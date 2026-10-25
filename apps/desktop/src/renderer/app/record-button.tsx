import { useEffect, useState } from 'react'
import type { RecorderState } from '../../shared/contract.ts'
import { capitalize, shortcutLabel, timestamp } from './format.ts'
import { api, IS_MAC } from './platform.ts'

function label(state: RecorderState, now: number): string {
  switch (state.kind) {
    case 'recording':
      return `Stop · ${timestamp((now - state.startedAt) / 1000)}`
    case 'processing':
      return capitalize(state.stage)
    case 'starting':
      return 'Starting'
    default:
      return 'Record meeting'
  }
}

function TrackLine({ state }: { state: Extract<RecorderState, { kind: 'recording' }> }) {
  const sources = [
    state.tracks.includes('mic') ? 'Mic' : '',
    state.tracks.includes('system') ? 'system audio' : '',
  ]
  const warnings = state.warnings.length > 0 ? ` · ${state.warnings.length} warning` : ''
  return <p className="record-sub">{sources.filter(Boolean).join(' + ') + warnings}</p>
}

export function RecordButton({
  state,
  shortcut,
}: {
  state: RecorderState
  shortcut: string | undefined
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (state.kind !== 'recording') return
    const timer = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(timer)
  }, [state.kind])
  const busy = state.kind === 'processing' || state.kind === 'starting'
  return (
    <div className="record-wrap">
      <button
        type="button"
        className={`record ${state.kind}`}
        disabled={busy}
        onClick={() => void api.toggleRecording()}
      >
        <span className="record-dot" />
        <span className="record-label">{label(state, now)}</span>
        {shortcut && state.kind !== 'processing' && <kbd>{shortcutLabel(shortcut, IS_MAC)}</kbd>}
      </button>
      {state.kind === 'recording' && <TrackLine state={state} />}
      {state.kind === 'processing' && <div className="progress" />}
    </div>
  )
}
