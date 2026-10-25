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
  const id = /^tacet_id: ([A-Za-z0-9_-]{1,64})\r?$/m.exec(front)?.[1]
  if (id !== undefined) return { id }
  const date = /^date: (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)\r?$/m.exec(front)?.[1]
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
    `tacet_id: ${m.id}`,
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
          '_Nothing to summarize._',
        ),
        ...section(
          'Decisions',
          m.minutes.decisions.map((d) => `- ${d.text} ${link(d)}`),
          '_No decisions found in the transcript._',
        ),
        ...section(
          'Action items',
          m.minutes.actionItems.map((a) => `- [ ] ${a.task} (**${a.owner}**) ${link(a)}`),
          '_No action items found in the transcript._',
        ),
      ]
    : []
  const transcript = m.transcript.segments.flatMap((s) => [
    `**${formatTimestamp(s.start)} ${s.speaker}:** ${s.text} ^${blockId(s.id)}`,
    '',
  ])
  return [...front, ...minutes, '## Transcript', '', ...transcript].join('\n')
}
