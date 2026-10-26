/** One minutes run on one transcript. */
export interface ReliabilityRun {
  readonly caseId: string
  readonly whisper: string
  readonly summary: number
  readonly decisions: number
  /** Whether the script has a decision, so an empty list is a miss. */
  readonly expectsDecisions: boolean
  readonly tasksFound: number
  readonly tasksTotal: number
  readonly dueRight: number
  readonly dueTotal: number
  readonly dueWrong: number
  readonly seconds: number
  /** The request itself failed (Ollama down, model missing): no minutes, and not an empty answer. */
  readonly failed: boolean
}

interface ReliabilityRow {
  readonly caseId: string
  readonly whisper: string
  readonly runs: number
  readonly withSummary: number
  /** Undefined when the case has no decision to find. */
  readonly withDecisions: number | undefined
  /** Runs that found every expected task. */
  readonly allTasks: number
  readonly dueRight: number
  readonly dueTotal: number
  readonly dueWrong: number
  readonly failed: number
}

export interface Reliability {
  readonly rows: readonly ReliabilityRow[]
  readonly runs: number
  readonly withSummary: number
  readonly decisionRuns: number
  readonly withDecisions: number
  readonly allTasks: number
  readonly dueRight: number
  readonly dueTotal: number
  readonly dueWrong: number
  readonly failed: number
}

const sum = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0)

/** Per case and whisper model, and in total: how many runs had each part of the minutes. */
export function reliability(runs: readonly ReliabilityRun[]): Reliability {
  const keys = [...new Set(runs.map((r) => `${r.caseId}\u0000${r.whisper}`))]
  const rows = keys.map((k): ReliabilityRow => {
    const rs = runs.filter((r) => `${r.caseId}\u0000${r.whisper}` === k)
    const [first] = rs
    if (first === undefined) throw new Error(`no runs for ${k}`)
    return {
      caseId: first.caseId,
      whisper: first.whisper,
      runs: rs.length,
      withSummary: rs.filter((r) => r.summary > 0).length,
      withDecisions: first.expectsDecisions ? rs.filter((r) => r.decisions > 0).length : undefined,
      allTasks: rs.filter((r) => r.tasksFound === r.tasksTotal).length,
      dueRight: sum(rs, (r) => r.dueRight),
      dueTotal: sum(rs, (r) => r.dueTotal),
      dueWrong: sum(rs, (r) => r.dueWrong),
      failed: rs.filter((r) => r.failed).length,
    }
  })
  const withDecisionRows = rows.filter((r) => r.withDecisions !== undefined)
  return {
    rows,
    runs: runs.length,
    withSummary: sum(rows, (r) => r.withSummary),
    decisionRuns: sum(withDecisionRows, (r) => r.runs),
    withDecisions: sum(withDecisionRows, (r) => r.withDecisions ?? 0),
    allTasks: sum(rows, (r) => r.allTasks),
    dueRight: sum(rows, (r) => r.dueRight),
    dueTotal: sum(rows, (r) => r.dueTotal),
    dueWrong: sum(rows, (r) => r.dueWrong),
    failed: sum(rows, (r) => r.failed),
  }
}

const pct = (n: number, d: number) => (d === 0 ? '–' : `${((n / d) * 100).toFixed(0)}%`)

export function reliabilityMarkdown(r: Reliability, llm: string, times: number): string {
  const head = [
    `Reliability of ${llm}: ${times} recordings of each meeting (the audio varied like a real capture), each transcribed and written into minutes.`,
    '',
    '| Case | Whisper | Runs | Summary | Decisions | All tasks | Deadlines right | Wrong deadlines | Failed requests |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  const body = r.rows.map(
    (x) =>
      `| ${x.caseId} | ${x.whisper} | ${x.runs} | ${x.withSummary}/${x.runs} | ${x.withDecisions === undefined ? '–' : `${x.withDecisions}/${x.runs}`} | ${x.allTasks}/${x.runs} | ${x.dueRight}/${x.dueTotal} | ${x.dueWrong} | ${x.failed} |`,
  )
  const total = `| **Total** | | ${r.runs} | ${pct(r.withSummary, r.runs)} | ${pct(r.withDecisions, r.decisionRuns)} | ${pct(r.allTasks, r.runs)} | ${pct(r.dueRight, r.dueTotal)} | ${r.dueWrong} | ${r.failed} |`
  return [...head, ...body, total].join('\n')
}
