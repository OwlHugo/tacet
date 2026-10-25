import type { Transcript } from '../transcript/types.ts'
import { type GroundingOptions, groundMinutes } from './ground.ts'
import { chunkSegments, systemPrompt, transcriptForPrompt } from './prompt.ts'
import type { GenerateRawMinutes, Minutes, RawMinutes } from './types.ts'

export interface GenerateMinutesDeps {
  readonly generate: GenerateRawMinutes
  /** Name recorded in the minutes ("qwen2.5:7b"). */
  readonly model: string
  readonly grounding?: GroundingOptions
}

/** Ask the LLM chunk by chunk, merge the answers and ground them against the transcript. */
export async function generateMinutes(
  transcript: Transcript,
  deps: GenerateMinutesDeps,
): Promise<{ minutes: Minutes; raw: RawMinutes }> {
  const raw: RawMinutes = { summary: [], decisions: [], action_items: [] }
  const system = systemPrompt(
    transcript.language,
    transcript.segments.map((s) => s.speaker),
  )
  for (const chunk of chunkSegments(transcript.segments)) {
    const part = await deps.generate(system, `Transcript:\n${transcriptForPrompt(chunk)}`)
    raw.summary.push(...part.summary)
    raw.decisions.push(...part.decisions)
    raw.action_items.push(...part.action_items)
  }
  return { minutes: groundMinutes(raw, transcript, deps.model, deps.grounding), raw }
}
