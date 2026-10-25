import { z } from 'zod'
import { MinutesSchema } from '../minutes/types.ts'
import { TranscriptSchema } from '../transcript/types.ts'

export const MeetingSchema = z.object({
  id: z.string().min(1),
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
