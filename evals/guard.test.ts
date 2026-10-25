import type { RawMinutes, Transcript } from '@tacet/core'
import { describe, expect, it } from 'vitest'
import { guardCheck } from './guard.ts'

const T: Transcript = {
  language: 'en',
  model: 'base',
  duration: 9,
  segments: [
    {
      id: 0,
      start: 0,
      end: 4,
      speaker: 'Others',
      text: 'Maria will update the pricing page by Monday.',
    },
    { id: 1, start: 5, end: 9, speaker: 'Me', text: 'I will send the release notes by Thursday.' },
  ],
}

const RAW: RawMinutes = {
  summary: [],
  decisions: [],
  action_items: [
    {
      task: 'Update the pricing page',
      owner: 'Maria',
      due: 'by Monday',
      quote: 'Maria will update the pricing page',
      segments: [0],
    },
    {
      task: 'Send the release notes',
      owner: 'Me',
      due: 'by Thursday',
      quote: 'I will send the release notes',
      segments: [1],
    },
  ],
}

describe('guardCheck', () => {
  it('rejects the fabricated items and every deadline attack on real tasks', () => {
    // 4 fabricated items + per task: made up, moved from the other task, shared line
    expect(guardCheck(RAW, T)).toEqual({ injected: 10, rejected: 10 })
  })

  it('moves nothing onto a task when no other deadline was said', () => {
    const one = { ...RAW, action_items: RAW.action_items.slice(0, 1) }
    // 4 fabricated + made up + shared line
    expect(guardCheck(one, T)).toEqual({ injected: 6, rejected: 6 })
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
    expect(guardCheck({ summary: [], decisions: [], action_items: [] }, leaky)).toEqual({
      injected: 4,
      rejected: 3,
    })
  })

  it('notices a deadline that the transcript lets through on the wrong task', () => {
    // The notes line also says "by Monday": moving Maria's deadline there survives.
    const both: Transcript = {
      ...T,
      segments: [
        T.segments[0] as Transcript['segments'][number],
        {
          id: 1,
          start: 5,
          end: 9,
          speaker: 'Me',
          text: 'I will send the release notes by Thursday, or by Monday.',
        },
      ],
    }
    expect(guardCheck(RAW, both)).toEqual({ injected: 10, rejected: 9 })
  })
})
