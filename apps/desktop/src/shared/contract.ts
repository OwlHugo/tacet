import { z } from 'zod'

/**
 * IPC contract between the renderer (untrusted, like an HTTP body) and the main process.
 * Every invoke channel has an input schema the main process parses before doing anything.
 */

const TrackSchema = z.enum(['mic', 'system'])
export type Track = z.infer<typeof TrackSchema>

/** Meeting ids are UUIDs: they become file names, so nothing else gets through. */
const MeetingIdSchema = z.uuid()

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

export type RecorderState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | {
      readonly kind: 'recording'
      readonly startedAt: number
      readonly tracks: readonly Track[]
      readonly warnings: readonly string[]
    }
  | { readonly kind: 'processing'; readonly stage: string }
  | { readonly kind: 'error'; readonly message: string }

export interface MeetingSummary {
  readonly id: string
  readonly title: string
  readonly date: string
  readonly duration: number
  readonly actionItems: number
}

export interface Health {
  readonly whisper: string | undefined
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
