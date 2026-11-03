/**
 * Builds the eval audio from evals/scripts.json with macOS `say`. The audio is committed, so CI on
 * Linux and Windows runs the same files without TTS.
 *
 * Each case has two tracks on one timeline, like a real call: me.wav (microphone) and others.wav
 * (system audio), 16 kHz mono PCM, or me.mp3 and others.mp3 at 32 kbps for a script with
 * `"audio": "mp3"`. Lines alternate between the tracks with a short gap.
 *
 *   node evals/gerar-audio.ts [case-id] && pnpm eval:gravar
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

const ROOT = import.meta.dirname
const GAP_SECONDS = 0.6

const Script = z.object({
  id: z.string(),
  title: z.string(),
  language: z.string(),
  voices: z.record(z.string(), z.string()),
  rate: z.number().optional(),
  /** `mp3` keeps a long call small in the repository; whisper reads it through ffmpeg. */
  audio: z.enum(['wav', 'mp3']).default('wav'),
  lines: z.array(
    z.object({
      speaker: z.string(),
      text: z.string(),
      /** A second person on the same track ("Others" is everyone heard through the computer). */
      voice: z.string().optional(),
    }),
  ),
  expected_actions: z.array(z.array(z.string())),
  expected_due: z.array(
    z.object({ task: z.array(z.string()), due: z.string(), optional: z.boolean().optional() }),
  ),
  /** Copied as is to case.json; `loadCases` validates them. */
  self: z.unknown().optional(),
  answer_key: z.unknown().optional(),
})
const ONLY = process.argv[2]

const sh = (cmd: string, args: readonly string[]) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString()
const seconds = (file: string) =>
  Number(
    sh('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file,
    ]).trim(),
  )

interface Placed {
  readonly wav: string
  readonly at: number
}

/** How a track is written: 16-bit PCM, or a small mono MP3 for a long call. */
const ENCODING = {
  wav: ['-sample_fmt', 's16'],
  mp3: ['-c:a', 'libmp3lame', '-b:a', '32k'],
} as const

/** Mix the clips of one speaker onto a silent track of the meeting's length. */
function mixTrack(
  parts: readonly Placed[],
  total: number,
  out: string,
  audio: keyof typeof ENCODING,
): void {
  const inputs = parts.flatMap((p) => ['-i', p.wav])
  const delays = parts.map((p, i) => `[${i + 1}]adelay=${Math.round(p.at * 1000)}:all=1[d${i}]`)
  const mix = `[0]${parts.map((_, i) => `[d${i}]`).join('')}amix=inputs=${parts.length + 1}:normalize=0,atrim=0:${total}[out]`
  sh('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-t',
    String(total),
    '-i',
    'anullsrc=r=16000:cl=mono',
    ...inputs,
    '-filter_complex',
    [...delays, mix].join(';'),
    '-map',
    '[out]',
    '-ar',
    '16000',
    '-ac',
    '1',
    ...ENCODING[audio],
    out,
  ])
}

for (const script of z
  .array(Script)
  .parse(JSON.parse(readFileSync(join(ROOT, 'scripts.json'), 'utf8')))
  .filter((s) => ONLY === undefined || s.id === ONLY)) {
  const dir = join(ROOT, 'cases', script.id)
  const work = join(tmpdir(), `tacet-eval-${script.id}`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  mkdirSync(dir, { recursive: true })
  const placed = new Map<string, Placed[]>()
  const reference: { speaker: string; text: string; start: number }[] = []
  let t = 0.5
  script.lines.forEach(({ voice: own, ...line }, i) => {
    const voice = own ?? script.voices[line.speaker]
    if (!voice) throw new Error(`${script.id}: no voice for ${line.speaker}`)
    const aiff = join(work, `${i}.aiff`)
    const wav = join(work, `${i}.wav`)
    sh('say', ['-v', voice, '-r', String(script.rate ?? 185), '-o', aiff, line.text])
    sh('ffmpeg', ['-loglevel', 'error', '-y', '-i', aiff, '-ar', '16000', '-ac', '1', wav])
    placed.set(line.speaker, [...(placed.get(line.speaker) ?? []), { wav, at: t }])
    reference.push({ ...line, start: Math.round(t * 100) / 100 })
    t += seconds(wav) + GAP_SECONDS
  })
  const total = t + 0.5
  const tracks = [...placed].map(([speaker, parts]) => {
    const file = `${speaker === 'Me' ? 'me' : 'others'}.${script.audio}`
    mixTrack(parts, total, join(dir, file), script.audio)
    return { file, speaker }
  })
  const kase = {
    id: script.id,
    title: script.title,
    language: script.language,
    tracks,
    reference,
    expected_actions: script.expected_actions,
    expected_due: script.expected_due,
    ...(script.answer_key === undefined ? {} : { answer_key: script.answer_key }),
    ...(script.self === undefined ? {} : { self: script.self }),
  }
  writeFileSync(join(dir, 'case.json'), `${JSON.stringify(kase, null, 2)}\n`)
  rmSync(work, { recursive: true, force: true })
  console.log(`${script.id}: ${total.toFixed(1)}s`)
}
