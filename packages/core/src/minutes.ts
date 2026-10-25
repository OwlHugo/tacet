import { ollamaJson, type OllamaOptions } from './ollama.js';
import { coverage, normalize, similarity, words } from './text.js';
import { formatTimestamp } from './time.js';
import type { ActionItem, Decision, Minutes, RejectedItem, Segment, SummaryPoint, Transcript } from './types.js';

/** Raw shape the LLM is asked to produce. Segment ids are the only thing that ties an item to the transcript. */
export interface RawMinutes {
  summary: { text: string; segments: number[] }[];
  decisions: { text: string; quote: string; segments: number[] }[];
  action_items: { task: string; owner: string; quote: string; segments: number[] }[];
}

const ids = { type: 'array', items: { type: 'integer' } };
export const MINUTES_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'array',
      items: { type: 'object', properties: { text: { type: 'string' }, segments: ids }, required: ['text', 'segments'] },
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, quote: { type: 'string' }, segments: ids },
        required: ['text', 'quote', 'segments'],
      },
    },
    action_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { task: { type: 'string' }, owner: { type: 'string' }, quote: { type: 'string' }, segments: ids },
        required: ['task', 'owner', 'quote', 'segments'],
      },
    },
  },
  required: ['summary', 'decisions', 'action_items'],
} as const;

export const SYSTEM_PROMPT = `You write meeting minutes from a transcript. Every line of the transcript looks like
[ID] mm:ss SPEAKER: text
"Me" is the person who recorded the meeting, "Others" is everyone heard through the computer.

Rules:
- Use only what is said in the transcript. Never add facts, names, dates or tasks that are not there.
- Every item must list the IDs of the transcript lines it comes from in "segments".
- "quote" must be copied word for word from one of those lines.
- summary: 2 to 5 short points about what was discussed.
- decisions: only things the participants explicitly agreed or decided. Empty list if none.
- action_items: only concrete tasks someone committed to or was asked to do. "owner" is the person's name if it was said,
  otherwise "Me" or "Others" based on who committed. Empty list if none.
- "Me" and "Others" are track labels, not names. In summary and decisions write neutrally ("the team", "it was agreed"), never "Me did".
- Write every field in the language of the transcript. Be brief.`;

const LANGUAGES: Record<string, string> = { en: 'English', pt: 'Portuguese', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian' };

export function languageInstruction(code: string): string {
  const name = LANGUAGES[code];
  return name ? `\nThe transcript is in ${name}. Write the summary, decisions and tasks in ${name}.` : '';
}

export function renderTranscriptForPrompt(segments: Segment[]): string {
  return segments.map((s) => `[${s.id}] ${formatTimestamp(s.start)} ${s.speaker}: ${s.text}`).join('\n');
}

/** Split long meetings so each request fits comfortably in a small local model's context. */
export function chunkSegments(segments: Segment[], maxChars = 9000): Segment[][] {
  const chunks: Segment[][] = [];
  let cur: Segment[] = [];
  let size = 0;
  for (const s of segments) {
    const len = s.text.length + 20;
    if (cur.length && size + len > maxChars) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(s);
    size += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export interface GroundingOptions {
  /** Minimum share of the quote's content words found in the cited lines. */
  quoteThreshold?: number;
  /** Minimum share of a summary point's content words found in the cited lines. */
  summaryThreshold?: number;
}

interface Anchor {
  segments: number[];
  score: number;
}

/** Find the transcript lines that support `text`: the cited ones (with neighbours) first, then anywhere. */
function anchor(text: string, cited: number[], byId: Map<number, Segment>, all: Segment[], threshold: number): Anchor | undefined {
  const valid = [...new Set(cited)].filter((id) => byId.has(id)).sort((a, b) => a - b);
  const windowOf = (list: number[]) => list.map((id) => byId.get(id)?.text ?? '').join(' ');
  if (valid.length) {
    const score = coverage(text, windowOf(valid));
    if (score >= threshold) return { segments: valid, score };
    const widened = [...new Set(valid.flatMap((id) => [id - 1, id, id + 1]))].filter((id) => byId.has(id));
    const wScore = coverage(text, windowOf(widened));
    if (wScore >= threshold) return { segments: narrow(text, widened, byId), score: wScore };
  }
  // Re-anchor: the model cited the wrong line but the words exist somewhere in the transcript.
  let best: Anchor | undefined;
  // Single lines first, so a pair only wins when it supports the text strictly better.
  for (const size of [1, 2]) {
    for (let i = 0; i + size <= all.length; i++) {
      const segs = all.slice(i, i + size);
      const score = coverage(text, segs.map((s) => s.text).join(' '));
      if (score >= threshold && (!best || score > best.score + 1e-9)) best = { segments: segs.map((s) => s.id), score };
    }
  }
  return best;
}

function narrow(text: string, list: number[], byId: Map<number, Segment>): number[] {
  const scored = list.map((id) => ({ id, score: coverage(text, byId.get(id)?.text ?? '') })).filter((x) => x.score > 0);
  return scored.length ? scored.sort((a, b) => b.score - a.score || a.id - b.id).slice(0, 2).map((x) => x.id).sort((a, b) => a - b) : list;
}

function knownOwner(owner: string, transcriptText: string): string {
  const o = owner.trim();
  if (!o) return 'Unassigned';
  const n = normalize(o);
  if (['me', 'eu', 'i'].includes(n)) return 'Me';
  if (['others', 'outros', 'them'].includes(n)) return 'Others';
  if (['unassigned', 'unknown', 'none', 'n a', 'ninguem'].includes(n)) return 'Unassigned';
  const ownerWords = words(o);
  const hay = new Set(words(transcriptText));
  return ownerWords.length && ownerWords.every((w) => hay.has(w)) ? o : 'Unassigned';
}

/**
 * The core guarantee of Tacet: drop everything the model said that cannot be traced to the transcript,
 * and replace model-provided timestamps with the real start time of the cited line.
 */
export function groundMinutes(raw: RawMinutes, transcript: Transcript, model: string, opts: GroundingOptions = {}): Minutes {
  const quoteT = opts.quoteThreshold ?? 0.6;
  const summaryT = opts.summaryThreshold ?? 0.3;
  const byId = new Map(transcript.segments.map((s) => [s.id, s]));
  const all = transcript.segments;
  const fullText = all.map((s) => s.text).join(' ');
  const at = (segs: number[]) => byId.get(segs[0] ?? -1)?.start ?? 0;
  const contextOf = (segs: number[]) =>
    [...new Set(segs.flatMap((id) => [id - 1, id, id + 1]))].map((id) => byId.get(id)?.text ?? '').join(' ');
  const rejected: RejectedItem[] = [];

  const summary: SummaryPoint[] = [];
  for (const p of raw.summary ?? []) {
    if (!p.text?.trim()) continue;
    const a = anchor(p.text, p.segments ?? [], byId, all, summaryT);
    if (!a) rejected.push({ kind: 'summary', text: p.text, reason: 'not supported by the cited lines' });
    else summary.push({ text: p.text.trim(), segments: a.segments, at: at(a.segments) });
  }

  const decisions: Decision[] = [];
  for (const d of raw.decisions ?? []) {
    if (!d.text?.trim()) continue;
    const a = anchor(d.quote || d.text, d.segments ?? [], byId, all, quoteT);
    if (!a) rejected.push({ kind: 'decision', text: d.text, reason: 'quote not found in the transcript' });
    else if (coverage(d.text, contextOf(a.segments)) < 0.3)
      rejected.push({ kind: 'decision', text: d.text, reason: 'decision wording is not supported by its source line' });
    else if (decisions.some((x) => similarity(x.text, d.text) > 0.7)) continue;
    else decisions.push({ text: d.text.trim(), quote: d.quote?.trim() ?? '', segments: a.segments, at: at(a.segments) });
  }

  const actionItems: ActionItem[] = [];
  for (const t of raw.action_items ?? []) {
    if (!t.task?.trim()) continue;
    const a = anchor(t.quote || t.task, t.segments ?? [], byId, all, quoteT);
    if (!a) {
      rejected.push({ kind: 'action', text: t.task, reason: 'quote not found in the transcript' });
      continue;
    }
    const source = a.segments.map((id) => byId.get(id)?.text ?? '').join(' ');
    if (coverage(t.task, contextOf(a.segments)) < 0.3) {
      rejected.push({ kind: 'action', text: t.task, reason: 'task wording is not supported by its source line' });
      continue;
    }
    if (actionItems.some((x) => similarity(x.task, t.task) > 0.7)) continue;
    let owner = knownOwner(t.owner ?? '', fullText);
    if (owner === 'Unassigned' && /\b(i ll|i will|i can|vou|eu)\b/.test(normalize(source))) owner = byId.get(a.segments[0] ?? -1)?.speaker ?? owner;
    actionItems.push({ task: t.task.trim(), owner, quote: t.quote?.trim() ?? '', segments: a.segments, at: at(a.segments) });
  }

  const byTime = <T extends { at: number }>(xs: T[]) => xs.sort((x, y) => x.at - y.at);
  return { summary, decisions: byTime(decisions), actionItems: byTime(actionItems), rejected, model };
}

export interface MinutesOptions extends Omit<OllamaOptions, 'model'> {
  model?: string;
  grounding?: GroundingOptions;
  /** Inject a different generator (tests, other local runtimes). */
  generate?: (system: string, user: string) => Promise<RawMinutes>;
}

export const DEFAULT_LLM = 'qwen2.5:7b';

export async function generateMinutes(transcript: Transcript, opts: MinutesOptions = {}): Promise<{ minutes: Minutes; raw: RawMinutes }> {
  const model = opts.model ?? DEFAULT_LLM;
  const generate =
    opts.generate ?? ((system: string, user: string) => ollamaJson<RawMinutes>(system, user, MINUTES_SCHEMA, { ...opts, model }));
  const raw: RawMinutes = { summary: [], decisions: [], action_items: [] };
  for (const chunk of chunkSegments(transcript.segments)) {
    if (!chunk.length) continue;
    const part = await generate(SYSTEM_PROMPT + languageInstruction(transcript.language), `Transcript:\n${renderTranscriptForPrompt(chunk)}`);
    raw.summary.push(...(part.summary ?? []));
    raw.decisions.push(...(part.decisions ?? []));
    raw.action_items.push(...(part.action_items ?? []));
  }
  return { minutes: groundMinutes(raw, transcript, model, opts.grounding), raw };
}
