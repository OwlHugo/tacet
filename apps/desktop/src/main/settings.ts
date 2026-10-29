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
    myName: '',
    nicknames: [],
    vocabulary: [],
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
 * Files written since version 2 hold only what the user changed. Older files hold every field, so a
 * `whisperModel: 'base'` there is the old default written back, not a choice, and is ignored. Any
 * other model in an old file was picked by the user and is kept.
 */
const VERSION = 2
const SavedSchema = SettingsSchema.partial().extend({ version: z.number().int().optional() })

/** Saved settings over the defaults. A file written by an incompatible version is ignored. */
export function loadSettings(file: string, defaults: Settings): Settings {
  if (!existsSync(file)) return defaults
  const saved = SavedSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!saved.success) return defaults
  const { version, whisperModel, ...rest } = saved.data
  return withPatch(defaults, picked(version, whisperModel) ? { ...rest, whisperModel } : rest)
}

/**
 * Write the fields that differ from the defaults, plus the whisper model whenever the user picked one
 * (`chose`): "base" picked on purpose on a machine where base is the default must stay base after
 * a better model is downloaded. A model never picked follows the best one downloaded.
 */
export function saveSettings(
  file: string,
  settings: Settings,
  defaults: Settings,
  chose: { readonly whisperModel: boolean },
): void {
  const changed = Object.fromEntries(
    Object.entries(settings).filter(
      ([k, v]) =>
        JSON.stringify(defaults[k as keyof Settings]) !== JSON.stringify(v) ||
        (k === 'whisperModel' && chose.whisperModel),
    ),
  )
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: VERSION, ...changed }, null, 2))
}

/** Whether the saved file holds a whisper model the user picked. */
export function choseWhisperModel(file: string): boolean {
  if (!existsSync(file)) return false
  const saved = SavedSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  return saved.success && picked(saved.data.version, saved.data.whisperModel)
}

/** The rule loadSettings applies: a model in an old file is a pick unless it is the old default. */
function picked(version: number | undefined, whisperModel: string | undefined): boolean {
  return whisperModel !== undefined && (version === VERSION || whisperModel !== 'base')
}
