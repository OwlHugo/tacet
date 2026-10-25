import { z } from 'zod'
import { MinutesSchema } from '../minutes/types.ts'
import { TranscriptSchema } from '../transcript/types.ts'

/** Meeting ids become file names (.tacet/<id>.json, audio/<id>/) and frontmatter: a closed charset. */
export const MEETING_ID = /^[A-Za-z0-9_-]{1,64}$/

export const MeetingSchema = z.object({
  id: z.string().regex(MEETING_ID, 'meeting id must be letters, digits, - or _'),
  title: z.string().min(1),
  /** ISO date-time of when the meeting started. */
  date: z.iso.datetime(),
  transcript: TranscriptSchema,
  minutes: MinutesSchema.optional(),
  timings: z.object({
    transcribeSeconds: z.number().nonnegative(),
    minutesSeconds: z.number().nonnegative().optional(),
  }),
})
export type Meeting = z.infer<typeof MeetingSchema>
