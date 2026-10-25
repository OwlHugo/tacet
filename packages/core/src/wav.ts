import { closeSync, openSync, readSync, writeSync, type PathLike } from 'node:fs';

/** Minimal streaming WAV writer: 16-bit PCM mono. Used by the recorder, no ffmpeg needed. */
export class WavWriter {
  private fd: number;
  private dataBytes = 0;

  constructor(
    path: PathLike,
    readonly sampleRate = 16000,
  ) {
    this.fd = openSync(path, 'w');
    writeSync(this.fd, header(0, sampleRate));
  }

  /** Append float samples in [-1, 1]. */
  write(samples: Float32Array): void {
    const buf = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
      buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
    }
    writeSync(this.fd, buf);
    this.dataBytes += buf.length;
  }

  get seconds(): number {
    return this.dataBytes / 2 / this.sampleRate;
  }

  close(): void {
    writeSync(this.fd, header(this.dataBytes, this.sampleRate), 0, 44, 0);
    closeSync(this.fd);
  }
}

function header(dataBytes: number, sampleRate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** Duration of a PCM WAV file in seconds, read from its header. */
export function wavDuration(path: string): number {
  const fd = openSync(path, 'r');
  try {
    const h = Buffer.alloc(44);
    readSync(fd, h, 0, 44, 0);
    const byteRate = h.readUInt32LE(28);
    const dataBytes = h.readUInt32LE(40);
    return byteRate ? dataBytes / byteRate : 0;
  } finally {
    closeSync(fd);
  }
}
