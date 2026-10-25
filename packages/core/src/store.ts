import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toMarkdown } from './markdown.js';
import { formatTimestamp } from './time.js';
import type { Meeting } from './types.js';

/**
 * A library is just a folder (point it at an Obsidian vault subfolder). Each meeting is
 *   <folder>/<date> <title>.md        human readable, Obsidian compatible
 *   <folder>/.tacet/<id>.json          structured data used by the app for search
 *   <folder>/.tacet/audio/<id>/        the raw tracks (optional, deletable)
 */
export class MeetingStore {
  constructor(readonly folder: string) {}

  private get dataDir() {
    return join(this.folder, '.tacet');
  }

  audioDir(id: string): string {
    const dir = join(this.dataDir, 'audio', id);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  markdownPath(m: Pick<Meeting, 'date' | 'title'>): string {
    const d = new Date(m.date);
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
    const safe = m.title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    return join(this.folder, `${stamp} ${safe}.md`);
  }

  save(m: Meeting): string {
    mkdirSync(this.dataDir, { recursive: true });
    const jsonPath = join(this.dataDir, `${m.id}.json`);
    const previous = this.get(m.id);
    if (previous) {
      const oldMd = this.markdownPath(previous);
      const newMd = this.markdownPath(m);
      if (oldMd !== newMd && existsSync(oldMd)) renameSync(oldMd, newMd);
    }
    writeFileSync(jsonPath, JSON.stringify(m, null, 2));
    const md = this.markdownPath(m);
    writeFileSync(md, toMarkdown(m));
    return md;
  }

  get(id: string): Meeting | undefined {
    const p = join(this.dataDir, `${id}.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Meeting) : undefined;
  }

  list(): Meeting[] {
    if (!existsSync(this.dataDir)) return [];
    return readdirSync(this.dataDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(this.dataDir, f), 'utf8')) as Meeting)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  search(query: string): SearchHit[] {
    return searchMeetings(this.list(), query);
  }
}

export interface SearchHit {
  meetingId: string;
  title: string;
  date: string;
  where: 'title' | 'summary' | 'decision' | 'action' | 'transcript';
  text: string;
  at: number;
  timestamp: string;
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Case and accent insensitive search; every term must appear in the hit. */
export function searchMeetings(meetings: Meeting[], query: string, limit = 200): SearchHit[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const match = (s: string) => {
    const f = fold(s);
    return terms.every((t) => f.includes(t));
  };
  const hits: SearchHit[] = [];
  const push = (m: Meeting, where: SearchHit['where'], text: string, at: number) =>
    hits.push({ meetingId: m.id, title: m.title, date: m.date, where, text, at, timestamp: formatTimestamp(at) });
  for (const m of meetings) {
    if (match(m.title)) push(m, 'title', m.title, 0);
    for (const p of m.minutes?.summary ?? []) if (match(p.text)) push(m, 'summary', p.text, p.at);
    for (const d of m.minutes?.decisions ?? []) if (match(d.text)) push(m, 'decision', d.text, d.at);
    for (const a of m.minutes?.actionItems ?? []) if (match(`${a.task} ${a.owner}`)) push(m, 'action', `${a.task} (${a.owner})`, a.at);
    for (const s of m.transcript.segments) if (match(s.text)) push(m, 'transcript', `${s.speaker}: ${s.text}`, s.start);
  }
  return hits.slice(0, limit);
}
