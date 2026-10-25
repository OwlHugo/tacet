import { join } from 'node:path'
import { WavWriter } from '@tacet/core'
import type { Track } from '../../shared/contract.ts'

export interface RecordedTrack {
  readonly track: Track
  readonly path: string
  readonly seconds: number
}

/**
 * How loud a chunk is, 0..1, for the level meter: RMS on a dB scale from -60 dB (silence) to 0 dB,
 * so a quiet voice still moves the bar.
 */
export function chunkLevel(data: Float32Array): number {
  if (data.length === 0) return 0
  let sum = 0
  for (const s of data) sum += s * s
  const db = 10 * Math.log10(sum / data.length + 1e-12)
  return Math.min(1, Math.max(0, (db + 60) / 60))
}

/** Receives PCM chunks from the recorder window and writes one WAV per track. */
export class RecordingSession {
  readonly id: string
  readonly dir: string
  readonly startedAt = new Date()
  readonly #writers = new Map<Track, WavWriter>()

  constructor(id: string, dir: string) {
    this.id = id
    this.dir = dir
  }

  open(track: Track, sampleRate: number): void {
    this.#writers.get(track)?.close()
    this.#writers.set(track, new WavWriter(join(this.dir, `${track}.wav`), sampleRate))
  }

  write(track: Track, data: Float32Array): void {
    this.#writers.get(track)?.write(data)
  }

  /** Close every file and return the tracks that captured something. */
  close(): RecordedTrack[] {
    const out = [...this.#writers].flatMap(([track, w]) => {
      w.close()
      return w.seconds > 0.5
        ? [{ track, path: join(this.dir, `${track}.wav`), seconds: w.seconds }]
        : []
    })
    this.#writers.clear()
    return out
  }
}
