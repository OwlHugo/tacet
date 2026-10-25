import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

  it('keeps one note per meeting when two share title and minute, in any save order', () => {
    const lib = library()
    const plain = lib.save(MEETING)
    expect(plain.endsWith('2026-10-24 1430 Beta launch sync.md')).toBe(true)
    const later = {
      ...MEETING,
      id: 'm2abcdef9',
      date: new Date(2026, 9, 24, 14, 30, 40).toISOString(),
    }
    const second = lib.save(later)
    expect(second.endsWith('1430 Beta launch sync m2abcdef.md')).toBe(true)
    // the first note moved out of the way instead of being overwritten
    expect(lib.notePath(MEETING).endsWith('1430 Beta launch sync m1.md')).toBe(true)
    expect(lib.save(MEETING)).toBe(lib.notePath(MEETING))
    const notes = readdirSync(lib.folder)
      .filter((f) => f.endsWith('.md'))
      .sort()
    expect(notes).toEqual([
      '2026-10-24 1430 Beta launch sync m1.md',
      '2026-10-24 1430 Beta launch sync m2abcdef.md',
    ])
    expect(readFileSync(second, 'utf8')).toContain('Beta launch sync')
    // a different title in the same minute is not a clash
    expect(lib.notePath({ ...MEETING, id: 'q', title: 'Other' }).endsWith('1430 Other.md')).toBe(
      true,
    )
  })

  it('still saves a new meeting when another .json in the folder is corrupt or from an old schema', () => {
    const lib = library()
    mkdirSync(join(lib.folder, '.tacet'), { recursive: true })
    writeFileSync(join(lib.folder, '.tacet', 'broken.json'), '{ not json')
    writeFileSync(join(lib.folder, '.tacet', 'old.json'), JSON.stringify({ id: 'old', name: 'v0' }))
    const path = lib.save(MEETING)
    expect(path.endsWith('2026-10-24 1430 Beta launch sync.md')).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain('Maria')
    expect(lib.get('m1')?.title).toBe('Beta launch sync')
  })

  it('gives a clash of three back its plain name when the others are renamed away', () => {
    const lib = library()
    const at = (s: number) => new Date(2026, 9, 24, 14, 30, s).toISOString()
    const a = { ...MEETING, id: 'aaaaaaaa1', date: at(1) }
    const b = { ...MEETING, id: 'bbbbbbbb2', date: at(2) }
    const c = { ...MEETING, id: 'cccccccc3', date: at(3) }
    for (const m of [a, b, c]) lib.save(m)
    const md = () =>
      readdirSync(lib.folder)
        .filter((f) => f.endsWith('.md'))
        .sort()
    expect(md()).toEqual([
      '2026-10-24 1430 Beta launch sync aaaaaaaa.md',
      '2026-10-24 1430 Beta launch sync bbbbbbbb.md',
      '2026-10-24 1430 Beta launch sync cccccccc.md',
    ])
    lib.save({ ...b, title: 'Retro' })
    expect(md()).toEqual([
      '2026-10-24 1430 Beta launch sync aaaaaaaa.md',
      '2026-10-24 1430 Beta launch sync cccccccc.md',
      '2026-10-24 1430 Retro.md',
    ])
    lib.save({ ...c, title: 'Planning' })
    expect(md()).toEqual([
      '2026-10-24 1430 Beta launch sync.md',
      '2026-10-24 1430 Planning.md',
      '2026-10-24 1430 Retro.md',
    ])
  })

  it('never overwrites a note it did not write, even when the other .json is unreadable', () => {
    const lib = library()
    const first = lib.save(MEETING)
    writeFileSync(join(lib.folder, '.tacet', 'm1.json'), '{ truncated')
    const again = { ...MEETING, id: 'm2abcdef9' }
    const second = lib.save(again)
    expect(second.endsWith('1430 Beta launch sync m2abcdef.md')).toBe(true)
    expect(readFileSync(first, 'utf8')).toContain('tacet_id: "m1"')
    // a note the user wrote by hand under the same name is left alone too
    const handmade = lib.notePath({ ...MEETING, id: 'h', title: 'Retro' })
    writeFileSync(handmade, '# my notes\n')
    const retro = lib.save({ ...MEETING, id: 'retro0001', title: 'Retro' })
    expect(retro.endsWith('1430 Retro retro000.md')).toBe(true)
    expect(readFileSync(handmade, 'utf8')).toBe('# my notes\n')
  })

  it('re-saves its own note in place, also one written before notes carried their id', () => {
    const lib = library()
    const path = lib.save(MEETING)
    writeFileSync(path, readFileSync(path, 'utf8').replace(/tacet_id: .*\n/, ''))
    expect(lib.save({ ...MEETING, timings: { transcribeSeconds: 2 } })).toBe(path)
    expect(readFileSync(path, 'utf8')).toContain('tacet_id: "m1"')
    expect(readdirSync(lib.folder).filter((f) => f.endsWith('.md'))).toHaveLength(1)
  })
})
