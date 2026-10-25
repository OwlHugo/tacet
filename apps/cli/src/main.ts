#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  ensureModel,
  findFfmpeg,
  findWhisper,
  findWhisperOrUndefined,
  MeetingLibrary,
  modelPath,
  ollamaMinutes,
  ollamaModels,
  processMeeting,
  toMarkdown,
  whisperTranscriber,
} from '@tacet/core'
import { z } from 'zod'
import { config } from './config.ts'
import { parseTracks } from './tracks.ts'

const VERSION = '0.1.0'
const DEFAULT_LLM = 'qwen2.5:7b'

const HELP = `tacet ${VERSION}  local meeting transcription, nothing leaves your machine

Usage
  tacet transcribe <audio...> [options]   transcribe and write minutes
  tacet search <query> [--dir DIR]        search saved meetings
  tacet list [--dir DIR]                  list saved meetings
  tacet doctor                            check whisper.cpp, models and Ollama

Transcribe options
  --mic FILE            your microphone track (labelled "Me")
  --system FILE         system audio track (labelled "Others")
  file.wav:Name         label a positional track
  -m, --model NAME      whisper model: tiny, base, small, large-v3-turbo or a .bin path (default base)
  -l, --language CODE   en, pt, ... or auto (default auto)
  --llm MODEL           Ollama model for the minutes (default ${DEFAULT_LLM})
  --no-minutes          transcript only
  -t, --title TEXT      meeting title
  -o, --out DIR         save Markdown into DIR (default: print to stdout)
  --json                print the meeting as JSON
`

const err = (s: string) => process.stderr.write(s)
const binaries = { searchPath: config.PATH, platform: process.platform }

const TranscribeArgs = z.object({
  mic: z.string().optional(),
  system: z.string().optional(),
  model: z.string().min(1),
  language: z.string().regex(/^(auto|[a-z]{2,3})$/, 'language must be a code like en, pt or auto'),
  llm: z.string().min(1),
  'no-minutes': z.boolean(),
  title: z.string().min(1).optional(),
  out: z.string().optional(),
  json: z.boolean(),
})

async function transcribeCommand(argv: string[]): Promise<void> {
  const { values: raw, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      mic: { type: 'string' },
      system: { type: 'string' },
      model: { type: 'string', short: 'm', default: 'base' },
      language: { type: 'string', short: 'l', default: 'auto' },
      llm: { type: 'string', default: DEFAULT_LLM },
      'no-minutes': { type: 'boolean', default: false },
      title: { type: 'string', short: 't' },
      out: { type: 'string', short: 'o' },
      json: { type: 'boolean', default: false },
    },
  })
  const args = TranscribeArgs.parse(raw)
  const tracks = parseTracks(positionals, args.mic, args.system).map((t) => ({
    ...t,
    path: resolve(t.path),
  }))
  const [first] = tracks
  if (!first) throw new Error('no audio given. Try `tacet transcribe meeting.wav`.')
  const missing = tracks.find((t) => !existsSync(t.path))
  if (missing) throw new Error(`file not found: ${missing.path}`)

  const llmUp = !args['no-minutes'] && (await ollamaModels(config.OLLAMA_HOST)) !== undefined
  if (!args['no-minutes'] && !llmUp)
    err('warning: Ollama is not running, saving the transcript without minutes.\n')
  const meeting = await processMeeting(
    {
      id: randomUUID(),
      title: args.title ?? basename(first.path, extname(first.path)),
      date: new Date(),
      tracks,
    },
    {
      transcribeTrack: whisperTranscriber({
        bin: findWhisper({ ...binaries, explicit: config.TACET_WHISPER_BIN }),
        ffmpeg: findFfmpeg({ ...binaries, explicit: config.TACET_FFMPEG_BIN }),
        model: await ensureModel(args.model, config.TACET_MODELS_DIR),
        language: args.language,
        env: process.env,
      }),
      whisperModel: args.model,
      minutes: llmUp
        ? {
            generate: ollamaMinutes({ host: config.OLLAMA_HOST, model: args.llm }),
            model: args.llm,
          }
        : undefined,
      now: () => performance.now(),
      onStage: (stage) =>
        err(
          stage === 'transcribing'
            ? `transcribing ${tracks.length} track(s) with whisper ${args.model}...\n`
            : `writing minutes with ${args.llm}...\n`,
        ),
    },
  )
  const audioMinutes = Math.max(meeting.transcript.duration / 60, 1 / 60)
  err(
    `done: ${meeting.transcript.segments.length} segments, ${meeting.transcript.duration.toFixed(1)}s of audio, ` +
      `transcribe ${(meeting.timings.transcribeSeconds / audioMinutes).toFixed(1)}s per audio minute` +
      (meeting.minutes ? `, ${meeting.minutes.rejected.length} ungrounded item(s) dropped` : '') +
      '\n',
  )
  if (args.out) err(`saved ${new MeetingLibrary(resolve(args.out)).save(meeting)}\n`)
  if (args.json) process.stdout.write(`${JSON.stringify(meeting, null, 2)}\n`)
  else if (!args.out) process.stdout.write(`${toMarkdown(meeting)}\n`)
}

function libraryFrom(argv: string[]): { library: MeetingLibrary; positionals: string[] } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { dir: { type: 'string', default: config.TACET_DIR } },
  })
  return { library: new MeetingLibrary(resolve(values.dir)), positionals }
}

function searchCommand(argv: string[]): void {
  const { library, positionals } = libraryFrom(argv)
  const query = positionals.join(' ')
  if (!query) throw new Error('usage: tacet search <query>')
  const hits = library.search(query)
  if (hits.length === 0) console.log('no matches')
  for (const h of hits)
    console.log(`${h.date.slice(0, 10)}  ${h.title}  ${h.timestamp}  [${h.where}]  ${h.text}`)
}

function listCommand(argv: string[]): void {
  const { library } = libraryFrom(argv)
  const meetings = library.list()
  if (meetings.length === 0) console.log(`no meetings in ${library.folder}`)
  for (const m of meetings) {
    const tasks = m.minutes?.actionItems.length ?? 0
    console.log(
      `${m.date.slice(0, 16).replace('T', ' ')}  ${m.title}  (${Math.round(m.transcript.duration / 60)} min, ${tasks} tasks)`,
    )
  }
}

async function doctorCommand(): Promise<void> {
  const row = (ok: boolean, label: string, detail: string) =>
    console.log(`${ok ? 'ok ' : 'no '} ${label.padEnd(20)} ${detail}`)
  const whisper = findWhisperOrUndefined({ ...binaries, explicit: config.TACET_WHISPER_BIN })
  row(
    whisper !== undefined,
    'whisper.cpp',
    whisper ?? 'not found: `brew install whisper-cpp` or set TACET_WHISPER_BIN',
  )
  const ffmpeg = findFfmpeg({ ...binaries, explicit: config.TACET_FFMPEG_BIN })
  row(
    ffmpeg !== undefined,
    'ffmpeg (optional)',
    ffmpeg ?? 'not found: only wav/mp3/flac/ogg can be read',
  )
  for (const m of ['base', 'large-v3-turbo']) {
    const path = modelPath(m, config.TACET_MODELS_DIR)
    row(existsSync(path), `model ${m}`, path)
  }
  const models = await ollamaModels(config.OLLAMA_HOST)
  row(
    models !== undefined,
    'ollama',
    models === undefined
      ? 'not running, minutes disabled'
      : models.join(', ') || 'running, no models (try `ollama pull qwen2.5:7b`)',
  )
}

const COMMANDS: Readonly<Record<string, (argv: string[]) => void | Promise<void>>> = {
  transcribe: transcribeCommand,
  search: searchCommand,
  list: listCommand,
  doctor: doctorCommand,
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv
  if (command === undefined || ['-h', '--help', 'help'].includes(command))
    return void process.stdout.write(HELP)
  if (command === '-v' || command === '--version') return console.log(VERSION)
  const run = COMMANDS[command]
  if (run) return run(rest)
  if (existsSync(command)) return transcribeCommand(argv)
  throw new Error(`unknown command "${command}". Run \`tacet --help\`.`)
}

// The CLI is the edge: any error ends here, printed once, with a non-zero exit.
main(process.argv.slice(2)).catch((e: unknown) => {
  err(
    `tacet: ${e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : String(e)}\n`,
  )
  process.exitCode = 1
})
