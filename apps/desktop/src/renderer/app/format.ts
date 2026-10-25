import { formatTimestamp } from '@tacet/core/browser'

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

const AUDIO = /\.(wav|m4a|mp3)$/i

/** Dropped files Tacet can transcribe, by extension. */
export const audioFiles = <F extends { readonly name: string }>(files: Iterable<F>): F[] =>
  [...files].filter((f) => AUDIO.test(f.name))
