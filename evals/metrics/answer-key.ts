import { coverage, type Minutes, normalize } from '@tacet/core'
import { z } from 'zod'

/**
 * The words that identify an item. Each must be in it; "a|b" accepts either word, since a model
 * writes "attachment" or "file" for the same thing.
 */
const Keywords = z
  .array(
    z
      .string()
      .min(1)
      // `holds` matches by content words, so an alternative made only of stopwords never matches.
      .refine((k) => k.split('|').every((alt) => coverage(alt, alt) === 1), {
        message: 'each alternative needs a content word (not only stopwords like "sim", "ok")',
      }),
  )
  .min(1)

const Decision = z.object({
  keywords: Keywords,
  /** Fine to list, not a miss when left out: said like a decision, but not the point of the meeting. */
  optional: z.boolean().optional(),
})

const Task = Decision.extend({
  /** The owners that are right for it, any of them. Left out when the meeting never says who. */
  owner: z.array(z.string()).min(1).optional(),
})

export const AnswerKeySchema = z.object({
  /** Words the summary must hold, so the main subject of the meeting is not lost. */
  subject: Keywords,
  /** The points a person would write in the summary, each as keywords. */
  summary: z.array(Keywords).optional(),
  /** What was really decided. */
  decisions: z.array(Decision),
  /** What someone really took on. */
  tasks: z.array(Task),
})
export type AnswerKey = z.infer<typeof AnswerKeySchema>

interface Score {
  /** Items in the minutes. */
  readonly given: number
  /** Items in the minutes that match the key (precision = right / given). */
  readonly right: number
  /** Required items of the key found in the minutes (recall = found / total). */
  readonly found: number
  readonly total: number
}

/** How the summary reads: how long it is, whether it opens on the subject, what it covers. */
interface SummaryScore {
  readonly points: number
  /** Whether the first point, the one read as the main subject, holds the subject's keywords. */
  readonly firstIsSubject: boolean
  /** Points that hold the subject's keywords: more than one is the main subject said again. */
  readonly withSubject: number
  /** Points of the key's `summary` found in it, out of `total` (0 when the key lists none). */
  readonly found: number
  readonly total: number
}

export interface AnswerKeyReport {
  readonly subject: boolean
  readonly summary: SummaryScore
  readonly decisions: Score
  readonly tasks: Score
  /** Tasks that match one of the key but carry an owner that is not right for it. */
  readonly wrongOwner: number
  /** Decisions and tasks that match nothing in the key, as written. */
  readonly invented: readonly string[]
}

/** Whether `text` holds every keyword (one of the alternatives of each), stemmed and unaccented. */
export function holds(keywords: readonly string[], text: string): boolean {
  return keywords.every((k) => k.split('|').some((alt) => coverage(alt, text) === 1))
}

function score<
  K extends { readonly keywords: readonly string[]; readonly optional?: boolean | undefined },
>(texts: readonly string[], key: readonly K[]): { score: Score; match: (K | undefined)[] } {
  const match = texts.map((text) => key.find((k) => holds(k.keywords, text)))
  const required = key.filter((k) => k.optional !== true)
  return {
    match,
    score: {
      given: texts.length,
      right: match.filter((k) => k !== undefined).length,
      found: required.filter((k) => texts.some((text) => holds(k.keywords, text))).length,
      total: required.length,
    },
  }
}

/**
 * Scores the minutes against what a person wrote down the meeting decided and assigned. Matching
 * is by keywords, not by the words of the transcript: grounding already proves an item was said,
 * this checks it was a decision or a task at all. An item matching nothing is counted as invented.
 */
export function checkAnswerKey(minutes: Minutes, key: AnswerKey): AnswerKeyReport {
  const decisions = score(
    minutes.decisions.map((d) => `${d.text} ${d.quote}`),
    key.decisions,
  )
  const tasks = score(
    minutes.actionItems.map((a) => `${a.task} ${a.quote}`),
    key.tasks,
  )
  const wrongOwner = minutes.actionItems.filter((a, i) => {
    const owners = tasks.match[i]?.owner
    return owners !== undefined && !owners.some((o) => normalize(o) === normalize(a.owner))
  }).length
  const points = minutes.summary.map((s) => s.text)
  const expected = key.summary ?? []
  return {
    subject: holds(key.subject, points.join(' ')),
    summary: {
      points: points.length,
      firstIsSubject: points.slice(0, 1).some((p) => holds(key.subject, p)),
      withSubject: points.filter((p) => holds(key.subject, p)).length,
      found: expected.filter((k) => points.some((p) => holds(k, p))).length,
      total: expected.length,
    },
    decisions: decisions.score,
    tasks: tasks.score,
    wrongOwner,
    invented: [
      ...minutes.decisions.filter((_, i) => !decisions.match[i]).map((d) => `decision: ${d.text}`),
      ...minutes.actionItems.filter((_, i) => !tasks.match[i]).map((a) => `task: ${a.task}`),
    ],
  }
}
