import type { TacetApi } from '../../shared/ipc';
import { captureMic, captureSystem, SAMPLE_RATE, type Capture } from './capture';

declare global {
  interface Window {
    tacet: TacetApi;
  }
}

const api = window.tacet.recorder;
const platform = navigator.userAgent.includes('Windows') ? 'win32' : navigator.userAgent.includes('Mac') ? 'darwin' : 'linux';
let captures: Capture[] = [];

const onChunk = (track: 'mic' | 'system', data: Float32Array) => api.chunk(track, data);

api.onStart(async ({ fakeMic }) => {
  captures = [];
  const warnings: string[] = [];
  api.open('mic', SAMPLE_RATE);
  api.open('system', SAMPLE_RATE);
  const [mic, sys] = await Promise.allSettled([captureMic(onChunk, fakeMic), captureSystem(platform, onChunk)]);
  if (mic.status === 'fulfilled') captures.push(mic.value);
  else warnings.push(`Microphone unavailable: ${String(mic.reason)}`);
  if (sys.status === 'fulfilled') captures.push(sys.value);
  else warnings.push(`System audio unavailable: ${String(sys.reason)}`);
  if (!captures.length) return api.failed(warnings.join(' | '));
  api.started(
    captures.map((c) => c.track),
    warnings,
  );
});

api.onStop(async () => {
  await Promise.all(captures.map((c) => c.stop()));
  captures = [];
  api.closed();
});
