import { z } from 'zod'

/** Track labels. The mic track is the person recording, the system track is everyone on the call. */
export const ME = 'Me'
export const OTHERS = 'Others'
/** Label of a single mixed track (an imported file): nobody in particular, never a task owner. */
export const SPEAKER = 'Speaker'

const SegmentSchema = z.object({
  /** Index inside the transcript; the minutes cite segments by it. */
  id: z.number().int().nonnegative(),
  /** Seconds from the start of the meeting. */
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  speaker: z.string().min(1),
  text: z.string(),
})
export type Segment = z.infer<typeof SegmentSchema>

/** A segment before it gets its place in the merged timeline. */
export type TimedText = Omit<Segment, 'id'>

export const TranscriptSchema = z.object({
  segments: z.array(SegmentSchema),
  /** Seconds. */
  duration: z.number().nonnegative(),
  language: z.string(),
  model: z.string(),
})
export type Transcript = z.infer<typeof TranscriptSchema>

export interface Track {
  readonly path: string
  readonly speaker: string
}

export interface TrackTranscript {
  readonly segments: readonly TimedText[]
  readonly language: string
}

/** Port: turns one audio track into timed text. whisper.cpp in production, a fake in tests. */
export type TranscribeTrack = (track: Track) => Promise<TrackTranscript>
