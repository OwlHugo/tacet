import { describe, expect, it } from 'vitest'
import { TRANSCRIPT } from '../testing.ts'
import { groundMinutes } from './ground.ts'
import type { RawMinutes } from './types.ts'

const RAW: RawMinutes = {
  summary: [
    { text: 'The team planned the beta launch for Friday.', segments: [0, 1, 2] },
    { text: 'Budget for Q3 was approved.', segments: [0] },
  ],
  decisions: [
    { text: 'Ship the beta on Friday', quote: 'Agreed, Friday it is.', segments: [2] },
    {
      text: 'Drop the dark mode toggle',
      quote: 'drop the dark mode toggle for now',
      segments: [3],
    },
    { text: 'Hire two engineers', quote: 'we will hire two engineers', segments: [1] },
  ],
  action_items: [
    {
      task: 'Update the pricing page',
      owner: 'Maria',
      quote: 'Maria will update the pricing page.',
      segments: [2],
    },
    {
      task: 'Send the release notes to the team by Thursday',
      owner: 'Me',
      quote: 'I will send the release notes',
      segments: [3],
    },
    { task: 'Book the venue', owner: 'John', quote: 'John books the venue', segments: [1] },
  ],
}

const one = (task: string, owner: string, quote: string, segments: number[]): RawMinutes => ({
  summary: [],
  decisions: [],
  action_items: [{ task, owner, quote, segments }],
})

describe('groundMinutes', () => {
  const m = groundMinutes(RAW, TRANSCRIPT, 'test')

  it('keeps only items backed by the transcript', () => {
    expect(m.summary.map((s) => s.text)).toEqual(['The team planned the beta launch for Friday.'])
    expect(m.decisions.map((d) => d.text)).toEqual([
      'Ship the beta on Friday',
      'Drop the dark mode toggle',
    ])
    expect(m.actionItems.map((a) => a.task)).toEqual([
      'Update the pricing page',
      'Send the release notes to the team by Thursday',
    ])
    expect(m.rejected.map((r) => r.text).sort()).toEqual([
      'Book the venue',
      'Budget for Q3 was approved.',
      'Hire two engineers',
    ])
  })

  it('re-anchors a quote cited on the wrong line and takes the time from the transcript', () => {
    const dark = m.decisions.find((d) => d.text.startsWith('Drop'))
    expect(dark?.segments).toEqual([4])
    expect(dark?.at).toBe(20.5)
  })

  it('keeps a named owner only when the name was said', () => {
    expect(m.actionItems[0]?.owner).toBe('Maria')
    const fake = groundMinutes(
      one('Update the pricing page', 'Pedro', 'Maria will update the pricing page', [2]),
      TRANSCRIPT,
      't',
    )
    expect(fake.actionItems[0]?.owner).toBe('Unassigned')
  })

  it('gives an unnamed commitment to whoever said it', () => {
    const r = groundMinutes(
      one('Send the release notes', '', 'I will send the release notes', [3]),
      TRANSCRIPT,
      't',
    )
    expect(r.actionItems[0]?.owner).toBe('Me')
  })

  it('maps "eu"/"outros" owners to the track labels', () => {
    const r = groundMinutes(
      one('Send the release notes', 'eu', 'I will send the release notes', [3]),
      TRANSCRIPT,
      't',
    )
    expect(r.actionItems[0]?.owner).toBe('Me')
  })

  it('finds the source when the cited id does not exist', () => {
    const r = groundMinutes(
      one('Send the release notes', 'Me', 'send the release notes', [99]),
      TRANSCRIPT,
      't',
    )
    expect(r.actionItems[0]?.segments).toEqual([3])
  })

  it('rejects a task whose wording is unrelated to a real quote', () => {
    const r = groundMinutes(
      one('Renegotiate the cloud contract', 'Me', 'I will send the release notes', [3]),
      TRANSCRIPT,
      't',
    )
    expect(r.actionItems).toEqual([])
    expect(r.rejected[0]?.reason).toMatch(/wording/)
  })

  it('drops duplicates and blank items', () => {
    const r = groundMinutes(
      {
        summary: [{ text: '  ', segments: [0] }],
        decisions: [
          { text: 'Ship the beta on Friday', quote: 'Friday it is', segments: [2] },
          { text: 'Ship the beta Friday', quote: 'Friday it is', segments: [2] },
        ],
        action_items: [],
      },
      TRANSCRIPT,
      't',
    )
    expect(r.summary).toEqual([])
    expect(r.decisions).toHaveLength(1)
  })
})
