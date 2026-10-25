/**
 * Two separate tracks:
 *   mic     getUserMedia microphone
 *   system  getDisplayMedia, answered in the main process with audio: 'loopback'
 *           (ScreenCaptureKit on macOS 13+, WASAPI on Windows). On Linux the PulseAudio/PipeWire
 *           "Monitor of ..." input is used instead, with no portal dialog.
 * Both are resampled to 16 kHz mono by an AudioWorklet and streamed to the main process.
 */
import type { Track } from '../../shared/contract.ts'

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; }
  process(inputs) {
    const ch = inputs[0];
    if (!ch || !ch.length) return true;
    for (let i = 0; i < ch[0].length; i++) {
      let s = 0;
      for (let c = 0; c < ch.length; c++) s += ch[c][i];
      this.buf[this.n++] = s / ch.length;
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('tacet-tap', Tap);
`

export const SAMPLE_RATE = 16000

export interface Capture {
  readonly track: Track
  stop(): Promise<void>
}

type OnChunk = (track: Track, data: Float32Array) => void

async function tap(stream: MediaStream, track: Track, onChunk: OnChunk): Promise<Capture> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
  await ctx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  const node = new AudioWorkletNode(ctx, 'tacet-tap', {
    channelCountMode: 'explicit',
    channelCount: 2,
  })
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(track, e.data)
  ctx.createMediaStreamSource(stream).connect(node)
  // Keep the graph pulling without playing anything back.
  const mute = ctx.createGain()
  mute.gain.value = 0
  node.connect(mute).connect(ctx.destination)
  return {
    track,
    stop: async () => {
      for (const t of stream.getTracks()) t.stop()
      await new Promise((r) => setTimeout(r, 300))
      await ctx.close()
    },
  }
}

/** e2e hook: play a WAV into a MediaStream as a known "microphone". */
async function fileStream(bytes: Uint8Array): Promise<MediaStream> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  const source = ctx.createBufferSource()
  source.buffer = await ctx.decodeAudioData(bytes.slice().buffer)
  const dest = ctx.createMediaStreamDestination()
  source.connect(dest)
  source.start()
  return dest.stream
}

export async function captureMic(onChunk: OnChunk, fake: Uint8Array | undefined): Promise<Capture> {
  const stream = fake
    ? await fileStream(fake)
    : await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
  return tap(stream, 'mic', onChunk)
}

async function linuxMonitor(): Promise<MediaStream | undefined> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const monitor = devices.find((d) => d.kind === 'audioinput' && /monitor/i.test(d.label))
  if (!monitor) return undefined
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: monitor.deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  })
}

async function loopback(): Promise<MediaStream> {
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  // Only the audio is wanted: the video track is stopped right away and never recorded.
  for (const t of display.getVideoTracks()) {
    t.stop()
    display.removeTrack(t)
  }
  if (display.getAudioTracks().length === 0)
    throw new Error('System audio track is not available on this system.')
  return display
}

export async function captureSystem(isLinux: boolean, onChunk: OnChunk): Promise<Capture> {
  const stream = (isLinux ? await linuxMonitor() : undefined) ?? (await loopback())
  return tap(stream, 'system', onChunk)
}
