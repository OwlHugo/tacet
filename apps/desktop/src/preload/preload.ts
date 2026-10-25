import type { Meeting, SearchHit } from '@tacet/core'
import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from 'electron'
import type { Health, MeetingSummary, RecorderState, Settings, Track } from '../shared/contract.ts'
import { EVENTS } from '../shared/events.ts'

const on = <T extends unknown[]>(channel: string, cb: (...a: T) => void): (() => void) => {
  const listener = (_e: IpcRendererEvent, ...a: unknown[]) => cb(...(a as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** Everything the renderer can ask the main process. Arguments are validated again on the other side. */
const api = {
  toggleRecording: (): Promise<void> => ipcRenderer.invoke('recording:toggle'),
  onState: (cb: (s: RecorderState) => void): (() => void) => {
    void ipcRenderer.invoke('recording:state').then(cb)
    return on<[RecorderState]>(EVENTS.state, cb)
  },
  onMeetingsChanged: (cb: () => void) => on(EVENTS.meetingsChanged, cb),
  listMeetings: (): Promise<MeetingSummary[]> => ipcRenderer.invoke('meetings:list'),
  getMeeting: (id: string): Promise<Meeting | undefined> => ipcRenderer.invoke('meetings:get', id),
  renameMeeting: (id: string, title: string): Promise<void> =>
    ipcRenderer.invoke('meetings:rename', id, title),
  revealMeeting: (id: string): Promise<void> => ipcRenderer.invoke('meetings:reveal', id),
  search: (q: string): Promise<SearchHit[]> => ipcRenderer.invoke('meetings:search', q),
  /** Transcribe a dropped file. Resolves with the new meeting id. */
  importAudio: (file: File): Promise<string> =>
    ipcRenderer.invoke('meetings:import', webUtils.getPathForFile(file)),
  /** Pick a file with the native dialog. Resolves with the new meeting id, or undefined if cancelled. */
  importAudioDialog: (): Promise<string | undefined> =>
    ipcRenderer.invoke('meetings:import-dialog'),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Omit<Settings, 'outputDir'>>): Promise<Settings> =>
    ipcRenderer.invoke('settings:set', patch),
  chooseFolder: (): Promise<Settings> => ipcRenderer.invoke('settings:choose-folder'),
  health: (): Promise<Health> => ipcRenderer.invoke('health'),
  /** Used only by the hidden recorder window. */
  recorder: {
    onStart: (cb: (opts: { fakeMic: Uint8Array | undefined }) => void) =>
      on(EVENTS.recorderStart, cb),
    onStop: (cb: () => void) => on(EVENTS.recorderStop, cb),
    open: (track: Track, rate: number) => ipcRenderer.send('recorder:open', track, rate),
    chunk: (track: Track, data: Float32Array) => ipcRenderer.send('recorder:chunk', track, data),
    started: (tracks: Track[], warnings: string[]) =>
      ipcRenderer.send('recorder:started', tracks, warnings),
    failed: (message: string) => ipcRenderer.send('recorder:failed', message),
    closed: () => ipcRenderer.send('recorder:closed'),
  },
}

export type TacetApi = typeof api

contextBridge.exposeInMainWorld('tacet', api)
