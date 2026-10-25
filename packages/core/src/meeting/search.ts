import { formatTimestamp } from '../transcript/timestamp.ts'
import type { Meeting } from './types.ts'

export interface SearchHit {
  readonly meetingId: string
  readonly title: string
  readonly date: string
  readonly where: 'title' | 'summary' | 'decision' | 'action' | 'transcript'
  readonly text: string
  readonly at: number
  readonly timestamp: string
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

function hitsIn(m: Meeting, matches: (s: string) => boolean): SearchHit[] {
  const candidates: [SearchHit['where'], string, number][] = [
    ['title', m.title, 0],
    ...(m.minutes?.summary ?? []).map((p): [SearchHit['where'], string, number] => [
      'summary',
      p.text,
      p.at,
    ]),
    ...(m.minutes?.decisions ?? []).map((d): [SearchHit['where'], string, number] => [
      'decision',
      d.text,
      d.at,
    ]),
    ...(m.minutes?.actionItems ?? []).map((a): [SearchHit['where'], string, number] => [
      'action',
      `${a.task} (${a.owner})`,
      a.at,
    ]),
    ...m.transcript.segments.map((s): [SearchHit['where'], string, number] => [
      'transcript',
      `${s.speaker}: ${s.text}`,
      s.start,
    ]),
  ]
  return candidates
    .filter(([, text]) => matches(text))
    .map(([where, text, at]) => ({
      meetingId: m.id,
      title: m.title,
      date: m.date,
      where,
      text,
      at,
      timestamp: formatTimestamp(at),
    }))
}

/** Case and accent insensitive; every term must appear in the hit. */
export function searchMeetings(
  meetings: readonly Meeting[],
  query: string,
  limit = 200,
): SearchHit[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const matches = (s: string) => {
    const f = fold(s)
    return terms.every((t) => f.includes(t))
  }
  return meetings.flatMap((m) => hitsIn(m, matches)).slice(0, limit)
}
