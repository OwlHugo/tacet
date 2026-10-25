import { coverage, normalize, similarity, words } from '../matching/words.ts'
import {
  ME,
  OTHERS as OTHERS_LABEL,
  type Segment,
  SPEAKER,
  type Transcript,
} from '../transcript/types.ts'
import type { Minutes, RawMinutes, Rejected } from './types.ts'

export interface GroundingOptions {
  /** Minimum share of a quote's content words found in the cited lines. */
  readonly quoteThreshold?: number
  /** Minimum share of a summary point's content words found in the cited lines. */
  readonly summaryThreshold?: number
}

/** Below this, an item's own wording (not just its quote) is unrelated to its source. */
const WORDING_THRESHOLD = 0.3
const DUPLICATE_SIMILARITY = 0.7

type Lines = readonly [Segment, ...Segment[]]

interface Anchor {
  readonly lines: Lines
  readonly score: number
}

const nonEmpty = (xs: readonly Segment[]): Lines | undefined => {
  const [first, ...rest] = xs
  return first ? [first, ...rest] : undefined
}

const textOf = (xs: readonly Segment[]) => xs.map((s) => s.text).join(' ')

/** Index of one transcript: every lookup returns only segments that exist. */
class TranscriptIndex {
  readonly all: readonly Segment[]
  readonly spoken: ReadonlySet<string>
  readonly speakers: ReadonlySet<string>
  readonly #byId: ReadonlyMap<number, Segment>

  constructor(transcript: Transcript) {
    this.all = transcript.segments
    this.spoken = new Set(words(textOf(transcript.segments)))
    this.speakers = new Set(transcript.segments.map((s) => s.speaker))
    this.#byId = new Map(transcript.segments.map((s) => [s.id, s]))
  }

  pick(ids: readonly number[]): Segment[] {
    return [...new Set(ids)]
      .sort((a, b) => a - b)
      .flatMap((id) => {
        const s = this.#byId.get(id)
        return s ? [s] : []
      })
  }

  /** The given lines plus their neighbours, in transcript order. */
  around(lines: readonly Segment[]): Segment[] {
    return this.pick(lines.flatMap((s) => [s.id - 1, s.id, s.id + 1]))
  }
}

/** Keep the one or two lines of a window that support the text best; the cited lines if none does. */
function narrow(text: string, window: readonly Segment[], cited: Lines): Lines {
  const best = window
    .map((s) => ({ s, score: coverage(text, s.text) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.id - b.s.id)
    .slice(0, 2)
    .map((x) => x.s)
    .sort((a, b) => a.id - b.id)
  return nonEmpty(best) ?? cited
}

/** The model cited the wrong line but the words exist elsewhere: single lines first, then pairs. */
function reanchor(text: string, index: TranscriptIndex, threshold: number): Anchor | undefined {
  let best: Anchor | undefined
  for (const size of [1, 2]) {
    for (let i = 0; i + size <= index.all.length; i++) {
      const lines = index.all.slice(i, i + size)
      const score = coverage(text, textOf(lines))
      const found = nonEmpty(lines)
      if (found && score >= threshold && (!best || score > best.score + 1e-9))
        best = { lines: found, score }
    }
  }
  return best
}

/** Find the lines that support `text`: the cited ones, then their neighbours, then anywhere. */
function anchor(
  text: string,
  cited: readonly number[],
  index: TranscriptIndex,
  threshold: number,
): Anchor | undefined {
  const lines = nonEmpty(index.pick(cited))
  if (lines) {
    const score = coverage(text, textOf(lines))
    if (score >= threshold) return { lines, score }
    const window = index.around(lines)
    const wide = coverage(text, textOf(window))
    if (wide >= threshold) return { lines: narrow(text, window, lines), score: wide }
  }
  return reanchor(text, index, threshold)
}

const SELF = new Set(['me', 'eu', 'i'])
const OTHERS_WORDS = new Set(['others', 'outros', 'them'])
const NOBODY = new Set(['', 'unassigned', 'unknown', 'none', 'n a', 'ninguem'])
const COMMITMENT = /\b(i ll|i will|i can|vou|eu)\b/

/**
 * A named owner is kept only if the name was actually said in the meeting, and "Me"/"Others" only
 * if that track exists: an imported file has a single mixed track, so nobody there is "Others".
 */
function resolveOwner(owner: string, source: Lines, index: TranscriptIndex): string {
  const n = normalize(owner)
  if (SELF.has(n) && index.speakers.has(ME)) return ME
  if (OTHERS_WORDS.has(n) && index.speakers.has(OTHERS_LABEL)) return OTHERS_LABEL
  if (
    !NOBODY.has(n) &&
    !SELF.has(n) &&
    !OTHERS_WORDS.has(n) &&
    !words(owner).includes(normalize(SPEAKER)) &&
    words(owner).every((w) => index.spoken.has(w))
  )
    return owner.trim()
  // "I will send the notes": whoever said that line owns the task, if we know who that was.
  const said = source[0].speaker
  return COMMITMENT.test(normalize(textOf(source))) && said !== SPEAKER ? said : 'Unassigned'
}

const cite = (lines: Lines) => ({
  segments: [lines[0].id, ...lines.slice(1).map((s) => s.id)] as [number, ...number[]],
  at: lines[0].start,
})
const byTime = <T extends { at: number }>(xs: T[]): T[] => xs.sort((a, b) => a.at - b.at)
const isDuplicate = (text: string, seen: readonly string[]) =>
  seen.some((s) => similarity(s, text) > DUPLICATE_SIMILARITY)
const wordingSupported = (text: string, lines: Lines, index: TranscriptIndex) =>
  coverage(text, textOf(index.around(lines))) >= WORDING_THRESHOLD

function groundSummary(
  raw: RawMinutes,
  index: TranscriptIndex,
  threshold: number,
  rejected: Rejected[],
) {
  return raw.summary.flatMap((p) => {
    const text = p.text.trim()
    if (!text) return []
    const a = anchor(text, p.segments, index, threshold)
    if (a) return [{ text, ...cite(a.lines) }]
    rejected.push({ kind: 'summary', text, reason: 'not supported by the cited lines' })
    return []
  })
}

function groundDecisions(
  raw: RawMinutes,
  index: TranscriptIndex,
  threshold: number,
  rejected: Rejected[],
) {
  const kept: Minutes['decisions'] = []
  for (const d of raw.decisions) {
    const text = d.text.trim()
    if (!text) continue
    const a = anchor(d.quote || text, d.segments, index, threshold)
    if (!a) rejected.push({ kind: 'decision', text, reason: 'quote not found in the transcript' })
    else if (!wordingSupported(text, a.lines, index))
      rejected.push({
        kind: 'decision',
        text,
        reason: 'decision wording is not supported by its source line',
      })
    else if (
      !isDuplicate(
        text,
        kept.map((x) => x.text),
      )
    )
      kept.push({ text, quote: d.quote.trim(), ...cite(a.lines) })
  }
  return byTime(kept)
}

type Action = Minutes['actionItems'][number]

/** A task that passed grounding, before its deadline is checked. */
interface Candidate {
  readonly raw: RawMinutes['action_items'][number]
  readonly task: string
  readonly lines: Lines
  /** The cited line that carries the quote best: the line the task was said on. */
  readonly core: Segment
}

/** The line among `lines` that supports `quote` best, the first one on a tie. */
const coreLine = (quote: string, lines: Lines): Segment =>
  lines.reduce((best, s) => (coverage(quote, s.text) > coverage(quote, best.text) ? s : best))

/**
 * A deadline is kept only if every word of it was said in the task's own line, or in a cited line
 * right next to it that is not another task's line ("Can you do it?" / "Yes, by Wednesday"); that
 * line then joins the citation. A deadline said for the next task never moves onto this one.
 */
function groundDue(
  c: Candidate,
  taskLines: ReadonlySet<number>,
  index: TranscriptIndex,
  rejected: Rejected[],
): { readonly due?: string; readonly lines: Lines } {
  const text = c.raw.due.trim()
  if (!text) return { lines: c.lines }
  const near = new Set(index.around([c.core]).map((s) => s.id))
  const evidence = index.pick(c.raw.segments).filter((s) => near.has(s.id) && !taskLines.has(s.id))
  const said = new Set(words(textOf([c.core, ...evidence])))
  if (words(text).every((w) => said.has(w))) {
    const extra = evidence.filter((s) => !c.lines.includes(s))
    const joined: [Segment, ...Segment[]] = [...c.lines, ...extra]
    return { due: text, lines: joined.sort((a, b) => a.id - b.id) }
  }
  rejected.push({
    kind: 'action',
    text: `${c.task}: ${text}`,
    reason: 'deadline not said in the cited lines',
  })
  return { lines: c.lines }
}

function groundTasks(
  raw: RawMinutes,
  index: TranscriptIndex,
  threshold: number,
  rejected: Rejected[],
): Candidate[] {
  const kept: Candidate[] = []
  for (const t of raw.action_items) {
    const task = t.task.trim()
    if (!task) continue
    const source = t.quote || task
    const a = anchor(source, t.segments, index, threshold)
    if (!a)
      rejected.push({ kind: 'action', text: task, reason: 'quote not found in the transcript' })
    else if (!wordingSupported(task, a.lines, index))
      rejected.push({
        kind: 'action',
        text: task,
        reason: 'task wording is not supported by its source line',
      })
    else if (
      !isDuplicate(
        task,
        kept.map((x) => x.task),
      )
    )
      kept.push({ raw: t, task, lines: a.lines, core: coreLine(source, a.lines) })
  }
  return kept
}

function groundActions(
  raw: RawMinutes,
  index: TranscriptIndex,
  threshold: number,
  rejected: Rejected[],
): Action[] {
  const tasks = groundTasks(raw, index, threshold, rejected)
  // A line that carries a task is never the evidence for another task's deadline.
  const taskLines = new Set(tasks.map((c) => c.core.id))
  return byTime(
    tasks.map((c) => {
      const d = groundDue(c, taskLines, index, rejected)
      return {
        task: c.task,
        owner: resolveOwner(c.raw.owner, c.lines, index),
        ...(d.due === undefined ? {} : { due: d.due }),
        quote: c.raw.quote.trim(),
        ...cite(d.lines),
      }
    }),
  )
}

/**
 * Tacet's core guarantee: drop everything the model said that cannot be traced to the transcript,
 * and take every timestamp from the cited line, never from the model.
 */
export function groundMinutes(
  raw: RawMinutes,
  transcript: Transcript,
  model: string,
  opts: GroundingOptions = {},
): Minutes {
  const index = new TranscriptIndex(transcript)
  const quote = opts.quoteThreshold ?? 0.6
  const rejected: Rejected[] = []
  return {
    summary: groundSummary(raw, index, opts.summaryThreshold ?? 0.3, rejected),
    decisions: groundDecisions(raw, index, quote, rejected),
    actionItems: groundActions(raw, index, quote, rejected),
    rejected,
    model,
  }
}
