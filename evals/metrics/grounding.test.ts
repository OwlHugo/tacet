import { groundMinutes, type Minutes, type Transcript } from '@tacet/core'
import { describe, expect, it } from 'vitest'
import { checkGrounding } from './grounding.ts'

const T: Transcript = {
  language: 'en',
  model: 'base',
  duration: 10,
  segments: [
    { id: 0, start: 0, end: 4, speaker: 'Others', text: 'Maria will update the pricing page.' },
    { id: 1, start: 5, end: 9, speaker: 'Me', text: 'I will send the release notes by Thursday.' },
  ],
}

describe('checkGrounding', () => {
  it('passes items produced by the guard and counts expected tasks', () => {
    const m = groundMinutes(
      {
        summary: [],
        decisions: [],
        action_items: [
          {
            task: 'Update the pricing page',
            owner: 'Maria',
            quote: 'Maria will update the pricing page',
            segments: [0],
          },
        ],
      },
      T,
      't',
    )
    const r = checkGrounding(m, T, [
      ['pricing', 'page'],
      ['release', 'notes'],
    ])
    expect(r).toMatchObject({ items: 1, grounded: 1, expectedFound: 1, expectedTotal: 2 })
  })

  it('flags an item with a wrong timestamp or a quote that is not there', () => {
    const forged: Minutes = {
      summary: [],
      decisions: [{ text: 'Move to Lisbon', quote: 'we move to Lisbon', segments: [0], at: 0 }],
      actionItems: [
        {
          task: 'Send notes',
          owner: 'Me',
          quote: 'I will send the release notes',
          segments: [1],
          at: 2,
        },
      ],
      rejected: [],
      model: 'x',
    }
    const r = checkGrounding(forged, T, [])
    expect(r.grounded).toBe(0)
    expect(r.ungrounded.map((u) => u.kind)).toEqual(['decision', 'action'])
  })
})
