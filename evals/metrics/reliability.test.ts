import { describe, expect, it } from 'vitest'
import { type ReliabilityRun, reliability, reliabilityMarkdown } from './reliability.ts'

const run = (o: Partial<ReliabilityRun> = {}): ReliabilityRun => ({
  caseId: 'a',
  whisper: 'base',
  summary: 2,
  decisions: 1,
  expectsDecisions: true,
  tasksFound: 2,
  tasksTotal: 2,
  dueRight: 1,
  dueTotal: 1,
  dueWrong: 0,
  seconds: 1,
  ...o,
})

describe('reliability', () => {
  it('counts per case and model the runs with each part of the minutes', () => {
    const r = reliability([
      run(),
      run({ summary: 0, decisions: 0, tasksFound: 1, dueRight: 0 }),
      run({ whisper: 'turbo' }),
      run({ caseId: 'b', expectsDecisions: false, decisions: 0, dueWrong: 1 }),
    ])
    expect(r.rows).toEqual([
      {
        caseId: 'a',
        whisper: 'base',
        runs: 2,
        withSummary: 1,
        withDecisions: 1,
        allTasks: 1,
        dueRight: 1,
        dueTotal: 2,
        dueWrong: 0,
      },
      expect.objectContaining({ caseId: 'a', whisper: 'turbo', runs: 1, withDecisions: 1 }),
      expect.objectContaining({ caseId: 'b', withDecisions: undefined, dueWrong: 1 }),
    ])
    expect(r).toMatchObject({
      runs: 4,
      withSummary: 3,
      decisionRuns: 3,
      withDecisions: 2,
      allTasks: 3,
      dueRight: 3,
      dueTotal: 4,
      dueWrong: 1,
    })
  })

  it('renders a row per case and model and a total in percent', () => {
    const md = reliabilityMarkdown(
      reliability([run(), run({ summary: 0, decisions: 0 })]),
      'qwen',
      2,
    )
    expect(md).toContain('| a | base | 2 | 1/2 | 1/2 | 2/2 | 2/2 | 0 |')
    expect(md).toContain('| **Total** | | 2 | 50% | 50% | 100% | 100% | 0 |')
    expect(reliabilityMarkdown(reliability([run({ expectsDecisions: false })]), 'q', 1)).toContain(
      '| a | base | 1 | 1/1 | – | 1/1 | 1/1 | 0 |\n| **Total** | | 1 | 100% | – |',
    )
  })
})
