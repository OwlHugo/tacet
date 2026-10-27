import type { Segment, Transcript } from '../transcript/types.ts'
import {
  type GroundingOptions,
  groundMinutes,
  type Lines,
  sourceLines,
  withoutDeadline,
} from './ground.ts'
import { chunkSegments, systemPrompt, transcriptForPrompt } from './prompt.ts'
import {
  type GenerateRawMinutes,
  type Minutes,
  type MinutesPart,
  PART_SCHEMA,
  type PartAnswer,
  type RawMinutes,
  type Rejected,
  type Self,
} from './types.ts'

const LISTS = ['summary', 'decisions', 'tasks'] as const

/**
 * Size of a chunk of transcript for the summary and the decisions. A 7B model keeps track of about
 * this much: on a 10-minute call a whole-call request loses the main subject and most decisions.
 * Tasks keep the larger default chunk: they are found line by line, and a reply that gives the
 * deadline must stay in the same chunk as its task.
 */
const OVERVIEW_CHARS = 4000

/** Lines of context on each side of an item's source when it is checked on its own. */
const CONTEXT_LINES = 2

export interface GenerateMinutesDeps {
  readonly generate: GenerateRawMinutes
  /** Name recorded in the minutes ("qwen2.5:7b"). */
  readonly model: string
  readonly grounding?: GroundingOptions
  /** Who recorded the meeting, when the user said it: owners on a mixed track. */
  readonly self?: Self | undefined
}

async function ask<P extends MinutesPart>(
  deps: GenerateMinutesDeps,
  system: string,
  user: string,
  part: P,
): Promise<PartAnswer<P>> {
  const schema = PART_SCHEMA[part]
  return schema.parse(await deps.generate(system, user, part)) as PartAnswer<P>
}

/** The source lines of an item and a few around them, as the model sees a transcript. */
function excerpt(lines: Lines, transcript: Transcript): string {
  const first = lines[0].id
  const last = Math.max(...lines.map((s) => s.id))
  return transcriptForPrompt(
    transcript.segments.filter(
      (s) => s.id >= first - CONTEXT_LINES && s.id <= last + CONTEXT_LINES,
    ),
  )
}

/**
 * Ask the model whether one item was really settled, on its own lines. Grounding proves the words
 * were said; this asks whether they were said as a decision or a task, not as a question, a joke
 * or a complaint. An item without source lines is left for grounding to reject.
 */
async function confirmed(
  item: string,
  quote: string,
  cited: readonly number[],
  transcript: Transcript,
  deps: GenerateMinutesDeps,
): Promise<boolean> {
  const lines = sourceLines(quote || item, cited, transcript)
  if (lines === undefined) return true
  const answer = await ask(
    deps,
    systemPrompt(transcript.language, [], 'confirm'),
    `Item: ${item}\nLines:\n${excerpt(lines, transcript)}`,
    'confirm',
  )
  return answer.agreed && answer.kind === 'agreed'
}

type Task = RawMinutes['action_items'][number]

/**
 * A deadline stays only when the model, asked on its own, says it is a time said for this task. A
 * refused one leaves the task's wording too ("Send the notes by Friday" becomes "Send the notes").
 */
async function checkedDue(
  task: Task,
  transcript: Transcript,
  deps: GenerateMinutesDeps,
  refused: Rejected[],
): Promise<Task> {
  if (task.due.trim() === '') return task
  const lines = sourceLines(task.quote || task.task, task.segments, transcript)
  if (lines === undefined) return task
  const answer = await ask(
    deps,
    systemPrompt(transcript.language, [], 'deadline'),
    `Task: ${task.task}\nDeadline: ${task.due}\nLines:\n${excerpt(lines, transcript)}`,
    'deadline',
  )
  if (answer.is_time && answer.for_this_task) return task
  refused.push({
    kind: 'deadline',
    text: `${task.task}: ${task.due}`,
    reason: answer.is_time ? 'deadline said for other work' : 'deadline is not a time',
  })
  return { ...task, task: withoutDeadline(task.task, task.due), due: '' }
}

/**
 * Ask the LLM chunk by chunk, one request per list (summary, decisions, tasks), then check every
 * decision and every deadline on its own lines, and ground what is left against the transcript. A 7B model
 * asked for everything at once spends itself on one list and leaves the others empty or wrong.
 */
export async function generateMinutes(
  transcript: Transcript,
  deps: GenerateMinutesDeps,
): Promise<{ minutes: Minutes; raw: RawMinutes }> {
  const raw: RawMinutes = { summary: [], decisions: [], action_items: [] }
  const speakers = transcript.segments.map((s) => s.speaker)
  const system = (part: (typeof LISTS)[number]) =>
    systemPrompt(transcript.language, speakers, part, deps.self)
  const numbered = (chunk: readonly Segment[]) => `Transcript:\n${transcriptForPrompt(chunk)}`
  for (const chunk of chunkSegments(transcript.segments, OVERVIEW_CHARS)) {
    const user = numbered(chunk)
    raw.summary.push(...(await ask(deps, system('summary'), user, 'summary')).summary)
    raw.decisions.push(...(await ask(deps, system('decisions'), user, 'decisions')).decisions)
  }
  for (const chunk of chunkSegments(transcript.segments)) {
    const user = numbered(chunk)
    raw.action_items.push(...(await ask(deps, system('tasks'), user, 'tasks')).action_items)
  }
  const checked: RawMinutes = { summary: raw.summary, decisions: [], action_items: [] }
  const refused: Rejected[] = []
  for (const d of raw.decisions)
    if (await confirmed(d.text, d.quote, d.segments, transcript, deps)) checked.decisions.push(d)
    else refused.push({ kind: 'decision', text: d.text, reason: 'not settled in its lines' })
  // Tasks are not confirmed: asked about one line, the model calls a plain request ("falta só
  // tratar X") "other" and drops it. Their deadline is checked.
  for (const t of raw.action_items)
    checked.action_items.push(await checkedDue(t, transcript, deps, refused))
  const minutes = groundMinutes(checked, transcript, deps.model, {
    ...deps.grounding,
    self: deps.self,
  })
  return { minutes: { ...minutes, rejected: [...refused, ...minutes.rejected] }, raw: checked }
}
