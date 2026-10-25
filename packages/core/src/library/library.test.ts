import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Meeting } from '../meeting/types.ts'
import { groundMinutes } from '../minutes/ground.ts'
import { TRANSCRIPT } from '../testing.ts'
import { MeetingLibrary } from './library.ts'

const MEETING: Meeting = {
  id: 'm1',
  title: 'Beta launch sync',
  date: new Date(2026, 9, 24, 14, 30).toISOString(),
  transcript: TRANSCRIPT,
  minutes: groundMinutes(
    {
      summary: [{ text: 'Beta launch planned for Friday', segments: [1] }],
      decisions: [],
      action_items: [
        {
          task: 'Update the pricing page',
          owner: 'Maria',
          quote: 'Maria will update the pricing page',
          segments: [2],
        },
      ],
    },
    TRANSCRIPT,
    'test',
  ),
  timings: { transcribeSeconds: 1 },
}

const library = () => new MeetingLibrary(mkdtempSync(join(tmpdir(), 'tacet-lib-')))

describe('MeetingLibrary', () => {
  it('writes Obsidian markdown with timestamp links to block ids', () => {
    const path = library().save(MEETING)
    expect(path.endsWith('2026-10-24 1430 Beta launch sync.md')).toBe(true)
    const md = readFileSync(path, 'utf8')
    expect(md).toContain('title: "Beta launch sync"')
    expect(md).toContain('- [ ] Update the pricing page (**Maria**) [[#^t0002|00:09]]')
    expect(md).toContain(
      '**00:09 Others:** Agreed, Friday it is. Maria will update the pricing page. ^t0002',
    )
    expect(md).toContain('_No decisions found in the transcript._')
  })

  it('writes a transcript-only note without minutes', () => {
    const { minutes: _, ...bare } = MEETING
    const md = readFileSync(library().save(bare), 'utf8')
    expect(md).not.toContain('## Summary')
    expect(md).toContain('## Transcript')
  })

  it('renames the note when the title changes and searches across meetings', () => {
    const lib = library()
    lib.save(MEETING)
    lib.save({ ...MEETING, title: 'Renamed' })
    expect(readdirSync(lib.folder).filter((f) => f.endsWith('.md'))).toEqual([
      '2026-10-24 1430 Renamed.md',
    ])
    expect(lib.get('m1')?.title).toBe('Renamed')
    const hits = lib.search('PRICING maria')
    expect(hits.map((h) => h.where)).toEqual(['action', 'transcript'])
    expect(hits[1]?.timestamp).toBe('00:09')
    expect(lib.search('   ')).toEqual([])
  })

  it('is empty before the first meeting', () => {
    const lib = library()
    expect(lib.list()).toEqual([])
    expect(lib.get('nope')).toBeUndefined()
  })
})
