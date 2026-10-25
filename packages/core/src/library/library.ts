import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { toMarkdown } from '../meeting/markdown.ts'
import { type SearchHit, searchMeetings } from '../meeting/search.ts'
import { type Meeting, MeetingSchema } from '../meeting/types.ts'

const pad = (n: number) => String(n).padStart(2, '0')

/** File name of a meeting's note: "2026-10-24 1430 Beta launch sync.md". */
export function noteName(m: Pick<Meeting, 'date' | 'title'>): string {
  const d = new Date(m.date)
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`
  const safe = m.title
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${stamp} ${safe}.md`
}

/**
 * A library is a folder (point it at an Obsidian vault subfolder):
 *   <folder>/<date> <title>.md     the note
 *   <folder>/.tacet/<id>.json      structured data for the app and search
 *   <folder>/.tacet/audio/<id>/    the recorded tracks (optional, deletable)
 */
export class MeetingLibrary {
  readonly folder: string

  constructor(folder: string) {
    this.folder = folder
  }

  get #dataDir(): string {
    return join(this.folder, '.tacet')
  }

  audioDir(id: string): string {
    const dir = join(this.#dataDir, 'audio', id)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * Two meetings with the same title in the same minute (the same file imported twice) would share
   * a note. The earliest keeps the plain name; later ones get their short id appended, so saving a
   * new meeting never overwrites or renames an older note.
   */
  notePath(m: Pick<Meeting, 'id' | 'date' | 'title'>): string {
    const base = noteName(m)
    const earlier = this.list().some(
      (x) =>
        x.id !== m.id &&
        noteName(x) === base &&
        (x.date < m.date || (x.date === m.date && x.id < m.id)),
    )
    return join(this.folder, earlier ? base.replace(/\.md$/, ` ${m.id.slice(0, 8)}.md`) : base)
  }

  save(m: Meeting): string {
    mkdirSync(this.#dataDir, { recursive: true })
    const previous = this.get(m.id)
    const note = this.notePath(m)
    if (previous && this.notePath(previous) !== note && existsSync(this.notePath(previous))) {
      renameSync(this.notePath(previous), note)
    }
    writeFileSync(join(this.#dataDir, `${m.id}.json`), JSON.stringify(m, null, 2))
    writeFileSync(note, toMarkdown(m))
    return note
  }

  get(id: string): Meeting | undefined {
    const path = join(this.#dataDir, `${id}.json`)
    return existsSync(path)
      ? MeetingSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
      : undefined
  }

  list(): Meeting[] {
    if (!existsSync(this.#dataDir)) return []
    return readdirSync(this.#dataDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => MeetingSchema.parse(JSON.parse(readFileSync(join(this.#dataDir, f), 'utf8'))))
      .sort((a, b) => b.date.localeCompare(a.date))
  }

  search(query: string): SearchHit[] {
    return searchMeetings(this.list(), query)
  }
}
