import { WavWriter } from '@tacet/core';
import { join } from 'node:path';
import type { Track } from '../shared/ipc';

/** Receives PCM chunks from the capture renderer and writes one WAV per track. */
export class RecordingSession {
  private writers = new Map<Track, WavWriter>();
  readonly startedAt = new Date();

  constructor(
    readonly id: string,
    readonly dir: string,
  ) {}

  open(track: Track, sampleRate: number): void {
    this.writers.get(track)?.close();
    this.writers.set(track, new WavWriter(join(this.dir, `${track}.wav`), sampleRate));
  }

  write(track: Track, data: Float32Array): void {
    this.writers.get(track)?.write(data);
  }

  /** Close every file and return the tracks that captured something. */
  close(): { track: Track; path: string; seconds: number }[] {
    const out: { track: Track; path: string; seconds: number }[] = [];
    for (const [track, w] of this.writers) {
      w.close();
      if (w.seconds > 0.5) out.push({ track, path: join(this.dir, `${track}.wav`), seconds: w.seconds });
    }
    this.writers.clear();
    return out;
  }
}
