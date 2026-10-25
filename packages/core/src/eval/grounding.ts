import { coverage, similarity } from '../text.js';
import type { Minutes, Transcript } from '../types.js';

export interface GroundingReport {
  items: number;
  grounded: number;
  ungrounded: { kind: string; text: string }[];
  /** Expected action items (by keywords) that the minutes found. */
  expectedFound: number;
  expectedTotal: number;
}

/**
 * Independent check, written separately from groundMinutes: an item is grounded only if it cites
 * real segments, its timestamp equals the start of the first cited segment, and its quote is in those segments.
 */
export function checkGrounding(minutes: Minutes, transcript: Transcript, expectedActions: string[][] = []): GroundingReport {
  const byId = new Map(transcript.segments.map((s) => [s.id, s]));
  const items = [
    ...minutes.decisions.map((d) => ({ kind: 'decision', text: d.text, quote: d.quote || d.text, segments: d.segments, at: d.at })),
    ...minutes.actionItems.map((a) => ({ kind: 'action', text: a.task, quote: a.quote || a.task, segments: a.segments, at: a.at })),
  ];
  const ungrounded: GroundingReport['ungrounded'] = [];
  for (const it of items) {
    const segs = it.segments.map((id) => byId.get(id));
    const ok =
      segs.length > 0 &&
      segs.every(Boolean) &&
      Math.abs((segs[0]?.start ?? -1) - it.at) < 0.001 &&
      coverage(it.quote, segs.map((s) => s?.text ?? '').join(' ')) >= 0.6;
    if (!ok) ungrounded.push({ kind: it.kind, text: it.text });
  }
  let expectedFound = 0;
  for (const keywords of expectedActions) {
    const hit = minutes.actionItems.some((a) => {
      const hay = `${a.task} ${a.quote}`;
      return keywords.every((k) => coverage(k, hay) === 1) || similarity(keywords.join(' '), hay) > 0.5;
    });
    if (hit) expectedFound++;
  }
  return { items: items.length, grounded: items.length - ungrounded.length, ungrounded, expectedFound, expectedTotal: expectedActions.length };
}
