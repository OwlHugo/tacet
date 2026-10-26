/**
 * Reliability of the minutes: how often each part comes out over N recordings of the same meeting.
 * whisper.cpp and the model at temperature 0 are deterministic on the same input, so asking twice
 * proves nothing. What varies in real use is the input: two recordings of one call never give the
 * same transcript. Each run is a variant of the case audio with what a real capture changes (the
 * offset between the tracks, the gain, background noise), transcribed and written into minutes.
 * Variant 0 is the audio as it is.
 *
 *   pnpm eval:confiabilidade [--vezes 8] [--whisper base,large-v3-turbo] [--llm qwen2.5:7b] [--caso id]
 *
 * Counts, per run: summary not empty, decisions not empty (for cases that have one), every expected
 * task found, deadlines right and wrong. Never writes fixtures.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  ensureModel,
  findFfmpeg,
  findWhisper,
  generateMinutes,
  ollamaMinutes,
  ollamaModels,
  type Transcript,
  transcribe,
  whisperTranscriber,
} from '@tacet/core'
import { type EvalCase, loadCases } from './cases.ts'
import { config } from './config.ts'
import { checkDeadlines } from './metrics/deadlines.ts'
import { checkGrounding } from './metrics/grounding.ts'
import { type ReliabilityRun, reliability, reliabilityMarkdown } from './metrics/reliability.ts'

const { values } = parseArgs({
  options: {
    vezes: { type: 'string', default: '8' },
    whisper: { type: 'string', default: 'base' },
    llm: { type: 'string', default: 'qwen2.5:7b' },
    caso: { type: 'string' },
  },
})
const TIMES = Number(values.vezes)
const log = (s: string) => process.stderr.write(`${s}\n`)

const WHISPER_OPTS = {
  explicit: config.TACET_WHISPER_BIN,
  searchPath: config.PATH,
  platform: process.platform,
}
const FFMPEG = findFfmpeg({ ...WHISPER_OPTS, explicit: undefined }) ?? 'ffmpeg'

/** Variant `i` of a track: the second track shifted, the gain changed and noise added a little more each time. */
function variant(src: string, out: string, i: number, track: number): void {
  const shift = track === 0 ? 0 : (i * 37) % 160
  const gain = 1 - 0.04 * i * (track === 0 ? 1 : -1)
  const noise = 0.0015 * i
  execFileSync(FFMPEG, [
    '-loglevel',
    'error',
    '-y',
    '-i',
    src,
    '-filter_complex',
    `[0:a]adelay=${shift}:all=1,volume=${gain.toFixed(3)}[v];anoisesrc=c=pink:a=${noise}:r=16000:d=600[n];[v][n]amix=inputs=2:duration=first:normalize=0[o]`,
    '-map',
    '[o]',
    '-ar',
    '16000',
    '-ac',
    '1',
    out,
  ])
}

async function transcriptOf(c: EvalCase, model: string, i: number): Promise<Transcript> {
  const transcribeTrack = whisperTranscriber({
    bin: findWhisper(WHISPER_OPTS),
    ffmpeg: FFMPEG,
    model: await ensureModel(model, config.TACET_MODELS_DIR),
    language: c.language,
    env: process.env,
  })
  const dir = mkdtempSync(join(tmpdir(), 'tacet-conf-'))
  const tracks = c.tracks.map((t, k) => {
    const path = join(dir, `${k}.wav`)
    if (i === 0) return { path: join(c.dir, t.file), speaker: t.speaker }
    variant(join(c.dir, t.file), path, i, k)
    return { path, speaker: t.speaker }
  })
  const transcript = await transcribe(tracks, transcribeTrack, model)
  rmSync(dir, { recursive: true, force: true })
  return transcript
}

if ((await ollamaModels(config.OLLAMA_HOST)) === undefined)
  throw new Error(`Ollama is not running at ${config.OLLAMA_HOST}.`)

const runs: ReliabilityRun[] = []
const generate = ollamaMinutes({ host: config.OLLAMA_HOST, model: values.llm })
const only = values.caso
for (const c of loadCases(join(import.meta.dirname, 'cases')).filter(
  (x) => only === undefined || x.id === only,
)) {
  for (const model of values.whisper.split(',')) {
    log(`> ${c.id}: whisper ${model}`)
    for (let i = 0; i < TIMES; i++) {
      const transcript = await transcriptOf(c, model, i)
      const t0 = performance.now()
      // A request that never comes back (the model looping) is a run with nothing in it, counted
      // as such: the point is how often the minutes come out, not hiding the ones that do not.
      const result = await generateMinutes(transcript, { generate, model: values.llm }).catch(
        (e: unknown) => {
          log(`    failed: ${e instanceof Error ? e.message : String(e)}`)
          return undefined
        },
      )
      if (result === undefined) {
        runs.push({
          caseId: c.id,
          whisper: model,
          summary: 0,
          decisions: 0,
          expectsDecisions: c.expects_decisions,
          tasksFound: 0,
          tasksTotal: c.expected_actions.length,
          dueRight: 0,
          dueTotal: c.expected_due.length,
          dueWrong: 0,
          seconds: (performance.now() - t0) / 1000,
        })
        continue
      }
      const { minutes } = result
      const grounding = checkGrounding(minutes, transcript, c.expected_actions)
      const deadlines = checkDeadlines(minutes, c.expected_due)
      runs.push({
        caseId: c.id,
        whisper: model,
        summary: minutes.summary.length,
        decisions: minutes.decisions.length,
        expectsDecisions: c.expects_decisions,
        tasksFound: grounding.expectedFound,
        tasksTotal: grounding.expectedTotal,
        dueRight: deadlines.right,
        dueTotal: deadlines.total,
        dueWrong: deadlines.wrong.length,
        seconds: (performance.now() - t0) / 1000,
      })
      log(`    ${((performance.now() - t0) / 1000).toFixed(0)}s`)
      for (const w of deadlines.wrong) log(`    wrong deadline: ${w}`)
      log(
        `  ${i + 1}/${TIMES}: summary ${minutes.summary.length}, decisions ${minutes.decisions.length}, tasks ${grounding.expectedFound}/${grounding.expectedTotal}, deadlines ${deadlines.right}/${deadlines.total}`,
      )
    }
  }
}
console.log(reliabilityMarkdown(reliability(runs), values.llm, TIMES))
