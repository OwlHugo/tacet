import { randomUUID } from 'node:crypto'
import { basename, extname } from 'node:path'
import {
  ensureModel,
  findFfmpeg,
  findWhisper,
  findWhisperOrUndefined,
  ME,
  type Meeting,
  MeetingLibrary,
  OTHERS,
  ollamaMinutes,
  ollamaModels,
  processMeeting,
  SPEAKER,
  type Stage,
  type Track,
  whisperTranscriber,
} from '@tacet/core'
import type { Settings } from '../shared/contract.ts'
import type { RecordedTrack } from './recording/session.ts'

export interface PipelineEnv {
  readonly whisperBin: string | undefined
  readonly ffmpegBin: string | undefined
  readonly modelsDir: string
  readonly ollamaHost: string
  readonly searchPath: string
  readonly bundledDirs: readonly string[]
  readonly platform: NodeJS.Platform
}

const binaries = (env: PipelineEnv) => ({
  searchPath: env.searchPath,
  platform: env.platform,
  bundledDirs: env.bundledDirs,
})

export const locateWhisper = (env: PipelineEnv) =>
  findWhisperOrUndefined({ ...binaries(env), explicit: env.whisperBin })

const LABEL = { mic: ME, system: OTHERS } as const

export const recordedTracks = (tracks: readonly RecordedTrack[]): Track[] =>
  tracks.map((t) => ({ path: t.path, speaker: LABEL[t.track] }))

/** An imported file is one mixed track: nobody can tell "Me" from "Others" in it. */
export const importedMeeting = (path: string) => ({
  title: basename(path, extname(path)),
  tracks: [{ path, speaker: SPEAKER }],
})

/** Run the core pipeline with the user's settings and save the note. Minutes only if Ollama is up. */
export async function runPipeline(
  input: {
    readonly id?: string
    readonly title: string
    readonly date: Date
    readonly tracks: readonly Track[]
  },
  settings: Settings,
  env: PipelineEnv,
  onStage: (stage: Stage) => void,
): Promise<{ meeting: Meeting; notePath: string }> {
  const llmUp = (await ollamaModels(env.ollamaHost)) !== undefined
  const meeting = await processMeeting(
    { id: input.id ?? randomUUID(), title: input.title, date: input.date, tracks: input.tracks },
    {
      transcribeTrack: whisperTranscriber({
        bin: findWhisper({ ...binaries(env), explicit: env.whisperBin }),
        ffmpeg: findFfmpeg({ ...binaries(env), explicit: env.ffmpegBin }),
        model: await ensureModel(settings.whisperModel, env.modelsDir),
        language: settings.language,
        env: process.env,
      }),
      whisperModel: settings.whisperModel,
      minutes: llmUp
        ? {
            generate: ollamaMinutes({ host: env.ollamaHost, model: settings.llmModel }),
            model: settings.llmModel,
          }
        : undefined,
      now: () => performance.now(),
      onStage,
    },
  )
  return { meeting, notePath: new MeetingLibrary(settings.outputDir).save(meeting) }
}
