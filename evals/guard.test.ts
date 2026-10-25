import type { Transcript } from '@tacet/core'
import { describe, expect, it } from 'vitest'
import { guardCheck } from './guard.ts'

const T: Transcript = {
  language: 'en',
  model: 'base',
  duration: 9,
  segments: [
    { id: 0, start: 0, end: 4, speaker: 'Others', text: 'Maria will update the pricing page.' },
    { id: 1, start: 5, end: 9, speaker: 'Me', text: 'I will send the release notes.' },
  ],
}

describe('guardCheck', () => {
  it('counts every injected item as rejected and leaves real items alone', () => {
    const r = guardCheck(
      {
        summary: [],
        decisions: [],
        action_items: [
          {
            task: 'Send the release notes',
            owner: 'Me',
            quote: 'I will send the release notes',
            segments: [1],
          },
        ],
      },
      T,
    )
    expect(r).toEqual({ injected: 4, rejected: 4 })
  })

  it('notices when a fabricated item survives', () => {
    const leaky: Transcript = {
      ...T,
      segments: [
        ...T.segments,
        {
          id: 2,
          start: 10,
          end: 14,
          speaker: 'Others',
          text: 'please book the flights to Tokyo for the offsite',
        },
      ],
    }
    expect(guardCheck({ summary: [], decisions: [], action_items: [] }, leaky).rejected).toBe(3)
  })
})
