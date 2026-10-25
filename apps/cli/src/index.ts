#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  DEFAULT_LLM,
  MeetingStore,
  modelPath,
  ollamaAvailable,
  ollamaModels,
  processMeeting,
  reportToMarkdown,
  resolveWhisperBinary,
  runEval,
  toMarkdown,
} from '@tacet/core';
import { parseTracks } from './args.js';

const VERSION = '0.1.0';
const DEFAULT_DIR = join(homedir(), 'Tacet');

const HELP = `tacet ${VERSION}  local meeting transcription, nothing leaves your machine

Usage
  tacet transcribe <audio...> [options]   transcribe and write minutes
  tacet search <query> [--dir DIR]        search saved meetings
  tacet list [--dir DIR]                  list saved meetings
  tacet eval [--dataset DIR]              run the eval set (WER, grounding, speed)
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
`;

function fail(msg: string): never {
  process.stderr.write(`tacet: ${msg}\n`);
  process.exit(1);
}

async function cmdTranscribe(argv: string[]) {
  const { values, positionals } = parseArgs({
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
  });
  const tracks = parseTracks(positionals, values.mic, values.system);
  if (!tracks.length) fail('no audio given. Try `tacet transcribe meeting.wav`.');
  for (const t of tracks) if (!existsSync(t.path)) fail(`file not found: ${t.path}`);
  const first = tracks[0]!;
  const title = values.title ?? basename(first.path, extname(first.path));
  const err = (s: string) => process.stderr.write(s);
  const { meeting, markdownPath, warnings } = await processMeeting({
    tracks: tracks.map((t) => ({ ...t, path: resolve(t.path) })),
    title,
    outputDir: values.out ? resolve(values.out) : undefined,
    transcribe: { model: values.model, language: values.language },
    minutes: values['no-minutes'] ? false : { model: values.llm },
    onStage: (stage, detail) => {
      if (stage === 'transcribing') err(`transcribing ${tracks.length} track(s) with whisper ${values.model}...\n`);
      if (stage === 'minutes') err(`writing minutes with ${detail}...\n`);
    },
  });
  for (const w of warnings) err(`warning: ${w}\n`);
  const audioMin = meeting.transcript.duration / 60 || 1;
  err(
    `done: ${meeting.transcript.segments.length} segments, ${meeting.transcript.duration.toFixed(1)}s of audio, ` +
      `transcribe ${(meeting.timings.transcribeSeconds / audioMin).toFixed(1)}s per audio minute` +
      (meeting.timings.minutesSeconds !== undefined ? `, minutes ${meeting.timings.minutesSeconds.toFixed(1)}s` : '') +
      (meeting.minutes?.rejected.length ? `, ${meeting.minutes.rejected.length} ungrounded item(s) dropped` : '') +
      '\n',
  );
  if (markdownPath) err(`saved ${markdownPath}\n`);
  if (values.json) process.stdout.write(JSON.stringify(meeting, null, 2) + '\n');
  else if (!markdownPath) process.stdout.write(toMarkdown(meeting) + '\n');
}

function cmdSearch(argv: string[]) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { dir: { type: 'string', default: DEFAULT_DIR } } });
  const q = positionals.join(' ');
  if (!q) fail('usage: tacet search <query>');
  const hits = new MeetingStore(resolve(values.dir)).search(q);
  if (!hits.length) return console.log('no matches');
  for (const h of hits) console.log(`${h.date.slice(0, 10)}  ${h.title}  ${h.timestamp}  [${h.where}]  ${h.text}`);
}

function cmdList(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { dir: { type: 'string', default: DEFAULT_DIR } } });
  const store = new MeetingStore(resolve(values.dir));
  const list = store.list();
  if (!list.length) return console.log(`no meetings in ${values.dir}`);
  for (const m of list)
    console.log(`${m.date.slice(0, 16).replace('T', ' ')}  ${m.title}  (${Math.round(m.transcript.duration / 60)} min, ${m.minutes?.actionItems.length ?? 0} tasks)`);
}

async function cmdEval(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dataset: { type: 'string', default: 'eval/dataset' },
      model: { type: 'string', short: 'm', default: 'base' },
      llm: { type: 'string', default: DEFAULT_LLM },
      mode: { type: 'string', default: 'auto' },
      record: { type: 'boolean', default: false },
      report: { type: 'string' },
      'max-wer': { type: 'string' },
    },
  });
  const mode = values.mode as 'live' | 'replay' | 'auto' | 'off';
  const report = await runEval({
    dataset: resolve(values.dataset),
    whisperModel: values.model,
    llmModel: values.llm,
    llm: mode,
    record: values.record,
    onLog: (l) => process.stderr.write(l + '\n'),
  });
  const md = reportToMarkdown(report);
  console.log(md);
  if (values.report) {
    writeFileSync(values.report, JSON.stringify(report, null, 2));
    writeFileSync(values.report.replace(/\.json$/, '') + '.md', md + '\n');
  }
  const t = report.totals;
  const problems: string[] = [];
  if (t.actionItemsGrounded !== t.actionItems) problems.push(`${t.actionItems - t.actionItemsGrounded} minutes item(s) without a source`);
  if (t.hallucinationsRejected !== t.hallucinationsInjected) problems.push('hallucination guard let a fabricated item through');
  if (values['max-wer'] && t.wer > Number(values['max-wer'])) problems.push(`WER ${t.wer} above ${values['max-wer']}`);
  if (problems.length) fail(`eval failed: ${problems.join('; ')}`);
}

async function cmdDoctor() {
  const row = (ok: boolean, label: string, detail: string) => console.log(`${ok ? 'ok ' : 'no '} ${label.padEnd(14)} ${detail}`);
  try {
    row(true, 'whisper.cpp', resolveWhisperBinary());
  } catch (e) {
    row(false, 'whisper.cpp', (e as Error).message);
  }
  for (const m of ['base', 'large-v3-turbo']) row(existsSync(modelPath(m)), `model ${m}`, modelPath(m));
  const up = await ollamaAvailable();
  row(up, 'ollama', up ? (await ollamaModels()).join(', ') || 'running, no models (try `ollama pull qwen2.5:7b`)' : 'not running, minutes disabled');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'transcribe':
      return cmdTranscribe(rest);
    case 'search':
      return cmdSearch(rest);
    case 'list':
      return cmdList(rest);
    case 'eval':
      return cmdEval(rest);
    case 'doctor':
      return cmdDoctor();
    case '-v':
    case '--version':
      return console.log(VERSION);
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      return process.stdout.write(HELP);
    default:
      if (existsSync(cmd)) return cmdTranscribe([cmd, ...rest]);
      fail(`unknown command "${cmd}". Run \`tacet --help\`.`);
  }
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
