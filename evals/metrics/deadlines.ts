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
  /** Tasks that carry a deadline other than the script's. A missing deadline is not listed here. */
  readonly wrong: readonly string[]
}

const holds = (due: string, expected: string) => {
  const said = new Set(words(due))
  return words(expected).every((w) => said.has(w))
}

/**
 * Independent of groundMinutes: for every deadline in the script, the task it belongs to must be in
 * the minutes with a `due` holding the expected words.
 */
export function checkDeadlines(minutes: Minutes, expected: readonly ExpectedDue[]): DeadlineReport {
  let right = 0
  const wrong: string[] = []
  for (const e of expected) {
    const task = minutes.actionItems.find((a) =>
      e.task.every((k) => coverage(k, `${a.task} ${a.quote}`) === 1),
    )
    if (task?.due === undefined) continue
    if (holds(task.due, e.due)) right++
    else wrong.push(`${task.task}: "${task.due}", expected "${e.due}"`)
  }
  return { right, total: expected.length, wrong }
}
