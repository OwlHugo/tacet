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

/**
 * Share of a mic segment's duration the system track must be talking over for it to be an echo.
 * An answer that repeats the question and only touches its edge stays below it.
 */
const ECHO_MIN_TIME_SHARE = 0.5

const overlaps = (a: TimedText, b: TimedText, slack = 0): boolean =>
  a.start < b.end + slack && b.start < a.end + slack

/** Share of `s`'s duration covered by the union of `pieces`, clipped to `s`. */
function timeShare(s: TimedText, pieces: readonly TimedText[]): number {
  const clipped = pieces
    .map((p) => [p.start, Math.min(s.end, p.end)] as const)
    .sort((a, b) => a[0] - b[0])
  let covered = 0
  let reach = s.start
  for (const [start, end] of clipped) {
    covered += Math.max(0, end - Math.max(start, reach))
    reach = Math.max(reach, end)
  }
  return covered / (s.end - s.start)
}

/**
 * Merge per-track segments into one timeline. Without headphones the mic also hears the speakers,
 * so a "Me" segment said mostly while "Others" talk, with words mostly theirs, is an echo. Whisper
 * cuts the two tracks differently (one long mic line against several short system pieces), so
 * time and words are pooled from every "Others" segment around it.
 */
export function mergeTracks(tracks: readonly (readonly TimedText[])[]): Segment[] {
  const all = tracks.flat()
  const others = all.filter((s) => s.speaker !== ME)
  const isEcho = (s: TimedText) => {
    if (s.speaker !== ME) return false
    const heard = others.filter((o) => overlaps(s, o, ECHO_SLACK_SECONDS))
    return (
      timeShare(s, heard) >= ECHO_MIN_TIME_SHARE &&
      coverage(s.text, heard.map((o) => o.text).join(' ')) >= 0.5
    )
  }
  return all
    .filter((s) => !isEcho(s))
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((s, id) => ({ ...s, id }))
}
