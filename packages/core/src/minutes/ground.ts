import { coverage, normalize, similarity, words } from '../matching/words.ts'
import type { Segment, Transcript } from '../transcript/types.ts'
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
  readonly #byId: ReadonlyMap<number, Segment>

  constructor(transcript: Transcript) {
    this.all = transcript.segments
    this.spoken = new Set(words(textOf(transcript.segments)))
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

  /** The given lines plus their neighbours. */
  around(lines: readonly Segment[]): Segment[] {
    return this.pick(lines.flatMap((s) => [s.id - 1, s.id, s.id + 1]))
  }
}

/** Keep the one or two lines of a window that support the text best. */
function narrow(text: string, window: Lines): Lines {
  const best = window
    .map((s) => ({ s, score: coverage(text, s.text) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.id - b.s.id)
    .slice(0, 2)
    .map((x) => x.s)
    .sort((a, b) => a.id - b.id)
  return nonEmpty(best) ?? window
}

/** The model cited the wrong line but the words exist elsewhere: single lines first, then pairs. */
function reanchor(text: string, index: TranscriptIndex, threshold: number): Anchor | undefined {
  let best: Anchor | undefined
  for (const size of [1, 2]) {
    for (let i = 0; i + size <= index.all.length; i++) {
      const lines = nonEmpty(index.all.slice(i, i + size))
      const score = coverage(text, textOf(lines ?? []))
      if (lines && score >= threshold && (!best || score > best.score + 1e-9))
        best = { lines, score }
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
    const window = nonEmpty(index.around(lines))
    const wide = coverage(text, textOf(window ?? []))
    if (window && wide >= threshold) return { lines: narrow(text, window), score: wide }
  }
  return reanchor(text, index, threshold)
}

const SELF = new Set(['me', 'eu', 'i'])
const OTHERS = new Set(['others', 'outros', 'them'])
const NOBODY = new Set(['', 'unassigned', 'unknown', 'none', 'n a', 'ninguem'])
const COMMITMENT = /\b(i ll|i will|i can|vou|eu)\b/

/** A named owner is kept only if the name was actually said in the meeting. */
function resolveOwner(owner: string, source: Lines, spoken: ReadonlySet<string>): string {
  const n = normalize(owner)
  if (SELF.has(n)) return 'Me'
  if (OTHERS.has(n)) return 'Others'
  if (!NOBODY.has(n) && words(owner).every((w) => spoken.has(w))) return owner.trim()
  // "I will send the notes": whoever said that line owns the task.
  return COMMITMENT.test(normalize(textOf(source))) ? source[0].speaker : 'Unassigned'
}

const cite = (lines: Lines) => ({ segments: lines.map((s) => s.id), at: lines[0].start })
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

function groundActions(
  raw: RawMinutes,
  index: TranscriptIndex,
  threshold: number,
  rejected: Rejected[],
) {
  const kept: Minutes['actionItems'] = []
  for (const t of raw.action_items) {
    const task = t.task.trim()
    if (!task) continue
    const a = anchor(t.quote || task, t.segments, index, threshold)
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
      kept.push({
        task,
        owner: resolveOwner(t.owner, a.lines, index.spoken),
        quote: t.quote.trim(),
        ...cite(a.lines),
      })
  }
  return byTime(kept)
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
