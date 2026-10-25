import { describe, expect, it } from 'vitest'
import { type CaseResult, failures, type Report, toMarkdown } from './report.ts'

const c = (over: Partial<CaseResult> = {}): CaseResult => ({
  id: 'a',
  audioSeconds: 30,
  wer: 0.1,
  speakerAccuracy: 1,
  timestampErrorSeconds: 0.01,
  transcribeSecondsPerAudioMinute: 2,
  minutesSecondsPerAudioMinute: undefined,
  items: 2,
  grounded: 2,
  expectedFound: 1,
  expectedTotal: 2,
  dueRight: 1,
  dueTotal: 1,
  dueWrong: [],
  guard: { injected: 4, rejected: 4 },
  ...over,
})
const report = (cases: CaseResult[]): Report => ({
  mode: 'sem-ia',
  platform: 'x',
  whisperModel: 'base',
  llmModel: 'm',
  cases,
})

describe('eval report', () => {
  it('passes when everything is grounded and the guard holds', () => {
    expect(failures(report([c(), c({ id: 'b', audioSeconds: 10, wer: 0.3 })]), 0.2)).toEqual([])
  })
  it('fails on ungrounded items, a leaking guard or a WER above the limit', () => {
    const r = report([c({ grounded: 1, guard: { injected: 4, rejected: 3 }, wer: 0.5 })])
    expect(failures(r, 0.2)).toHaveLength(3)
  })
  it('fails on a task that carries a deadline nobody said for it', () => {
    const r = report([c({ dueRight: 0, dueWrong: ['Send notes: "friday", expected "thursday"'] })])
    expect(failures(r, undefined)).toEqual([
      'wrong deadline: a: Send notes: "friday", expected "thursday"',
    ])
  })
  it('renders a weighted total row', () => {
    const md = toMarkdown(report([c(), c({ id: 'b', audioSeconds: 10, wer: 0.3 })]))
    expect(md).toContain('| **Total** | 40.0s | 15.0% |')
    expect(md).toContain('Hallucination guard: 8/8')
    expect(md).toContain(
      '| Expected tasks found | Deadlines right |\n|---|---|---|---|---|---|---|---|---|---|\n',
    )
    expect(md).toContain('| 2/2 | 1/2 | 1/1 |\n')
    expect(md).toContain('| 4/4 | 50.0% | 2/2 |\n')
    expect(toMarkdown(report([c({ expectedTotal: 0, expectedFound: 0 })]))).toContain(
      '| 2/2 | – | 1/1 |',
    )
  })

  it('shows no speaker attribution for a one-track case', () => {
    const md = toMarkdown(report([c(), c({ id: 'single', speakerAccuracy: undefined })]))
    expect(md).toContain('| a | 30.0s | 10.0% | 100.0% |')
    expect(md).toContain('| single | 30.0s | 10.0% | – |')
  })
})
