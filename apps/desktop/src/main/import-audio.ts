import { statSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { IMPORT_EXTENSIONS_LABEL, isImportableAudio } from '../shared/audio-files.ts'
import type { RecorderState } from '../shared/contract.ts'

/**
 * The renderer never sends a path it typed: the preload only forwards `webUtils.getPathForFile` of
 * a dropped File, and the button goes through the native dialog in the main process. The path is
 * still resolved and normalized here ("/a/../b.wav" becomes "/b.wav"), must keep an audio extension
 * and must be an existing regular file before anything reads it.
 */
export function resolveImportPath(
  raw: string,
  platform: NodeJS.Platform,
  isFile: (path: string) => boolean = (p) =>
    statSync(p, { throwIfNoEntry: false })?.isFile() === true,
): string {
  const path = platform === 'win32' ? win32.resolve(raw) : posix.resolve(raw)
  if (!isImportableAudio(path))
    throw new Error(`Only ${IMPORT_EXTENSIONS_LABEL} files can be imported.`)
  if (!isFile(path)) throw new Error(`File not found: ${path}`)
  return path
}

export interface ImportDeps {
  readonly getState: () => RecorderState
  readonly setState: (s: RecorderState) => void
  /** resolveImportPath for this platform. */
  readonly resolve: (raw: string) => string
  /** The transcription + minutes pipeline. Resolves with the new meeting id. */
  readonly run: (path: string) => Promise<string>
}

/**
 * Same pipeline as a recording, from a file on disk. Refuses while something else is running, without
 * touching that state. Any failure puts the recorder back to idle and rejects: the import's error
 * belongs to the window that started it, which shows it once, so it never lingers as a recording error.
 */
export function audioImporter(deps: ImportDeps): (path: string) => Promise<string> {
  return async (path) => {
    const busy = deps.getState().kind
    if (busy !== 'idle' && busy !== 'error')
      throw new Error('Wait for the current meeting to finish.')
    const file = deps.resolve(path)
    deps.setState({ kind: 'processing', stage: 'transcribing' })
    const id = await deps.run(file).finally(() => deps.setState({ kind: 'idle' }))
    return id
  }
}
