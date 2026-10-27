import { z } from 'zod'

/**
 * The person who recorded the meeting, as the user set it: their name and what people call them
 * ("Ana", ["Aninha"]). It tells the model, and grounding, who "you" usually is.
 */
export const SelfSchema = z.object({
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)),
})
export type Self = z.infer<typeof SelfSchema>
/** What the LLM must return. Segment ids are the only link between an item and the transcript. */
export const RawMinutesSchema = z.object({
  summary: z.array(z.object({ text: z.string(), segments: z.array(z.number().int()) })),
  decisions: z.array(
    z.object({ text: z.string(), quote: z.string(), segments: z.array(z.number().int()) }),
  ),
  action_items: z.array(
    z.object({
      task: z.string(),
      owner: z.string(),
      /** The deadline as it was said ("by Thursday", "até quarta"). Empty when none was said. */
      due: z.string(),
      quote: z.string(),
      segments: z.array(z.number().int()),
    }),
  ),
})
export type RawMinutes = z.infer<typeof RawMinutesSchema>

const citation = {
  /** Never empty: an item without a source line is rejected by the guard. */
  segments: z.tuple([z.number().int().nonnegative()], z.number().int().nonnegative()),
  /** Start (s) of the first cited segment. Taken from the transcript, never from the LLM. */
  at: z.number().nonnegative(),
}

export const MinutesSchema = z.object({
  summary: z.array(z.object({ text: z.string(), ...citation })),
  decisions: z.array(z.object({ text: z.string(), quote: z.string(), ...citation })),
  actionItems: z.array(
    z.object({
      task: z.string(),
      owner: z.string(),
      /**
       * As written in the transcript, only when said in a row on a line of this task that no other
       * task stands on and that names at most one of the owners the model gave (see groundDue).
       */
      due: z.string().optional(),
      quote: z.string(),
      ...citation,
    }),
  ),
  /** Items the model produced that are not in the transcript. Kept for transparency, never shown as facts. */
  rejected: z.array(
    z.object({
      /** `deadline`: the task was kept, only the deadline the model gave it was dropped. */
      kind: z.enum(['summary', 'decision', 'action', 'deadline']),
      text: z.string(),
      reason: z.string(),
    }),
  ),
  model: z.string(),
})
export type Minutes = z.infer<typeof MinutesSchema>
export type Rejected = Minutes['rejected'][number]

/**
 * What one request asks for. Each list of the minutes has its own request, so a small model looks
 * at one thing at a time; `confirm` is the yes/no check of one decision or task on its own lines,
 * `deadline` the check that a task's deadline is a time said for that task.
 */
export type MinutesPart = 'summary' | 'decisions' | 'tasks' | 'confirm' | 'deadline'

/** The schema the model must follow for each part. */
export const PART_SCHEMA = {
  summary: RawMinutesSchema.pick({ summary: true }),
  decisions: RawMinutesSchema.pick({ decisions: true }),
  tasks: RawMinutesSchema.pick({ action_items: true }),
  /** `kind` comes first, so the model names what the lines are before it answers. */
  confirm: z.object({
    kind: z.enum(['agreed', 'question', 'joke', 'complaint', 'story', 'other']),
    agreed: z.boolean(),
  }),
  deadline: z.object({ is_time: z.boolean(), for_this_task: z.boolean() }),
} as const

export type PartAnswer<P extends MinutesPart> = z.infer<(typeof PART_SCHEMA)[P]>

/**
 * Port: a local LLM that answers one prompt with JSON in the shape of PART_SCHEMA[part]. Ollama in
 * production, a fake in tests. The answer is untrusted: it is parsed against that schema on arrival.
 */
export type GenerateRawMinutes = (
  system: string,
  user: string,
  part: MinutesPart,
) => Promise<unknown>
