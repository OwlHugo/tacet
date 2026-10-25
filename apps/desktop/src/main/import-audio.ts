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

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Same pipeline as a recording, from a file on disk. Refuses while something else is running, without
 * touching that state. A pipeline failure becomes the error state and also rejects, so the caller
 * that started the import shows it.
 */
export function audioImporter(deps: ImportDeps): (path: string) => Promise<string> {
  return async (path) => {
    const busy = deps.getState().kind
    if (busy !== 'idle' && busy !== 'error')
      throw new Error('Wait for the current meeting to finish.')
    // From here on this import owns the error line: an older error is replaced, never shown twice.
    const fail = (e: unknown): never => {
      deps.setState({ kind: 'error', message: message(e) })
      throw e
    }
    const id = await Promise.resolve(path)
      .then(deps.resolve)
      .then((file) => {
        deps.setState({ kind: 'processing', stage: 'transcribing' })
        return deps.run(file)
      })
      .catch(fail)
    deps.setState({ kind: 'idle' })
    return id
  }
}
