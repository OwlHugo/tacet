import { coverage, type Minutes, words } from '@tacet/core'

/** A deadline the script says: the task as keywords, and the words the deadline must have. */
export interface ExpectedDue {
  readonly task: readonly string[]
  readonly due: string
}

export interface DeadlineReport {
  /** Expected deadlines found on the right task. */
  readonly right: number
  readonly total: number
  /**
   * Tasks with a deadline the script does not give them: another deadline than the one said, or
   * one on a task the script has no deadline for. A missing deadline is not listed here.
   */
  readonly wrong: readonly string[]
}

const holds = (due: string, expected: string) => {
  const said = new Set(words(due))
  return words(expected).every((w) => said.has(w))
}

const has = (keywords: readonly string[], text: string) =>
  keywords.every((k) => coverage(k, text) === 1)

/** The expected deadline of a task: by its wording first, then by its quote (which may be the reply). */
const expectedOf = (expected: readonly ExpectedDue[], a: Minutes['actionItems'][number]) =>
  expected.find((x) => has(x.task, a.task)) ??
  expected.find((x) => has(x.task, `${a.task} ${a.quote}`))

/**
 * Independent of groundMinutes: every deadline in the script must reach its task with the words
 * that were said, and no other task may carry a deadline.
 */
export function checkDeadlines(minutes: Minutes, expected: readonly ExpectedDue[]): DeadlineReport {
  const met = new Set<ExpectedDue>()
  const wrong: string[] = []
  for (const a of minutes.actionItems) {
    if (a.due === undefined) continue
    const e = expectedOf(expected, a)
    if (e === undefined) wrong.push(`${a.task}: "${a.due}", expected no deadline`)
    else if (holds(a.due, e.due)) met.add(e)
    else wrong.push(`${a.task}: "${a.due}", expected "${e.due}"`)
  }
  return { right: met.size, total: expected.length, wrong }
}
