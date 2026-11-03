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
            due: '',
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

  it('checks a summary point against its lines and the ones next to them', () => {
    const point = (text: string, segments: number[], at: number): Minutes => ({
      summary: [{ text, segments: segments as [number, ...number[]], at }],
      decisions: [],
      actionItems: [],
      rejected: [],
      model: 'x',
    })
    const ok = (m: Minutes) => checkGrounding(m, T, []).grounded === 1
    expect(ok(point('Release notes go out Thursday', [0], 0))).toBe(true)
    expect(ok(point('Release notes go out Thursday', [1], 0))).toBe(false)
    expect(ok(point('The office moves to Lisbon', [0], 0))).toBe(false)
    expect(ok(point('Release notes go out Thursday', [7], 0))).toBe(false)
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

  it('flags an owner that is not a track, not a name that was said, or the single-track label', () => {
    const task = (owner: string): Minutes => ({
      summary: [],
      decisions: [],
      actionItems: [
        { task: 'Send notes', owner, quote: 'I will send the release notes', segments: [1], at: 5 },
      ],
      rejected: [],
      model: 'x',
    })
    const ok = (owner: string, t: Transcript = T) =>
      checkGrounding(task(owner), t, []).grounded === 1
    expect(['Me', 'Others', 'Maria', 'Unassigned'].map((o) => ok(o))).toEqual([
      true,
      true,
      true,
      true,
    ])
    expect(ok('Pedro')).toBe(false)
    // The user's own name, set with --me, may own a task without being said.
    const pedro = { name: 'Pedro', aliases: ['Pepe'] }
    const mixed = { ...T, segments: T.segments.map((s) => ({ ...s, speaker: 'Speaker' })) }
    const asSelf = (owner: string, t: Transcript = mixed) =>
      checkGrounding(task(owner), t, [], pedro).grounded === 1
    expect([asSelf('Pedro'), asSelf('Pepe'), asSelf('Paulo')]).toEqual([true, true, false])
    // On two tracks the user is "Me": their name as owner is not grounded.
    expect(asSelf('Pedro', T)).toBe(false)
    // "the others" is said, but there is no Others track: still not an owner
    const single = {
      ...T,
      segments: [
        ...T.segments.map((s) => ({ ...s, speaker: 'Speaker' })),
        {
          id: 2,
          start: 10,
          end: 12,
          speaker: 'Speaker',
          text: 'Next speaker: ask me and the others to review it.',
        },
      ],
    }
    expect(['speaker', 'Speaker A'].map((o) => ok(o, single))).toEqual([false, false])
    expect(['Me', 'Others', 'Speaker', 'Maria'].map((o) => ok(o, single))).toEqual([
      false,
      false,
      false,
      true,
    ])
  })
})
