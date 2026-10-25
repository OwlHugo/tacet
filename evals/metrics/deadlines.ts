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

const isTask = (keywords: readonly string[], a: Minutes['actionItems'][number]) =>
  keywords.every((k) => coverage(k, `${a.task} ${a.quote}`) === 1)

/**
 * Independent of groundMinutes: every deadline in the script must reach its task with the words
 * that were said, and no other task may carry a deadline.
 */
export function checkDeadlines(minutes: Minutes, expected: readonly ExpectedDue[]): DeadlineReport {
  let right = 0
  const wrong: string[] = []
  for (const a of minutes.actionItems) {
    if (a.due === undefined) continue
    const e = expected.find((x) => isTask(x.task, a))
    if (e === undefined) wrong.push(`${a.task}: "${a.due}", expected no deadline`)
    else if (holds(a.due, e.due)) right++
    else wrong.push(`${a.task}: "${a.due}", expected "${e.due}"`)
  }
  return { right, total: expected.length, wrong }
}
