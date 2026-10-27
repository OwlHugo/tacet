import { formatTimestamp } from '../transcript/timestamp.ts'
import { ME, OTHERS, type Segment, SPEAKER } from '../transcript/types.ts'
import type { MinutesPart, Self } from './types.ts'

/** How the speakers are labelled, which changes what the model may write as an owner. */
const TRACKS = `"Me" is the person who recorded the meeting, "Others" is everyone heard through the computer.`
const SINGLE = `All lines are labelled "Speaker": the recording has one mixed track, so the label never says who spoke.`
const LABELLED = (names: string) => `Speakers are labelled ${names}.`

const OWNER_TRACKS = `"owner" is the person's name if it was said,
  otherwise "Me" or "Others" based on who committed.`
const OWNER_SINGLE = `"owner" is the person's name only if it was said in the transcript,
  otherwise an empty string. Never write "Speaker", "Me" or "Others" as an owner.`
const OWNER_LABELLED = `"owner" is the person's name if it was said, otherwise the label of the line
  where someone said they will do it ("I will", "I'll"), otherwise an empty string.`

const NEUTRAL_TRACKS = `- "Me" and "Others" are track labels, not names. In summary and decisions write neutrally ("the team", "it was agreed"), never "Me did".
`
const NEUTRAL_SINGLE = `- "Speaker" is not a name. In summary and decisions write neutrally ("the team", "it was agreed").
`

const quoted = (names: readonly string[]) => names.map((n) => `"${n}"`).join(', ')

/** Who "Me" is, or who is on a mixed track, when the user said their name. */
function selfLine(self: Self | undefined, single: boolean): string {
  if (self === undefined) return ''
  const aka = self.aliases.length > 0 ? ` (also called ${quoted(self.aliases)})` : ''
  return single
    ? `\nThe meeting was recorded by "${self.name}"${aka}, one of the voices. Work asked of "${self.name}" or of one of those names, or asked of "you" in a one-to-one call, has "${self.name}" as owner.`
    : `\n"Me" is "${self.name}"${aka}.`
}

const COMMON = (speakers: string) => `Every line of the transcript looks like
[ID] mm:ss SPEAKER: text
${speakers}

Rules:
- Use only what is said in the transcript. Never add facts, names, dates or tasks that are not there.
- Every item must list the IDs of the transcript lines it comes from in "segments".`

/** What was the meeting about, its main subject first. */
const summary = (speakers: string, neutral: string) =>
  `You write the summary of a meeting from its transcript. ${COMMON(speakers)}
- summary: 2 to 5 short points about what was discussed. The first point is the main subject: what the meeting is for (what will be built, changed or decided), never small talk, a complaint or a story told on the side.
${neutral}- Write every field in the language of the transcript. Be brief.`

/** An invented call that shows what a decision is and what is not. */
const DECISIONS_EXAMPLE = `Example transcript:
[0] 00:00 Speaker: The garden club wants the spring fair on the first Saturday.
[1] 00:05 Speaker: Let's do the plant swap first and the raffle after lunch.
[2] 00:09 Speaker: Okay.
[3] 00:10 Speaker: Do we print new posters?
[4] 00:12 Speaker: No, we reuse last year's posters.
[5] 00:15 Speaker: Sure, and we rent a helicopter to drop the flyers, right?
[6] 00:19 Speaker: Ha. My neighbour repainted his fence again, by the way.
[7] 00:23 Speaker: The bake sale waits until the autumn fair.
Example answer decisions:
- "Plant swap first, raffle after lunch" from [1]
- "Reuse last year's posters" from [4]
- "The bake sale waits until the autumn fair" from [7]
Not decisions: [3] is a question (its answer [4] is the decision), [5] is sarcasm, [6] is small talk.`

/** What was agreed, and nothing that only sounds like it. */
const decisions = (speakers: string, neutral: string) =>
  `You list the decisions of a meeting from its transcript. ${COMMON(speakers)}
- "quote" must be copied word for word from one of those lines.
- decisions: what the participants settled on how the work will be done: what is in or out, what comes first, how it will be built, what waits for later. "Do X first", "no need for Y", "keep Z as it is" are decisions.
- Never a decision: a question, a joke, sarcasm or irony, a complaint, gossip, a story about what happened before or what other people do. Empty list if nothing was settled.
${neutral}- Write every field in the language of the transcript. Be brief.

${DECISIONS_EXAMPLE}`

/** The action items: who will do what, and by when if it was said. */
const tasks = (speakers: string, owner: string) =>
  `You list the action items of a meeting from its transcript. ${COMMON(speakers)}
- "quote" must be copied word for word from one of those lines.
- action_items: every concrete task someone committed to ("I will", "X will") or was asked to do. Go through the whole transcript line by line: each line where someone takes on work, or is named to do something, is one item, even when the line also says something else ("We agreed. Ana will fix the docs." gives Ana's task). A decision about when something happens ("the release is on Tuesday") is not a task unless someone takes it on. ${owner} Empty list if none.
- "due" is the task's deadline in the exact words of the transcript ("by Thursday", "até sexta", "tomorrow morning"), never expanded ("até sexta" stays "até sexta") or turned into a date. When it is said in the reply right after the task ("Sure, tomorrow morning"), add that line to "segments". Empty string if no deadline was said.
- Write every field in the language of the transcript. Be brief.`

/** The yes/no check of one item: it must have been settled, not asked, joked or complained about. */
const CONFIRM = `You check one item of meeting minutes against the lines of the transcript it comes from.
Answer what those lines are:
- "agreed": the participants settled it, someone said they will do it, or someone was asked to do it and nobody refused.
- "question": it was only asked, never answered with a yes.
- "joke": irony, sarcasm, exaggeration, laughing at something.
- "complaint": criticism of other people or venting.
- "story": what happened before, or what other people do or want.
- "other": none of these.
"agreed" is true only when the lines show the item was settled or taken on, as the item says it. A sarcastic or exaggerated line is never agreed, even when it sounds like a plan.`

/** The check of one deadline: a time, said for this task and not for another one nearby. */
const DEADLINE = `You check the deadline of one task of meeting minutes against the lines of the transcript it comes from.
- "is_time": the deadline names a time or a date ("by Friday", "tomorrow", "at five", "next week"). A manner ("as fast as possible", "first", "carefully") is not a time.
- "for_this_task": in the lines, that time is said about this same task, not about another piece of work mentioned nearby.`

interface Speakers {
  readonly speakers: string
  readonly owner: string
  readonly neutral: string
}

type ListPart = Exclude<MinutesPart, 'confirm' | 'deadline'>

const CHECKS = { confirm: CONFIRM, deadline: DEADLINE } as const

const prompts = (s: Speakers): Record<ListPart, string> => ({
  summary: summary(s.speakers, s.neutral),
  decisions: decisions(s.speakers, s.neutral),
  tasks: tasks(s.speakers, s.owner),
})

const RECORDING: Speakers = { speakers: TRACKS, owner: OWNER_TRACKS, neutral: NEUTRAL_TRACKS }

/** The prompts for a recording (mic = "Me", system audio = "Others"). */
export const SYSTEM_PROMPT = prompts(RECORDING)

/** Pick the speaker instructions that match the labels actually present in the transcript. */
function forSpeakers(speakers: readonly string[], self: Self | undefined): Speakers {
  const set = new Set(speakers)
  if (set.size === 0 || [...set].every((s) => s === ME || s === OTHERS))
    return { ...RECORDING, speakers: `${TRACKS}${selfLine(self, false)}` }
  if (set.size === 1 && set.has(SPEAKER))
    return {
      speakers: `${SINGLE}${selfLine(self, true)}`,
      owner: OWNER_SINGLE,
      neutral: NEUTRAL_SINGLE,
    }
  return {
    speakers: LABELLED(quoted([...set])),
    owner: OWNER_LABELLED,
    neutral: '',
  }
}

const LANGUAGES: Readonly<Record<string, string>> = {
  en: 'English',
  pt: 'Portuguese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
}

/** The system prompt for one request, for these speakers and this language. */
export function systemPrompt(
  language: string,
  speakers: readonly string[],
  part: MinutesPart,
  self?: Self,
): string {
  const check = part === 'confirm' || part === 'deadline'
  const base = check ? CHECKS[part] : prompts(forSpeakers(speakers, self))[part]
  const name = LANGUAGES[language]
  if (name === undefined) return base
  return check
    ? `${base}\nThe transcript is in ${name}.`
    : `${base}\nThe transcript is in ${name}. Write every field in ${name}.`
}

export function transcriptForPrompt(segments: readonly Segment[]): string {
  return segments
    .map((s) => `[${s.id}] ${formatTimestamp(s.start)} ${s.speaker}: ${s.text}`)
    .join('\n')
}

/** Split long meetings so each request fits a small local model's context. */
export function chunkSegments(segments: readonly Segment[], maxChars = 9000): Segment[][] {
  const chunks: Segment[][] = []
  let current: Segment[] = []
  let size = 0
  for (const s of segments) {
    const len = s.text.length + 20
    if (current.length > 0 && size + len > maxChars) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(s)
    size += len
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}
