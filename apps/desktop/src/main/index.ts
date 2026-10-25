import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  Notification,
  session,
  shell,
  systemPreferences,
  Tray,
} from 'electron';
import { MeetingStore, ollamaAvailable, ollamaModels, processMeeting, resolveWhisperBinary, type Track as CoreTrack } from '@tacet/core';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Health, MeetingSummary, RecorderState, Settings, Track } from '../shared/ipc';
import { trayIcons } from './icons';
import { RecordingSession } from './recording';
import { loadSettings, saveSettings } from './settings';

// System audio without a virtual driver: Chromium loopback. macOS 13+ goes through ScreenCaptureKit,
// Windows through WASAPI loopback, Linux through the PulseAudio/PipeWire monitor.
const features = ['MacLoopbackAudioForScreenShare', 'MacSckSystemAudioLoopbackOverride', 'PulseaudioLoopbackForScreenShare'];
app.commandLine.appendSwitch('enable-features', features.join(','));
// Electron 39+ defaults to the Core Audio tap path on macOS 14.2+, which needs a separate
// "System Audio Recording" grant that unbundled builds never get. ScreenCaptureKit works with the
// regular Screen Recording permission, so prefer it unless TACET_CATAP=1.
if (process.platform === 'darwin' && !process.env.TACET_CATAP) app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare');
// Test hook (e2e script): TACET_FAKE_MIC=file.wav replaces the microphone with that file.
// System audio is still captured for real through loopback.
const FAKE_MIC = process.env.TACET_FAKE_MIC;

const AUTORECORD = Number(process.env.TACET_AUTORECORD ?? 0);
const log = (...a: unknown[]) => console.log('[tacet]', ...a);

let settings: Settings;
let tray: Tray | undefined;
let mainWindow: BrowserWindow | undefined;
let recorderWindow: BrowserWindow | undefined;
let state: RecorderState = { kind: 'idle' };
let current: RecordingSession | undefined;
let closedWaiter: (() => void) | undefined;

const store = () => new MeetingStore(settings.outputDir);
const bundledDirs = () => [app.isPackaged ? join(process.resourcesPath, 'bin') : join(app.getAppPath(), 'resources', 'bin')];
const preload = join(import.meta.dirname, '../preload/index.cjs');

function rendererUrl(page: 'index' | 'recorder'): { url?: string; file?: string } {
  const dev = process.env.ELECTRON_RENDERER_URL;
  if (dev) return { url: `${dev}/${page}.html` };
  return { file: join(import.meta.dirname, `../renderer/${page}.html`) };
}

function load(win: BrowserWindow, page: 'index' | 'recorder') {
  const r = rendererUrl(page);
  return r.url ? win.loadURL(r.url) : win.loadFile(r.file!);
}

function setState(s: RecorderState) {
  state = s;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('state', s);
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const icons = trayIcons();
  const rec = state.kind === 'recording';
  tray.setImage(rec ? icons.recording : icons.idle);
  tray.setToolTip(rec ? 'Tacet: recording' : state.kind === 'processing' ? `Tacet: ${state.stage}` : 'Tacet');
  const busy = state.kind === 'processing' || state.kind === 'starting';
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: rec ? 'Stop recording' : 'Start recording',
        accelerator: settings.shortcut,
        enabled: !busy,
        click: () => void toggleRecording(),
      },
      { type: 'separator' },
      { label: state.kind === 'processing' ? `Processing: ${state.stage}` : 'Open Tacet', enabled: true, click: showMain },
      { label: 'Open notes folder', click: () => void shell.openPath(settings.outputDir) },
      { type: 'separator' },
      { label: 'Quit Tacet', role: 'quit' },
    ]),
  );
}

function showMain() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0E0F14',
    title: 'Tacet',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload, sandbox: false, contextIsolation: true },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  void load(mainWindow, 'index');
  if (process.platform === 'darwin') app.dock?.show();
  mainWindow.on('closed', () => {
    mainWindow = undefined;
    if (process.platform === 'darwin') app.dock?.hide();
  });
}

function forwardConsole(win: BrowserWindow, name: string) {
  win.webContents.on('console-message', (e) => log(`${name}:`, e.message));
}

function createRecorder() {
  recorderWindow = new BrowserWindow({
    show: false,
    width: 200,
    height: 100,
    webPreferences: { preload, sandbox: false, contextIsolation: true, backgroundThrottling: false },
  });
  forwardConsole(recorderWindow, 'recorder');
  void load(recorderWindow, 'recorder');
}

async function toggleRecording() {
  if (state.kind === 'recording') return stopRecording();
  if (state.kind === 'idle' || state.kind === 'error') return startRecording();
}

async function startRecording() {
  if (!recorderWindow || recorderWindow.isDestroyed()) createRecorder();
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
    await systemPreferences.askForMediaAccess('microphone');
  }
  const id = randomUUID();
  current = new RecordingSession(id, store().audioDir(id));
  setState({ kind: 'starting' });
  const fakeMic = FAKE_MIC ? new Uint8Array(readFileSync(FAKE_MIC)) : undefined;
  recorderWindow!.webContents.send('rec:start', { id, fakeMic });
}

async function stopRecording() {
  const session = current;
  if (!session || state.kind !== 'recording') return;
  setState({ kind: 'processing', stage: 'saving audio' });
  await new Promise<void>((resolve) => {
    closedWaiter = resolve;
    recorderWindow?.webContents.send('rec:stop');
    setTimeout(resolve, 4000);
  });
  current = undefined;
  const tracks = session.close();
  log('tracks', tracks);
  if (!tracks.length) {
    setState({ kind: 'error', message: 'Nothing was recorded. Check microphone and screen recording permissions.' });
    return;
  }
  const label: Record<Track, string> = { mic: 'Me', system: 'Others' };
  const coreTracks: CoreTrack[] = tracks.map((t) => ({ path: t.path, speaker: label[t.track] }));
  try {
    const t0 = Date.now();
    const res = await processMeeting({
      id: session.id,
      tracks: coreTracks,
      date: session.startedAt,
      title: `Meeting ${session.startedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
      outputDir: settings.outputDir,
      transcribe: { model: settings.whisperModel, language: settings.language, bundledDirs: bundledDirs() },
      minutes: { model: settings.llmModel },
      onStage: (stage, detail) => {
        if (stage === 'transcribing') setState({ kind: 'processing', stage: 'transcribing' });
        if (stage === 'minutes') setState({ kind: 'processing', stage: `writing minutes (${detail})` });
      },
    });
    if (!settings.keepAudio) rmSync(session.dir, { recursive: true, force: true });
    log('saved', res.markdownPath, 'in', (Date.now() - t0) / 1000, 's', res.warnings);
    log('result', JSON.stringify({ segments: res.meeting.transcript.segments, minutes: res.meeting.minutes, timings: res.meeting.timings }));
    setState({ kind: 'idle' });
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('meetings-changed');
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'Meeting notes ready',
        body: `${res.meeting.minutes?.actionItems.length ?? 0} action items. ${res.warnings[0] ?? ''}`.trim(),
        silent: true,
      });
      n.on('click', showMain);
      n.show();
    }
  } catch (e) {
    log('process failed', e);
    setState({ kind: 'error', message: (e as Error).message });
  }
  if (AUTORECORD) setTimeout(() => app.quit(), 500);
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(settings.shortcut, () => void toggleRecording());
  if (!ok) log(`could not register shortcut ${settings.shortcut}`);
}

function summary(): MeetingSummary[] {
  return store()
    .list()
    .map((m) => ({
      id: m.id,
      title: m.title,
      date: m.date,
      duration: m.transcript.duration,
      actionItems: m.minutes?.actionItems.length ?? 0,
      hasMinutes: Boolean(m.minutes),
    }));
}

async function health(): Promise<Health> {
  let whisper: string | null = null;
  let whisperError: string | undefined;
  try {
    whisper = resolveWhisperBinary({ bundledDirs: bundledDirs() });
  } catch (e) {
    whisperError = (e as Error).message;
  }
  const up = await ollamaAvailable();
  const perm = (t: 'microphone' | 'screen') =>
    process.platform === 'linux' ? 'granted' : systemPreferences.getMediaAccessStatus(t);
  return {
    whisper,
    whisperError,
    ollama: up,
    ollamaModels: up ? await ollamaModels() : [],
    platform: process.platform,
    permissions: { microphone: perm('microphone'), screen: process.platform === 'darwin' ? perm('screen') : 'granted' },
  };
}

function wireIpc() {
  ipcMain.handle('toggle', () => toggleRecording());
  ipcMain.handle('state', () => state);
  ipcMain.handle('meetings:list', () => summary());
  ipcMain.handle('meetings:get', (_e, id: string) => store().get(id));
  ipcMain.handle('meetings:rename', (_e, id: string, title: string) => {
    const m = store().get(id);
    if (m && title.trim()) store().save({ ...m, title: title.trim() });
  });
  ipcMain.handle('meetings:reveal', (_e, id: string) => {
    const m = store().get(id);
    if (m) shell.showItemInFolder(store().markdownPath(m));
  });
  ipcMain.handle('search', (_e, q: string) => store().search(q));
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    if (patch.shortcut) registerShortcut();
    updateTray();
    return settings;
  });
  ipcMain.handle('choose-folder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], defaultPath: settings.outputDir });
    return r.canceled ? undefined : r.filePaths[0];
  });
  ipcMain.handle('health', () => health());

  ipcMain.on('rec:open', (_e, track: Track, rate: number) => current?.open(track, rate));
  ipcMain.on('rec:chunk', (_e, track: Track, data: Float32Array) => current?.write(track, data));
  ipcMain.on('rec:started', (_e, tracks: Track[], warnings: string[]) => {
    log('recording', tracks, warnings);
    setState({ kind: 'recording', startedAt: Date.now(), tracks, warnings });
    if (AUTORECORD) setTimeout(() => void stopRecording(), AUTORECORD * 1000);
  });
  ipcMain.on('rec:failed', (_e, message: string) => {
    log('recording failed', message);
    current?.close();
    current = undefined;
    setState({ kind: 'error', message });
    if (AUTORECORD) setTimeout(() => app.quit(), 500);
  });
  ipcMain.on('rec:closed', () => closedWaiter?.());
}

function wireCapture() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'display-capture'].includes(permission)));
  session.defaultSession.setDisplayMediaRequestHandler(
    (_req, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
        .catch((e: unknown) => {
          log('desktopCapturer failed', e);
          callback({});
        });
    },
    { useSystemPicker: false },
  );
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', showMain);
app.on('window-all-closed', () => {
  // Tray app: keep running.
});
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  settings = loadSettings();
  if (process.platform === 'darwin' && !process.env.TACET_SHOW_DOCK) app.dock?.hide();
  wireIpc();
  wireCapture();
  createRecorder();
  tray = new Tray(trayIcons().idle);
  tray.on('click', () => (process.platform === 'darwin' ? undefined : showMain()));
  updateTray();
  registerShortcut();
  log(`ready, notes go to ${settings.outputDir}, shortcut ${settings.shortcut}`);
  if (process.platform !== 'linux')
    log('permissions', { microphone: systemPreferences.getMediaAccessStatus('microphone'), screen: systemPreferences.getMediaAccessStatus('screen') });
  if (AUTORECORD) recorderWindow?.webContents.once('did-finish-load', () => void startRecording());
  else if (!process.env.TACET_HIDDEN) showMain();
});
