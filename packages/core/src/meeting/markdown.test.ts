import { describe, expect, it } from 'vitest'
import { TRANSCRIPT } from '../testing.ts'
import { noteOwner, toMarkdown } from './markdown.ts'
import type { Meeting } from './types.ts'

const base: Meeting = {
  id: 'm',
  title: 'Sync "Q4"',
  date: '2026-10-24T14:30:00.000Z',
  transcript: { ...TRANSCRIPT, duration: 3725 },
  timings: { transcribeSeconds: 1 },
}

describe('toMarkdown', () => {
  it('writes frontmatter Obsidian can read, with the title quoted', () => {
    const md = toMarkdown(base)
    expect(
      md.startsWith(
        '---\ntitle: "Sync \\"Q4\\""\ndate: 2026-10-24T14:30:00.000Z\nduration: "1:02:05"\nlanguage: en\nwhisper_model: base\ntags: [meeting, tacet]\ntacet: 1\ntacet_id: m\n---\n\n# Sync "Q4"\n',
      ),
    ).toBe(true)
    expect(md).not.toContain('llm:')
    expect(md).not.toContain('## Summary')
  })

  it('renders every section, with empty states and links to block ids', () => {
    const md = toMarkdown({
      ...base,
      minutes: {
        summary: [],
        decisions: [{ text: 'Ship Friday', quote: 'Friday it is', segments: [2], at: 9.5 }],
        actionItems: [],
        rejected: [],
        model: 'qwen2.5:7b',
      },
    })
    expect(md).toContain('llm: qwen2.5:7b')
    expect(md).toContain('## Summary\n\n_Nothing to summarize._\n')
    expect(md).toContain('## Decisions\n\n- Ship Friday [[#^t0002|00:09]]\n')
    expect(md).toContain('## Action items\n\n_No action items found in the transcript._\n')
    expect(md).toContain(
      '**00:20 Others:** We also decided to drop the dark mode toggle for now. ^t0004\n',
    )
  })

  it('reads back the meeting a note belongs to, only from its own frontmatter', () => {
    expect(noteOwner(toMarkdown(base))).toEqual({ id: 'm' })
    const legacy = toMarkdown(base).replace('tacet_id: m\n', '')
    expect(noteOwner(legacy)).toEqual({ date: '2026-10-24T14:30:00.000Z' })
    expect(noteOwner(legacy.replace('tacet: 1\n', ''))).toBeUndefined()
    for (const other of [
      '# My own note\n\ntacet_id: x\n',
      '---\ntitle: x\n---\n\ntacet_id: x\n\n---\nmore\n',
      '---\ntacet_id: "a" "b"\n---\n',
      '---\ntacet_id: \\q\n---\n',
      '---\ntacet_id: ../../etc\n---\n',
      '',
    ])
      expect(noteOwner(other)).toBeUndefined()
  })
})
