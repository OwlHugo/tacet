import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Meeting, SearchHit } from '@tacet/core';
import type { Health, MeetingSummary, RecorderState, Settings, TacetApi } from '../../shared/ipc';
import { day, duration, elapsed, time, ts } from './format';

declare global {
  interface Window {
    tacet: TacetApi;
  }
}
const api = window.tacet;
const isMac = navigator.userAgent.includes('Mac');
const pretty = (accel: string) =>
  accel
    .replace('CommandOrControl', isMac ? '⌘' : 'Ctrl')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .split('+')
    .join(isMac ? '' : '+');

export function App() {
  const [state, setState] = useState<RecorderState>({ kind: 'idle' });
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [selected, setSelected] = useState<string>();
  const [meeting, setMeeting] = useState<Meeting>();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [settings, setSettings] = useState<Settings>();
  const [health, setHealth] = useState<Health>();
  const [showSettings, setShowSettings] = useState(false);
  const [focus, setFocus] = useState<number>();
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const list = await api.listMeetings();
    setMeetings(list);
    setSelected((cur) => cur ?? list[0]?.id);
  }, []);

  useEffect(() => {
    void refresh();
    void api.getSettings().then(setSettings);
    void api.health().then(setHealth);
    const offState = api.onState(setState);
    const offChanged = api.onMeetingsChanged(async () => {
      const list = await api.listMeetings();
      setMeetings(list);
      setSelected(list[0]?.id);
    });
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setQuery('');
        setShowSettings(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      offState();
      offChanged();
      window.removeEventListener('keydown', onKey);
    };
  }, [refresh]);

  useEffect(() => {
    if (!selected) return setMeeting(undefined);
    void api.getMeeting(selected).then(setMeeting);
  }, [selected, meetings]);

  useEffect(() => {
    if (!query.trim()) return setHits([]);
    const t = setTimeout(() => void api.search(query).then(setHits), 120);
    return () => clearTimeout(t);
  }, [query]);

  const open = (id: string, at?: number) => {
    setSelected(id);
    setFocus(at);
    setQuery('');
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="drag" />
        <RecordButton state={state} shortcut={settings?.shortcut} />
        <div className="search">
          <SearchIcon />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search meetings" spellCheck={false} />
          <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </div>
        <nav className="list">
          {query.trim() ? (
            <SearchResults hits={hits} onOpen={open} />
          ) : meetings.length ? (
            meetings.map((m) => (
              <button key={m.id} className={`item ${m.id === selected ? 'active' : ''}`} onClick={() => open(m.id)}>
                <span className="item-title">{m.title}</span>
                <span className="item-meta">
                  {day(m.date)} · {time(m.date)} · {duration(m.duration)}
                  {m.actionItems ? ` · ${m.actionItems} tasks` : ''}
                </span>
              </button>
            ))
          ) : (
            <p className="muted pad">No meetings yet.</p>
          )}
        </nav>
        <footer className="sidebar-foot">
          <span className="local">
            <i className="dot-ok" /> Local only
          </span>
          <button className="ghost" onClick={() => setShowSettings((v) => !v)}>
            Settings
          </button>
        </footer>
      </aside>

      <main className="main">
        <div className="drag" />
        {health && <HealthBar health={health} />}
        {showSettings && settings ? (
          <SettingsPanel settings={settings} health={health} onChange={setSettings} onClose={() => setShowSettings(false)} />
        ) : meeting ? (
          <MeetingView meeting={meeting} focus={focus} onRenamed={refresh} />
        ) : (
          <Empty shortcut={settings?.shortcut} folder={settings?.outputDir} />
        )}
      </main>
    </div>
  );
}

function RecordButton({ state, shortcut }: { state: RecorderState; shortcut?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state.kind !== 'recording') return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [state.kind]);
  const busy = state.kind === 'processing' || state.kind === 'starting';
  return (
    <div className="record-wrap">
      <button className={`record ${state.kind}`} disabled={busy} onClick={() => void api.toggleRecording()}>
        <span className="record-dot" />
        <span className="record-label">
          {state.kind === 'recording'
            ? `Stop · ${elapsed(now - state.startedAt)}`
            : state.kind === 'processing'
              ? capitalize(state.stage)
              : state.kind === 'starting'
                ? 'Starting'
                : 'Record meeting'}
        </span>
        {shortcut && state.kind !== 'processing' && <kbd>{pretty(shortcut)}</kbd>}
      </button>
      {state.kind === 'recording' && (
        <p className="record-sub">
          {state.tracks.includes('mic') ? 'Mic' : ''}
          {state.tracks.length === 2 ? ' + ' : ''}
          {state.tracks.includes('system') ? 'system audio' : ''}
          {state.warnings.length ? ` · ${state.warnings.length} warning` : ''}
        </p>
      )}
      {state.kind === 'error' && <p className="record-sub error">{state.message}</p>}
      {state.kind === 'processing' && <div className="progress" />}
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function SearchResults({ hits, onOpen }: { hits: SearchHit[]; onOpen: (id: string, at?: number) => void }) {
  if (!hits.length) return <p className="muted pad">No matches.</p>;
  return (
    <>
      {hits.map((h, i) => (
        <button key={i} className="item hit" onClick={() => onOpen(h.meetingId, h.where === 'title' ? undefined : h.at)}>
          <span className="item-meta">
            {h.title} · <span className="accent">{h.timestamp}</span> · {h.where}
          </span>
          <span className="hit-text">{h.text}</span>
        </button>
      ))}
    </>
  );
}

function MeetingView({ meeting, focus, onRenamed }: { meeting: Meeting; focus?: number; onRenamed: () => void }) {
  const [active, setActive] = useState<number>();
  const [title, setTitle] = useState(meeting.title);
  useEffect(() => setTitle(meeting.title), [meeting.id, meeting.title]);

  const jump = useCallback((segmentId: number) => {
    setActive(segmentId);
    document.getElementById(`seg-${segmentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  useEffect(() => {
    if (focus === undefined) return;
    const seg = meeting.transcript.segments.find((s) => Math.abs(s.start - focus) < 0.01);
    if (seg) setTimeout(() => jump(seg.id), 50);
  }, [focus, meeting, jump]);

  const m = meeting.minutes;
  const stats = useMemo(() => {
    const t = meeting.timings;
    const perMin = t.transcribeSeconds / Math.max(meeting.transcript.duration / 60, 1 / 60);
    return `${duration(meeting.transcript.duration)} · transcribed in ${t.transcribeSeconds.toFixed(1)}s (${perMin.toFixed(1)}s per audio minute)`;
  }, [meeting]);

  const save = () => {
    if (title.trim() && title !== meeting.title) void api.renameMeeting(meeting.id, title).then(onRenamed);
  };

  return (
    <div className="meeting">
      <header className="meeting-head">
        <input
          className="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          spellCheck={false}
        />
        <div className="meta">
          <span>
            {day(meeting.date)} · {time(meeting.date)} · {stats}
          </span>
          <button className="ghost" onClick={() => void api.revealMeeting(meeting.id)}>
            Show Markdown
          </button>
        </div>
      </header>

      <div className="columns">
        <section className="minutes">
          {m ? (
            <>
              <Block title="Summary" empty="Nothing to summarize.">
                {m.summary.map((p, i) => (
                  <Row key={i} at={p.at} onJump={() => jump(p.segments[0] ?? 0)}>
                    {p.text}
                  </Row>
                ))}
              </Block>
              <Block title="Decisions" empty="No decisions in the transcript.">
                {m.decisions.map((d, i) => (
                  <Row key={i} at={d.at} onJump={() => jump(d.segments[0] ?? 0)}>
                    {d.text}
                  </Row>
                ))}
              </Block>
              <Block title="Action items" empty="No action items in the transcript.">
                {m.actionItems.map((a, i) => (
                  <Row key={i} at={a.at} onJump={() => jump(a.segments[0] ?? 0)} check>
                    {a.task} <span className="owner">{a.owner}</span>
                  </Row>
                ))}
              </Block>
              <p className="footnote">
                Every line links to the transcript. {m.rejected.length ? `${m.rejected.length} item(s) the model made up were dropped. ` : ''}
                Written by {m.model} on this machine.
              </p>
            </>
          ) : (
            <p className="muted">Transcript only. Start Ollama to get minutes for the next meeting.</p>
          )}
        </section>

        <section className="transcript">
          <h3>Transcript</h3>
          {meeting.transcript.segments.map((s) => (
            <p key={s.id} id={`seg-${s.id}`} className={`seg ${active === s.id ? 'active' : ''}`}>
              <span className="seg-time">{ts(s.start)}</span>
              <span className={`seg-who ${s.speaker === 'Me' ? 'me' : ''}`}>{s.speaker}</span>
              <span className="seg-text">{s.text}</span>
            </p>
          ))}
        </section>
      </div>
    </div>
  );
}

function Block({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="block">
      <h3>{title}</h3>
      {children.length ? <ul>{children}</ul> : <p className="muted">{empty}</p>}
    </div>
  );
}

function Row({ at, onJump, check, children }: { at: number; onJump: () => void; check?: boolean; children: React.ReactNode }) {
  return (
    <li className={check ? 'check' : ''}>
      {check && <span className="box" />}
      <span className="row-text">{children}</span>
      <button className="stamp" onClick={onJump} title="Jump to the source in the transcript">
        {ts(at)}
      </button>
    </li>
  );
}

function Empty({ shortcut, folder }: { shortcut?: string; folder?: string }) {
  return (
    <div className="empty">
      <h2>Record your first meeting</h2>
      <p>
        Press <kbd>{shortcut ? pretty(shortcut) : '⌘⇧M'}</kbd> anywhere, or use the tray icon. Tacet records your microphone and the call audio
        on separate tracks, transcribes them with whisper.cpp and writes the minutes with a local model.
      </p>
      <p className="muted">Notes are saved as Markdown in {folder ?? 'your notes folder'}. Nothing is uploaded.</p>
    </div>
  );
}

function HealthBar({ health }: { health: Health }) {
  const issues: string[] = [];
  if (!health.whisper) issues.push(health.whisperError ?? 'whisper.cpp not found');
  if (!health.ollama) issues.push('Ollama is not running: meetings will be saved without minutes.');
  if (health.permissions.microphone === 'denied') issues.push('Microphone access is denied in System Settings.');
  if (health.permissions.screen === 'denied') issues.push('Screen & System Audio Recording is off: only your mic will be recorded.');
  if (!issues.length) return null;
  return (
    <div className="health">
      {issues.map((i) => (
        <span key={i}>{i}</span>
      ))}
    </div>
  );
}

function SettingsPanel({
  settings,
  health,
  onChange,
  onClose,
}: {
  settings: Settings;
  health?: Health;
  onChange: (s: Settings) => void;
  onClose: () => void;
}) {
  const set = async (patch: Partial<Settings>) => onChange(await api.setSettings(patch));
  return (
    <div className="settings">
      <header className="meeting-head">
        <h2>Settings</h2>
        <button className="ghost" onClick={onClose}>
          Done
        </button>
      </header>
      <label className="field">
        <span>Notes folder</span>
        <div className="folder">
          <code>{settings.outputDir}</code>
          <button
            className="ghost"
            onClick={async () => {
              const dir = await api.chooseFolder();
              if (dir) await set({ outputDir: dir });
            }}
          >
            Change
          </button>
        </div>
        <small>Pick a folder inside your Obsidian vault to get the notes there.</small>
      </label>
      <label className="field">
        <span>Transcription model</span>
        <select value={settings.whisperModel} onChange={(e) => void set({ whisperModel: e.target.value })}>
          <option value="base">base · fast, 142 MB</option>
          <option value="small">small · 466 MB</option>
          <option value="large-v3-turbo">large-v3-turbo · best, 1.6 GB</option>
        </select>
        <small>Downloaded once from Hugging Face the first time you use it. That is the only network request Tacet makes.</small>
      </label>
      <label className="field">
        <span>Language</span>
        <select value={settings.language} onChange={(e) => void set({ language: e.target.value })}>
          <option value="auto">Detect automatically</option>
          <option value="en">English</option>
          <option value="pt">Portuguese</option>
          <option value="es">Spanish</option>
          <option value="de">German</option>
          <option value="fr">French</option>
        </select>
      </label>
      <label className="field">
        <span>Minutes model (Ollama)</span>
        <select value={settings.llmModel} onChange={(e) => void set({ llmModel: e.target.value })}>
          {[...new Set([settings.llmModel, ...(health?.ollamaModels ?? [])])].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Shortcut</span>
        <input defaultValue={settings.shortcut} onBlur={(e) => void set({ shortcut: e.target.value })} spellCheck={false} />
        <small>Electron accelerator, e.g. CommandOrControl+Shift+M.</small>
      </label>
      <label className="field row">
        <input type="checkbox" checked={settings.keepAudio} onChange={(e) => void set({ keepAudio: e.target.checked })} />
        <span>Keep the audio files after transcribing</span>
      </label>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
