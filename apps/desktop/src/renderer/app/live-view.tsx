import { useEffect, useState } from 'react'
import type { ProcessingStage, RecorderState, Track } from '../../shared/contract.ts'
import { shortcutLabel, timestamp } from './format.ts'
import { api, IS_MAC } from './platform.ts'

type Recording = Extract<RecorderState, { kind: 'recording' }>
type Processing = Extract<RecorderState, { kind: 'processing' }>
type Active = Extract<RecorderState, { kind: 'starting' | 'recording' | 'processing' }>
type Failed = Extract<RecorderState, { kind: 'error' }>
/** What the live panel shows: a meeting in progress, or the reason the last one failed. */
type Live = Active | Failed

export const isActive = (s: RecorderState): s is Active =>
  s.kind === 'starting' || s.kind === 'recording' || s.kind === 'processing'

/** A meeting in progress, or the one that just failed: what the live panel and row are about. */
export const isLive = (s: RecorderState): s is Live => isActive(s) || s.kind === 'error'

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
    const timer = setInterval(() => setNow(Date.now()), 200)
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
    <section className="live">
      <p className="live-kicker" aria-live="polite">
        <span className="live-dot" /> Recording
      </p>
      <time className="live-clock">{timestamp(Math.max(0, now - state.startedAt) / 1000)}</time>
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
      <p className="muted">Audio stays on this {DEVICE}.</p>
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

const DEVICE = IS_MAC ? 'Mac' : 'computer'

const STEP_HINT: Record<ProcessingStage, string> = {
  'saving audio': 'Closing the audio files.',
  transcribing: `whisper.cpp is transcribing each track on this ${DEVICE}. A model used for the first time is downloaded first.`,
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

/**
 * Whether the main panel shows the live view. Opening a meeting while recording shows that meeting;
 * the live row in the list, stopping or a new recording bring the live view back.
 */
export function useLiveView(state: RecorderState) {
  const [browsing, setBrowsing] = useState(false)
  useEffect(() => {
    if (state.kind !== 'idle') setBrowsing(false)
  }, [state.kind])
  const live = isLive(state) ? state : undefined
  return {
    /** The live state while the panel should show it, undefined otherwise. */
    shown: browsing ? undefined : live,
    leave: () => setBrowsing(true),
    back: () => setBrowsing(false),
  }
}

const ITEM_TITLE: Record<Live['kind'], string> = {
  starting: 'Recording now',
  recording: 'Recording now',
  processing: 'Processing',
  error: 'Not saved',
}

/** First row of the meeting list while a meeting is live: the way back to the live panel. */
export function LiveItem(props: { state: Live; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={`item live-item ${props.active ? 'active' : ''}`}
      onClick={props.onOpen}
    >
      <span className="item-title">
        <i className="live-dot" /> {ITEM_TITLE[props.state.kind]}
      </span>
      <span className="item-meta">
        {props.state.kind === 'error' ? 'See what went wrong' : 'Back to the live view'}
      </span>
    </button>
  )
}

/** Permissions live in the system settings, not in Tacet's: sending the user to Settings would not help. */
const isPermission = (message: string) =>
  /microphone and screen recording permissions/i.test(message)

function FailedView({ state, onSettings }: { state: Failed; onSettings: () => void }) {
  const permission = isPermission(state.message)
  return (
    <section className="live" role="alert">
      <h2 className="live-title">No notes for this meeting</h2>
      <p className="live-error">{state.message}</p>
      {permission ? (
        <p className="muted">
          Allow Tacet in the system settings ({IS_MAC ? 'Privacy & Security' : 'privacy settings'}),
          then record again with the button on the left.
        </p>
      ) : (
        <>
          <button type="button" className="live-retry" onClick={onSettings}>
            Open Settings
          </button>
          <p className="muted">
            Fix it there, then record again with the button on the left. Any audio already recorded
            is kept in the notes folder, under .tacet/audio, and can be imported.
          </p>
        </>
      )}
    </section>
  )
}

/** The main panel while a meeting is being recorded or processed, or when it just failed. */
export function LiveView(props: {
  state: Live
  shortcut: string | undefined
  onSettings: () => void
}) {
  const { state, shortcut } = props
  if (state.kind === 'recording') return <RecordingView state={state} shortcut={shortcut} />
  if (state.kind === 'processing') return <ProcessingView state={state} />
  if (state.kind === 'error') return <FailedView state={state} onSettings={props.onSettings} />
  return (
    <section className="live" aria-live="polite">
      <p className="live-kicker">Starting</p>
      <p className="muted">Opening the microphone and the call audio.</p>
    </section>
  )
}
