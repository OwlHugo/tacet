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
/** "I will", "vou", "eu": whoever says it takes the work on. "I'll" is checked on the raw text. */
const COMMITMENT = /\b(i ll|i will|i can|vou|eu)\b/
/** "I'll" normalizes to "ill", the same word as the adjective ("Bia is ill"): only the apostrophe tells them apart. */
const I_WILL = /\bI['’]ll\b/i

/** Whether the one speaking takes work on in this text. */
const commits = (text: string) => I_WILL.test(text) || COMMITMENT.test(normalize(text))

const wasSaid = (name: string, index: TranscriptIndex) =>
  words(name).every((w) => index.spoken.has(w))

/** Work someone can be asked to do, after "você pode", "pode ...?", "consegue ...?". */
const PT_TASK_VERB =
  '(mandar|enviar|revisar|fazer|ver se|olhar|cuidar|preparar|marcar|agendar|ligar|escrever|atualizar|resolver|subir|checar|conferir|corrigir|arrumar|testar|organizar|levar|trazer|pagar|comprar|reservar|imprimir|avisar|falar|terminar|entregar|assinar|pegar|tirar|renovar)'

/** Work someone can be asked to do, after "can you", "please", "you need to". */
const EN_TASK_VERB =
  '(send|book|call|check|fix|review|write|print|order|update|prepare|draft|schedule|set up|look into|take care|handle|finish|deliver|sign|pick up|buy|pay|share|forward|email|ask|tell|follow up|organize|clean|test|deploy|upload|move|cancel|confirm|reply|cover|take|bring|get|make|do|run|own|lead|plan|renew)'

/** Work asked with "que você": "preciso que você revise", "queria que você mandasse". */
const PT_TASK_SUBJUNCTIVE =
  '(mand|envi|revis|fac|fiz|olh|cuid|prepar|marqu|marc|agend|ligu|lig|escrev|atualiz|resolv|sub|chequ|confir|confer|corrij|corrig|arrum|test|organiz|lev|traga|troux|pagu|pag|compr|reserv|imprim|avis|fal|termin|entreg|assin|pegu|peg|tir|renov)[a-z]*'

/** Portuguese imperatives a "por favor" turns into a request ("Por favor, revisa o contrato"). */
const PT_IMPERATIVE =
  '(manda|mande|envia|envie|revisa|revise|faz|faca|liga|ligue|marca|marque|prepara|prepare|olha|olhe|confere|confira|resolve|resolva|assina|assine|imprime|imprima|reserva|reserve)'

/**
 * A request made to "you": a clause (normalized) that starts with one of these forms, and names
 * work. A "you" anywhere else is not one: "thank you", "I will send you", "te mando", "you sent it
 * yesterday", "você tem razão", "can you see my screen", "you have to admit", "please note".
 */
const ASKS_YOU = new RegExp(
  // A clause may open with "and" / "e" or a "please": "..., e eu quero que você assine".
  '^(and |e |also |tambem )?(please |por favor )?(' +
    [
      `(can|could|would|will) you (please )?${EN_TASK_VERB}`,
      `you (need|have|must|got) to ${EN_TASK_VERB}`,
      `(i need|i want|i d like|id like|i would like) you to ${EN_TASK_VERB}`,
      `(voce|vc|tu) (pode|podes|poderia|podia|consegue|consegues|precisa) ${PT_TASK_VERB}`,
      `(eu )?(preciso|quero|queria) que (voce|vc|tu) ${PT_TASK_SUBJUNCTIVE}`,
      '(voce|vc) fica com (o|a|os|as|esse|essa|esses|essas|isso|isto|este|esta)',
      'me (manda|mande|envia|envie|passa|passe|avisa|avise|mostra|mostre)',
      '(send|give|tell|show|forward|email) me',
    ].join('|') +
    String.raw`)\b`,
)

/** A bare imperative is a request only with a "please" on it: "Please book the room", "Book the room, please". */
const PLEASE = new RegExp(
  String.raw`^(please|por favor) (${EN_TASK_VERB}|${PT_IMPERATIVE})\b|^(${EN_TASK_VERB}|${PT_IMPERATIVE})\b.* (please|por favor)$`,
)

/** "O contrato fica com você": the work is handed to "you" at the end of the clause. */
const HANDED_TO_YOU = /\bfica com (voce|vc)$/

/** Asked as a question: "Pode mandar o contrato?", "Consegue revisar hoje?" ("Pode crer." is not). */
const ASKS_AS_QUESTION = new RegExp(
  String.raw`^(pode|poderia|podia|consegue|conseguiria|da pra) ${PT_TASK_VERB}\b`,
)

/** A word that greets, agrees, asks nicely or says when, not a name said to someone ("Okay, can you…"). */
const NOT_A_VOCATIVE = new Set(
  (
    'ok okay so and then well right sure yes yeah hey hi oh ah great good actually also please ' +
    'thanks e entao bom beleza certo ta olha oi opa sim agora por favor obrigado obrigada ' +
    'pessoal gente galera guys everyone team folks hoje amanha depois today tomorrow later now ' +
    'monday tuesday wednesday thursday friday saturday sunday segunda terca quarta quinta sexta ' +
    'sabado domingo'
  ).split(' '),
)

/** A short run of words that names someone, not a greeting or a "thanks" ("Bia", "Ana Clara Souza"). */
const isVocative = (text: string) => {
  const said = words(text)
  return said.length > 0 && said.length <= 3 && !said.every((w) => NOT_A_VOCATIVE.has(w))
}

interface Clause {
  /** As said, with its punctuation. */
  readonly said: string
  /** Normalized. */
  readonly text: string
  /** Whether the sentence it is in is a question. */
  readonly question: boolean
}

/**
 * The clauses of a line. A "please" / "por favor" said apart, before or after, stays on the clause
 * it asks for ("Please, send the deck", "Book the room, please"). A clause is a question only when
 * its own sentence ends with "?": in "Dá pra mandar a nota depois. Alguém viu?" nothing is asked.
 */
const clausesOf = (text: string): Clause[] =>
  text
    .trim()
    .replace(/^(please|por favor)\s*,\s*/i, '$1 ')
    .replace(/,\s*(please|por favor)\s*([.!?]*)$/i, ' $1$2')
    .split(/(?<=[.!?])\s*/)
    .flatMap((sentence) =>
      sentence
        .split(/(?<=[,;:])/)
        .map((said) => ({ said, text: normalize(said), question: sentence.endsWith('?') })),
    )

/**
 * A clause that is only a name said to someone: "Bia," / "So, Bia," / "Bia?" before the request,
 * or ", Bia?" / ", Pedro." after it. Past the first clause a name is written with a capital, unlike
 * "…, by Friday?".
 */
const isName = (c: Clause, i: number, clauses: readonly Clause[]) =>
  isVocative(c.said) &&
  (i === 0 || /^\s*\p{Lu}/u.test(c.said)) &&
  (/[,?]\s*$/.test(c.said) || clauses[i - 1]?.said.trimEnd().endsWith(',') === true)

/** Words a name follows when it is who or where the work is for, not who is asked ("send it to Bia"). */
const TO_SOMEONE = new Set(
  'to for with from in on at into via para pra pro com ao a de do da em no na pelo pela'.split(' '),
)

/**
 * A name at the end of a request with no comma, as whisper often writes it ("Can you send the invoice
 * Bia?"): a capitalized word, not the first, not one of the task's, not after "to" / "pra".
 */
function endsWithName(c: Clause, task: ReadonlySet<string>): boolean {
  const said = c.said.trim().split(/\s+/)
  const last = said.at(-1)?.replace(/[.!?,;:]+$/, '') ?? ''
  const before = normalize(said.at(-2) ?? '')
  const word = normalize(last)
  return (
    said.length > 1 &&
    /^\p{Lu}\p{Ll}+$/u.test(last) &&
    !task.has(stem(word)) &&
    !NOT_A_VOCATIVE.has(word) &&
    !TO_SOMEONE.has(before)
  )
}

const asked = (c: Clause) =>
  ASKS_YOU.test(c.text) ||
  PLEASE.test(c.text) ||
  HANDED_TO_YOU.test(c.text) ||
  (c.question && ASKS_AS_QUESTION.test(c.text))

/** Verbs of work: a request with the same verb as the task may still be for other work. */
const TASK_VERB = new RegExp(`^(${EN_TASK_VERB}|${PT_TASK_VERB}|${PT_IMPERATIVE})$`)

/**
 * The words a request must name to be for this task: what the work is on ("invoice", "contrato"),
 * not the verb ("send", "mandar"), which a request for other work may share. A task that is only a
 * verb keeps it.
 */
function taskWords(task: string): ReadonlySet<string> {
  const all = contentWords(task).map(stem)
  const objects = all.filter((w) => !TASK_VERB.test(w))
  return new Set(objects.length > 0 ? objects : all)
}

/**
 * Whether a line asks the recorder for this task: a clause of it is a request that names what the
 * task is on, the line says no name to anyone ("Bia, consegue…?", "So, Bia, can you…", "Can you send
 * the invoice, Bia?", "Can you send the invoice Bia?"), and the one speaking takes nothing on in the
 * rest of it ("Can you wait? I will send the invoice"; "Você pode revisar o que eu mandei?" counts:
 * the "eu" is inside the request). A request for other work on the same line ("Can you send the deck?
 * Also Pedro sends the invoice.") does not make the invoice theirs. A request said to someone by name
 * is theirs; when that name is the recorder's, it was said, and the task is theirs anyway.
 */
function asksSelf(line: Segment, task: ReadonlySet<string>): boolean {
  const clauses = clausesOf(line.text)
  const rest = clauses
    .filter((c) => !asked(c))
    .map((c) => c.text)
    .join(' ')
  return (
    !clauses.some(isName) &&
    clauses.some(
      (c) =>
        asked(c) && contentWords(c.text).some((w) => task.has(stem(w))) && !endsWithName(c, task),
    ) &&
    !COMMITMENT.test(rest) &&
    !I_WILL.test(line.text)
  )
}

/**
 * The owner as the person who recorded the meeting: "Me" on two tracks. On one track their name,
 * when one of their names was said in the meeting or a line of the task asks it of "you". A name
 * with no letter or digit ("🙂", "-") is no name: it would match the empty owner, and is never shown.
 */
function asSelf(
  n: string,
  self: Self,
  source: Lines,
  index: TranscriptIndex,
  task: string,
): string | undefined {
  const names = [self.name, ...self.aliases].filter((s) => words(s).length > 0)
  const [shown] = names
  if (!names.some((s) => normalize(s) === n)) return undefined
  if (index.speakers.has(ME)) return ME
  const named = names.some((s) => wasSaid(s, index))
  const own = taskWords(task)
  return named || source.some((l) => asksSelf(l, own)) ? shown : undefined
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
  task: string,
): string {
  const n = normalize(owner)
  const me = self === undefined ? undefined : asSelf(n, self, source, index, task)
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
  return commits(textOf(source)) && said !== SPEAKER ? said : 'Unassigned'
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

/**
 * What a reply says to agree: "Fechado", "sure", "sem problema", "pode deixar". Agreeing brings no
 * subject of its own.
 */
const AGREEING_PHRASES =
  /\b(sem problemas?|nao (tem|ha) problemas?|no problems?|no worries|of course|pode deixar|deixa comigo|pode ser|tudo bem|tudo certo|by all means)\b/g
const AGREEING = new Set(
  (
    'sure fine deal done agreed absolutely right perfect alright great good sounds yep fechado ' +
    'beleza combinado certo claro isso tranquilo boa bom otimo joia perfeito feito ai'
  )
    .split(' ')
    .map(stem),
)

/**
 * Verbs a reply takes the asked work on with ("consigo entregar", "I'll finish", "posso fazer"). They
 * name no work, but a reply that has one says what it will do: then any other word is the work, and
 * if it is not this task's ("Fechado, faço o deploy até sexta"), the deadline is another task's.
 */
const TAKING_ON = new Set(
  (
    'consigo posso podemos entrego entregar faco fazer termino terminar mando mandar envio enviar ' +
    'resolvo fica deliver finish send get have ready manage handle ill pronto'
  )
    .split(' ')
    .map(stem),
)

/**
 * Words that point back at the task asked ("esse aqui", "that one") or round an answer off ("works
 * for me", "sounds good to us"): no subject of their own.
 */
const POINTING = new Set(
  (
    'esse essa este esta isto aqui ali la entao one here there then also too works work sounds ' +
    'nicely totally definitely ja mesmo'
  )
    .split(' ')
    .map(stem),
)

/**
 * A "no" in a reply: the deadline said there may be the one refused ("Não, até sexta não dá"). The
 * English "no" counts only said apart ("No, not by Friday"): in Portuguese it is "em + o" ("entrego
 * no sábado").
 */
const NEGATION =
  /\b(nao|nem|nunca|not|nope|never|cannot)\b|\b(can|won|don|didn|isn|couldn|wouldn)\s?t\b/
const NO_APART = /(^|[.!?]\s*)no\s*[,.!]/i

/**
 * Whether the line holding a deadline talks about this task: it says some of the task's words, or
 * it is a reply that adds nothing of its own and says no "no" ("Não, até sexta não dá", "No, not by
 * Friday" may refuse that very deadline): every other word agrees ("Great, by Friday", "Tá bom,
 * até sexta"), takes the asked work on ("consigo entregar"), or points back at it ("esse aqui").
 * Any other word may be other work ("Beleza, o deploy até sexta"), so the deadline is dropped: a
 * missing deadline is better than a wrong one. "On Friday we pick the band for the party?" after
 * "Book the hall first" names another piece of work, so its deadline is not the hall's.
 */
function aboutTask(line: Segment, said: string, task: string): boolean {
  const own = new Set(contentWords(task).map(stem))
  // "I’ll" with a curly apostrophe is "I'll": normalize would split it into "i ll".
  const text = line.text.replace(said, ' ').replace(/’/g, "'")
  const kept = normalize(text).replace(AGREEING_PHRASES, ' ')
  const rest = contentWords(kept).map(stem)
  if (rest.some((w) => own.has(w))) return true
  if (NEGATION.test(kept) || NO_APART.test(text)) return false
  return rest.every((w) => AGREEING.has(w) || TAKING_ON.has(w) || POINTING.has(w))
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
        owner: resolveOwner(c.raw.owner, c.lines, index, self, c.task),
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
