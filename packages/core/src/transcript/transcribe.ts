import { mergeTracks } from './merge.ts'
import type { Track, TranscribeTrack, Transcript } from './types.ts'

/** Transcribe every track on its own (speaker = track) and merge them into one timeline. */
export async function transcribe(
  tracks: readonly Track[],
  transcribeTrack: TranscribeTrack,
  model: string,
): Promise<Transcript> {
  const results = []
  for (const track of tracks) results.push(await transcribeTrack(track))
  const segments = mergeTracks(results.map((r) => r.segments))
  return {
    segments,
    duration: segments.reduce((max, s) => Math.max(max, s.end), 0),
    language: results.find((r) => r.language !== 'auto')?.language ?? 'auto',
    model,
  }
}
