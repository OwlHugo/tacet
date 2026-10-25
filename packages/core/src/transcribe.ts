import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { resolveFfmpeg, resolveWhisperBinary, type ResolveOptions } from './binaries.js';
import { ensureModel } from './models.js';
import { similarity } from './text.js';
import type { Segment, Speaker, Transcript } from './types.js';

export interface Track {
  path: string;
  speaker: Speaker;
}

export interface TranscribeOptions extends ResolveOptions {
  /** Whisper model name ("base", "large-v3-turbo") or a path to a ggml .bin. Default: base. */
  model?: string;
  /** Spoken language code or "auto". Default: auto. */
  language?: string;
  threads?: number;
  onLog?: (line: string) => void;
}

interface WhisperJson {
  result?: { language?: string };
  transcription: { offsets: { from: number; to: number }; text: string }[];
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, onLog?: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => onLog?.(d.toString()));
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}: ${stderr.split('\n').slice(-8).join('\n')}`)),
    );
  });
}

/** whisper.cpp reads wav/mp3/flac/ogg itself; anything else (webm, m4a, mp4) goes through ffmpeg first. */
async function toWhisperInput(path: string, work: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  if (['.wav', '.mp3', '.flac', '.ogg'].includes(ext)) return path;
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error(`Cannot read ${ext} files without ffmpeg. Convert to .wav first or install ffmpeg.`);
  const out = join(work, 'input.wav');
  await run(ffmpeg, ['-loglevel', 'error', '-y', '-i', path, '-ar', '16000', '-ac', '1', out], process.env);
  return out;
}

/** Transcribe one audio file into segments attributed to `speaker`. */
export async function transcribeTrack(track: Track, opts: TranscribeOptions = {}): Promise<{ segments: Omit<Segment, 'id'>[]; language: string }> {
  const bin = resolveWhisperBinary(opts);
  const model = await ensureModel(opts.model ?? 'base');
  const work = mkdtempSync(join(tmpdir(), 'tacet-'));
  try {
    const input = await toWhisperInput(track.path, work);
    const outBase = join(work, 'out');
    const args = ['-m', model, '-f', input, '-oj', '-of', outBase, '-np', '-l', opts.language ?? 'auto'];
    if (opts.threads) args.push('-t', String(opts.threads));
    // Prebuilt Linux builds ship their .so files next to the binary.
    const env = { ...process.env, LD_LIBRARY_PATH: [dirname(bin), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
    await run(bin, args, env, opts.onLog);
    const json = JSON.parse(readFileSync(`${outBase}.json`, 'utf8')) as WhisperJson;
    const segments = json.transcription
      .map((t) => ({ start: t.offsets.from / 1000, end: t.offsets.to / 1000, speaker: track.speaker, text: t.text.trim() }))
      .filter((s) => s.text && !isHallucination(s.text));
    return { segments, language: json.result?.language ?? opts.language ?? 'auto' };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Whisper's well-known outputs on silence. */
export function isHallucination(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^[\[(].*[\])]$/.test(t) || /^(thank you\.?|thanks for watching!?|obrigad[oa]\.?|you)$/.test(t);
}

/**
 * Merge per-track segments into one timeline.
 * Without headphones the mic also hears the speakers, so a "Me" segment that overlaps an "Others"
 * segment with mostly the same words is an echo and gets dropped.
 */
export function mergeTracks(tracks: Omit<Segment, 'id'>[][]): Segment[] {
  const all = tracks.flat();
  const others = all.filter((s) => s.speaker !== 'Me');
  const kept = all.filter((s) => {
    if (s.speaker !== 'Me') return true;
    return !others.some((o) => overlap(s, o) > 0.3 && similarity(s.text, o.text) >= 0.5);
  });
  return kept.sort((a, b) => a.start - b.start || a.end - b.end).map((s, id) => ({ ...s, id }));
}

function overlap(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const inter = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  const len = Math.min(a.end - a.start, b.end - b.start);
  return len > 0 ? Math.max(0, inter) / len : 0;
}

export async function transcribe(tracks: Track[], opts: TranscribeOptions = {}): Promise<Transcript> {
  const results = [];
  for (const t of tracks) results.push(await transcribeTrack(t, opts));
  const segments = mergeTracks(results.map((r) => r.segments));
  const duration = segments.reduce((m, s) => Math.max(m, s.end), 0);
  return {
    segments,
    duration,
    language: results.find((r) => r.language !== 'auto')?.language ?? 'auto',
    model: opts.model ?? 'base',
  };
}
