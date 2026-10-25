import { closeSync, openSync, readSync, statSync } from 'node:fs';

export interface Pcm {
  sampleRate: number;
  samples: Float32Array;
}

/** Read a 16-bit PCM WAV (any channel count, mixed to mono). Walks the RIFF chunks, so LIST/fact chunks are fine. */
export function readWav(path: string): Pcm {
  const size = statSync(path).size;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(size);
    readSync(fd, buf, 0, size, 0);
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path} is not a WAV file`);
    let pos = 12;
    let channels = 1;
    let sampleRate = 16000;
    let bits = 16;
    while (pos + 8 <= buf.length) {
      const id = buf.toString('ascii', pos, pos + 4);
      let len = buf.readUInt32LE(pos + 4);
      const body = pos + 8;
      if (id === 'fmt ') {
        channels = buf.readUInt16LE(body + 2);
        sampleRate = buf.readUInt32LE(body + 4);
        bits = buf.readUInt16LE(body + 14);
      } else if (id === 'data') {
        if (bits !== 16) throw new Error(`${path}: only 16-bit PCM is supported`);
        // Streaming writers can leave the size at 0 or past the end.
        if (len === 0 || body + len > buf.length) len = buf.length - body;
        const frames = Math.floor(len / 2 / channels);
        const samples = new Float32Array(frames);
        for (let i = 0; i < frames; i++) {
          let s = 0;
          for (let c = 0; c < channels; c++) s += buf.readInt16LE(body + (i * channels + c) * 2);
          samples[i] = s / channels / 0x8000;
        }
        return { sampleRate, samples };
      }
      pos = body + len + (len % 2);
    }
    throw new Error(`${path}: no audio data`);
  } finally {
    closeSync(fd);
  }
}

export interface Region {
  start: number;
  end: number;
}

export interface VadOptions {
  frameMs?: number;
  /** Frames quieter than (loudest frame - this many dB) are silence. */
  rangeDb?: number;
  /** Absolute floor in dBFS, so a silent track does not become all speech. */
  floorDb?: number;
  minSpeech?: number;
  mergeGap?: number;
}

/**
 * Energy based speech detection. Whisper's own timestamps drift a lot on call tracks, which are
 * mostly silence (the other side is talking). Snapping segments to real speech fixes the timeline,
 * and the timestamps in the minutes depend on it.
 */
export function speechRegions(pcm: Pcm, opts: VadOptions = {}): Region[] {
  const frame = Math.max(1, Math.round((pcm.sampleRate * (opts.frameMs ?? 20)) / 1000));
  const n = Math.floor(pcm.samples.length / frame);
  const db = new Float32Array(n);
  let max = -Infinity;
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += (pcm.samples[i] ?? 0) ** 2;
    db[f] = 10 * Math.log10(sum / frame + 1e-12);
    if (db[f]! > max) max = db[f]!;
  }
  const threshold = Math.max(max - (opts.rangeDb ?? 35), opts.floorDb ?? -55);
  const sec = frame / pcm.sampleRate;
  const raw: Region[] = [];
  let open = -1;
  for (let f = 0; f <= n; f++) {
    const speech = f < n && db[f]! >= threshold;
    if (speech && open < 0) open = f;
    if (!speech && open >= 0) {
      raw.push({ start: open * sec, end: f * sec });
      open = -1;
    }
  }
  const merged: Region[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end <= (opts.mergeGap ?? 0.35)) last.end = r.end;
    else merged.push({ ...r });
  }
  return merged.filter((r) => r.end - r.start >= (opts.minSpeech ?? 0.15));
}

/**
 * Move each segment's start/end onto the speech it covers. Segments that cover no speech at all are
 * whisper hallucinating on silence and get removed.
 */
export function snapToSpeech<T extends { start: number; end: number }>(segments: T[], regions: Region[], slack = 0.3): T[] {
  const out: T[] = [];
  for (const s of segments) {
    const near = regions.filter((r) => r.end > s.start - slack && r.start < s.end + slack);
    if (!near.length) continue;
    // Ignore regions that only graze the segment edge (the tail of the previous line).
    const inside = (r: Region) => Math.min(r.end, s.end) - Math.max(r.start, s.start);
    const solid = near.filter((r) => inside(r) >= Math.min(0.25, (r.end - r.start) / 2));
    const hit = solid.length ? solid : near;
    const start = Math.max(s.start, hit[0]!.start);
    const end = Math.min(s.end, hit[hit.length - 1]!.end);
    out.push({ ...s, start: Math.min(start, end), end: Math.max(start, end) });
  }
  return out;
}
