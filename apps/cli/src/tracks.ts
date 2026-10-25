import { basename, extname } from 'node:path'
import { ME, OTHERS, SPEAKER, type Track } from '@tacet/core'

/**
 * Tracks come from:
 *   tacet transcribe call.wav                       one file, speaker "Speaker"
 *   tacet transcribe --mic me.wav --system them.wav
 *   tacet transcribe me.wav:Me them.wav:Ana         explicit labels
 */
export function parseTracks(
  positionals: readonly string[],
  mic?: string,
  system?: string,
): Track[] {
  const flagged = [
    ...(mic ? [{ path: mic, speaker: ME }] : []),
    ...(system ? [{ path: system, speaker: OTHERS }] : []),
  ]
  const several = positionals.length + flagged.length > 1
  const positional = positionals.map((p) => {
    const m = /^(.*\.[a-z0-9]{2,5}):([^\\/:]+)$/i.exec(p)
    if (m?.[1] && m[2]) return { path: m[1], speaker: m[2] }
    return { path: p, speaker: several ? basename(p, extname(p)) : SPEAKER }
  })
  return [...flagged, ...positional]
}
