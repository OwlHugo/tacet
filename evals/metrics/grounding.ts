import { coverage, type Minutes, similarity, type Transcript } from '@tacet/core'

export interface GroundingReport {
  readonly items: number
  readonly grounded: number
  readonly ungrounded: readonly { readonly kind: string; readonly text: string }[]
  readonly expectedFound: number
  readonly expectedTotal: number
}

/**
 * Independent check, written apart from groundMinutes: an item is grounded only if it cites real
 * segments, its timestamp is the start of the first one, and its quote is in them.
 */
export function checkGrounding(
  minutes: Minutes,
  transcript: Transcript,
  expectedActions: readonly (readonly string[])[],
): GroundingReport {
  const byId = new Map(transcript.segments.map((s) => [s.id, s]))
  const items = [
    ...minutes.decisions.map((d) => ({
      kind: 'decision',
      text: d.text,
      quote: d.quote || d.text,
      segments: d.segments,
      at: d.at,
    })),
    ...minutes.actionItems.map((a) => ({
      kind: 'action',
      text: a.task,
      quote: a.quote || a.task,
      segments: a.segments,
      at: a.at,
    })),
  ]
  const ungrounded = items.filter((it) => {
    const segs = it.segments.map((id) => byId.get(id))
    const text = segs.map((s) => s?.text ?? '').join(' ')
    const ok =
      segs.length > 0 &&
      segs.every((s) => s !== undefined) &&
      Math.abs((segs[0]?.start ?? -1) - it.at) < 0.001 &&
      coverage(it.quote, text) >= 0.6
    return !ok
  })
  const expectedFound = expectedActions.filter((keywords) =>
    minutes.actionItems.some((a) => {
      const hay = `${a.task} ${a.quote}`
      return (
        keywords.every((k) => coverage(k, hay) === 1) || similarity(keywords.join(' '), hay) > 0.5
      )
    }),
  ).length
  return {
    items: items.length,
    grounded: items.length - ungrounded.length,
    ungrounded: ungrounded.map((u) => ({ kind: u.kind, text: u.text })),
    expectedFound,
    expectedTotal: expectedActions.length,
  }
}
