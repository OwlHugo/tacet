import type { Meeting, SearchHit } from '@tacet/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Health, MeetingSummary, RecorderState, Settings } from '../../shared/contract.ts'
import { importError, shortcutLabel } from './format.ts'
import { DropOverlay, ImportButton, useAudioDrop } from './import-audio.tsx'
import { MeetingView } from './meeting-view.tsx'
import { api, IS_MAC } from './platform.ts'
import { RecordButton } from './record-button.tsx'
import { SettingsPanel } from './settings-panel.tsx'
import { MeetingList, SearchBox, SearchResults } from './sidebar.tsx'

function healthIssues(h: Health): string[] {
  return [
    ...(h.whisper
      ? []
      : ['whisper.cpp not found: `brew install whisper-cpp` or set TACET_WHISPER_BIN.']),
    ...(h.ollamaModels ? [] : ['Ollama is not running: meetings will be saved without minutes.']),
    ...(h.microphone === 'denied' ? ['Microphone access is denied in System Settings.'] : []),
    ...(h.screen === 'denied'
      ? ['Screen & System Audio Recording is off: only your mic will be recorded.']
      : []),
  ]
}

function HealthBar({ health }: { health: Health }) {
  const issues = healthIssues(health)
  if (issues.length === 0) return null
  return (
    <div className="health">
      {issues.map((i) => (
        <span key={i}>{i}</span>
      ))}
    </div>
  )
}

function Empty({ settings }: { settings: Settings | undefined }) {
  return (
    <div className="empty">
      <h2>Record your first meeting</h2>
      <p>
        Press <kbd>{shortcutLabel(settings?.shortcut ?? 'CommandOrControl+Shift+M', IS_MAC)}</kbd>{' '}
        anywhere, use the tray icon, or drop an audio file here. Tacet records your microphone and
        the call audio on separate tracks, transcribes them with whisper.cpp and writes the minutes
        with a local model.
      </p>
      <p className="muted">
        Notes are saved as Markdown in {settings?.outputDir ?? 'your notes folder'}. Nothing is
        uploaded.
      </p>
    </div>
  )
}

/** Cmd/Ctrl+K focuses search, Esc clears it and closes settings. */
function useKeys(search: React.RefObject<HTMLInputElement | null>, onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        search.current?.focus()
      }
      if (e.key === 'Escape') onEscape()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [search, onEscape])
}

function useSearch(query: string): SearchHit[] {
  const [hits, setHits] = useState<SearchHit[]>([])
  useEffect(() => {
    if (!query.trim()) return setHits([])
    const timer = setTimeout(() => void api.search(query).then(setHits), 120)
    return () => clearTimeout(timer)
  }, [query])
  return hits
}

export function App() {
  const [state, setState] = useState<RecorderState>({ kind: 'idle' })
  const [meetings, setMeetings] = useState<MeetingSummary[]>([])
  const [selected, setSelected] = useState<string>()
  const [meeting, setMeeting] = useState<Meeting>()
  const [query, setQuery] = useState('')
  const [settings, setSettings] = useState<Settings>()
  const [health, setHealth] = useState<Health>()
  const [showSettings, setShowSettings] = useState(false)
  const [focus, setFocus] = useState<number>()
  const [importMessage, setImportMessage] = useState<string>()
  const latest = useRef(state)
  latest.current = state
  // A new recording or import replaces whatever the last import said.
  useEffect(() => {
    if (state.kind === 'starting' || state.kind === 'processing') setImportMessage(undefined)
  }, [state.kind])
  const searchRef = useRef<HTMLInputElement>(null)
  const hits = useSearch(query)
  const importCallbacks = {
    onStart: () => setImportMessage(undefined),
    onImported: (id: string) => {
      setShowSettings(false)
      setSelected(id)
    },
    // The main process broadcasts the error state before the import rejects; read the latest one.
    onError: (e: unknown) => {
      const now = latest.current
      setImportMessage(importError(e, now.kind === 'error' ? now.message : undefined))
    },
  }
  const drop = useAudioDrop(importCallbacks)
  const busy =
    state.kind === 'processing' || state.kind === 'starting' || state.kind === 'recording'

  const refresh = useCallback(async (selectNewest: boolean) => {
    const list = await api.listMeetings()
    setMeetings(list)
    setSelected((current) => (selectNewest ? list[0]?.id : (current ?? list[0]?.id)))
  }, [])

  useEffect(() => {
    void refresh(false)
    void api.getSettings().then(setSettings)
    void api.health().then(setHealth)
    const offState = api.onState(setState)
    const offChanged = api.onMeetingsChanged(() => void refresh(true))
    return () => {
      offState()
      offChanged()
    }
  }, [refresh])

  const closeOverlays = useCallback(() => {
    setQuery('')
    setShowSettings(false)
  }, [])
  useKeys(searchRef, closeOverlays)

  useEffect(() => {
    if (selected === undefined) return setMeeting(undefined)
    void api.getMeeting(selected).then(setMeeting)
  }, [selected])

  const open = (id: string, at?: number) => {
    setSelected(id)
    setFocus(at)
    setQuery('')
  }

  const renamed = (id: string) => () =>
    void refresh(false).then(() => api.getMeeting(id).then(setMeeting))

  return (
    <div className="app" {...drop.handlers}>
      {drop.over && <DropOverlay />}
      <aside className="sidebar">
        <div className="drag" />
        <RecordButton state={state} shortcut={settings?.shortcut} />
        <ImportButton disabled={busy} {...importCallbacks} />
        {importMessage && <p className="record-sub error">{importMessage}</p>}
        <SearchBox
          value={query}
          onChange={setQuery}
          inputRef={searchRef}
          hint={IS_MAC ? '⌘K' : 'Ctrl K'}
        />
        <nav className="list">
          {query.trim() ? (
            <SearchResults hits={hits} onOpen={open} />
          ) : (
            <MeetingList meetings={meetings} selected={selected} onOpen={open} />
          )}
        </nav>
        <footer className="sidebar-foot">
          <span className="local">
            <i className="dot-ok" /> Local only
          </span>
          <button type="button" className="ghost" onClick={() => setShowSettings((v) => !v)}>
            Settings
          </button>
        </footer>
      </aside>
      <main className="main">
        <div className="drag" />
        {health && <HealthBar health={health} />}
        {showSettings && settings ? (
          <SettingsPanel
            settings={settings}
            health={health}
            onChange={setSettings}
            onClose={() => setShowSettings(false)}
          />
        ) : meeting ? (
          <MeetingView meeting={meeting} focus={focus} onRenamed={renamed(meeting.id)} />
        ) : (
          <Empty settings={settings} />
        )}
      </main>
    </div>
  )
}
