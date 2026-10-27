/**
 * Eval of transcription and grounded minutes against evals/cases.
 *
 *   pnpm eval:sem-ia   replays the recorded whisper + LLM output (fixture.json). No binaries, runs in CI.
 *   pnpm eval          real whisper.cpp + real Ollama on this machine.
 *   pnpm eval:gravar   same as `pnpm eval`, and rewrites fixture.json. Commit it when the prompt changes.
 *   --so-whisper       real whisper.cpp, LLM output replayed (CI on macOS/Windows/Linux).
 *   --so-llm           transcript replayed, real Ollama: a prompt or model change, measured fast.
 *   --caso id          only that case.
 *
 * TACET_EVAL_CASES=<dir> reads the cases from another folder (cases that must stay off the repo).
 * A case with an `answer_key` is also scored for meaning: decisions and tasks that match the key
 * (precision, recall), items that match nothing (invented) and tasks with the wrong owner.
 *
 * Fails if any decision or task lacks a source, if an injected hallucination survives, or if WER
 * goes above --max-wer.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  ensureModel,
  findFfmpeg,
  findWhisper,
  generateMinutes,
  groundMinutes,
  ollamaMinutes,
  ollamaModels,
  type RawMinutes,
  type Transcript,
  transcribe,
  whisperTranscriber,
} from '@tacet/core'
import { type EvalCase, type Fixture, fixtureOf, fixturePath, loadCases } from './cases.ts'
import { config } from './config.ts'
import { guardCheck } from './guard.ts'
import { checkAnswerKey } from './metrics/answer-key.ts'
import { speakerAccuracy, timestampError } from './metrics/attribution.ts'
import { checkDeadlines } from './metrics/deadlines.ts'
import { checkGrounding } from './metrics/grounding.ts'
import { wer } from './metrics/wer.ts'
import { type CaseResult, failures, type Report, toMarkdown } from './report.ts'

const { values } = parseArgs({
  options: {
    'sem-ia': { type: 'boolean', default: false },
    'so-whisper': { type: 'boolean', default: false },
    'so-llm': { type: 'boolean', default: false },
    caso: { type: 'string' },
    gravar: { type: 'boolean', default: false },
    whisper: { type: 'string', default: 'base' },
    llm: { type: 'string', default: 'qwen2.5:7b' },
    'max-wer': { type: 'string' },
    relatorio: { type: 'string' },
  },
})
const MODE = values['sem-ia']
  ? 'sem-ia'
  : values['so-whisper']
    ? 'so-whisper'
    : values['so-llm']
      ? 'so-llm'
      : 'com-ia'
const USES_LLM = MODE === 'com-ia' || MODE === 'so-llm'
const log = (s: string) => process.stderr.write(`${s}\n`)

interface Run {
  readonly transcript: Transcript
  readonly raw: RawMinutes
  readonly transcribeSeconds: number | undefined
  readonly minutesSeconds: number | undefined
}

async function realTranscript(c: EvalCase): Promise<{ transcript: Transcript; seconds: number }> {
  log(`> ${c.id}: whisper ${values.whisper}`)
  const opts = {
    explicit: config.TACET_WHISPER_BIN,
    searchPath: config.PATH,
    platform: process.platform,
  }
  const transcribeTrack = whisperTranscriber({
    bin: findWhisper(opts),
    ffmpeg: findFfmpeg({ ...opts, explicit: undefined }),
    model: await ensureModel(values.whisper, config.TACET_MODELS_DIR),
    language: c.language,
    vocabulary: c.vocabulary,
    env: process.env,
  })
  const t0 = performance.now()
  const transcript = await transcribe(
    c.tracks.map((t) => ({ path: join(c.dir, t.file), speaker: t.speaker })),
    transcribeTrack,
    values.whisper,
  )
  return { transcript, seconds: (performance.now() - t0) / 1000 }
}

function recorded(c: EvalCase): Fixture {
  if (c.fixture === undefined)
    throw new Error(`${c.id} has no fixture.json yet: record it with \`pnpm eval:gravar\`.`)
  return c.fixture
}

async function runCase(c: EvalCase): Promise<Run> {
  if (MODE === 'sem-ia')
    return { ...recorded(c), transcribeSeconds: undefined, minutesSeconds: undefined }
  const { transcript, seconds } =
    MODE === 'so-llm'
      ? { transcript: recorded(c).transcript, seconds: undefined }
      : await realTranscript(c)
  if (MODE === 'so-whisper') {
    // The replayed LLM output cites the fixture's segments, so it is grounded against that transcript.
    return {
      transcript,
      raw: recorded(c).raw,
      transcribeSeconds: seconds,
      minutesSeconds: undefined,
    }
  }
  log(`> ${c.id}: minutes ${values.llm}`)
  const t0 = performance.now()
  const { raw } = await generateMinutes(transcript, {
    generate: ollamaMinutes({ host: config.OLLAMA_HOST, model: values.llm }),
    model: values.llm,
    self: c.self,
  })
  return {
    transcript,
    raw,
    transcribeSeconds: seconds,
    minutesSeconds: (performance.now() - t0) / 1000,
  }
}

function pooledWer(c: EvalCase, t: Transcript): number {
  const perTrack = [...new Set(c.reference.map((r) => r.speaker))].map((speaker) =>
    wer(
      c.reference
        .filter((r) => r.speaker === speaker)
        .map((r) => r.text)
        .join(' '),
      t.segments
        .filter((s) => s.speaker === speaker)
        .map((s) => s.text)
        .join(' '),
    ),
  )
  const words = perTrack.reduce((a, w) => a + w.referenceWords, 0)
  // Per track and pooled: cross-track ordering depends on timestamps, measured on its own.
  return words > 0 ? perTrack.reduce((a, w) => a + w.errors, 0) / words : 0
}

async function evaluate(c: EvalCase): Promise<CaseResult> {
  const run = await runCase(c)
  const minutesOn = MODE === 'so-whisper' ? recorded(c).transcript : run.transcript
  const minutes = groundMinutes(run.raw, minutesOn, USES_LLM ? values.llm : recorded(c).llmModel, {
    self: c.self,
  })
  const grounding = checkGrounding(minutes, minutesOn, c.expected_actions)
  const deadlines = checkDeadlines(minutes, c.expected_due)
  const perMinute = (s: number | undefined) =>
    s === undefined ? undefined : s / (run.transcript.duration / 60)
  const result: CaseResult = {
    id: c.id,
    audioSeconds: run.transcript.duration,
    wer: pooledWer(c, run.transcript),
    speakerAccuracy: c.tracks.length > 1 ? speakerAccuracy(c.reference, run.transcript) : undefined,
    timestampErrorSeconds: timestampError(c.reference, run.transcript),
    transcribeSecondsPerAudioMinute: perMinute(run.transcribeSeconds),
    minutesSecondsPerAudioMinute: perMinute(run.minutesSeconds),
    items: grounding.items,
    grounded: grounding.grounded,
    expectedFound: grounding.expectedFound,
    expectedTotal: grounding.expectedTotal,
    dueRight: deadlines.right,
    dueTotal: deadlines.total,
    dueWrong: deadlines.wrong,
    emptyParts: [
      ...(minutes.summary.length === 0 ? ['summary'] : []),
      ...(c.expects_decisions && minutes.decisions.length === 0 ? ['decisions'] : []),
    ],
    guard: guardCheck(run.raw, minutesOn),
    meaning: c.answer_key === undefined ? undefined : checkAnswerKey(minutes, c.answer_key),
  }
  if (values.gravar) {
    const whisper = MODE === 'so-llm' ? recorded(c).whisperModel : values.whisper
    writeFileSync(
      fixturePath(c.dir),
      `${JSON.stringify(fixtureOf(whisper, values.llm, run.transcript, run.raw), null, 2)}\n`,
    )
  }
  log(
    `  WER ${(result.wer * 100).toFixed(1)}%, ${grounding.grounded}/${grounding.items} grounded, ${deadlines.right}/${deadlines.total} deadlines`,
  )
  for (const item of result.meaning?.invented ?? []) log(`  not in the answer key: ${item}`)
  return result
}

if (USES_LLM && (await ollamaModels(config.OLLAMA_HOST)) === undefined) {
  throw new Error(
    `Ollama is not running at ${config.OLLAMA_HOST}. Start it, or use --sem-ia / --so-whisper.`,
  )
}
const only = values.caso
const cases = loadCases(config.TACET_EVAL_CASES).filter((c) => only === undefined || c.id === only)
if (cases.length === 0) throw new Error(`No eval case is called "${only}".`)
const results: CaseResult[] = []
for (const c of cases) results.push(await evaluate(c))
const first = cases[0]
const report: Report = {
  mode: MODE,
  platform: `${process.platform}-${process.arch}`,
  whisperModel:
    MODE === 'sem-ia' || MODE === 'so-llm'
      ? (first?.fixture?.whisperModel ?? values.whisper)
      : values.whisper,
  llmModel: USES_LLM ? values.llm : (first?.fixture?.llmModel ?? values.llm),
  cases: results,
}
const md = toMarkdown(report)
console.log(md)
if (values.relatorio) writeFileSync(values.relatorio, `${md}\n`)
const problems = failures(
  report,
  values['max-wer'] === undefined ? undefined : Number(values['max-wer']),
)
if (problems.length > 0) {
  for (const p of problems) console.error(`✗ ${p}`)
  process.exitCode = 1
}
