import { describe, expect, it } from 'vitest'
import { TRANSCRIPT } from '../testing.ts'
import { generateMinutes } from './generate.ts'
import { chunkSegments, systemPrompt } from './prompt.ts'

describe('generateMinutes', () => {
  it('sends the numbered transcript and grounds the answer', async () => {
    const calls: { system: string; user: string }[] = []
    const { minutes } = await generateMinutes(TRANSCRIPT, {
      model: 'fake',
      generate: async (system, user) => {
        calls.push({ system, user })
        return {
          summary: [],
          decisions: [],
          action_items: [
            {
              task: 'Send the release notes',
              owner: 'Me',
              quote: 'I will send the release notes',
              segments: [3],
            },
            {
              task: 'Book flights to Tokyo',
              owner: 'Others',
              quote: 'book the flights to Tokyo',
              segments: [1],
            },
          ],
        }
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.user).toContain('[3] 00:14 Me: I will send the release notes')
    expect(calls[0]?.system).toContain('The transcript is in English')
    expect(minutes.actionItems.map((a) => a.task)).toEqual(['Send the release notes'])
    expect(minutes.model).toBe('fake')
  })

  it('splits long transcripts by size', () => {
    expect(chunkSegments(TRANSCRIPT.segments, 120).length).toBeGreaterThan(1)
    expect(chunkSegments([], 120)).toEqual([])
  })

  it('leaves the prompt alone for unknown languages', () => {
    expect(systemPrompt('auto', ['Me', 'Others'])).not.toContain('The transcript is in')
  })

  it('tells the model what the labels mean for recordings, imports and named tracks', () => {
    const tracks = systemPrompt('en', ['Me', 'Others', 'Me'])
    expect(tracks).toContain('"Me" is the person who recorded the meeting')

    const single = systemPrompt('en', ['Speaker', 'Speaker'])
    expect(single).toContain('one mixed track')
    expect(single).toContain('Never write "Speaker", "Me" or "Others" as an owner')
    expect(single).not.toContain('"Me" is the person')
    expect(single).not.toContain('based on who committed')

    // a recording without system audio, and --mic plus a named file from the CLI
    expect(systemPrompt('en', ['Me'])).toContain('"Me" is the person who recorded the meeting')
    expect(systemPrompt('en', ['Me', 'Ana'])).toContain('Speakers are labelled "Me", "Ana".')

    const named = systemPrompt('en', ['Ana', 'Bob'])
    expect(named).toContain('Speakers are labelled "Ana", "Bob".')
    expect(named).toContain('otherwise an empty string')
    expect(named).not.toContain('"Me" is the person')
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
