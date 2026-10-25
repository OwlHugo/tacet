import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { MeetingLibrary } from '@tacet/core'
import type { RecorderState, Track } from '../../shared/contract.ts'
import { EVENTS } from '../../shared/events.ts'
import { type RecordedTrack, RecordingSession } from './session.ts'

/** How long to wait for the recorder window to flush its last chunks after stop. */
const FLUSH_TIMEOUT_MS = 4000

interface RecorderWindow {
  readonly webContents: { send(channel: string, ...args: unknown[]): void }
}

export interface ControllerDeps {
  readonly recorder: () => RecorderWindow
  readonly notesFolder: () => string
  readonly setState: (s: RecorderState) => void
  readonly getState: () => RecorderState
  readonly askMicrophone: () => Promise<void>
  /** e2e hook: WAV bytes to play as the microphone. */
  readonly fakeMic: string | undefined
  readonly onRecorded: (
    session: { id: string; startedAt: Date; dir: string },
    tracks: RecordedTrack[],
  ) => void
}

/** Start/stop state machine for a recording; the audio itself arrives through onChunk. */
export function recordingController(deps: ControllerDeps) {
  let current: RecordingSession | undefined
  let flushed: (() => void) | undefined

  async function start(): Promise<void> {
    await deps.askMicrophone()
    const id = randomUUID()
    current = new RecordingSession(id, new MeetingLibrary(deps.notesFolder()).audioDir(id))
    deps.setState({ kind: 'starting' })
    const fakeMic = deps.fakeMic ? new Uint8Array(readFileSync(deps.fakeMic)) : undefined
    deps.recorder().webContents.send(EVENTS.recorderStart, { fakeMic })
  }

  async function stop(): Promise<void> {
    const session = current
    if (!session) return
    deps.setState({ kind: 'processing', stage: 'saving audio' })
    await new Promise<void>((resolve) => {
      flushed = resolve
      deps.recorder().webContents.send(EVENTS.recorderStop)
      setTimeout(resolve, FLUSH_TIMEOUT_MS)
    })
    current = undefined
    const tracks = session.close()
    if (tracks.length === 0) {
      deps.setState({
        kind: 'error',
        message: 'Nothing was recorded. Check microphone and screen recording permissions.',
      })
      return
    }
    deps.onRecorded(session, tracks)
  }

  return {
    toggle(): Promise<void> {
      const kind = deps.getState().kind
      if (kind === 'recording') return stop()
      if (kind === 'idle' || kind === 'error') return start()
      return Promise.resolve()
    },
    stop,
    open: (track: Track, rate: number) => current?.open(track, rate),
    chunk: (track: Track, data: Float32Array) => current?.write(track, data),
    started: (tracks: Track[], warnings: string[]) =>
      deps.setState({ kind: 'recording', startedAt: Date.now(), tracks, warnings }),
    failed: (message: string) => {
      current?.close()
      current = undefined
      deps.setState({ kind: 'error', message })
    },
    closed: () => flushed?.(),
  }
}
