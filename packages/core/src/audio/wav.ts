import { closeSync, openSync, readFileSync, writeSync } from 'node:fs'
import type { Pcm } from './speech.ts'

function header(dataBytes: number, sampleRate: number): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + dataBytes, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(dataBytes, 40)
  return h
}

/** Streaming 16-bit PCM mono WAV writer. The recorder uses it, so recording needs no ffmpeg. */
export class WavWriter {
  readonly sampleRate: number
  #fd: number
  #dataBytes = 0

  constructor(path: string, sampleRate = 16000) {
    this.sampleRate = sampleRate
    this.#fd = openSync(path, 'w')
    writeSync(this.#fd, header(0, sampleRate))
  }

  /** Append float samples in [-1, 1]. */
  write(samples: Float32Array): void {
    const buf = Buffer.alloc(samples.length * 2)
    samples.forEach((sample, i) => {
      const s = Math.max(-1, Math.min(1, sample))
      buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2)
    })
    writeSync(this.#fd, buf)
    this.#dataBytes += buf.length
  }

  get seconds(): number {
    return this.#dataBytes / 2 / this.sampleRate
  }

  close(): void {
    writeSync(this.#fd, header(this.#dataBytes, this.sampleRate), 0, 44, 0)
    closeSync(this.#fd)
  }
}

function toMono(buf: Buffer, body: number, len: number, channels: number): Float32Array {
  const frames = Math.floor(len / 2 / channels)
  const samples = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) sum += buf.readInt16LE(body + (i * channels + c) * 2)
    samples[i] = sum / channels / 0x8000
  }
  return samples
}

/** Read a 16-bit PCM WAV, mixed to mono. Walks the RIFF chunks, so LIST/fact chunks are fine. */
export function readWav(path: string): Pcm {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path} is not a WAV file`)
  }
  let pos = 12
  let channels = 1
  let sampleRate = 16000
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const declared = buf.readUInt32LE(pos + 4)
    const body = pos + 8
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2)
      sampleRate = buf.readUInt32LE(body + 4)
      if (buf.readUInt16LE(body + 14) !== 16)
        throw new Error(`${path}: only 16-bit PCM is supported`)
    } else if (id === 'data') {
      // Streaming writers can leave the size at 0 or past the end of the file.
      const len = declared === 0 || body + declared > buf.length ? buf.length - body : declared
      return { sampleRate, samples: toMono(buf, body, len, channels) }
    }
    pos = body + declared + (declared % 2)
  }
  throw new Error(`${path}: no audio data`)
}
