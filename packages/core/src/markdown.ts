import { blockId, formatTimestamp } from './time.js';
import type { Citation, Meeting } from './types.js';

const link = (c: Citation) => `[[#^${blockId(c.segments[0] ?? 0)}|${formatTimestamp(c.at)}]]`;

const yamlString = (s: string) => JSON.stringify(s);

/** Obsidian-flavoured Markdown: YAML frontmatter, block ids on every transcript line, timestamp links to them. */
export function toMarkdown(m: Meeting): string {
  const out: string[] = [];
  out.push('---');
  out.push(`title: ${yamlString(m.title)}`);
  out.push(`date: ${m.date}`);
  out.push(`duration: ${yamlString(formatTimestamp(m.transcript.duration))}`);
  out.push(`language: ${m.transcript.language}`);
  out.push(`whisper_model: ${m.transcript.model}`);
  if (m.minutes) out.push(`llm: ${m.minutes.model}`);
  out.push('tags: [meeting, tacet]');
  out.push('tacet: 1');
  out.push('---', '', `# ${m.title}`, '');

  if (m.minutes) {
    const { summary, decisions, actionItems } = m.minutes;
    out.push('## Summary', '');
    if (summary.length) for (const p of summary) out.push(`- ${p.text} ${link(p)}`);
    else out.push('_Nothing to summarize._');
    out.push('', '## Decisions', '');
    if (decisions.length) for (const d of decisions) out.push(`- ${d.text} ${link(d)}`);
    else out.push('_No decisions found in the transcript._');
    out.push('', '## Action items', '');
    if (actionItems.length) for (const a of actionItems) out.push(`- [ ] ${a.task} (**${a.owner}**) ${link(a)}`);
    else out.push('_No action items found in the transcript._');
    out.push('');
  }

  out.push('## Transcript', '');
  for (const s of m.transcript.segments) {
    out.push(`**${formatTimestamp(s.start)} ${s.speaker}:** ${s.text} ^${blockId(s.id)}`, '');
  }
  return out.join('\n');
}
