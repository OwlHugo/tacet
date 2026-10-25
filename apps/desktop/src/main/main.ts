import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  defaultModel,
  installedModels,
  MeetingLibrary,
  ollamaModels,
  type Stage,
} from '@tacet/core'
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  Menu,
  Notification,
  session,
  shell,
  systemPreferences,
  Tray,
} from 'electron'
import { IMPORT_EXTENSIONS } from '../shared/audio-files.ts'
import {
  INVOKE,
  type MeetingSummary,
  type ProcessingStage,
  RECORDER,
  type RecorderState,
  type Settings,
} from '../shared/contract.ts'
import { EVENTS } from '../shared/events.ts'
import { config } from './config.ts'
import { audioImporter, resolveImportPath } from './import-audio.ts'
import {
  importedMeeting,
  locateWhisper,
  type PipelineEnv,
  recordedTracks,
  runPipeline,
} from './pipeline.ts'
import { recordingController } from './recording/controller.ts'
import { chunkLevel, type RecordedTrack } from './recording/session.ts'
import {
  handle,
  listen,
  lockDownSession,
  lockDownWindow,
  pageUrl,
  registerScheme,
  SECURE_PREFERENCES,
  serveRenderer,
} from './security.ts'
import { defaultSettings, loadSettings, saveSettings, withPatch } from './settings.ts'
import { trayIcons } from './tray/icons.ts'

// System audio without a virtual driver: Chromium loopback. ScreenCaptureKit on macOS 13+, WASAPI on
// Windows, the PulseAudio/PipeWire monitor on Linux.
app.commandLine.appendSwitch(
  'enable-features',
  'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride,PulseaudioLoopbackForScreenShare',
)
// Electron 39+ defaults to the Core Audio tap on macOS 14.2+, which needs a "System Audio Recording"
// grant unbundled builds never get. ScreenCaptureKit only needs Screen Recording.
if (process.platform === 'darwin' && !config.TACET_CATAP) {
  app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare')
}
registerScheme()

const DEV = config.ELECTRON_RENDERER_URL
const PRELOAD = join(import.meta.dirname, '../preload/preload.cjs')
const log = (...a: unknown[]) => console.log('[tacet]', ...a)
const settingsFile = () => join(app.getPath('userData'), 'settings.json')

let settings: Settings
let defaults: Settings
let state: RecorderState = { kind: 'idle' }
let tray: Tray | undefined
let mainWindow: BrowserWindow | undefined
let recorderWindow: BrowserWindow | undefined

const library = () => new MeetingLibrary(settings.outputDir)
const pipelineEnv = (): PipelineEnv => ({
  whisperBin: config.TACET_WHISPER_BIN,
  ffmpegBin: config.TACET_FFMPEG_BIN,
  modelsDir: config.TACET_MODELS_DIR ?? join(app.getPath('home'), '.cache', 'whisper'),
  ollamaHost: config.OLLAMA_HOST,
  searchPath: config.PATH,
  bundledDirs: [
    app.isPackaged
      ? join(process.resourcesPath, 'bin')
      : join(app.getAppPath(), 'resources', 'bin'),
  ],
  platform: process.platform,
})
const broadcast = (channel: string, payload?: unknown) => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

function setState(s: RecorderState): void {
  state = s
  broadcast(EVENTS.state, s)
  updateTray()
}

function window(
  options: Electron.BrowserWindowConstructorOptions,
  page: 'index' | 'recorder',
): BrowserWindow {
  const win = new BrowserWindow({
    ...options,
    webPreferences: { ...SECURE_PREFERENCES, preload: PRELOAD, ...options.webPreferences },
  })
  lockDownWindow(win)
  void win.loadURL(pageUrl(page, DEV))
  return win
}

function showMain(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }
  const win = window(
    {
      width: 1080,
      height: 720,
      minWidth: 720,
      minHeight: 480,
      backgroundColor: '#0E0F14',
      title: 'Tacet',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      autoHideMenuBar: true,
      show: false,
    },
    'index',
  )
  mainWindow = win
  win.once('ready-to-show', () => win.show())
  if (config.TACET_SCREENSHOT) screenshotAndQuit(win, config.TACET_SCREENSHOT)
  app.dock?.show()
  win.on('closed', () => {
    mainWindow = undefined
    app.dock?.hide()
  })
}

/** Docs hook: render the window into a PNG and quit. */
function screenshotAndQuit(win: BrowserWindow, file: string): void {
  win.webContents.once('did-finish-load', () =>
    setTimeout(async () => {
      writeFileSync(file, (await win.webContents.capturePage()).toPNG())
      log('screenshot', file)
      app.quit()
    }, 2500),
  )
}

function recorder(): BrowserWindow {
  if (recorderWindow && !recorderWindow.isDestroyed()) return recorderWindow
  const win = window(
    { show: false, width: 200, height: 100, webPreferences: { backgroundThrottling: false } },
    'recorder',
  )
  win.webContents.on('console-message', (e) => log('recorder:', e.message))
  recorderWindow = win
  return win
}

const STAGE_LABEL: Record<Stage, ProcessingStage> = {
  transcribing: 'transcribing',
  minutes: 'writing minutes',
}

async function processRecording(
  rec: { id: string; startedAt: Date; dir: string },
  tracks: RecordedTrack[],
): Promise<void> {
  const { meeting, notePath } = await runPipeline(
    {
      id: rec.id,
      title: `Meeting ${rec.startedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
      date: rec.startedAt,
      tracks: recordedTracks(tracks),
    },
    settings,
    pipelineEnv(),
    (stage) => setState({ kind: 'processing', stage: STAGE_LABEL[stage], source: 'recording' }),
  )
  if (!settings.keepAudio) rmSync(rec.dir, { recursive: true, force: true })
  log(
    'saved',
    notePath,
    JSON.stringify({ segments: meeting.transcript.segments.length, minutes: meeting.minutes }),
  )
  setState({ kind: 'idle' })
  broadcast(EVENTS.meetingsChanged)
  if (Notification.isSupported()) {
    const n = new Notification({
      title: 'Meeting notes ready',
      body: meeting.minutes
        ? `${meeting.minutes.actionItems.length} action items`
        : 'Transcript saved. Start Ollama to get minutes.',
      silent: true,
    })
    n.on('click', showMain)
    n.show()
  }
}

const importAudio = audioImporter({
  getState: () => state,
  setState,
  resolve: (raw) => resolveImportPath(raw, process.platform),
  run: async (path) => {
    const { meeting, notePath } = await runPipeline(
      { ...importedMeeting(path), date: new Date() },
      settings,
      pipelineEnv(),
      (stage) => setState({ kind: 'processing', stage: STAGE_LABEL[stage], source: 'import' }),
    )
    log('imported', path, '->', notePath)
    broadcast(EVENTS.meetingsChanged)
    return meeting.id
  },
})

/** The window shows an import's error; with it closed (a tray app), a notification does instead. */
const importFromWindow = (path: string) =>
  importAudio(path).catch((e: unknown) => {
    if (
      (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) &&
      Notification.isSupported()
    )
      new Notification({
        title: 'Import failed',
        body: e instanceof Error ? e.message : String(e),
        silent: true,
      }).show()
    throw e
  })

const controller = recordingController({
  recorder,
  notesFolder: () => settings.outputDir,
  getState: () => state,
  setState,
  fakeMic: config.TACET_FAKE_MIC,
  askMicrophone: async () => {
    if (
      process.platform === 'darwin' &&
      systemPreferences.getMediaAccessStatus('microphone') !== 'granted'
    ) {
      await systemPreferences.askForMediaAccess('microphone')
    }
  },
  // The pipeline is the end of the line for a recording: its error is shown to the user, not thrown.
  onRecorded: (rec, tracks) =>
    void processRecording(rec, tracks)
      .catch((e: unknown) =>
        setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
      )
      .finally(() => config.TACET_AUTORECORD && setTimeout(() => app.quit(), 500)),
})

function updateTray(): void {
  if (!tray) return
  const icons = trayIcons(process.platform)
  const recording = state.kind === 'recording'
  tray.setImage(recording ? icons.recording : icons.idle)
  tray.setToolTip(
    recording
      ? 'Tacet: recording'
      : state.kind === 'processing'
        ? `Tacet: ${state.stage}`
        : 'Tacet',
  )
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: recording ? 'Stop recording' : 'Start recording',
        accelerator: settings.shortcut,
        enabled: state.kind !== 'processing' && state.kind !== 'starting',
        click: () => void controller.toggle(),
      },
      { type: 'separator' },
      {
        label: state.kind === 'processing' ? `Processing: ${state.stage}` : 'Open Tacet',
        click: showMain,
      },
      { label: 'Open notes folder', click: () => void shell.openPath(settings.outputDir) },
      { type: 'separator' },
      { label: 'Quit Tacet', role: 'quit' },
    ]),
  )
}

function registerShortcut(): void {
  globalShortcut.unregisterAll()
  if (!globalShortcut.register(settings.shortcut, () => void controller.toggle())) {
    log(`could not register shortcut ${settings.shortcut}`)
  }
}

const summaries = (): MeetingSummary[] =>
  library()
    .list()
    .map((m) => ({
      id: m.id,
      title: m.title,
      date: m.date,
      duration: m.transcript.duration,
      actionItems: m.minutes?.actionItems.length ?? 0,
    }))

function updateSettings(next: Settings): Settings {
  const shortcutChanged = next.shortcut !== settings.shortcut
  settings = next
  saveSettings(settingsFile(), settings, defaults)
  if (shortcutChanged) registerShortcut()
  updateTray()
  return settings
}

function wireIpc(): void {
  handle('recording:toggle', INVOKE['recording:toggle'], DEV, () => controller.toggle())
  handle('recording:state', INVOKE['recording:state'], DEV, () => state)
  handle('meetings:list', INVOKE['meetings:list'], DEV, summaries)
  handle('meetings:get', INVOKE['meetings:get'], DEV, (id) => library().get(id))
  handle('meetings:rename', INVOKE['meetings:rename'], DEV, (id, title) => {
    const m = library().get(id)
    if (m) library().save({ ...m, title })
  })
  handle('meetings:reveal', INVOKE['meetings:reveal'], DEV, (id) => {
    const m = library().get(id)
    if (!m) return
    // No note on disk any more (the user replaced or deleted it): show the folder instead.
    const note = library().notePath(m)
    if (note) shell.showItemInFolder(note)
    else void shell.openPath(settings.outputDir)
  })
  handle('meetings:search', INVOKE['meetings:search'], DEV, (q) => library().search(q))
  handle('meetings:import', INVOKE['meetings:import'], DEV, importFromWindow)
  handle('meetings:import-dialog', INVOKE['meetings:import-dialog'], DEV, async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: [...IMPORT_EXTENSIONS] }],
    })
    const [file] = r.filePaths
    return r.canceled || !file ? undefined : importFromWindow(file)
  })
  handle('settings:get', INVOKE['settings:get'], DEV, () => settings)
  handle('settings:set', INVOKE['settings:set'], DEV, (patch) =>
    updateSettings(withPatch(settings, patch)),
  )
  handle('settings:choose-folder', INVOKE['settings:choose-folder'], DEV, async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: settings.outputDir,
    })
    const [folder] = r.filePaths
    return r.canceled || !folder ? settings : updateSettings({ ...settings, outputDir: folder })
  })
  handle('health', INVOKE.health, DEV, async () => ({
    whisper: locateWhisper(pipelineEnv()),
    whisperModels: installedModels(pipelineEnv().modelsDir),
    ollamaModels: await ollamaModels(config.OLLAMA_HOST),
    microphone:
      process.platform === 'linux'
        ? 'granted'
        : systemPreferences.getMediaAccessStatus('microphone'),
    screen:
      process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted',
  }))

  listen('recorder:open', RECORDER['recorder:open'], DEV, controller.open)
  listen('recorder:chunk', RECORDER['recorder:chunk'], DEV, (track, data) => {
    controller.chunk(track, data)
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send(EVENTS.level, track, chunkLevel(data))
  })
  listen('recorder:started', RECORDER['recorder:started'], DEV, (tracks, warnings) => {
    log('recording', tracks, warnings)
    controller.started(tracks, warnings)
    if (config.TACET_AUTORECORD)
      setTimeout(() => void controller.stop(), config.TACET_AUTORECORD * 1000)
  })
  listen('recorder:failed', RECORDER['recorder:failed'], DEV, (message) => {
    log('recording failed', message)
    controller.failed(message)
    if (config.TACET_AUTORECORD) setTimeout(() => app.quit(), 500)
  })
  listen('recorder:closed', RECORDER['recorder:closed'], DEV, controller.closed)
}

/** getDisplayMedia from the recorder gets the first screen plus loopback audio; video is dropped there. */
function wireSystemAudio(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) =>
      void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        const [screen] = sources
        callback(screen ? { video: screen, audio: 'loopback' } : {})
      }),
    { useSystemPicker: false },
  )
}

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', showMain)
// Tray app: closing the last window keeps it running.
app.on('window-all-closed', () => undefined)
app.on('will-quit', () => globalShortcut.unregisterAll())

void app.whenReady().then(() => {
  defaults = defaultSettings(app.getPath('documents'), defaultModel(pipelineEnv().modelsDir))
  const saved = loadSettings(settingsFile(), defaults)
  settings = config.TACET_OUTPUT_DIR ? { ...saved, outputDir: config.TACET_OUTPUT_DIR } : saved
  app.dock?.hide()
  serveRenderer(join(import.meta.dirname, '../renderer'))
  lockDownSession()
  wireIpc()
  wireSystemAudio()
  const rec = recorder()
  tray = new Tray(trayIcons(process.platform).idle)
  if (process.platform !== 'darwin') tray.on('click', showMain)
  updateTray()
  registerShortcut()
  log(`ready, notes go to ${settings.outputDir}, shortcut ${settings.shortcut}`)
  if (config.TACET_AUTORECORD)
    rec.webContents.once('did-finish-load', () => void controller.toggle())
  else if (!config.TACET_HIDDEN) showMain()
})
