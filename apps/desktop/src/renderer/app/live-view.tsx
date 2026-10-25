import { useEffect, useState } from 'react'
import type { ProcessingStage, RecorderState, Track } from '../../shared/contract.ts'
import { shortcutLabel, timestamp } from './format.ts'
import { api, IS_MAC } from './platform.ts'

type Recording = Extract<RecorderState, { kind: 'recording' }>
type Processing = Extract<RecorderState, { kind: 'processing' }>
type Active = Extract<RecorderState, { kind: 'starting' | 'recording' | 'processing' }>

export const isActive = (s: RecorderState): s is Active =>
  s.kind === 'starting' || s.kind === 'recording' || s.kind === 'processing'

const TRACKS: readonly { readonly track: Track; readonly name: string; readonly hint: string }[] = [
  { track: 'mic', name: 'You', hint: 'microphone' },
  { track: 'system', name: 'Call', hint: 'system audio' },
]

/** Each chunk lifts the bar at once; between words it falls back slowly, like a VU meter. */
const DECAY = 0.82

/** Loudness per track, as the main process measures each chunk (about four per second). */
function useLevels(): Record<Track, number> {
  const [levels, setLevels] = useState<Record<Track, number>>({ mic: 0, system: 0 })
  useEffect(() => {
    const off = api.onLevel((track, level) =>
      setLevels((l) => ({ ...l, [track]: Math.max(level, l[track]) })),
    )
    const fall = setInterval(
      () => setLevels((l) => ({ mic: l.mic * DECAY, system: l.system * DECAY })),
      120,
    )
    return () => {
      off()
      clearInterval(fall)
    }
  }, [])
  return levels
}

function useClock(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [active])
  return now
}

function Meter({
  name,
  hint,
  level,
  on,
}: {
  name: string
  hint: string
  level: number
  on: boolean
}) {
  return (
    <div className={`meter ${on ? '' : 'off'}`}>
      <span className="meter-name">
        {name} <small>{on ? hint : `${hint} · not captured`}</small>
      </span>
      <span className="meter-bar">
        <i style={{ transform: `scaleX(${on ? level : 0})` }} />
      </span>
    </div>
  )
}

function RecordingView({ state, shortcut }: { state: Recording; shortcut: string | undefined }) {
  const now = useClock(true)
  const levels = useLevels()
  return (
    <section className="live" aria-live="polite">
      <p className="live-kicker">
        <span className="live-dot" /> Recording
      </p>
      <p className="live-clock">{timestamp(Math.max(0, now - state.startedAt) / 1000)}</p>
      <div className="meters">
        {TRACKS.map((t) => (
          <Meter
            key={t.track}
            name={t.name}
            hint={t.hint}
            level={levels[t.track]}
            on={state.tracks.includes(t.track)}
          />
        ))}
      </div>
      {state.warnings.map((w) => (
        <p key={w} className="live-warning">
          {w}
        </p>
      ))}
      <button type="button" className="live-stop" onClick={() => void api.toggleRecording()}>
        <span className="live-square" /> Stop and write minutes
        {shortcut && <kbd>{shortcutLabel(shortcut, IS_MAC)}</kbd>}
      </button>
      <p className="muted">Audio stays on this Mac.</p>
    </section>
  )
}

const STEPS: Record<Processing['source'], readonly ProcessingStage[]> = {
  recording: ['saving audio', 'transcribing', 'writing minutes'],
  import: ['transcribing', 'writing minutes'],
}

const STEP_LABEL: Record<ProcessingStage, string> = {
  'saving audio': 'Saving audio',
  transcribing: 'Transcribing',
  'writing minutes': 'Writing minutes',
}

const STEP_HINT: Record<ProcessingStage, string> = {
  'saving audio': 'Closing the two tracks.',
  transcribing: 'whisper.cpp is transcribing each track on this Mac.',
  'writing minutes': 'The local model is writing the minutes. The notes open when they are ready.',
}

function ProcessingView({ state }: { state: Processing }) {
  const steps = STEPS[state.source]
  const current = steps.indexOf(state.stage)
  return (
    <section className="live" aria-live="polite">
      <p className="live-kicker">
        Step {current + 1} of {steps.length}
      </p>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s} className={i < current ? 'done' : i === current ? 'now' : ''}>
            <span className="step-mark" />
            {STEP_LABEL[s]}
          </li>
        ))}
      </ol>
      <div className="progress" />
      <p className="muted">{STEP_HINT[state.stage]}</p>
    </section>
  )
}

/** The main panel while a meeting is being recorded or processed. */
export function LiveView({ state, shortcut }: { state: Active; shortcut: string | undefined }) {
  if (state.kind === 'recording') return <RecordingView state={state} shortcut={shortcut} />
  if (state.kind === 'processing') return <ProcessingView state={state} />
  return (
    <section className="live" aria-live="polite">
      <p className="live-kicker">Starting</p>
      <p className="muted">Opening the microphone and the call audio.</p>
    </section>
  )
}
