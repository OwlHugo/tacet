import type { Track } from '../../shared/contract.ts'
import { type Capture, captureMic, captureSystem, SAMPLE_RATE } from './capture.ts'

const recorder = window.tacet.recorder
const isLinux = !navigator.userAgent.includes('Windows') && !navigator.userAgent.includes('Mac')
let captures: Capture[] = []

const onChunk = (track: Track, data: Float32Array) => recorder.chunk(track, data)

recorder.onStart(async ({ fakeMic, fakeSystem }) => {
  recorder.open('mic', SAMPLE_RATE)
  recorder.open('system', SAMPLE_RATE)
  const [mic, system] = await Promise.allSettled([
    captureMic(onChunk, fakeMic),
    captureSystem(isLinux, onChunk, fakeSystem),
  ])
  // Each track is optional: a meeting with only the mic (no screen permission) is still useful.
  captures = [mic, system].flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const warnings = [
    ...(mic.status === 'rejected' ? [`Microphone unavailable: ${String(mic.reason)}`] : []),
    ...(system.status === 'rejected' ? [`System audio unavailable: ${String(system.reason)}`] : []),
  ]
  if (captures.length === 0) recorder.failed(warnings.join(' | '))
  else
    recorder.started(
      captures.map((c) => c.track),
      warnings,
    )
})

recorder.onStop(async () => {
  await Promise.all(captures.map((c) => c.stop()))
  captures = []
  recorder.closed()
})
