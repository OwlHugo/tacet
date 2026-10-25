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
 * segments, its timestamp is the start of the first one, its quote is in them, and (for tasks) its
 * owner is a track of this transcript, a name that was said, or nobody.
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
      owner: 'Unassigned',
    })),
    ...minutes.actionItems.map((a) => ({
      kind: 'action',
      text: a.task,
      quote: a.quote || a.task,
      segments: a.segments,
      at: a.at,
      owner: a.owner,
    })),
  ]
  const speakers = new Set(transcript.segments.map((s) => s.speaker))
  const spoken = transcript.segments.map((s) => s.text).join(' ')
  // An owner is a track that exists in this transcript, a name that was said, or nobody. Track
  // labels count only as tracks: "Others" is not an owner of a one-track import just because someone
  // said "the others". "Speaker" (one mixed track) says nothing about who spoke, so it never is.
  const TRACK_LABELS = new Set(['me', 'others', 'speaker'])
  const ownerGrounded = (owner: string) =>
    owner === 'Unassigned' ||
    (TRACK_LABELS.has(owner.trim().toLowerCase())
      ? owner !== 'Speaker' && speakers.has(owner)
      : speakers.has(owner) || coverage(owner, spoken) === 1)
  const ungrounded = items.filter((it) => {
    const segs = it.segments.map((id) => byId.get(id))
    const text = segs.map((s) => s?.text ?? '').join(' ')
    const ok =
      segs.length > 0 &&
      segs.every((s) => s !== undefined) &&
      Math.abs((segs[0]?.start ?? -1) - it.at) < 0.001 &&
      coverage(it.quote, text) >= 0.6 &&
      ownerGrounded(it.owner)
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
