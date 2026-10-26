import { blockId, formatTimestamp } from '../transcript/timestamp.ts'
import type { Meeting } from './types.ts'

interface Cited {
  readonly segments: readonly [number, ...number[]]
  readonly at: number
}

const link = (c: Cited) => `[[#^${blockId(c.segments[0])}|${formatTimestamp(c.at)}]]`

function section(title: string, items: readonly string[], empty: string): string[] {
  return [`## ${title}`, '', ...(items.length > 0 ? items : [empty]), '']
}

const PLAIN_ID = /^[A-Za-z0-9_-]+$/

/** Plain ids are written as is; anything else as a JSON string, so YAML and the reader agree. */
const frontmatterId = (id: string) => (PLAIN_ID.test(id) ? id : JSON.stringify(id))

/** The id from a `tacet_id:` value, or undefined for anything that is not one Tacet wrote. */
function readId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (PLAIN_ID.test(value)) return value
  const quoted = /^"(?:[^"\\]|\\.)*"$/.test(value) ? value : undefined
  if (quoted === undefined) return undefined
  try {
    const id: unknown = JSON.parse(quoted)
    return typeof id === 'string' && id !== '' ? id : undefined
  } catch {
    return undefined
  }
}

/**
 * Who a note was written for, from its own frontmatter (the block between the first two `---`
 * lines): `{ id }` for current notes, `{ date }` for notes Tacet wrote before notes carried their id
 * (`tacet: 1` plus the meeting's exact ISO date). Undefined for anything else, including notes
 * written by hand. Never throws, whatever the file contains.
 */
export function noteOwner(
  markdown: string,
): { readonly id: string } | { readonly date: string } | undefined {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1]
  if (front === undefined) return undefined
  const id = readId(/^tacet_id: (.+?)\r?$/m.exec(front)?.[1])
  if (id !== undefined) return { id }
  const date = /^date: (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\r?$/m.exec(front)?.[1]
  return date !== undefined && /^tacet: 1\r?$/m.test(front) ? { date } : undefined
}

/** Obsidian Markdown: YAML frontmatter, a block id on every transcript line, timestamps linking to them. */
export function toMarkdown(m: Meeting): string {
  const front = [
    '---',
    `title: ${JSON.stringify(m.title)}`,
    `date: ${m.date}`,
    `duration: ${JSON.stringify(formatTimestamp(m.transcript.duration))}`,
    `language: ${m.transcript.language}`,
    `whisper_model: ${m.transcript.model}`,
    ...(m.minutes ? [`llm: ${m.minutes.model}`] : []),
    'tags: [meeting, tacet]',
    'tacet: 1',
    `tacet_id: ${frontmatterId(m.id)}`,
    '---',
    '',
    `# ${m.title}`,
    '',
  ]
  const minutes = m.minutes
    ? [
        ...section(
          'Summary',
          m.minutes.summary.map((p) => `- ${p.text} ${link(p)}`),
          '_The local model wrote no summary for this meeting. The transcript below is complete._',
        ),
        ...section(
          'Decisions',
          m.minutes.decisions.map((d) => `- ${d.text} ${link(d)}`),
          '_The local model found no decisions. The transcript below is complete._',
        ),
        ...section(
          'Action items',
          m.minutes.actionItems.map(
            (a) => `- [ ] ${a.task} (**${a.owner}**${a.due ? `, ${a.due}` : ''}) ${link(a)}`,
          ),
          '_The local model found no action items. The transcript below is complete._',
        ),
      ]
    : []
  const transcript = m.transcript.segments.flatMap((s) => [
    `**${formatTimestamp(s.start)} ${s.speaker}:** ${s.text} ^${blockId(s.id)}`,
    '',
  ])
  return [...front, ...minutes, '## Transcript', '', ...transcript].join('\n')
}
