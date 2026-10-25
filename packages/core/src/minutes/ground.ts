import {
  coverage,
  findPhrase,
  normalize,
  STOPWORDS as STOP,
  similarity,
  words,
} from '../matching/words.ts'
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

/** The line among `lines` that says `quote` in a row, else the one that supports it best (first on a tie). */
const coreLine = (quote: string, lines: Lines): Segment =>
  lines.find((s) => findPhrase(quote, s.text) !== undefined) ??
  lines.reduce((best, s) => (coverage(quote, s.text) > coverage(quote, best.text) ? s : best))

/**
 * A deadline is kept only if it was said in a row inside the task's quote, found as a run of words on
 * the task's own line, or in the cited reply: the next line, said by someone else, that is not another
 * task's line ("Can you do it?" / "Yes, by Wednesday"), which then joins the citation. A deadline elsewhere on the line
 * ("I'll send the notes, by the way Thursday is a holiday") or said for another task on the same line
 * ("Ana reviews the contract and Pedro deploys by Friday") is dropped. What is kept is the wording of
 * the transcript, not the model's.
 */
/** Words that introduce a deadline, cut with it: "by", "on", "até", "pra"... */
const LEAD = new Set(
  'by on before until till at in ate para pra na no ate antes de do da'.split(' '),
)

/**
 * The task as the model wrote it, without the deadline at its end ("Send the notes by Thursday."):
 * a kept deadline is shown on its own, and a dropped one must not reach the minutes through the
 * task's wording. A deadline in the middle of the task is left alone.
 */
function withoutDeadline(task: string, due: string): string {
  const said = findPhrase(due, task)
  if (said === undefined) return task
  const at = task.lastIndexOf(said)
  const tail = task.slice(at + said.length)
  if (words(tail).length > 0) return task
  let head = task.slice(0, at).trimEnd()
  let led = LEAD.has(words(said)[0] ?? '')
  for (
    let w = /[\p{L}]+$/u.exec(head);
    w && LEAD.has(normalize(w[0]));
    w = /[\p{L}]+$/u.exec(head)
  ) {
    head = head.slice(0, w.index).trimEnd()
    led = true
  }
  // Only a deadline introduced like one ("by Thursday", "até sexta") is cut: "notes" is not a deadline.
  const cut = head.replace(/[\s,;:-]+$/, '')
  return led && words(cut).length > 0 ? `${cut}${tail.trim()}` : task
}

/** Words a reply uses to take a task on without naming it ("Sure, by Wednesday", "Fechado, entrego até quarta"). */
const TAKING_IT = new Set(
  (
    'sure fine deal done will can do deliver send finish get it that this ' +
    'claro certo fechado combinado beleza pode deixa comigo consigo da entrego faco fecho mando termino'
  ).split(' '),
)

/**
 * The deadline in a reply, as said, when the clause that says it is about the task: nothing else in
 * that clause but words of the task or of taking it on. "Reviso. Ah, e o deploy fica pra sexta" gives
 * the deploy's deadline, not the review's, and "Sure. By the way Thursday is a holiday" gives none.
 */
function answerDeadline(due: string, reply: string, task: string): string | undefined {
  // A light stem, so "reviso" answers "revisa" and "sending" answers "send".
  const stem = (w: string) => w.slice(0, 5)
  const ofTask = new Set(words(task).map(stem))
  for (const clause of reply.split(/[.,;!?]+/)) {
    const said = findPhrase(due, clause)
    if (said === undefined) continue
    const rest = words(clause.replace(said, ' ')).filter((w) => w.length > 1 && !STOP.has(w))
    if (rest.every((w) => ofTask.has(stem(w)) || TAKING_IT.has(w))) return said
  }
  return undefined
}

function groundDue(
  c: Candidate,
  taskLines: ReadonlySet<number>,
  index: TranscriptIndex,
  rejected: Rejected[],
): { readonly due?: string; readonly lines: Lines } {
  const text = c.raw.due.trim()
  if (!text) return { lines: c.lines }
  const quoted = findPhrase(c.raw.quote, c.core.text)
  const own = quoted === undefined ? undefined : findPhrase(text, quoted)
  if (own !== undefined) return { due: own, lines: c.lines }
  // The reply: the line right after the task, said by someone else ("Sure, by Wednesday"). One mixed
  // track ("Speaker") does not say who spoke, so there the next line is enough.
  const reply = index
    .pick([c.core.id + 1])
    .find((s) => s.speaker !== c.core.speaker || s.speaker === SPEAKER)
  const said =
    reply && c.raw.segments.includes(reply.id) && !taskLines.has(reply.id)
      ? answerDeadline(text, reply.text, `${c.task} ${c.raw.quote}`)
      : undefined
  if (reply && said !== undefined) {
    const joined: [Segment, ...Segment[]] = [reply, ...c.lines.filter((x) => x.id !== reply.id)]
    return { due: said, lines: joined.sort((x, y) => x.id - y.id) }
  }
  rejected.push({
    kind: 'deadline',
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
        task: withoutDeadline(c.task, c.raw.due),
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
