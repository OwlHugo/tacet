import { describe, expect, it } from 'vitest'
import { TRANSCRIPT } from '../testing.ts'
import { generateMinutes } from './generate.ts'
import { chunkSegments, systemPrompt } from './prompt.ts'

describe('generateMinutes', () => {
  it('asks for the overview and the tasks apart, on the numbered transcript, and grounds both', async () => {
    const calls: { system: string; user: string; part: string }[] = []
    const { minutes } = await generateMinutes(TRANSCRIPT, {
      model: 'fake',
      generate: async (system, user, part) => {
        calls.push({ system, user, part })
        if (part === 'overview')
          return {
            summary: [{ text: 'The team planned the beta launch.', segments: [0] }],
            decisions: [],
            action_items: [],
          }
        return {
          summary: [],
          decisions: [],
          action_items: [
            {
              task: 'Send the release notes',
              owner: 'Me',
              due: '',
              quote: 'I will send the release notes',
              segments: [3],
            },
            {
              task: 'Book flights to Tokyo',
              owner: 'Others',
              due: '',
              quote: 'book the flights to Tokyo',
              segments: [1],
            },
          ],
        }
      },
    })
    expect(calls.map((c) => c.part)).toEqual(['overview', 'tasks'])
    expect(calls[0]?.user).toContain('[3] 00:14 Me: I will send the release notes')
    expect(calls[1]?.user).toBe(calls[0]?.user)
    expect(calls[0]?.system).toContain('The transcript is in English')
    expect(calls[0]?.system).toContain('summary and the decisions')
    expect(calls[0]?.system).not.toContain('"due"')
    expect(calls[1]?.system).toContain('"due"')
    expect(calls[1]?.system).not.toContain('summary:')
    expect(minutes.summary.map((s) => s.text)).toEqual(['The team planned the beta launch.'])
    expect(minutes.actionItems.map((a) => a.task)).toEqual(['Send the release notes'])
    expect(minutes.model).toBe('fake')
  })

  it('splits long transcripts by size', () => {
    expect(chunkSegments(TRANSCRIPT.segments, 120).length).toBeGreaterThan(1)
    expect(chunkSegments([], 120)).toEqual([])
  })

  it('leaves the prompt alone for unknown languages', () => {
    expect(systemPrompt('auto', ['Me', 'Others'], 'tasks')).not.toContain('The transcript is in')
  })

  it('tells the model what the labels mean for recordings, imports and named tracks', () => {
    const tracks = systemPrompt('en', ['Me', 'Others', 'Me'], 'tasks')
    expect(tracks).toContain('"Me" is the person who recorded the meeting')

    const single = systemPrompt('en', ['Speaker', 'Speaker'], 'tasks')
    expect(single).toContain('one mixed track')
    expect(single).toContain('Never write "Speaker", "Me" or "Others" as an owner')
    expect(single).not.toContain('"Me" is the person')
    expect(single).not.toContain('based on who committed')

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
    // the overview never talks about owners: those belong to the tasks
    expect(systemPrompt('en', ['Me', 'Others'], 'overview')).not.toContain('"owner"')
    expect(systemPrompt('en', ['Me', 'Others'], 'overview')).toContain('never "Me did"')
  })

  it('sends the single-track prompt for an imported file', async () => {
    let system = ''
    await generateMinutes(
      { ...TRANSCRIPT, segments: TRANSCRIPT.segments.map((s) => ({ ...s, speaker: 'Speaker' })) },
      {
        model: 'fake',
        generate: async (s) => {
          system = s
          return { summary: [], decisions: [], action_items: [] }
        },
      },
    )
    expect(system).toContain('one mixed track')
  })
})
