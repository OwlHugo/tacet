import { generateMinutes } from '../minutes/generate.ts'
import type { GenerateRawMinutes } from '../minutes/types.ts'
import { transcribe } from '../transcript/transcribe.ts'
import type { Track, TranscribeTrack } from '../transcript/types.ts'
import type { Meeting } from './types.ts'

export type Stage = 'transcribing' | 'minutes'

export interface ProcessDeps {
  readonly transcribeTrack: TranscribeTrack
  /** Whisper model name, recorded in the transcript. */
  readonly whisperModel: string
  /** Undefined when there is no LLM (Ollama not running, or --no-minutes): transcript only. */
  readonly minutes?: { readonly generate: GenerateRawMinutes; readonly model: string } | undefined
  readonly now: () => number
  readonly onStage?: (stage: Stage) => void
}

export interface ProcessInput {
  readonly id: string
  readonly title: string
  readonly date: Date
  readonly tracks: readonly Track[]
}

/** Transcribe the tracks and, when an LLM is available and someone spoke, write grounded minutes. */
export async function processMeeting(input: ProcessInput, deps: ProcessDeps): Promise<Meeting> {
  deps.onStage?.('transcribing')
  const t0 = deps.now()
  const transcript = await transcribe(input.tracks, deps.transcribeTrack, deps.whisperModel)
  const meeting: Meeting = {
    id: input.id,
    title: input.title,
    date: input.date.toISOString(),
    transcript,
    timings: { transcribeSeconds: (deps.now() - t0) / 1000 },
  }
  if (!deps.minutes || transcript.segments.length === 0) return meeting
  deps.onStage?.('minutes')
  const t1 = deps.now()
  const { minutes } = await generateMinutes(transcript, deps.minutes)
  return {
    ...meeting,
    minutes,
    timings: { ...meeting.timings, minutesSeconds: (deps.now() - t1) / 1000 },
  }
}
