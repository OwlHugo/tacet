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
       * As written in the transcript, only when said in a row inside the task's quote on its own line,
       * or in the reply right after it (see groundDue).
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

/** Port: a local LLM that answers the minutes prompt. Ollama in production, a fake in tests. */
export type GenerateRawMinutes = (system: string, user: string) => Promise<RawMinutes>
