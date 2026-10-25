import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
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

/**
 * Files written since version 2 hold only what the user changed. Older files hold every field, so
 * their `whisperModel` is the old default (`base`) written back, not a choice, and is ignored.
 */
const VERSION = 2
const SavedSchema = SettingsSchema.partial().extend({ version: z.number().int().optional() })

/** Saved settings over the defaults. A file written by an incompatible version is ignored. */
export function loadSettings(file: string, defaults: Settings): Settings {
  if (!existsSync(file)) return defaults
  const saved = SavedSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!saved.success) return defaults
  const { version, whisperModel, ...rest } = saved.data
  return withPatch(defaults, version === VERSION ? { ...rest, whisperModel } : rest)
}

/** Write only the fields that differ from the defaults, so a better default still reaches the user. */
export function saveSettings(file: string, settings: Settings, defaults: Settings): void {
  const changed = Object.fromEntries(
    Object.entries(settings).filter(([k, v]) => defaults[k as keyof Settings] !== v),
  )
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: VERSION, ...changed }, null, 2))
}
