import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { RecorderState, TacetApi, Track } from '../shared/ipc';

function on<T extends unknown[]>(channel: string, cb: (...a: T) => void): () => void {
  const fn = (_e: IpcRendererEvent, ...a: unknown[]) => cb(...(a as T));
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

const api: TacetApi = {
  toggleRecording: () => ipcRenderer.invoke('toggle'),
  onState: (cb) => {
    void ipcRenderer.invoke('state').then((s: RecorderState) => cb(s));
    return on<[RecorderState]>('state', cb);
  },
  onMeetingsChanged: (cb) => on('meetings-changed', cb),
  listMeetings: () => ipcRenderer.invoke('meetings:list'),
  getMeeting: (id) => ipcRenderer.invoke('meetings:get', id),
  renameMeeting: (id, title) => ipcRenderer.invoke('meetings:rename', id, title),
  search: (q) => ipcRenderer.invoke('search', q),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  revealMeeting: (id) => ipcRenderer.invoke('meetings:reveal', id),
  health: () => ipcRenderer.invoke('health'),
  recorder: {
    onStart: (cb) => on<[{ id: string }]>('rec:start', cb),
    onStop: (cb) => on('rec:stop', cb),
    open: (track: Track, rate: number) => ipcRenderer.send('rec:open', track, rate),
    chunk: (track: Track, data: Float32Array) => ipcRenderer.send('rec:chunk', track, data),
    started: (tracks, warnings) => ipcRenderer.send('rec:started', tracks, warnings),
    failed: (message) => ipcRenderer.send('rec:failed', message),
    closed: () => ipcRenderer.send('rec:closed'),
  },
};

contextBridge.exposeInMainWorld('tacet', api);
