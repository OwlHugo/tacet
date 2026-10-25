import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import { toMarkdown } from '../meeting/markdown.ts'
import { type SearchHit, searchMeetings } from '../meeting/search.ts'
import { type Meeting, MeetingSchema } from '../meeting/types.ts'

const pad = (n: number) => String(n).padStart(2, '0')

/** The fields that decide a note's file name. */
const NoteKeySchema = MeetingSchema.pick({ id: true, date: true, title: true })
type NoteKey = z.infer<typeof NoteKeySchema>

/** JSON.parse for files we do not own the content of: invalid JSON is just "not a meeting". */
function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

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
   * What the name clash check needs from each meeting. Read leniently: a corrupt or older .json
   * elsewhere in the folder must never stop a new meeting from being saved, so an unreadable entry
   * is simply not a clash. `list()` and `get()` still validate the full schema.
   */
  #names(): NoteKey[] {
    if (!existsSync(this.#dataDir)) return []
    return readdirSync(this.#dataDir)
      .filter((f) => f.endsWith('.json'))
      .flatMap((f) => {
        const text = readFileSync(join(this.#dataDir, f), 'utf8')
        const parsed = NoteKeySchema.safeParse(parseJsonOrUndefined(text))
        return parsed.success ? [parsed.data] : []
      })
  }

  /** Where a meeting's note lives, given the names of every meeting in the library. */
  #pathAmong(m: NoteKey, all: readonly NoteKey[]): string {
    const base = noteName(m)
    // Same title in the same minute (one file imported twice): every note in the clash gets its
    // short id, so no order of saves can make two meetings share a file.
    const clash = all.some((x) => x.id !== m.id && noteName(x) === base)
    return join(this.folder, clash ? base.replace(/\.md$/, ` ${m.id.slice(0, 8)}.md`) : base)
  }

  notePath(m: NoteKey): string {
    return this.#pathAmong(m, this.#names())
  }

  /** Writes the data and the note. A rename or a new clash moves the affected notes along. */
  save(m: Meeting): string {
    mkdirSync(this.#dataDir, { recursive: true })
    const before = this.#names()
    const from = new Map(before.map((x) => [x.id, this.#pathAmong(x, before)]))
    writeFileSync(join(this.#dataDir, `${m.id}.json`), JSON.stringify(m, null, 2))
    const after = this.#names()
    for (const x of after) {
      const old = from.get(x.id)
      const now = this.#pathAmong(x, after)
      if (old !== undefined && old !== now && existsSync(old)) renameSync(old, now)
    }
    const note = this.#pathAmong(m, after)
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
