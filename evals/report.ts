import type { AnswerKeyReport } from './metrics/answer-key.ts'

export interface CaseResult {
  readonly id: string
  readonly audioSeconds: number
  readonly wer: number
  /** Undefined for one-track cases: every line lands on the only track, so there is nothing to measure. */
  readonly speakerAccuracy: number | undefined
  readonly timestampErrorSeconds: number | undefined
  readonly transcribeSecondsPerAudioMinute: number | undefined
  readonly minutesSecondsPerAudioMinute: number | undefined
  readonly items: number
  readonly grounded: number
  readonly expectedFound: number
  readonly expectedTotal: number
  readonly dueRight: number
  readonly dueTotal: number
  /** Tasks that carry a deadline other than the one said. */
  readonly dueWrong: readonly string[]
  /** Parts of the minutes that came out empty though the meeting had them ("summary", "decisions"). */
  readonly emptyParts: readonly string[]
  readonly guard: { readonly injected: number; readonly rejected: number }
  /** Scored against the case's answer key; undefined for a case without one. */
  readonly meaning: AnswerKeyReport | undefined
}

export interface Report {
  readonly mode: string
  readonly platform: string
  readonly whisperModel: string
  readonly llmModel: string
  readonly cases: readonly CaseResult[]
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const num = (x: number | undefined, suffix = '') =>
  x === undefined ? '–' : `${x.toFixed(2)}${suffix}`
const sum = (xs: readonly CaseResult[], f: (c: CaseResult) => number) =>
  xs.reduce((a, c) => a + f(c), 0)

/** Audio-weighted mean, ignoring cases where the metric was not measured. */
function weighted(
  cases: readonly CaseResult[],
  f: (c: CaseResult) => number | undefined,
): number | undefined {
  const measured = cases.filter((c) => f(c) !== undefined)
  const seconds = sum(measured, (c) => c.audioSeconds)
  return measured.length > 0
    ? sum(measured, (c) => (f(c) ?? 0) * c.audioSeconds) / seconds
    : undefined
}

function totals(r: Report) {
  const expected = sum(r.cases, (c) => c.expectedTotal)
  return {
    audioSeconds: sum(r.cases, (c) => c.audioSeconds),
    wer: weighted(r.cases, (c) => c.wer) ?? 0,
    transcribe: weighted(r.cases, (c) => c.transcribeSecondsPerAudioMinute),
    minutes: weighted(r.cases, (c) => c.minutesSecondsPerAudioMinute),
    items: sum(r.cases, (c) => c.items),
    grounded: sum(r.cases, (c) => c.grounded),
    recall: expected > 0 ? sum(r.cases, (c) => c.expectedFound) / expected : undefined,
    dueRight: sum(r.cases, (c) => c.dueRight),
    dueTotal: sum(r.cases, (c) => c.dueTotal),
    dueWrong: r.cases.flatMap((c) => c.dueWrong.map((w) => `${c.id}: ${w}`)),
    emptyParts: r.cases.flatMap((c) => c.emptyParts.map((p) => `${c.id}: no ${p}`)),
    wrongOwner: r.cases.flatMap((c) =>
      c.meaning === undefined || c.meaning.wrongOwner === 0
        ? []
        : [`${c.id}: ${c.meaning.wrongOwner} task(s)`],
    ),
    injected: sum(r.cases, (c) => c.guard.injected),
    rejected: sum(r.cases, (c) => c.guard.rejected),
  }
}

/** right/given as precision, found/total as recall: "2/3 · 2/2". */
const ratio = (a: number, b: number) => `${a}/${b}`

/** The minutes against each answer key: what was really decided and assigned, by meaning. */
function meaningTable(r: Report): string[] {
  const scored = r.cases.flatMap((c) =>
    c.meaning === undefined ? [] : [{ id: c.id, m: c.meaning }],
  )
  if (scored.length === 0) return []
  const rows = scored.map(
    ({ id, m }) =>
      `| ${id} | ${m.subject ? 'yes' : 'no'} | ${ratio(m.decisions.right, m.decisions.given)} | ${ratio(m.decisions.found, m.decisions.total)} | ${ratio(m.tasks.right, m.tasks.given)} | ${ratio(m.tasks.found, m.tasks.total)} | ${m.wrongOwner} | ${m.invented.length} |`,
  )
  return [
    '',
    '| Case | Main subject in summary | Decisions right (precision) | Decisions found (recall) | Tasks right (precision) | Tasks found (recall) | Wrong owner | Invented items |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
  ]
}

export function toMarkdown(r: Report): string {
  const t = totals(r)
  const rows = r.cases.map(
    (c) =>
      `| ${c.id} | ${c.audioSeconds.toFixed(1)}s | ${pct(c.wer)} | ${c.speakerAccuracy === undefined ? '–' : pct(c.speakerAccuracy)} | ${num(c.timestampErrorSeconds, 's')} | ${num(c.transcribeSecondsPerAudioMinute)} | ${num(c.minutesSecondsPerAudioMinute)} | ${c.grounded}/${c.items} | ${c.expectedFound}/${c.expectedTotal} | ${c.dueRight}/${c.dueTotal} |`,
  )
  return [
    '| Case | Audio | WER | Speaker attribution | Timestamp error | Transcribe (s / audio min) | Minutes (s / audio min) | Grounded items | Expected tasks found | Deadlines right |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    `| **Total** | ${t.audioSeconds.toFixed(1)}s | ${pct(t.wer)} | | | ${num(t.transcribe)} | ${num(t.minutes)} | ${t.grounded}/${t.items} | ${t.recall === undefined ? '–' : pct(t.recall)} | ${t.dueRight}/${t.dueTotal} |`,
    '',
    ...meaningTable(r),
    '',
    `Hallucination guard: ${t.rejected}/${t.injected} fabricated items rejected.`,
    `Mode \`${r.mode}\`, platform ${r.platform}, whisper \`${r.whisperModel}\`, LLM \`${r.llmModel}\`.`,
  ].join('\n')
}

/**
 * Below this share of the deadlines said in the scripts, the eval fails: a prompt change that makes
 * the model stop giving deadlines (all dropped, none wrong) must not pass. The 7B model misses one
 * now and then, hence the margin.
 */
const MIN_DUE_RECALL = 0.7

/** Problems that fail the eval. Empty = pass. */
export function failures(r: Report, maxWer: number | undefined): string[] {
  const t = totals(r)
  return [
    ...(t.grounded === t.items ? [] : [`${t.items - t.grounded} minutes item(s) without a source`]),
    ...(t.rejected === t.injected ? [] : ['the hallucination guard let a fabricated item through']),
    ...t.dueWrong.map((w) => `wrong deadline: ${w}`),
    ...t.emptyParts.map((p) => `empty minutes part: ${p}`),
    ...t.wrongOwner.map((w) => `owner the answer key does not allow: ${w}`),
    ...(t.dueTotal > 0 && t.dueRight / t.dueTotal < MIN_DUE_RECALL
      ? [`only ${t.dueRight}/${t.dueTotal} deadlines found`]
      : []),
    ...(maxWer !== undefined && t.wer > maxWer ? [`WER ${pct(t.wer)} above ${pct(maxWer)}`] : []),
  ]
}
