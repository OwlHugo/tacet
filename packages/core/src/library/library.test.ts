import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
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
/** A library from before Tacet kept its note index. */
const forgetIndex = (lib: MeetingLibrary) => rmSync(join(lib.folder, '.tacet', 'notes'))
const md = (lib: MeetingLibrary) =>
  readdirSync(lib.folder)
    .filter((f) => f.endsWith('.md'))
    .sort()

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

  it('never overwrites or moves a note it did not write, on the first save or any later one', () => {
    const lib = library()
    const handmade = join(lib.folder, '2026-10-24 1430 Retro.md')
    writeFileSync(handmade, '# my notes\n')
    const retro = { ...MEETING, id: 'retro0001', title: 'Retro' }
    const first = lib.save(retro)
    expect(first.endsWith('1430 Retro retro000.md')).toBe(true)
    // saving again (new minutes) and renaming in the UI keep away from the hand-written file
    expect(lib.save({ ...retro, timings: { transcribeSeconds: 2 } })).toBe(first)
    expect(lib.notePath(retro)).toBe(first)
    const renamed = lib.save({ ...retro, title: 'Planning' })
    expect(renamed.endsWith('1430 Planning.md')).toBe(true)
    expect(readFileSync(handmade, 'utf8')).toBe('# my notes\n')
    expect(md(lib)).toEqual(['2026-10-24 1430 Planning.md', '2026-10-24 1430 Retro.md'])
  })

  it('keeps the note of a meeting whose .json became unreadable', () => {
    const lib = library()
    const first = lib.save(MEETING)
    writeFileSync(join(lib.folder, '.tacet', 'm1.json'), '{ truncated')
    const again = { ...MEETING, id: 'm2abcdef9' }
    const second = lib.save(again)
    expect(second.endsWith('1430 Beta launch sync m2abcdef.md')).toBe(true)
    expect(lib.save({ ...again, timings: { transcribeSeconds: 3 } })).toBe(second)
    expect(readFileSync(first, 'utf8')).toContain('tacet_id: m1')
  })

  it('adopts a note written before notes carried their id, without duplicating it', () => {
    const lib = library()
    const path = lib.save(MEETING)
    writeFileSync(path, readFileSync(path, 'utf8').replace(/tacet_id: .*\n/, ''))
    forgetIndex(lib)
    expect(lib.save({ ...MEETING, timings: { transcribeSeconds: 2 } })).toBe(path)
    expect(readFileSync(path, 'utf8')).toContain('tacet_id: m1')
    expect(md(lib)).toHaveLength(1)
  })

  it('moves only its own note when the user copied it, however often the meeting is renamed', () => {
    const lib = library()
    const retro = { ...MEETING, id: 'retro0001', title: 'Retro' }
    const original = lib.save(retro)
    const copy = original.replace('Retro.md', 'Retro 1.md')
    writeFileSync(copy, `${readFileSync(original, 'utf8')}\nmy annotations\n`)
    for (const title of ['Planning', 'Retro', 'Planning', 'Retro', 'Planning'])
      lib.save({ ...retro, title })
    expect(readFileSync(copy, 'utf8')).toContain('my annotations')
    expect(md(lib)).toEqual(['2026-10-24 1430 Planning.md', '2026-10-24 1430 Retro 1.md'])
    expect(lib.notePath(retro)).toBe(join(lib.folder, '2026-10-24 1430 Planning.md'))
  })

  it('recognizes its notes when an editor saved them with CRLF line endings', () => {
    const lib = library()
    const path = lib.save(MEETING)
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll('\n', '\r\n'))
    forgetIndex(lib)
    expect(lib.save({ ...MEETING, title: 'Renamed' }).endsWith('1430 Renamed.md')).toBe(true)
    expect(md(lib)).toEqual(['2026-10-24 1430 Renamed.md'])
  })

  it('renames a note when only the case of the title changes', () => {
    const lib = library()
    lib.save({ ...MEETING, title: 'Retro' })
    expect(lib.save({ ...MEETING, title: 'retro' }).endsWith('1430 retro.md')).toBe(true)
    expect(md(lib)).toEqual(['2026-10-24 1430 retro.md'])
  })

  it('ignores folders and broken links named like notes', () => {
    const lib = library()
    mkdirSync(join(lib.folder, 'Projeto.md'))
    symlinkSync(join(lib.folder, 'missing.md'), join(lib.folder, 'ref.md'))
    expect(lib.save(MEETING).endsWith('1430 Beta launch sync.md')).toBe(true)
  })

  it('adopts an old note whose date has no milliseconds', () => {
    const lib = library()
    const at = { ...MEETING, date: '2026-10-24T17:30:00Z' }
    const path = lib.save(at)
    writeFileSync(path, readFileSync(path, 'utf8').replace(/tacet_id: .*\n/, ''))
    forgetIndex(lib)
    expect(lib.save({ ...at, title: 'Renamed' }).endsWith(' Renamed.md')).toBe(true)
    expect(md(lib)).toHaveLength(1)
  })

  it('never writes through a broken link that sits at the note name', () => {
    const lib = library()
    const outside = join(mkdtempSync(join(tmpdir(), 'tacet-out-')), 'x.md')
    symlinkSync(outside, join(lib.folder, '2026-10-24 1430 Beta launch sync.md'))
    expect(lib.save(MEETING).endsWith('1430 Beta launch sync m1.md')).toBe(true)
    expect(readdirSync(join(outside, '..'))).toEqual([])
  })

  it('saves even when another note in the folder cannot be read', () => {
    const lib = library()
    const locked = join(lib.folder, 'private.md')
    writeFileSync(locked, '# mine\n')
    chmodSync(locked, 0o000)
    expect(lib.save(MEETING).endsWith('1430 Beta launch sync.md')).toBe(true)
    chmodSync(locked, 0o600)
  })

  it('leaves alone a note the user made at the name of one Tacet wrote and deleted', () => {
    const lib = library()
    const retro = { ...MEETING, id: 'retro0001', title: 'Retro' }
    const path = lib.save(retro)
    writeFileSync(path, '# my own retro notes\n')
    const renamed = lib.save({ ...retro, title: 'Planning' })
    expect(renamed.endsWith('1430 Planning.md')).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('# my own retro notes\n')
    expect(md(lib)).toEqual(['2026-10-24 1430 Planning.md', '2026-10-24 1430 Retro.md'])
  })
})
