import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import { noteOwner, toMarkdown } from '../meeting/markdown.ts'
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

  /**
   * Which meeting wrote each note in the folder: by the `tacet_id` in its frontmatter, or for notes
   * from before that field, by the meeting's exact date when exactly one meeting has it. A meeting
   * claimed by more than one file (the user copied a note in Obsidian) has no owner entry: none of
   * those files is Tacet's to move, so they are all left alone.
   */
  #owners(all: readonly NoteKey[]): Map<string, string> {
    const claims = new Map<string, string[]>()
    if (!existsSync(this.folder)) return new Map()
    const byDate = new Map<string, string[]>()
    for (const x of all) byDate.set(x.date, [...(byDate.get(x.date) ?? []), x.id])
    // Only regular files: a folder named "x.md" or a broken symlink in the vault is not a note.
    const notes = readdirSync(this.folder, { withFileTypes: true }).filter(
      (d) =>
        d.name.endsWith('.md') &&
        statSync(join(this.folder, d.name), { throwIfNoEntry: false })?.isFile(),
    )
    for (const { name } of notes) {
      const path = join(this.folder, name)
      const owner = noteOwner(readFileSync(path, 'utf8'))
      const ids =
        owner === undefined ? [] : 'id' in owner ? [owner.id] : (byDate.get(owner.date) ?? [])
      const [id] = ids
      if (ids.length === 1 && id !== undefined) claims.set(id, [...(claims.get(id) ?? []), path])
    }
    return new Map(
      [...claims].flatMap(([id, paths]) => {
        const [only] = paths
        return paths.length === 1 && only !== undefined ? [[id, only] as const] : []
      }),
    )
  }

  /**
   * The note a meeting should have: its name, or its name with the id when another meeting has the
   * same title in the same minute. A name already taken by a file this meeting did not write (a note
   * of a meeting whose .json is unreadable, or one the user wrote by hand) is never used; the
   * meeting takes the name with its id instead.
   */
  #target(m: NoteKey, all: readonly NoteKey[], owners: ReadonlyMap<string, string>): string {
    const base = noteName(m)
    const clash = all.some((x) => x.id !== m.id && noteName(x) === base)
    const own = owners.get(m.id)
    // Same file, maybe in another case: on APFS and NTFS "Retro.md" and "retro.md" are one file.
    const isOwn = (path: string) =>
      own !== undefined && realpathSync.native(path) === realpathSync.native(own)
    const free = (path: string) => !existsSync(path) || isOwn(path)
    const candidates = [
      ...(clash ? [] : [base]),
      base.replace(/\.md$/, ` ${m.id.slice(0, 8)}.md`),
      base.replace(/\.md$/, ` ${m.id}.md`),
    ].map((name) => join(this.folder, name))
    const path = candidates.find(free)
    if (path === undefined) throw new Error(`Every note name for meeting ${m.id} is taken: ${base}`)
    return path
  }

  /** Where this meeting's note is, or would be written. */
  notePath(m: NoteKey): string {
    const all = this.#names()
    const owners = this.#owners(all)
    return owners.get(m.id) ?? this.#target(m, all, owners)
  }

  /**
   * Writes the data and the note. A rename or a new name clash moves notes, but only notes Tacet
   * wrote for that same meeting: a file is never overwritten or moved unless its frontmatter says
   * it belongs to the meeting being placed.
   */
  save(m: Meeting): string {
    mkdirSync(this.#dataDir, { recursive: true })
    writeFileSync(join(this.#dataDir, `${m.id}.json`), JSON.stringify(m, null, 2))
    const all = this.#names()
    const owners = this.#owners(all)
    const note = this.#target(m, all, owners)
    const previous = owners.get(m.id)
    // Our own note moves (keeping whatever the user added is not possible: Tacet rewrites it).
    if (previous !== undefined && previous !== note) renameSync(previous, note)
    writeFileSync(note, toMarkdown(m))
    owners.set(m.id, note)
    // Meetings that now clash with (or no longer clash with) this one move to their new name.
    for (const x of all) {
      const at = owners.get(x.id)
      if (x.id === m.id || at === undefined) continue
      const to = this.#target(x, all, owners)
      if (to !== at) {
        renameSync(at, to)
        owners.set(x.id, to)
      }
    }
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
