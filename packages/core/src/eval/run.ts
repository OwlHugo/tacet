import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateMinutes, groundMinutes, type RawMinutes } from '../minutes.js';
import { ollamaAvailable } from '../ollama.js';
import { transcribe } from '../transcribe.js';
import type { Speaker, Transcript } from '../types.js';
import { checkGrounding, type GroundingReport } from './grounding.js';
import { wer } from './wer.js';

export interface EvalCase {
  id: string;
  title: string;
  language: string;
  tracks: { file: string; speaker: Speaker }[];
  /** The script that was spoken, in order. */
  reference: { speaker: Speaker; text: string }[];
  /** Each expected action item as a list of keywords that must appear in the task or its quote. */
  expected_actions: string[][];
}

export interface CaseResult {
  id: string;
  audioSeconds: number;
  wer: number;
  werBySpeaker: Record<string, number>;
  speakerAccuracy: number;
  transcribeSecondsPerAudioMinute: number;
  minutes?: {
    mode: 'live' | 'replay';
    model: string;
    secondsPerAudioMinute?: number;
    grounding: GroundingReport;
    rejectedByGuard: number;
  };
  hallucinationGuard: { injected: number; rejected: number };
}

export interface EvalReport {
  date: string;
  platform: string;
  whisperModel: string;
  llmModel?: string;
  cases: CaseResult[];
  totals: {
    audioSeconds: number;
    wer: number;
    transcribeSecondsPerAudioMinute: number;
    minutesSecondsPerAudioMinute?: number;
    actionItems: number;
    actionItemsGrounded: number;
    expectedActionRecall?: number;
    hallucinationsInjected: number;
    hallucinationsRejected: number;
  };
}

export interface EvalOptions {
  dataset: string;
  whisperModel?: string;
  llmModel?: string;
  /** live: call Ollama, replay: use the recorded LLM output, auto: live if Ollama is up. */
  llm?: 'live' | 'replay' | 'auto' | 'off';
  /** Save transcripts and raw LLM output as replay fixtures. */
  record?: boolean;
  bundledDirs?: string[];
  onLog?: (line: string) => void;
}

/** Fabricated items the guard must reject. They cite real segment ids but are not in the transcript. */
export const INJECTED_HALLUCINATIONS: RawMinutes = {
  summary: [{ text: 'The team approved a budget increase for the marketing department.', segments: [0] }],
  decisions: [{ text: 'Move the office to Lisbon.', quote: 'we will move the office to Lisbon next quarter', segments: [0] }],
  action_items: [
    { task: 'Book flights for the offsite in Tokyo', owner: 'Others', quote: 'please book the flights to Tokyo', segments: [1] },
    { task: 'Renegotiate the cloud contract with the vendor', owner: 'Me', quote: 'renegotiate the cloud vendor contract', segments: [0] },
  ],
};

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export async function runEval(opts: EvalOptions): Promise<EvalReport> {
  const whisperModel = opts.whisperModel ?? 'base';
  const llmModel = opts.llmModel ?? 'qwen2.5:7b';
  const log = opts.onLog ?? (() => {});
  let llmMode = opts.llm ?? 'auto';
  if (llmMode === 'auto') llmMode = (await ollamaAvailable()) ? 'live' : 'replay';
  if (llmMode === 'live' && !(await ollamaAvailable())) throw new Error('--llm live needs Ollama running on this machine');

  const dirs = readdirSync(opts.dataset, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(opts.dataset, d.name, 'case.json')))
    .map((d) => join(opts.dataset, d.name))
    .sort();

  const cases: CaseResult[] = [];
  for (const dir of dirs) {
    const c = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8')) as EvalCase;
    log(`> ${c.id}: transcribing (${whisperModel})`);
    const t0 = performance.now();
    const transcript = await transcribe(
      c.tracks.map((t) => ({ path: join(dir, t.file), speaker: t.speaker })),
      { model: whisperModel, language: c.language, bundledDirs: opts.bundledDirs },
    );
    const tSec = (performance.now() - t0) / 1000;
    const audioSeconds = transcript.duration;
    const hyp = transcript.segments.map((s) => s.text).join(' ');
    const ref = c.reference.map((r) => r.text).join(' ');
    const werBySpeaker: Record<string, number> = {};
    for (const sp of new Set(c.reference.map((r) => r.speaker))) {
      werBySpeaker[sp] = round(
        wer(
          c.reference.filter((r) => r.speaker === sp).map((r) => r.text).join(' '),
          transcript.segments.filter((s) => s.speaker === sp).map((s) => s.text).join(' '),
        ).wer,
      );
    }
    const speakerAccuracy = speakerAttributionAccuracy(c, transcript);

    const result: CaseResult = {
      id: c.id,
      audioSeconds: round(audioSeconds, 1),
      wer: round(wer(ref, hyp).wer),
      werBySpeaker,
      speakerAccuracy: round(speakerAccuracy),
      transcribeSecondsPerAudioMinute: round(tSec / (audioSeconds / 60), 2),
      hallucinationGuard: { injected: 0, rejected: 0 },
    };

    const transcriptFixture = join(dir, 'replay.transcript.json');
    const llmFixture = join(dir, 'replay.llm.json');
    if (opts.record) writeFileSync(transcriptFixture, JSON.stringify(transcript, null, 2));

    if (llmMode !== 'off') {
      let raw: RawMinutes | undefined;
      let grounded: Transcript = transcript;
      let mSec: number | undefined;
      if (llmMode === 'live') {
        log(`> ${c.id}: minutes (${llmModel})`);
        const t1 = performance.now();
        const out = await generateMinutes(transcript, { model: llmModel });
        mSec = (performance.now() - t1) / 1000;
        raw = out.raw;
        if (opts.record) writeFileSync(llmFixture, JSON.stringify({ model: llmModel, raw }, null, 2));
      } else if (existsSync(llmFixture) && existsSync(transcriptFixture)) {
        raw = (JSON.parse(readFileSync(llmFixture, 'utf8')) as { raw: RawMinutes }).raw;
        grounded = JSON.parse(readFileSync(transcriptFixture, 'utf8')) as Transcript;
      }
      if (raw) {
        const fixtureModel = llmMode === 'replay' ? (JSON.parse(readFileSync(llmFixture, 'utf8')) as { model: string }).model : llmModel;
        const minutes = groundMinutes(raw, grounded, fixtureModel);
        const grounding = checkGrounding(minutes, grounded, c.expected_actions);
        result.minutes = {
          mode: llmMode,
          model: fixtureModel,
          secondsPerAudioMinute: mSec === undefined ? undefined : round(mSec / (audioSeconds / 60), 2),
          grounding,
          rejectedByGuard: minutes.rejected.length,
        };
        const guard = guardCheck(raw, grounded);
        result.hallucinationGuard = guard;
      }
    }
    if (!result.minutes) result.hallucinationGuard = guardCheck({ summary: [], decisions: [], action_items: [] }, transcript);
    cases.push(result);
    log(`  WER ${(result.wer * 100).toFixed(1)}%, ${result.transcribeSecondsPerAudioMinute}s per audio minute`);
  }

  const audio = cases.reduce((a, c) => a + c.audioSeconds, 0);
  const weighted = (f: (c: CaseResult) => number | undefined) => {
    const xs = cases.filter((c) => f(c) !== undefined);
    const secs = xs.reduce((a, c) => a + c.audioSeconds, 0);
    return xs.length ? round(xs.reduce((a, c) => a + (f(c) ?? 0) * c.audioSeconds, 0) / secs, 3) : undefined;
  };
  const withMinutes = cases.filter((c) => c.minutes);
  const expTotal = withMinutes.reduce((a, c) => a + (c.minutes?.grounding.expectedTotal ?? 0), 0);
  const report: EvalReport = {
    date: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    whisperModel,
    llmModel: withMinutes[0]?.minutes?.model,
    cases,
    totals: {
      audioSeconds: round(audio, 1),
      wer: weighted((c) => c.wer) ?? 0,
      transcribeSecondsPerAudioMinute: weighted((c) => c.transcribeSecondsPerAudioMinute) ?? 0,
      minutesSecondsPerAudioMinute: weighted((c) => c.minutes?.secondsPerAudioMinute),
      actionItems: withMinutes.reduce((a, c) => a + c.minutes!.grounding.items, 0),
      actionItemsGrounded: withMinutes.reduce((a, c) => a + c.minutes!.grounding.grounded, 0),
      expectedActionRecall: expTotal ? round(withMinutes.reduce((a, c) => a + c.minutes!.grounding.expectedFound, 0) / expTotal) : undefined,
      hallucinationsInjected: cases.reduce((a, c) => a + c.hallucinationGuard.injected, 0),
      hallucinationsRejected: cases.reduce((a, c) => a + c.hallucinationGuard.rejected, 0),
    },
  };
  return report;
}

/** Add fabricated items to the model output and count how many the grounding guard throws away. */
function guardCheck(raw: RawMinutes, transcript: Transcript): { injected: number; rejected: number } {
  const injected = INJECTED_HALLUCINATIONS.summary.length + INJECTED_HALLUCINATIONS.decisions.length + INJECTED_HALLUCINATIONS.action_items.length;
  const mixed: RawMinutes = {
    summary: [...raw.summary, ...INJECTED_HALLUCINATIONS.summary],
    decisions: [...raw.decisions, ...INJECTED_HALLUCINATIONS.decisions],
    action_items: [...raw.action_items, ...INJECTED_HALLUCINATIONS.action_items],
  };
  const m = groundMinutes(mixed, transcript, 'guard');
  const fake = (t: string) =>
    [...INJECTED_HALLUCINATIONS.summary.map((x) => x.text), ...INJECTED_HALLUCINATIONS.decisions.map((x) => x.text), ...INJECTED_HALLUCINATIONS.action_items.map((x) => x.task)].includes(t);
  const survived = [...m.summary.map((x) => x.text), ...m.decisions.map((x) => x.text), ...m.actionItems.map((x) => x.task)].filter(fake).length;
  return { injected, rejected: injected - survived };
}

/** Share of reference lines whose words land mostly in segments of the right speaker. */
function speakerAttributionAccuracy(c: EvalCase, t: Transcript): number {
  if (!c.reference.length) return 1;
  let ok = 0;
  for (const line of c.reference) {
    const own = t.segments.filter((s) => s.speaker === line.speaker).map((s) => s.text).join(' ');
    const other = t.segments.filter((s) => s.speaker !== line.speaker).map((s) => s.text).join(' ');
    const a = 1 - wer(line.text, own).wer;
    const ownHit = wordHit(line.text, own);
    const otherHit = wordHit(line.text, other);
    if (ownHit >= otherHit && (ownHit > 0.5 || a > 0)) ok++;
  }
  return ok / c.reference.length;
}

function wordHit(needle: string, hay: string): number {
  const n = needle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z]{3,}/g) ?? [];
  const h = new Set(hay.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z]{3,}/g) ?? []);
  return n.length ? n.filter((w) => h.has(w)).length / n.length : 0;
}

export function reportToMarkdown(r: EvalReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `| Case | Audio | WER | Speaker attribution | Transcribe (s / audio min) | Minutes (s / audio min) | Grounded items | Expected tasks found |`,
    `|---|---|---|---|---|---|---|---|`,
  ];
  for (const c of r.cases) {
    const g = c.minutes?.grounding;
    lines.push(
      `| ${c.id} | ${c.audioSeconds}s | ${pct(c.wer)} | ${pct(c.speakerAccuracy)} | ${c.transcribeSecondsPerAudioMinute} | ${c.minutes?.secondsPerAudioMinute ?? '–'} | ${g ? `${g.grounded}/${g.items}` : '–'} | ${g ? `${g.expectedFound}/${g.expectedTotal}` : '–'} |`,
    );
  }
  const t = r.totals;
  lines.push(
    `| **Total** | ${t.audioSeconds}s | ${pct(t.wer)} | | ${t.transcribeSecondsPerAudioMinute} | ${t.minutesSecondsPerAudioMinute ?? '–'} | ${t.actionItemsGrounded}/${t.actionItems} | ${t.expectedActionRecall === undefined ? '–' : pct(t.expectedActionRecall)} |`,
  );
  lines.push('', `Hallucination guard: ${t.hallucinationsRejected}/${t.hallucinationsInjected} fabricated items rejected.`);
  lines.push(`Platform ${r.platform}, whisper \`${r.whisperModel}\`${r.llmModel ? `, LLM \`${r.llmModel}\`` : ''}.`);
  return lines.join('\n');
}
