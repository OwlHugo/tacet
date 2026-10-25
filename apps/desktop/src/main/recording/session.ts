import { join } from 'node:path'
import { WavWriter } from '@tacet/core'
import type { Track } from '../../shared/contract.ts'

export interface RecordedTrack {
  readonly track: Track
  readonly path: string
  readonly seconds: number
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
