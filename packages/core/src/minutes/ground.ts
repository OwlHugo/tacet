import {
  contentWords,
  coverage,
  findPhrase,
  normalize,
  similarity,
  stem,
  words,
} from '../matching/words.ts'
import {
  ME,
  OTHERS as OTHERS_LABEL,
  type Segment,
  SPEAKER,
  type Transcript,
} from '../transcript/types.ts'
import type { Minutes, RawMinutes, Rejected, Self } from './types.ts'

export interface GroundingOptions {
  /** Minimum share of a quote's content words found in the cited lines. */
  readonly quoteThreshold?: number
  /** Minimum share of a summary point's content words found in the cited lines. */
  readonly summaryThreshold?: number
  /**
   * The person who recorded the meeting and what people call them ("Ana", "Aninha"). On two tracks
   * that person is the "Me" track, so an owner that is one of these names is "Me". On one track it is
   * their name, kept only if one of these was said or the task's line asks it of "you".
   */
  readonly self?: Self | undefined
}

/** Below this, an item's own wording (not just its quote) is unrelated to its source. */
const WORDING_THRESHOLD = 0.3
const DUPLICATE_SIMILARITY = 0.7

/** The lines an item stands on: never empty. */
export type Lines = readonly [Segment, ...Segment[]]

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

/** The lines an item stands on, as grounding finds them, or undefined when it has none. */
export function sourceLines(
  text: string,
  cited: readonly number[],
  transcript: Transcript,
  threshold = 0.6,
): Lines | undefined {
  return anchor(text, cited, new TranscriptIndex(transcript), threshold)?.lines
}

const SELF = new Set(['me', 'eu', 'i'])
const OTHERS_WORDS = new Set(['others', 'outros', 'them'])
const NOBODY = new Set(['', 'unassigned', 'unknown', 'none', 'n a', 'ninguem'])
const COMMITMENT = /\b(i ll|i will|i can|vou|eu)\b/

const wasSaid = (name: string, index: TranscriptIndex) =>
  words(name).every((w) => index.spoken.has(w))

/** A line that asks something of "you": on one track, of the person recording in a one-to-one call. */
const ASKS_YOU = /\b(you|your|voce|vc|tu|te)\b/

/**
 * The owner as the person who recorded the meeting: "Me" on two tracks. On one track their name,
 * when one of their names was said in the meeting or the task's line asks it of "you".
 */
function asSelf(n: string, self: Self, source: Lines, index: TranscriptIndex): string | undefined {
  const names = [self.name, ...self.aliases]
  if (!names.some((s) => normalize(s) === n)) return undefined
  if (index.speakers.has(ME)) return ME
  const named = names.some((s) => wasSaid(s, index))
  return named || ASKS_YOU.test(normalize(textOf(source))) ? self.name : undefined
}

/**
 * A named owner is kept only if the name was actually said in the meeting, and "Me"/"Others" only
 * if that track exists: an imported file has a single mixed track, so nobody there is "Others".
 */
function resolveOwner(
  owner: string,
  source: Lines,
  index: TranscriptIndex,
  self: Self | undefined,
): string {
  const n = normalize(owner)
  const me = self === undefined ? undefined : asSelf(n, self, source, index)
  if (me !== undefined) return me
  if (SELF.has(n) && index.speakers.has(ME)) return ME
  if (OTHERS_WORDS.has(n) && index.speakers.has(OTHERS_LABEL)) return OTHERS_LABEL
  if (
    !NOBODY.has(n) &&
    !SELF.has(n) &&
    !OTHERS_WORDS.has(n) &&
    !words(owner).includes(normalize(SPEAKER)) &&
    wasSaid(owner, index)
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
}

/** Words that introduce a deadline at the end of a task, cut with it. */
const LEAD = /\s+(?:by|on|before|until|até|ate|pra|antes de)$/iu

/**
 * The task as the model wrote it, without a deadline at its end ("Send the notes by Thursday."): a
 * kept deadline is shown on its own, and a dropped one must not reach the minutes through the task's
 * wording. Only a deadline introduced like one ("by", "até") is cut, and never the whole task.
 */
export function withoutDeadline(task: string, due: string): string {
  const end = /[.!?]$/.exec(task)?.[0] ?? ''
  const body = task.slice(0, task.length - end.length)
  const said = findPhrase(due, body)
  if (said === undefined || !body.endsWith(said)) return task
  const before = body.slice(0, body.length - said.length).trimEnd()
  const lead =
    LEAD.exec(before) ?? (/^(?:by|até|ate|pra|before|until)\s/iu.test(said) ? [''] : null)
  if (lead === null) return task
  const cut = before.slice(0, before.length - lead[0].length).replace(/,$/, '')
  return words(cut).length > 0 ? `${cut}${end}` : task
}

/** Owner labels that are not a person's name. */
const NOT_A_NAME = new Set(
  [ME, OTHERS_LABEL, SPEAKER, 'Unassigned', 'I', 'eu', 'outros', 'nos', 'we'].map(normalize),
)

/** How many of the owners the model gave a line names: "Ana revisa e o Pedro faz o deploy" names two. */
function namesOn(line: Segment, owners: ReadonlySet<string>): number {
  const said = new Set(words(line.text))
  return [...owners].filter((o) => said.has(o)).length
}

/** Words a line may bring of its own and still be a reply about the task ("Sure, by Friday"). */
const REPLY_WORDS = 2

/**
 * Words of agreeing to do something, which bring no subject of their own: "Fechado, consigo
 * entregar isso até sexta sem problema" is still a reply about the task asked just before.
 */
const AGREEING = new Set(
  (
    'sure fine deal done deliver get finish manage problem worries absolutely course right ' +
    'that isso fechado beleza combinado certo claro pode deixa consigo entregar entrego faco fazer ' +
    'termino terminar problema tranquilo boa ai'
  )
    .split(' ')
    .map(stem),
)

/**
 * Whether the line holding a deadline talks about this task: it says some of the task's words, or
 * it is a short reply that brings no subject of its own. "On Friday we pick the band for the party?" after "Book
 * the hall first" names another piece of work, so its deadline is not the hall's.
 */
function aboutTask(line: Segment, said: string, task: string): boolean {
  const own = new Set(contentWords(task).map(stem))
  const rest = contentWords(line.text.replace(said, ' ')).map(stem)
  const subject = rest.filter((w) => !AGREEING.has(w))
  return rest.some((w) => own.has(w)) || subject.length <= REPLY_WORDS
}

/**
 * A deadline is kept only when there is no doubt whose it is: it is said, as a run of words, on a
 * cited line of this task that no other task cites and that names at most one person. A line shared
 * by two tasks, or naming two people, drops it. A missing deadline is acceptable; a wrong one is not.
 * What is kept is the transcript's wording.
 */
function groundDue(
  c: Candidate,
  citedBy: ReadonlyMap<number, number>,
  owners: ReadonlySet<string>,
  rejected: Rejected[],
): string | undefined {
  const text = c.raw.due.trim()
  if (!text) return undefined
  for (const line of c.lines) {
    const said = findPhrase(text, line.text)
    if (
      said !== undefined &&
      citedBy.get(line.id) === 1 &&
      namesOn(line, owners) <= 1 &&
      aboutTask(line, said, c.task)
    )
      return said
  }
  rejected.push({
    kind: 'deadline',
    text: `${c.task}: ${text}`,
    reason: 'deadline not said on a line of this task alone',
  })
  return undefined
}

/**
 * The tasks that pass grounding, and for every task the model gave the lines it stands on: the lines
 * grounding found for it when it found any (the model's citation may be wrong), plus the cited ones.
 * A task dropped as a duplicate still stands on its lines.
 */
function groundTasks(
  raw: RawMinutes,
  index: TranscriptIndex,
  threshold: number,
  rejected: Rejected[],
): { readonly kept: Candidate[]; readonly standsOn: readonly (readonly number[])[] } {
  const kept: Candidate[] = []
  const standsOn: number[][] = []
  for (const t of raw.action_items) {
    const task = t.task.trim()
    if (!task) continue
    const source = t.quote || task
    const a = anchor(source, t.segments, index, threshold)
    standsOn.push([...(a?.lines.map((s) => s.id) ?? []), ...t.segments])
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
      kept.push({ raw: t, task, lines: a.lines })
  }
  return { kept, standsOn }
}

function groundActions(
  raw: RawMinutes,
  index: TranscriptIndex,
  threshold: number,
  rejected: Rejected[],
  self: Self | undefined,
): Action[] {
  const { kept: tasks, standsOn } = groundTasks(raw, index, threshold, rejected)
  // A line is in doubt when more than one task the model gave stands on it, kept or not.
  const citedBy = new Map<number, number>()
  for (const ids of standsOn)
    for (const id of new Set(ids)) citedBy.set(id, (citedBy.get(id) ?? 0) + 1)
  const owners = new Set(
    raw.action_items.flatMap((t) => words(t.owner).slice(0, 1)).filter((o) => !NOT_A_NAME.has(o)),
  )
  return byTime(
    tasks.map((c) => {
      const due = groundDue(c, citedBy, owners, rejected)
      return {
        task: withoutDeadline(c.task, due ?? c.raw.due),
        owner: resolveOwner(c.raw.owner, c.lines, index, self),
        ...(due === undefined ? {} : { due }),
        quote: c.raw.quote.trim(),
        ...cite(c.lines),
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
    actionItems: groundActions(raw, index, quote, rejected, opts.self),
    rejected,
    model,
  }
}
