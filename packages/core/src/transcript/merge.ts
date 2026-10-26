import { coverage } from '../matching/words.ts'
import { ME, type Segment, type TimedText } from './types.ts'

/** Trim and drop the stray quote mark whisper sometimes opens a segment with. */
export function cleanText(text: string): string {
  const t = text.trim()
  return /^["“]/.test(t) && !/["”]/.test(t.slice(1)) ? t.slice(1).trim() : t
}

/** Whisper's well-known outputs on silence. */
export function isHallucination(text: string): boolean {
  const t = text.trim().toLowerCase()
  return (
    /^[[(].*[\])]$/.test(t) || /^(thank you\.?|thanks for watching!?|obrigad[oa]\.?|you)$/.test(t)
  )
}

/** How far around a mic segment the system track may say the same words (whisper's timing drift). */
const ECHO_SLACK_SECONDS = 1.5

const overlaps = (a: TimedText, b: TimedText, slack = 0): boolean =>
  a.start < b.end + slack && b.start < a.end + slack

/**
 * Merge per-track segments into one timeline. Without headphones the mic also hears the speakers,
 * so a "Me" segment whose words are mostly said by "Others" at the same time is an echo. Whisper
 * cuts the two tracks differently (one long mic line against several short system pieces), so the
 * words are pooled from every "Others" segment around it.
 */
export function mergeTracks(tracks: readonly (readonly TimedText[])[]): Segment[] {
  const all = tracks.flat()
  const others = all.filter((s) => s.speaker !== ME)
  const isEcho = (s: TimedText) => {
    const heard = others.filter((o) => overlaps(s, o, ECHO_SLACK_SECONDS))
    return (
      s.speaker === ME &&
      heard.some((o) => overlaps(s, o)) &&
      coverage(s.text, heard.map((o) => o.text).join(' ')) >= 0.5
    )
  }
  return all
    .filter((s) => !isEcho(s))
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((s, id) => ({ ...s, id }))
}
