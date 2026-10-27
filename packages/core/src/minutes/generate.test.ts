import { describe, expect, it } from 'vitest'
import { TRANSCRIPT } from '../testing.ts'
import { generateMinutes } from './generate.ts'
import { madeUp } from './made-up.ts'
import { chunkSegments, systemPrompt } from './prompt.ts'
import type { GenerateRawMinutes, MinutesPart } from './types.ts'

interface Call {
  readonly system: string
  readonly user: string
  readonly part: MinutesPart
}

/** A fake model: one fixed answer per part, every call recorded. */
function fake(answers: Partial<Record<MinutesPart, (user: string) => unknown>>) {
  const calls: Call[] = []
  const generate: GenerateRawMinutes = async (system, user, part) => {
    calls.push({ system, user, part })
    const empty = {
      summary: { summary: [] },
      decisions: { decisions: [] },
      tasks: { action_items: [] },
      confirm: { kind: 'agreed', agreed: true },
      deadline: { is_time: true, for_this_task: true },
    }[part]
    return answers[part]?.(user) ?? empty
  }
  return { calls, generate }
}

const releaseNotes = (due = '') => ({
  task: 'Send the release notes',
  owner: 'Me',
  due,
  quote: 'I will send the release notes',
  segments: [3],
})

describe('generateMinutes', () => {
  it('asks for each list apart, on the numbered transcript, and grounds them', async () => {
    const { calls, generate } = fake({
      summary: () => ({ summary: [{ text: 'The team planned the beta launch.', segments: [0] }] }),
      decisions: () => ({
        decisions: [{ text: 'Ship the beta on Friday', quote: 'Friday it is', segments: [2] }],
      }),
      tasks: () => ({
        action_items: [
          releaseNotes(),
          {
            task: 'Book flights to Tokyo',
            owner: 'Others',
            due: '',
            quote: 'book the flights to Tokyo',
            segments: [1],
          },
        ],
      }),
    })
    const { minutes } = await generateMinutes(TRANSCRIPT, { model: 'fake', generate })
    expect(calls.map((c) => c.part)).toEqual(['summary', 'decisions', 'tasks', 'confirm'])
    expect(calls[0]?.user).toContain('[3] 00:14 Me: I will send the release notes')
    expect(calls[1]?.user).toBe(calls[0]?.user)
    expect(calls[0]?.system).toContain('The transcript is in English')
    expect(calls[0]?.system).toContain('main subject')
    expect(calls[1]?.system).toContain('sarcasm')
    expect(calls[2]?.system).toContain('"due"')
    // the check sees the decision and only the lines around its source
    expect(calls[3]?.user).toContain('Item: Ship the beta on Friday')
    expect(calls[3]?.user).toContain('[2] 00:09 Others: Agreed, Friday it is.')
    expect(minutes.summary.map((s) => s.text)).toEqual(['The team planned the beta launch.'])
    expect(minutes.decisions.map((d) => d.text)).toEqual(['Ship the beta on Friday'])
    // grounding, not the check, drops the task nobody said
    expect(minutes.actionItems.map((a) => a.task)).toEqual(['Send the release notes'])
    expect(minutes.model).toBe('fake')
  })

  it('drops a decision the check says was not settled, and never asks it about tasks', async () => {
    const { generate } = fake({
      decisions: () => ({
        decisions: [
          { text: 'Ship the beta on Friday', quote: 'Friday it is', segments: [2] },
          { text: 'Drop the dark mode toggle', quote: 'drop the dark mode toggle', segments: [4] },
        ],
      }),
      tasks: () => ({ action_items: [releaseNotes()] }),
      confirm: (user) =>
        /^Item: (Drop the dark mode|Send the release notes)/.test(user)
          ? { kind: 'joke', agreed: true }
          : { kind: 'agreed', agreed: true },
    })
    const { minutes, raw } = await generateMinutes(TRANSCRIPT, { model: 'fake', generate })
    expect(minutes.decisions.map((d) => d.text)).toEqual(['Ship the beta on Friday'])
    expect(minutes.actionItems.map((a) => a.task)).toEqual(['Send the release notes'])
    expect(raw.decisions).toHaveLength(1)
    expect(madeUp(minutes)).toBe(0)
    expect(minutes.rejected).toContainEqual({
      kind: 'unconfirmed',
      text: 'Drop the dark mode toggle',
      reason: 'not settled in its lines',
    })
  })

  it('shows each check two lines on each side of the source, and no more', async () => {
    const long = {
      ...TRANSCRIPT,
      segments: Array.from({ length: 12 }, (_, id) => ({
        id,
        start: id * 3,
        end: id * 3 + 2,
        speaker: 'Me',
        text: id === 6 ? 'We agreed to ship the beta on Friday.' : `Line number ${id} of the call.`,
      })),
    }
    const { calls, generate } = fake({
      decisions: () => ({
        decisions: [
          { text: 'Ship the beta on Friday', quote: 'ship the beta on Friday', segments: [6] },
        ],
      }),
    })
    await generateMinutes(long, { model: 'fake', generate })
    const shown = [
      ...(calls.find((c) => c.part === 'confirm')?.user ?? '').matchAll(/^\[(\d+)\]/gm),
    ]
    expect(shown.map((m) => Number(m[1]))).toEqual([4, 5, 6, 7, 8])
  })

  it('needs both the kind and the answer to agree', async () => {
    const { generate } = fake({
      decisions: () => ({
        decisions: [{ text: 'Ship the beta on Friday', quote: 'Friday it is', segments: [2] }],
      }),
      confirm: () => ({ kind: 'agreed', agreed: false }),
    })
    const { minutes } = await generateMinutes(TRANSCRIPT, { model: 'fake', generate })
    expect(minutes.decisions).toEqual([])
  })

  it('keeps a deadline only when its check says it is a time said for that task', async () => {
    const run = async (answer: { is_time: boolean; for_this_task: boolean }) => {
      const { calls, generate } = fake({
        tasks: () => ({ action_items: [releaseNotes('by Thursday')] }),
        deadline: () => answer,
      })
      const { minutes } = await generateMinutes(TRANSCRIPT, { model: 'fake', generate })
      return { due: minutes.actionItems[0]?.due, calls }
    }
    const kept = await run({ is_time: true, for_this_task: true })
    expect(kept.due).toBe('by Thursday')
    expect(kept.calls.at(-1)?.user).toContain('Deadline: by Thursday')
    expect((await run({ is_time: false, for_this_task: true })).due).toBeUndefined()
    expect((await run({ is_time: true, for_this_task: false })).due).toBeUndefined()
  })

  it('takes a refused deadline out of the task wording too, and says why', async () => {
    const { generate } = fake({
      tasks: () => ({
        action_items: [{ ...releaseNotes('by Friday'), task: 'Send the release notes by Friday' }],
      }),
      deadline: () => ({ is_time: true, for_this_task: false }),
    })
    const { minutes } = await generateMinutes(TRANSCRIPT, { model: 'fake', generate })
    expect(minutes.actionItems[0]?.task).toBe('Send the release notes')
    expect(minutes.actionItems[0]).not.toHaveProperty('due')
    expect(minutes.rejected).toContainEqual({
      kind: 'deadline',
      text: 'Send the release notes by Friday: by Friday',
      reason: 'deadline said for other work',
    })
  })

  it('does not check a deadline that was not given, nor one on a task with no source', async () => {
    const { calls, generate } = fake({
      tasks: () => ({
        action_items: [
          releaseNotes(),
          {
            task: 'Book flights to Tokyo',
            owner: 'Others',
            due: 'tomorrow',
            quote: 'book the flights to Tokyo',
            segments: [9],
          },
        ],
      }),
    })
    const { minutes } = await generateMinutes(TRANSCRIPT, { model: 'fake', generate })
    expect(calls.filter((c) => c.part === 'deadline')).toEqual([])
    expect(calls.filter((c) => c.part === 'confirm')).toEqual([])
    expect(minutes.actionItems.map((a) => a.task)).toEqual(['Send the release notes'])
  })

  it('rejects an answer outside the schema of its part', async () => {
    const { generate } = fake({ summary: () => ({ summary: 'not a list' }) })
    await expect(generateMinutes(TRANSCRIPT, { model: 'fake', generate })).rejects.toThrow()
  })

  it('gives the user their own tasks when they said who they are', async () => {
    const mixed = {
      ...TRANSCRIPT,
      segments: TRANSCRIPT.segments.map((s) => ({ ...s, speaker: 'Speaker' })),
    }
    const { calls, generate } = fake({
      tasks: () => ({ action_items: [{ ...releaseNotes(), owner: 'Rafa' }] }),
    })
    const { minutes } = await generateMinutes(mixed, {
      model: 'fake',
      generate,
      self: { name: 'Rafael', aliases: ['Rafa'] },
    })
    expect(calls[2]?.system).toContain('The meeting was recorded by "Rafael" (also called "Rafa")')
    expect(minutes.actionItems[0]?.owner).toBe('Rafael')
  })

  it('asks for the summary and decisions on shorter chunks than the tasks', async () => {
    const long = {
      ...TRANSCRIPT,
      segments: Array.from({ length: 60 }, (_, id) => ({
        id,
        start: id * 5,
        end: id * 5 + 4,
        speaker: 'Me',
        text: 'We talk about the launch plan for a while, line after line, until the end. '.repeat(
          1,
        ),
      })),
    }
    const { calls, generate } = fake({})
    await generateMinutes(long, { model: 'fake', generate })
    const count = (part: MinutesPart) => calls.filter((c) => c.part === part).length
    expect(count('summary')).toBe(count('decisions'))
    expect(count('summary')).toBeGreaterThan(1)
    expect(count('tasks')).toBe(1)
  })

  it('splits long transcripts by size', () => {
    expect(chunkSegments(TRANSCRIPT.segments, 120).length).toBeGreaterThan(1)
    expect(chunkSegments([], 120)).toEqual([])
  })

  it('leaves the prompt alone for unknown languages', () => {
    expect(systemPrompt('auto', ['Me', 'Others'], 'tasks')).not.toContain('The transcript is in')
    expect(systemPrompt('auto', [], 'confirm')).not.toContain('The transcript is in')
    expect(systemPrompt('pt', [], 'deadline')).toContain('The transcript is in Portuguese.')
    expect(systemPrompt('pt', [], 'confirm')).not.toContain('Write every field')
  })

  it('tells the model what the labels mean for recordings, imports and named tracks', () => {
    const tracks = systemPrompt('en', ['Me', 'Others', 'Me'], 'tasks')
    expect(tracks).toContain('"Me" is the person who recorded the meeting')
    expect(systemPrompt('en', ['Me', 'Others'], 'tasks', { name: 'Ana', aliases: [] })).toContain(
      '"Me" is "Ana".',
    )

    const single = systemPrompt('en', ['Speaker', 'Speaker'], 'tasks')
    expect(single).toContain('one mixed track')
    expect(single).toContain('Never write "Speaker", "Me" or "Others" as an owner')
    expect(single).not.toContain('"Me" is the person')
    expect(single).not.toContain('based on who committed')
    expect(single).not.toContain('recorded by')

    // a recording without system audio, and --mic plus a named file from the CLI
    expect(systemPrompt('en', ['Me'], 'tasks')).toContain(
      '"Me" is the person who recorded the meeting',
    )
    expect(systemPrompt('en', ['Me', 'Ana'], 'tasks')).toContain(
      'Speakers are labelled "Me", "Ana".',
    )

    const named = systemPrompt('en', ['Ana', 'Bob'], 'tasks')
    expect(named).toContain('Speakers are labelled "Ana", "Bob".')
    expect(named).toContain('otherwise an empty string')
    expect(named).not.toContain('"Me" is the person')
    // summary and decisions never talk about owners: those belong to the tasks
    expect(systemPrompt('en', ['Me', 'Others'], 'decisions')).not.toContain('"owner"')
    expect(systemPrompt('en', ['Me', 'Others'], 'summary')).toContain('never "Me did"')
  })

  it('sends the single-track prompt for an imported file', async () => {
    const { calls, generate } = fake({})
    await generateMinutes(
      { ...TRANSCRIPT, segments: TRANSCRIPT.segments.map((s) => ({ ...s, speaker: 'Speaker' })) },
      { model: 'fake', generate },
    )
    expect(calls[0]?.system).toContain('one mixed track')
  })
})
