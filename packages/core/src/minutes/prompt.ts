import { formatTimestamp } from '../transcript/timestamp.ts'
import type { Segment } from '../transcript/types.ts'

export const SYSTEM_PROMPT = `You write meeting minutes from a transcript. Every line of the transcript looks like
[ID] mm:ss SPEAKER: text
"Me" is the person who recorded the meeting, "Others" is everyone heard through the computer.

Rules:
- Use only what is said in the transcript. Never add facts, names, dates or tasks that are not there.
- Every item must list the IDs of the transcript lines it comes from in "segments".
- "quote" must be copied word for word from one of those lines.
- summary: 2 to 5 short points about what was discussed.
- decisions: only things the participants explicitly agreed or decided. Empty list if none.
- action_items: only concrete tasks someone committed to or was asked to do. "owner" is the person's name if it was said,
  otherwise "Me" or "Others" based on who committed. Empty list if none.
- "Me" and "Others" are track labels, not names. In summary and decisions write neutrally ("the team", "it was agreed"), never "Me did".
- Write every field in the language of the transcript. Be brief.`

const LANGUAGES: Readonly<Record<string, string>> = {
  en: 'English',
  pt: 'Portuguese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
}

export function systemPrompt(language: string): string {
  const name = LANGUAGES[language]
  return name
    ? `${SYSTEM_PROMPT}\nThe transcript is in ${name}. Write the summary, decisions and tasks in ${name}.`
    : SYSTEM_PROMPT
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
