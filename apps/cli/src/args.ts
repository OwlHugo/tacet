import { basename, extname } from 'node:path';
import type { Track } from '@tacet/core';

/**
 * Tracks come from:
 *   tacet transcribe call.wav                      one file, speaker "Speaker"
 *   tacet transcribe --mic me.wav --system them.wav
 *   tacet transcribe me.wav:Me them.wav:Others     explicit labels
 */
export function parseTracks(positionals: string[], mic?: string, system?: string): Track[] {
  const tracks: Track[] = [];
  if (mic) tracks.push({ path: mic, speaker: 'Me' });
  if (system) tracks.push({ path: system, speaker: 'Others' });
  for (const p of positionals) {
    const m = /^(.*\.[a-z0-9]{2,5}):([^\\/:]+)$/i.exec(p);
    if (m?.[1] && m[2]) tracks.push({ path: m[1], speaker: m[2] });
    else tracks.push({ path: p, speaker: positionals.length + tracks.length > 1 ? basename(p, extname(p)) : 'Speaker' });
  }
  return tracks;
}
