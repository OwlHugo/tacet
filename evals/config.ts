import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

/** The only place the evals read the environment. */
export const config = z
  .object({
    TACET_WHISPER_BIN: z.string().optional(),
    TACET_MODELS_DIR: z.string().default(join(homedir(), '.cache', 'whisper')),
    OLLAMA_HOST: z.string().default('127.0.0.1:11434'),
    PATH: z.string().default(''),
    /** Where the cases are. Defaults to evals/cases; point it elsewhere for cases that stay private. */
    TACET_EVAL_CASES: z.string().default(join(import.meta.dirname, 'cases')),
  })
  .parse(process.env)
