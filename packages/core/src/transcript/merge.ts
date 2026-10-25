import { similarity } from '../matching/words.ts'
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

const overlap = (a: TimedText, b: TimedText): number => {
  const inter = Math.min(a.end, b.end) - Math.max(a.start, b.start)
  const len = Math.min(a.end - a.start, b.end - b.start)
  return len > 0 ? Math.max(0, inter) / len : 0
}

/**
 * Merge per-track segments into one timeline. Without headphones the mic also hears the speakers,
 * so a "Me" segment that overlaps an "Others" segment with mostly the same words is an echo.
 */
export function mergeTracks(tracks: readonly (readonly TimedText[])[]): Segment[] {
  const all = tracks.flat()
  const others = all.filter((s) => s.speaker !== ME)
  const isEcho = (s: TimedText) =>
    s.speaker === ME && others.some((o) => overlap(s, o) > 0.3 && similarity(s.text, o.text) >= 0.5)
  return all
    .filter((s) => !isEcho(s))
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((s, id) => ({ ...s, id }))
}
