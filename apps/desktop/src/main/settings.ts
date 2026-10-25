import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type Settings, SettingsSchema } from '../shared/contract.ts'

/** `whisperModel` is the best model already downloaded (see defaultModel), so a new install never downloads one it does not need. */
export function defaultSettings(
  documents: string,
  whisperModel: Settings['whisperModel'],
): Settings {
  return {
    outputDir: join(documents, 'Tacet'),
    whisperModel,
    language: 'auto',
    llmModel: 'qwen2.5:7b',
    shortcut: 'CommandOrControl+Shift+M',
    keepAudio: true,
  }
}

/** `base` with every field of `patch` that is set. */
export function withPatch(
  base: Settings,
  patch: Partial<Record<keyof Settings, unknown>>,
): Settings {
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  return SettingsSchema.parse({ ...base, ...set })
}

/** Saved settings over the defaults. A file written by an incompatible version is ignored. */
export function loadSettings(file: string, defaults: Settings): Settings {
  if (!existsSync(file)) return defaults
  const saved = SettingsSchema.partial().safeParse(JSON.parse(readFileSync(file, 'utf8')))
  return saved.success ? withPatch(defaults, saved.data) : defaults
}

export function saveSettings(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(settings, null, 2))
}
