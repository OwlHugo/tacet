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
  emptyParts: [],
  guard: { injected: 4, rejected: 4 },
  meaning: undefined,
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
    const r = report([
      c({ dueRight: 1, dueTotal: 1, dueWrong: ['Send notes: "friday", expected "thursday"'] }),
    ])
    expect(failures(r, undefined)).toEqual([
      'wrong deadline: a: Send notes: "friday", expected "thursday"',
    ])
  })
  it('fails on minutes with an empty summary or no decisions where the meeting had them', () => {
    expect(failures(report([c({ emptyParts: ['summary', 'decisions'] })]), undefined)).toEqual([
      'empty minutes part: a: no summary',
      'empty minutes part: a: no decisions',
    ])
  })
  it('fails on a task whose owner the answer key does not allow', () => {
    const meaning = {
      subject: true,
      summary: { points: 1, firstIsSubject: true, withSubject: 1, found: 0, total: 0 },
      decisions: { given: 1, right: 1, found: 1, total: 1 },
      tasks: { given: 2, right: 2, found: 2, total: 2 },
      wrongOwner: 1,
      invented: [],
    }
    expect(failures(report([c({ meaning })]), undefined)).toEqual([
      'owner the answer key does not allow: a: 1 task(s)',
    ])
    expect(failures(report([c({ meaning: { ...meaning, wrongOwner: 0 } })]), undefined)).toEqual([])
  })
  it('fails when too few of the deadlines said were found', () => {
    expect(failures(report([c({ dueRight: 1, dueTotal: 2 })]), undefined)).toEqual([
      'only 1/2 deadlines found',
    ])
    expect(failures(report([c({ dueRight: 7, dueTotal: 10 })]), undefined)).toEqual([])
    expect(failures(report([c({ dueRight: 0, dueTotal: 0 })]), undefined)).toEqual([])
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

  it('adds the answer key table only for cases that have one', () => {
    const meaning = {
      subject: false,
      summary: { points: 7, firstIsSubject: false, withSubject: 3, found: 2, total: 4 },
      decisions: { given: 3, right: 1, found: 1, total: 2 },
      tasks: { given: 2, right: 2, found: 2, total: 3 },
      wrongOwner: 1,
      invented: ['decision: x', 'decision: y'],
    }
    const md = toMarkdown(report([c(), c({ id: 'k', meaning })]))
    expect(md).toContain('| k | no | 7 | no | 3 | 2/4 | 1/3 | 1/2 | 2/2 | 2/3 | 1 | 2 |')
    expect(
      toMarkdown(
        report([
          c({ id: 'k', meaning: { ...meaning, summary: { ...meaning.summary, total: 0 } } }),
        ]),
      ),
    ).toContain('| k | no | 7 | no | 3 | – |')
    expect(
      toMarkdown(
        report([
          c({
            id: 'k',
            meaning: {
              ...meaning,
              subject: true,
              summary: { ...meaning.summary, firstIsSubject: true },
            },
          }),
        ]),
      ),
    ).toContain('| k | yes | 7 | yes | 3 | 2/4 |')
    expect(md).toContain(
      '| Summary points | First point is the subject | Points with the subject | Summary points of the key found |',
    )
    expect(md.split('Invented items |')[1]?.split('\n')[1]).toBe(
      '|---|---|---|---|---|---|---|---|---|---|---|---|',
    )
    expect(md.split('Invented items')[1]).not.toContain('| a | ')
    expect(toMarkdown(report([c()]))).not.toContain('Invented items')
  })
})
