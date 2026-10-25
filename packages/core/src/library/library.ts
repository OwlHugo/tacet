import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { noteOwner, toMarkdown } from '../meeting/markdown.ts'
import { type SearchHit, searchMeetings } from '../meeting/search.ts'
import { type Meeting, MeetingSchema } from '../meeting/types.ts'

const pad = (n: number) => String(n).padStart(2, '0')

/** The fields that decide a note's file name. */
const NoteKeySchema = MeetingSchema.pick({ id: true, date: true, title: true })
type NoteKey = z.infer<typeof NoteKeySchema>

/**
 * `.tacet/notes`: Tacet's own record of the note file it wrote for each meeting (id -> file name).
 * It is the only thing that makes a .md "ours": files not in it (copies, hand-written notes,
 * anything else in the vault) are never read, moved or overwritten. No .json extension, so
 * `list()` does not take it for a meeting.
 */
const NOTE_INDEX = 'notes'
const NoteIndexSchema = z.record(z.string(), z.string().regex(/^[^/\\]+\.md$/))

/**
 * Files in the notes folder belong to the user, not to Tacet: a corrupt .json, an unreadable or
 * odd .md must never stop a meeting from being saved, so reading them is lenient and "unreadable"
 * just means "not ours". `list()` and `get()` still validate the full schema and fail loudly.
 */
function readOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function parseJsonOrUndefined(text: string | undefined): unknown {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Anything at that name, including a folder or a broken link, takes the name. */
const occupied = (path: string) => lstatSync(path, { throwIfNoEntry: false }) !== undefined
const isRegularFile = (path: string) =>
  lstatSync(path, { throwIfNoEntry: false })?.isFile() === true

/** One file under two spellings: on APFS and NTFS "Retro.md" and "retro.md" are the same file. */
function sameFile(a: string, b: string): boolean {
  const sa = statSync(a, { throwIfNoEntry: false })
  const sb = statSync(b, { throwIfNoEntry: false })
  return sa !== undefined && sb !== undefined && sa.dev === sb.dev && sa.ino === sb.ino
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

  /** What the name clash check needs from each meeting, read leniently (see readOrUndefined). */
  #names(): NoteKey[] {
    if (!existsSync(this.#dataDir)) return []
    return readdirSync(this.#dataDir)
      .filter((f) => f.endsWith('.json'))
      .flatMap((f) => {
        const text = readOrUndefined(join(this.#dataDir, f))
        const parsed = NoteKeySchema.safeParse(parseJsonOrUndefined(text))
        return parsed.success ? [parsed.data] : []
      })
  }

  #index(): Map<string, string> {
    const parsed = NoteIndexSchema.safeParse(
      parseJsonOrUndefined(readOrUndefined(join(this.#dataDir, NOTE_INDEX))),
    )
    return new Map(parsed.success ? Object.entries(parsed.data) : [])
  }

  #writeIndex(index: ReadonlyMap<string, string>): void {
    writeFileSync(
      join(this.#dataDir, NOTE_INDEX),
      `${JSON.stringify(Object.fromEntries([...index].sort()), null, 2)}\n`,
    )
  }

  /**
   * The note this meeting already has: the file recorded in the index, if it is still there. For
   * libraries from before the index, a note at the meeting's own name whose frontmatter says it was
   * written for this meeting (by id, or by date for the oldest notes).
   */
  #own(m: NoteKey, index: ReadonlyMap<string, string>): string | undefined {
    const recorded = index.get(m.id)
    // The index says where Tacet put it; the frontmatter confirms the file there is still that note
    // and not one the user made at the same name after deleting it.
    if (recorded !== undefined) {
      const path = join(this.folder, recorded)
      const owner = isRegularFile(path) ? noteOwner(readOrUndefined(path) ?? '') : undefined
      return owner !== undefined && 'id' in owner && owner.id === m.id ? path : undefined
    }
    const base = noteName(m)
    return [base, base.replace(/\.md$/, ` ${m.id.slice(0, 8)}.md`)]
      .map((name) => join(this.folder, name))
      .find((path) => {
        if (!isRegularFile(path)) return false
        const owner = noteOwner(readOrUndefined(path) ?? '')
        return owner !== undefined && ('id' in owner ? owner.id === m.id : owner.date === m.date)
      })
  }

  /**
   * The note a meeting should have: its name, or its name with the id when another meeting has the
   * same title in the same minute. A name taken by anything that is not this meeting's own note is
   * never used: the meeting takes the name with its id instead.
   */
  #target(m: NoteKey, all: readonly NoteKey[], own: string | undefined): string {
    const base = noteName(m)
    const clash = all.some((x) => x.id !== m.id && noteName(x) === base)
    const free = (path: string) => !occupied(path) || (own !== undefined && sameFile(path, own))
    const path = [
      ...(clash ? [] : [base]),
      base.replace(/\.md$/, ` ${m.id.slice(0, 8)}.md`),
      base.replace(/\.md$/, ` ${m.id}.md`),
    ]
      .map((name) => join(this.folder, name))
      .find(free)
    if (path === undefined) throw new Error(`Every note name for meeting ${m.id} is taken: ${base}`)
    return path
  }

  /** Where this meeting's note is, or undefined when it has none on disk (never written, or replaced). */
  notePath(m: NoteKey): string | undefined {
    return this.#own(m, this.#index())
  }

  /**
   * Writes the data and the note. A rename or a new name clash moves notes, but only the notes the
   * index says Tacet wrote. Where everything goes is decided before anything is written.
   */
  save(m: Meeting): string {
    mkdirSync(this.#dataDir, { recursive: true })
    const stored = this.#names()
    const all = [...stored.filter((x) => x.id !== m.id), m]
    const index = this.#index()
    // Looked up under the name it was saved with: a rename changes the title, not the old file.
    const own = this.#own(stored.find((x) => x.id === m.id) ?? m, index)
    const note = this.#target(m, all, own)
    writeFileSync(join(this.#dataDir, `${m.id}.json`), JSON.stringify(m, null, 2))
    if (own !== undefined && own !== note) renameSync(own, note)
    writeFileSync(note, toMarkdown(m))
    index.set(m.id, basename(note))
    // Meetings that now clash with (or no longer clash with) this one move to their new name.
    for (const x of all) {
      if (x.id === m.id) continue
      const at = this.#own(x, index)
      if (at === undefined) continue
      const to = this.#target(x, all, at)
      if (to !== at) renameSync(at, to)
      index.set(x.id, basename(to))
    }
    this.#writeIndex(index)
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
