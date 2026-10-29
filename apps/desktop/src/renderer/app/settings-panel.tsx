import { useState } from 'react'
import type { Health, Settings } from '../../shared/contract.ts'
import { ipcErrorMessage, listOf } from './format.ts'
import { api } from './platform.ts'

type Patch = Partial<Omit<Settings, 'outputDir'>>

const WHISPER_MODELS = [
  ['tiny', 'tiny · fastest, 75 MB'],
  ['base', 'base · fast, 142 MB'],
  ['small', 'small · 466 MB'],
  ['large-v3-turbo', 'large-v3-turbo · best, 1.6 GB'],
] as const

const LANGUAGES = [
  ['auto', 'Detect automatically'],
  ['en', 'English'],
  ['pt', 'Portuguese'],
  ['es', 'Spanish'],
  ['de', 'German'],
  ['fr', 'French'],
] as const

export function SettingsPanel(props: {
  settings: Settings
  health: Health | undefined
  onChange: (s: Settings) => void
  onClose: () => void
}) {
  const { settings } = props
  const [error, setError] = useState<string>()
  const set = async (patch: Patch) => {
    setError(undefined)
    props.onChange(
      await api.setSettings(patch).catch((e: unknown) => {
        setError(ipcErrorMessage(e))
        return settings
      }),
    )
  }
  const llms = [...new Set([settings.llmModel, ...(props.health?.ollamaModels ?? [])])]
  const downloaded = new Set(props.health?.whisperModels)
  return (
    <div className="settings">
      <header className="meeting-head">
        <h2>Settings</h2>
        <button type="button" className="ghost" onClick={props.onClose}>
          Done
        </button>
      </header>
      <div className="field">
        <span>Notes folder</span>
        <div className="folder">
          <code>{settings.outputDir}</code>
          <button
            type="button"
            className="ghost"
            onClick={async () => props.onChange(await api.chooseFolder())}
          >
            Change
          </button>
        </div>
        <small>Pick a folder inside your Obsidian vault to get the notes there.</small>
      </div>
      <label className="field">
        <span>Transcription model</span>
        <select
          value={settings.whisperModel}
          onChange={(e) => void set({ whisperModel: e.target.value as Settings['whisperModel'] })}
        >
          {WHISPER_MODELS.map(([value, text]) => (
            <option key={value} value={value}>
              {downloaded.has(value) ? `${text} · downloaded` : text}
            </option>
          ))}
        </select>
        <small>
          A model that is not downloaded yet comes from Hugging Face the first time you use it. That
          is the only network request Tacet makes.
        </small>
      </label>
      <label className="field">
        <span>Language</span>
        <select value={settings.language} onChange={(e) => void set({ language: e.target.value })}>
          {LANGUAGES.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Minutes model (Ollama)</span>
        <select value={settings.llmModel} onChange={(e) => void set({ llmModel: e.target.value })}>
          {llms.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Shortcut</span>
        <input
          defaultValue={settings.shortcut}
          onBlur={(e) => void set({ shortcut: e.target.value })}
          spellCheck={false}
        />
        <small>Electron accelerator, e.g. CommandOrControl+Shift+M.</small>
      </label>
      <label className="field row">
        <input
          type="checkbox"
          checked={settings.keepAudio}
          onChange={(e) => void set({ keepAudio: e.target.checked })}
        />
        <span>Keep the audio files after transcribing</span>
      </label>
      <h3 className="settings-group">About you</h3>
      <label className="field">
        <span>Your name</span>
        <input
          key={`name-${settings.myName}`}
          defaultValue={settings.myName}
          onBlur={(e) => void set({ myName: e.target.value.trim() })}
          placeholder="Ana"
        />
        <small>
          Tasks asked of you get your name as owner. On a recording, that is your microphone track.
        </small>
      </label>
      <label className="field">
        <span>Nicknames</span>
        <input
          key={`nick-${settings.nicknames.join(',')}`}
          defaultValue={settings.nicknames.join(', ')}
          onBlur={(e) => void set({ nicknames: listOf(e.target.value) })}
          placeholder="Aninha, Ana B."
          disabled={settings.myName === ''}
        />
        <small>Other names people call you, separated by commas.</small>
      </label>
      <label className="field">
        <span>Vocabulary</span>
        <textarea
          key={`vocab-${settings.vocabulary.join(',')}`}
          defaultValue={settings.vocabulary.join('\n')}
          onBlur={(e) => void set({ vocabulary: listOf(e.target.value) })}
          rows={4}
          spellCheck={false}
          placeholder={'Kubernetes\nPedro Alcântara'}
        />
        <small>
          Names and terms the transcription gets wrong, one per line. They stay on this machine.
        </small>
      </label>
      {error && <p className="field settings-error">{error}</p>}
    </div>
  )
}
