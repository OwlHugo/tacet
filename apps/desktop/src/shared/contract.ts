import { z } from 'zod'
import { IMPORT_EXTENSIONS_LABEL, isImportableAudio } from './audio-files.ts'

/**
 * IPC contract between the renderer (untrusted, like an HTTP body) and the main process.
 * Every invoke channel has an input schema the main process parses before doing anything.
 */

const TrackSchema = z.enum(['mic', 'system'])
export type Track = z.infer<typeof TrackSchema>

/** Meeting ids are UUIDs: they become file names, so nothing else gets through. */
const MeetingIdSchema = z.uuid()

/**
 * A file to import, as the preload gets it from `webUtils.getPathForFile`: an absolute POSIX path,
 * a Windows drive path (C:\ or C:/) or a UNC share (\\server\share\...). The main process
 * resolves and normalizes it and checks it is a file before reading it.
 */
const ImportPathSchema = z
  .string()
  .max(4096)
  .regex(/^(\/|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/, 'expected an absolute path')
  .refine(isImportableAudio, `expected a ${IMPORT_EXTENSIONS_LABEL} file`)

/** Electron accelerator such as CommandOrControl+Shift+M. */
const AcceleratorSchema = z
  .string()
  .regex(/^([A-Za-z]+\+){1,3}[A-Za-z0-9]$/, 'expected an accelerator like CommandOrControl+Shift+M')

export const SettingsSchema = z.object({
  outputDir: z.string().min(1),
  whisperModel: z.enum(['tiny', 'base', 'small', 'large-v3-turbo']),
  language: z.string().regex(/^(auto|[a-z]{2,3})$/),
  llmModel: z.string().min(1),
  shortcut: AcceleratorSchema,
  keepAudio: z.boolean(),
})
export type Settings = z.infer<typeof SettingsSchema>

/** What the renderer may change. The notes folder only changes through the native folder picker. */
const SettingsPatchSchema = SettingsSchema.omit({ outputDir: true }).partial().strict()

export type ProcessingStage = 'saving audio' | 'transcribing' | 'writing minutes'

export type RecorderState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | {
      readonly kind: 'recording'
      readonly startedAt: number
      readonly tracks: readonly Track[]
      readonly warnings: readonly string[]
    }
  | {
      readonly kind: 'processing'
      readonly stage: ProcessingStage
      /** An import has no audio to save, so its steps start at transcribing. */
      readonly source: 'recording' | 'import'
    }
  | {
      readonly kind: 'error'
      readonly message: string
      /** `capture`: nothing could be recorded (microphone or screen permission); `pipeline`: recorded, then failed. */
      readonly cause: 'capture' | 'pipeline'
    }

export interface MeetingSummary {
  readonly id: string
  readonly title: string
  readonly date: string
  readonly duration: number
  readonly actionItems: number
}

export interface Health {
  readonly whisper: string | undefined
  /** Whisper models already downloaded, best first. */
  readonly whisperModels: readonly string[]
  readonly ollamaModels: readonly string[] | undefined
  readonly microphone: string
  readonly screen: string
}

/** Input schemas of the invoke channels, keyed by channel name. */
export const INVOKE = {
  'recording:toggle': z.tuple([]),
  'recording:state': z.tuple([]),
  'meetings:list': z.tuple([]),
  'meetings:get': z.tuple([MeetingIdSchema]),
  'meetings:rename': z.tuple([MeetingIdSchema, z.string().trim().min(1).max(200)]),
  'meetings:reveal': z.tuple([MeetingIdSchema]),
  'meetings:search': z.tuple([z.string().max(500)]),
  'meetings:import': z.tuple([ImportPathSchema]),
  'meetings:import-dialog': z.tuple([]),
  'settings:get': z.tuple([]),
  'settings:set': z.tuple([SettingsPatchSchema]),
  'settings:choose-folder': z.tuple([]),
  health: z.tuple([]),
} as const

/** Fire-and-forget messages from the hidden recorder window. */
export const RECORDER = {
  'recorder:open': z.tuple([TrackSchema, z.literal(16000)]),
  'recorder:chunk': z.tuple([TrackSchema, z.instanceof(Float32Array)]),
  'recorder:started': z.tuple([z.array(TrackSchema).min(1), z.array(z.string())]),
  'recorder:failed': z.tuple([z.string()]),
  'recorder:closed': z.tuple([]),
} as const

/** "Invalid meetings:import: expected an absolute path", the message the renderer shows. */
export const invalidArguments = (channel: string, error: z.ZodError): string =>
  `Invalid ${channel}: ${[...new Set(error.issues.map((i) => i.message))].join('; ')}`
