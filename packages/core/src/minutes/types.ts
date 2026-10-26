import { z } from 'zod'

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
 * Which part of the minutes one request asks for. `overview` is the summary and the decisions,
 * `tasks` the action items; the parts not asked for come back as empty lists.
 */
export type MinutesPart = 'overview' | 'tasks'

/** The schema the model must follow for each part. */
export const PART_SCHEMA = {
  overview: RawMinutesSchema.pick({ summary: true, decisions: true }),
  tasks: RawMinutesSchema.pick({ action_items: true }),
} as const

/** Port: a local LLM that answers one minutes prompt. Ollama in production, a fake in tests. */
export type GenerateRawMinutes = (
  system: string,
  user: string,
  part: MinutesPart,
) => Promise<RawMinutes>
