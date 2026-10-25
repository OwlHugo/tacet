import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type RawMinutes, RawMinutesSchema, type Transcript, TranscriptSchema } from '@tacet/core'
import { z } from 'zod'

const ReferenceLineSchema = z.object({ speaker: z.string(), text: z.string(), start: z.number() })
export type ReferenceLine = z.infer<typeof ReferenceLineSchema>

const CaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  language: z.string(),
  tracks: z.array(z.object({ file: z.string(), speaker: z.string() })).min(1),
  /** The script that was spoken, in order, with the second each line starts at. */
  reference: z.array(ReferenceLineSchema),
  /** Each expected action item as keywords that must appear in the task or its quote. */
  expected_actions: z.array(z.array(z.string())),
})

/** What a real whisper + LLM run produced, replayed by `eval:sem-ia` so CI needs neither. */
const FixtureSchema = z.object({
  whisperModel: z.string(),
  llmModel: z.string(),
  transcript: TranscriptSchema,
  raw: RawMinutesSchema,
})
export type Fixture = z.infer<typeof FixtureSchema>

export interface EvalCase extends z.infer<typeof CaseSchema> {
  readonly dir: string
  readonly fixture: Fixture
}

export const fixturePath = (dir: string) => join(dir, 'fixture.json')

export function loadCases(root: string): EvalCase[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(root, d.name))
    .sort()
    .map((dir) => ({
      ...CaseSchema.parse(JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8'))),
      dir,
      fixture: FixtureSchema.parse(JSON.parse(readFileSync(fixturePath(dir), 'utf8'))),
    }))
}

export function fixtureOf(
  whisperModel: string,
  llmModel: string,
  transcript: Transcript,
  raw: RawMinutes,
): Fixture {
  return { whisperModel, llmModel, transcript, raw }
}
