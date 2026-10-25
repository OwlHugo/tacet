import { groundMinutes, type Transcript } from '@tacet/core'
import { describe, expect, it } from 'vitest'
import { checkDeadlines } from './deadlines.ts'

const T: Transcript = {
  language: 'en',
  model: 'base',
  duration: 10,
  segments: [
    { id: 0, start: 0, end: 4, speaker: 'Others', text: 'Maria will update the pricing page.' },
    { id: 1, start: 5, end: 9, speaker: 'Me', text: 'I will send the release notes by Thursday.' },
  ],
}

const minutes = (due: string) =>
  groundMinutes(
    {
      summary: [],
      decisions: [],
      action_items: [
        {
          task: 'Send the release notes',
          owner: 'Me',
          due,
          quote: 'I will send the release notes',
          segments: [1],
        },
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

describe('checkDeadlines', () => {
  it('counts a deadline on the right task, and a missing one as not right', () => {
    const r = checkDeadlines(minutes('by Thursday'), [
      { task: ['release', 'notes'], due: 'thursday' },
      { task: ['pricing', 'page'], due: 'friday' },
    ])
    expect(r).toEqual({ right: 1, total: 2, wrong: [] })
  })

  it('needs every keyword of the task and every word of the deadline', () => {
    const r = checkDeadlines(minutes('by Thursday'), [
      { task: ['release', 'pricing'], due: 'thursday' },
      { task: ['release', 'notes'], due: 'thursday morning' },
    ])
    expect(r.right).toBe(0)
    expect(r.wrong).toEqual(['Send the release notes: "by Thursday", expected "thursday morning"'])
  })

  it('lists a task whose deadline is not the expected one', () => {
    const r = checkDeadlines(minutes('notes'), [{ task: ['release', 'notes'], due: 'thursday' }])
    expect(r.right).toBe(0)
    expect(r.wrong).toEqual(['Send the release notes: "notes", expected "thursday"'])
  })
})
