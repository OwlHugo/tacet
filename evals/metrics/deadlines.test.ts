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
          quote: 'I will send the release notes by Thursday',
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

  it('counts each expected deadline once, even when two tasks carry it', () => {
    const twice = minutes('by Thursday')
    const copy = twice.actionItems.map((a) => ({ ...a, task: `${a.task} again` }))
    const r = checkDeadlines({ ...twice, actionItems: [...twice.actionItems, ...copy] }, [
      { task: ['release', 'notes'], due: 'thursday' },
    ])
    expect(r).toEqual({ right: 1, total: 1, wrong: [] })
  })

  it('leaves an optional deadline out of the count, but still checks its words', () => {
    const optional = (due: string) => [{ task: ['release', 'notes'], due, optional: true }]
    expect(checkDeadlines(minutes('by Thursday'), optional('thursday'))).toEqual({
      right: 0,
      total: 0,
      wrong: [],
    })
    expect(checkDeadlines(minutes('by Thursday'), optional('friday')).wrong).toEqual([
      'Send the release notes: "by Thursday", expected "friday"',
    ])
  })

  it('lists a deadline on a task the script gives none', () => {
    const r = checkDeadlines(minutes('by Thursday'), [{ task: ['pricing', 'page'], due: 'friday' }])
    expect(r).toEqual({
      right: 0,
      total: 1,
      wrong: ['Send the release notes: "by Thursday", expected no deadline'],
    })
  })

  it('needs every keyword of the task and every word of the deadline', () => {
    const r = checkDeadlines(minutes('by Thursday'), [
      { task: ['release', 'notes'], due: 'thursday morning' },
    ])
    expect(r.right).toBe(0)
    expect(r.wrong).toEqual(['Send the release notes: "by Thursday", expected "thursday morning"'])
    const other = checkDeadlines(minutes('by Thursday'), [
      { task: ['release', 'venue'], due: 'thursday' },
    ])
    expect(other.wrong).toEqual(['Send the release notes: "by Thursday", expected no deadline'])
  })

  it('lists a task whose deadline is not the expected one', () => {
    const m = minutes('by Thursday')
    const off = { ...m, actionItems: m.actionItems.map((a) => ({ ...a, due: 'by Friday' })) }
    const r = checkDeadlines(off, [{ task: ['release', 'notes'], due: 'thursday' }])
    expect(r.right).toBe(0)
    expect(r.wrong).toEqual([
      'Update the pricing page: "by Friday", expected no deadline',
      'Send the release notes: "by Friday", expected "thursday"',
    ])
  })

  it('matches a task by its wording before its quote, which may be the reply about another task', () => {
    const m = minutes('by Thursday')
    const item = m.actionItems[0]
    if (item === undefined) throw new Error('no task')
    const tela = {
      ...item,
      task: 'Build the checkout screen',
      quote: 'Fechado. Só que eu preciso dos textos de erro',
      due: 'by Thursday',
    }
    const r = checkDeadlines({ ...m, actionItems: [tela] }, [
      { task: ['textos', 'erro'], due: 'tomorrow' },
      { task: ['checkout', 'screen'], due: 'thursday' },
    ])
    expect(r).toEqual({ right: 1, total: 2, wrong: [] })
  })
})
