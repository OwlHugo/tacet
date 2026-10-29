import { formatTimestamp } from '@tacet/core/browser'
import { isImportableAudio } from '../../shared/audio-files.ts'

export const timestamp = formatTimestamp

export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  return minutes < 1 ? `${Math.round(seconds)}s` : `${minutes} min`
}

export const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** Electron accelerator in the platform's notation: ⌘⇧M on macOS, Ctrl+Shift+M elsewhere. */
export function shortcutLabel(accelerator: string, isMac: boolean): string {
  const keys = accelerator
    .replace('CommandOrControl', isMac ? '⌘' : 'Ctrl')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .split('+')
  return keys.join(isMac ? '' : '+')
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Dropped files Tacet can transcribe, by extension. */
export const audioFiles = <F extends { readonly name: string }>(files: Iterable<F>): F[] =>
  [...files].filter((f) => isImportableAudio(f.name))

/** "Error invoking remote method 'meetings:import': Error: ffmpeg failed" -> "ffmpeg failed". */
export const ipcErrorMessage = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e))
    .replace(/^Error invoking remote method '[^']+': /, '')
    .replace(/^(?:[A-Za-z]*Error: )+/, '')

/**
 * The items of a list, split on `separator`: trimmed, no blanks, no repeats. Nicknames take commas
 * or lines ("Rafa, Rafinha"); the vocabulary takes lines only, since a term may hold a comma
 * ("Silva, Pedro").
 */
export const listOf = (text: string, separator: RegExp = /[,\n]/): string[] => [
  ...new Set(
    text
      .split(separator)
      .map((w) => w.trim())
      .filter((w) => w !== ''),
  ),
]

/** One term per line: a comma belongs to the term. */
export const linesOf = (text: string): string[] => listOf(text, /\n/)
