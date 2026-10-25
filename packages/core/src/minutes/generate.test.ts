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
    expect(systemPrompt('auto')).not.toContain('The transcript is in')
  })
})
