export interface Pcm {
  readonly sampleRate: number
  readonly samples: Float32Array
}

export interface Region {
  start: number
  end: number
}

export interface SpeechOptions {
  readonly frameMs?: number
  /** Frames quieter than (loudest frame - this many dB) are silence. */
  readonly rangeDb?: number
  /** Absolute floor in dBFS, so a silent track does not become all speech. */
  readonly floorDb?: number
  readonly minSpeech?: number
  readonly mergeGap?: number
}

function frameLevels(pcm: Pcm, frame: number): Float32Array {
  const n = Math.floor(pcm.samples.length / frame)
  const db = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let sum = 0
    for (const s of pcm.samples.subarray(f * frame, (f + 1) * frame)) sum += s * s
    db[f] = 10 * Math.log10(sum / frame + 1e-12)
  }
  return db
}

function loudRuns(db: Float32Array, threshold: number, seconds: number): Region[] {
  const runs: Region[] = []
  let open = -1
  db.forEach((level, f) => {
    if (level >= threshold && open < 0) open = f
    if (level < threshold && open >= 0) {
      runs.push({ start: open * seconds, end: f * seconds })
      open = -1
    }
  })
  if (open >= 0) runs.push({ start: open * seconds, end: db.length * seconds })
  return runs
}

/**
 * Energy based speech detection. Whisper's timestamps drift on call tracks, which are mostly
 * silence (the other side is talking); snapping segments to real speech fixes the timeline the
 * minutes' timestamps depend on.
 */
export function speechRegions(pcm: Pcm, opts: SpeechOptions = {}): Region[] {
  const frame = Math.max(1, Math.round((pcm.sampleRate * (opts.frameMs ?? 20)) / 1000))
  const db = frameLevels(pcm, frame)
  const loudest = db.reduce((m, v) => Math.max(m, v), Number.NEGATIVE_INFINITY)
  const threshold = Math.max(loudest - (opts.rangeDb ?? 35), opts.floorDb ?? -55)
  const merged: Region[] = []
  for (const r of loudRuns(db, threshold, frame / pcm.sampleRate)) {
    const last = merged.at(-1)
    if (last && r.start - last.end <= (opts.mergeGap ?? 0.35)) last.end = r.end
    else merged.push(r)
  }
  return merged.filter((r) => r.end - r.start >= (opts.minSpeech ?? 0.15))
}

/**
 * Move each segment's start/end onto the speech it covers. Segments over pure silence are whisper
 * hallucinating and are removed.
 */
export function snapToSpeech<T extends { start: number; end: number }>(
  segments: readonly T[],
  regions: readonly Region[],
  slack = 0.3,
): T[] {
  return segments.flatMap((s) => {
    const near = regions.filter((r) => r.end > s.start - slack && r.start < s.end + slack)
    // Ignore regions that only graze the segment edge (the tail of the previous line).
    const inside = (r: Region) => Math.min(r.end, s.end) - Math.max(r.start, s.start)
    const solid = near.filter((r) => inside(r) >= Math.min(0.25, (r.end - r.start) / 2))
    const hit = solid.length > 0 ? solid : near
    const first = hit[0]
    const last = hit.at(-1)
    if (!first || !last) return []
    const start = Math.max(s.start, first.start)
    const end = Math.min(s.end, last.end)
    return [{ ...s, start: Math.min(start, end), end: Math.max(start, end) }]
  })
}
