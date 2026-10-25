export { type Pcm, type Region, snapToSpeech, speechRegions } from './audio/speech.ts'
export { readWav, WavWriter } from './audio/wav.ts'
export { MeetingLibrary, noteName } from './library/library.ts'
export { coverage, normalize, similarity, words } from './matching/words.ts'
export { toMarkdown } from './meeting/markdown.ts'
export {
  type ProcessDeps,
  type ProcessInput,
  processMeeting,
  type Stage,
} from './meeting/process.ts'
export { type SearchHit, searchMeetings } from './meeting/search.ts'
export { type Meeting, MeetingSchema } from './meeting/types.ts'
export { generateMinutes } from './minutes/generate.ts'
export { type GroundingOptions, groundMinutes } from './minutes/ground.ts'
export { SYSTEM_PROMPT } from './minutes/prompt.ts'
export {
  type GenerateRawMinutes,
  type Minutes,
  MinutesSchema,
  type RawMinutes,
  RawMinutesSchema,
} from './minutes/types.ts'
export { ollamaHost, ollamaMinutes, ollamaModels } from './ollama/ollama.ts'
export { mergeTracks } from './transcript/merge.ts'
export { blockId, formatTimestamp } from './transcript/timestamp.ts'
export { transcribe } from './transcript/transcribe.ts'
export {
  ME,
  OTHERS,
  type Segment,
  SPEAKER,
  type Track,
  type TranscribeTrack,
  type Transcript,
  TranscriptSchema,
} from './transcript/types.ts'
export {
  type FindBinaryOptions,
  findFfmpeg,
  findWhisper,
  findWhisperOrUndefined,
} from './whisper/binaries.ts'
export { defaultModel, ensureModel, installedModels, modelPath } from './whisper/models.ts'
export { type WhisperOptions, whisperTranscriber } from './whisper/transcribe-track.ts'
