import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { z } from 'zod'
import { snapToSpeech, speechRegions } from '../audio/speech.ts'
import { readWav } from '../audio/wav.ts'
import { words } from '../matching/words.ts'
import { cleanText, isHallucination } from '../transcript/merge.ts'
import type { Track, TrackTranscript, TranscribeTrack } from '../transcript/types.ts'
import { run } from './run.ts'

export interface WhisperOptions {
  readonly bin: string
  /** Path to the ggml model file (see ensureModel). */
  readonly model: string
  /** Spoken language code or "auto". */
  readonly language: string
  /**
   * Words the user expects in their meetings (names, product terms). whisper.cpp takes them as the
   * initial prompt, which makes it spell them that way. Empty for none.
   */
  readonly vocabulary: readonly string[]
  /** ffmpeg, to convert m4a/mp3/webm into 16 kHz WAV. Without it only WAV/FLAC/OGG/MP3 work. */
  readonly ffmpeg?: string | undefined
  /** Environment for the child processes, from the app config. */
  readonly env: NodeJS.ProcessEnv
}

/** The part of whisper.cpp's `-oj` output Tacet reads. */
const WhisperJson = z.object({
  result: z.object({ language: z.string() }).optional(),
  transcription: z.array(
    z.object({ offsets: z.object({ from: z.number(), to: z.number() }), text: z.string() }),
  ),
})

const NATIVE = new Set(['.mp3', '.flac', '.ogg'])

/** Timestamp snapping needs PCM, so anything that is not WAV goes through ffmpeg when there is one. */
async function toWav(path: string, work: string, opts: WhisperOptions): Promise<string> {
  const ext = extname(path).toLowerCase()
  if (ext === '.wav') return path
  if (!opts.ffmpeg) {
    if (NATIVE.has(ext)) return path
    throw new Error(
      `Cannot read ${ext} files without ffmpeg. Convert to .wav first or install ffmpeg.`,
    )
  }
  const out = join(work, 'input.wav')
  await run(
    opts.ffmpeg,
    ['-loglevel', 'error', '-y', '-i', path, '-ar', '16000', '-ac', '1', out],
    opts.env,
  )
  return out
}

/** The `--prompt` arguments for a vocabulary: the words as a comma list, or nothing. */
export function vocabularyPrompt(vocabulary: readonly string[]): string[] {
  const listed = vocabulary.map((w) => w.trim()).filter((w) => w !== '')
  return listed.length === 0 ? [] : ['--prompt', `${listed.join(', ')}.`]
}

/**
 * whisper.cpp may write its initial prompt back as a segment over silence. A segment made only of
 * vocabulary words ("Rafaela.", "Kubernetes, Rafaela") is that echo, not speech: kept, it would make
 * a name count as said in the meeting.
 */
export function echoesVocabulary(text: string, vocabulary: readonly string[]): boolean {
  const listed = new Set(vocabulary.flatMap((w) => words(w)))
  const said = words(text)
  return said.length > 0 && said.every((w) => listed.has(w))
}

/** whisper.cpp adapter for the TranscribeTrack port. */
export function whisperTranscriber(opts: WhisperOptions): TranscribeTrack {
  // Prebuilt Linux builds ship their .so files next to the binary.
  const env = {
    ...opts.env,
    LD_LIBRARY_PATH: [dirname(opts.bin), opts.env['LD_LIBRARY_PATH']].filter(Boolean).join(':'),
  }
  return async (track: Track): Promise<TrackTranscript> => {
    const work = mkdtempSync(join(tmpdir(), 'tacet-'))
    try {
      const input = await toWav(track.path, work, opts)
      const out = join(work, 'out')
      await run(
        opts.bin,
        [
          ...['-m', opts.model, '-f', input, '-oj', '-of', out, '-np', '-l', opts.language],
          ...vocabularyPrompt(opts.vocabulary),
        ],
        env,
      )
      const json = WhisperJson.parse(JSON.parse(readFileSync(`${out}.json`, 'utf8')))
      const segments = json.transcription
        .map((t) => ({
          start: t.offsets.from / 1000,
          end: t.offsets.to / 1000,
          speaker: track.speaker,
          text: cleanText(t.text),
        }))
        .filter(
          (s) => s.text && !isHallucination(s.text) && !echoesVocabulary(s.text, opts.vocabulary),
        )
      return {
        segments: input.endsWith('.wav')
          ? snapToSpeech(segments, speechRegions(readWav(input)))
          : segments,
        language: json.result?.language ?? opts.language,
      }
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }
}
