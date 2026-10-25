import { formatTimestamp } from '../transcript/timestamp.ts'
import { ME, OTHERS, type Segment, SPEAKER } from '../transcript/types.ts'

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

const prompt = (speakers: string, owner: string, neutral: string) =>
  `You write meeting minutes from a transcript. Every line of the transcript looks like
[ID] mm:ss SPEAKER: text
${speakers}

Rules:
- Use only what is said in the transcript. Never add facts, names, dates or tasks that are not there.
- Every item must list the IDs of the transcript lines it comes from in "segments".
- "quote" must be copied word for word from one of those lines.
- summary: 2 to 5 short points about what was discussed.
- decisions: only things the participants explicitly agreed or decided. Empty list if none.
- action_items: only concrete tasks someone committed to or was asked to do. ${owner} Empty list if none.
- "due" is the task's deadline in the exact words of the transcript ("by Thursday", "até sexta", "tomorrow morning"), never expanded ("até sexta" stays "até sexta") or turned into a date. When it is said in the reply right after the task ("Sure, tomorrow morning"), add that line to "segments". Empty string if no deadline was said.
${neutral}- Write every field in the language of the transcript. Be brief.`

/** The prompt for a recording (mic = "Me", system audio = "Others"). */
export const SYSTEM_PROMPT = prompt(TRACKS, OWNER_TRACKS, NEUTRAL_TRACKS)

/** Pick the speaker instructions that match the labels actually present in the transcript. */
function forSpeakers(speakers: readonly string[]): string {
  const set = new Set(speakers)
  if (set.size === 0 || [...set].every((s) => s === ME || s === OTHERS)) return SYSTEM_PROMPT
  if (set.size === 1 && set.has(SPEAKER)) return prompt(SINGLE, OWNER_SINGLE, NEUTRAL_SINGLE)
  return prompt(LABELLED([...set].map((s) => `"${s}"`).join(', ')), OWNER_LABELLED, '')
}

const LANGUAGES: Readonly<Record<string, string>> = {
  en: 'English',
  pt: 'Portuguese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
}

export function systemPrompt(language: string, speakers: readonly string[]): string {
  const base = forSpeakers(speakers)
  const name = LANGUAGES[language]
  return name
    ? `${base}\nThe transcript is in ${name}. Write the summary, decisions and tasks in ${name}.`
    : base
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
