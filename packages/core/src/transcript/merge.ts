import { coverage, similarity } from '../matching/words.ts'
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

/** Share of a mic segment's content words the system track must say for it to be an echo. */
const ECHO_MIN_WORD_SHARE = 0.5

/**
 * Share of a mic segment's duration the system track must be talking over for it to be an echo.
 * An answer that repeats the question and only touches its edge stays below it.
 */
const ECHO_MIN_TIME_SHARE = 0.5

/** Share of the shorter of two segments a single pair must overlap to be an echo. */
const ECHO_MIN_PAIR_OVERLAP = 0.3

const overlaps = (a: TimedText, b: TimedText, slack = 0): boolean =>
  a.start < b.end + slack && b.start < a.end + slack

/** Overlap of two segments as a share of the shorter one. */
const pairOverlap = (a: TimedText, b: TimedText): number => {
  const inter = Math.min(a.end, b.end) - Math.max(a.start, b.start)
  const len = Math.min(a.end - a.start, b.end - b.start)
  return len > 0 ? Math.max(0, inter) / len : 0
}

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
 * so a "Me" segment is an echo when one "Others" segment overlaps it with mostly the same words,
 * or when the "Others" around it talk over most of it with most of its words. Whisper cuts the two
 * tracks differently (one long mic line against several short system pieces), hence the pooled
 * check; it stretches a quiet mic line over the silence before it, hence the pairwise one.
 */
export function mergeTracks(tracks: readonly (readonly TimedText[])[]): Segment[] {
  const all = tracks.flat()
  const others = all.filter((s) => s.speaker !== ME)
  const isEcho = (s: TimedText) => {
    if (s.speaker !== ME) return false
    const pairEcho = others.some(
      (o) =>
        pairOverlap(s, o) > ECHO_MIN_PAIR_OVERLAP &&
        similarity(s.text, o.text) >= ECHO_MIN_WORD_SHARE,
    )
    const heard = others.filter((o) => overlaps(s, o, ECHO_SLACK_SECONDS))
    return (
      pairEcho ||
      (timeShare(s, heard) >= ECHO_MIN_TIME_SHARE &&
        coverage(s.text, heard.map((o) => o.text).join(' ')) >= ECHO_MIN_WORD_SHARE)
    )
  }
  return all
    .filter((s) => !isEcho(s))
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((s, id) => ({ ...s, id }))
}
