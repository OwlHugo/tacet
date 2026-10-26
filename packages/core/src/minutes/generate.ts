import type { Transcript } from '../transcript/types.ts'
import { type GroundingOptions, groundMinutes } from './ground.ts'
import { chunkSegments, systemPrompt, transcriptForPrompt } from './prompt.ts'
import type { GenerateRawMinutes, Minutes, MinutesPart, RawMinutes } from './types.ts'

const PARTS: readonly MinutesPart[] = ['overview', 'tasks']

export interface GenerateMinutesDeps {
  readonly generate: GenerateRawMinutes
  /** Name recorded in the minutes ("qwen2.5:7b"). */
  readonly model: string
  readonly grounding?: GroundingOptions
}

/**
 * Ask the LLM chunk by chunk, merge the answers and ground them against the transcript. Each chunk
 * takes two requests, one for the summary and decisions and one for the tasks: a 7B model asked for
 * everything at once sometimes spends itself on the tasks and leaves the summary empty.
 */
export async function generateMinutes(
  transcript: Transcript,
  deps: GenerateMinutesDeps,
): Promise<{ minutes: Minutes; raw: RawMinutes }> {
  const raw: RawMinutes = { summary: [], decisions: [], action_items: [] }
  const speakers = transcript.segments.map((s) => s.speaker)
  for (const chunk of chunkSegments(transcript.segments)) {
    const user = `Transcript:\n${transcriptForPrompt(chunk)}`
    for (const part of PARTS) {
      const answer = await deps.generate(
        systemPrompt(transcript.language, speakers, part),
        user,
        part,
      )
      raw.summary.push(...answer.summary)
      raw.decisions.push(...answer.decisions)
      raw.action_items.push(...answer.action_items)
    }
  }
  return { minutes: groundMinutes(raw, transcript, deps.model, deps.grounding), raw }
}
