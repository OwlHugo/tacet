import { randomUUID } from 'node:crypto';
import { generateMinutes, type MinutesOptions } from './minutes.js';
import { ollamaAvailable } from './ollama.js';
import { MeetingStore } from './store.js';
import { transcribe, type Track, type TranscribeOptions } from './transcribe.js';
import type { Meeting } from './types.js';

export type Stage = 'transcribing' | 'minutes' | 'saving' | 'done';

export interface ProcessOptions {
  tracks: Track[];
  title?: string;
  date?: Date;
  id?: string;
  /** Folder to write the Markdown into. Without it nothing is written. */
  outputDir?: string;
  transcribe?: TranscribeOptions;
  /** false skips the LLM step. */
  minutes?: MinutesOptions | false;
  onStage?: (stage: Stage, detail?: string) => void;
}

export interface ProcessResult {
  meeting: Meeting;
  markdownPath?: string;
  warnings: string[];
}

export async function processMeeting(opts: ProcessOptions): Promise<ProcessResult> {
  const warnings: string[] = [];
  const date = opts.date ?? new Date();
  opts.onStage?.('transcribing');
  const t0 = performance.now();
  const transcript = await transcribe(opts.tracks, opts.transcribe);
  const transcribeSeconds = (performance.now() - t0) / 1000;

  const meeting: Meeting = {
    id: opts.id ?? randomUUID(),
    title: opts.title ?? `Meeting ${date.toISOString().slice(0, 16).replace('T', ' ')}`,
    date: date.toISOString(),
    transcript,
    timings: { transcribeSeconds },
  };

  if (opts.minutes !== false) {
    const host = opts.minutes?.host;
    if (!transcript.segments.length) {
      warnings.push('No speech detected, skipped minutes.');
    } else if (opts.minutes?.generate || (await ollamaAvailable(host))) {
      opts.onStage?.('minutes', opts.minutes?.model);
      const t1 = performance.now();
      meeting.minutes = (await generateMinutes(transcript, opts.minutes ?? {})).minutes;
      meeting.timings.minutesSeconds = (performance.now() - t1) / 1000;
    } else {
      warnings.push('Ollama is not running on this machine, saved the transcript without minutes. Start it with `ollama serve`.');
    }
  }

  let markdownPath: string | undefined;
  if (opts.outputDir) {
    opts.onStage?.('saving');
    markdownPath = new MeetingStore(opts.outputDir).save(meeting);
  }
  opts.onStage?.('done');
  return { meeting, markdownPath, warnings };
}
