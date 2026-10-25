import { normalize, type Transcript } from '@tacet/core'
import type { ReferenceLine } from '../cases.ts'

const longWords = (text: string) =>
  normalize(text)
    .split(' ')
    .filter((w) => w.length >= 3)

/** Share of the words of `needle` that appear in `hay`. */
function wordHit(needle: string, hay: string): number {
  const n = longWords(needle)
  const h = new Set(longWords(hay))
  return n.length > 0 ? n.filter((w) => h.has(w)).length / n.length : 0
}

const textOf = (t: Transcript, keep: (speaker: string) => boolean) =>
  t.segments
    .filter((s) => keep(s.speaker))
    .map((s) => s.text)
    .join(' ')

/** Share of script lines whose words land on the right track. */
export function speakerAccuracy(reference: readonly ReferenceLine[], t: Transcript): number {
  if (reference.length === 0) return 1
  const right = reference.filter((line) => {
    const own = wordHit(
      line.text,
      textOf(t, (s) => s === line.speaker),
    )
    const other = wordHit(
      line.text,
      textOf(t, (s) => s !== line.speaker),
    )
    return own > 0.5 && own >= other
  })
  return right.length / reference.length
}

/** Mean distance (s) between when a line was spoken and the start of the segment holding it. */
export function timestampError(
  reference: readonly ReferenceLine[],
  t: Transcript,
): number | undefined {
  const errors = reference.flatMap((line) => {
    const best = t.segments
      .filter((s) => s.speaker === line.speaker)
      .map((s) => ({ score: wordHit(s.text, line.text), start: s.start }))
      .sort((a, b) => b.score - a.score)[0]
    return best && best.score > 0.3 ? [Math.abs(best.start - line.start)] : []
  })
  return errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : undefined
}
