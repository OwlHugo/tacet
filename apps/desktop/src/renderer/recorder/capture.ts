/**
 * Audio capture, two separate tracks:
 *   mic     getUserMedia microphone
 *   system  getDisplayMedia with the main process answering audio: 'loopback'
 *           (ScreenCaptureKit on macOS 13+, WASAPI on Windows). On Linux we take the
 *           PulseAudio/PipeWire "Monitor of ..." input instead, no portal dialog needed.
 * Both are resampled to 16 kHz mono in an AudioWorklet and streamed to the main process.
 */
export type Track = 'mic' | 'system';

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; }
  process(inputs) {
    const ch = inputs[0];
    if (!ch || !ch.length) return true;
    const len = ch[0].length;
    for (let i = 0; i < len; i++) {
      let s = 0;
      for (let c = 0; c < ch.length; c++) s += ch[c][i];
      this.buf[this.n++] = s / ch.length;
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('tacet-tap', Tap);
`;

export const SAMPLE_RATE = 16000;

export interface Capture {
  track: Track;
  stop(): Promise<void>;
}

async function tap(stream: MediaStream, track: Track, onChunk: (t: Track, d: Float32Array) => void): Promise<Capture> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'tacet-tap', { channelCountMode: 'explicit', channelCount: 2 });
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(track, e.data);
  src.connect(node);
  // Keep the graph pulling without playing anything back.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);
  return {
    track,
    stop: async () => {
      stream.getTracks().forEach((t) => t.stop());
      await new Promise((r) => setTimeout(r, 300));
      await ctx.close();
    },
  };
}

export async function captureMic(onChunk: (t: Track, d: Float32Array) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  return tap(stream, 'mic', onChunk);
}

async function linuxMonitor(): Promise<MediaStream | undefined> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const monitor = devices.find((d) => d.kind === 'audioinput' && /monitor/i.test(d.label));
  if (!monitor) return undefined;
  return navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: monitor.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
}

export async function captureSystem(platform: string, onChunk: (t: Track, d: Float32Array) => void): Promise<Capture> {
  let stream: MediaStream | undefined;
  if (platform === 'linux') stream = await linuxMonitor();
  if (!stream) {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    // We only want the audio. Drop the video right away.
    display.getVideoTracks().forEach((t) => {
      t.stop();
      display.removeTrack(t);
    });
    if (!display.getAudioTracks().length) throw new Error('System audio track is not available on this system.');
    stream = display;
  }
  return tap(stream, 'system', onChunk);
}
