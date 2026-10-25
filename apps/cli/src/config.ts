import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

/** The only place the CLI reads the environment. */
export const config = z
  .object({
    TACET_WHISPER_BIN: z.string().optional(),
    TACET_FFMPEG_BIN: z.string().optional(),
    TACET_MODELS_DIR: z.string().default(join(homedir(), '.cache', 'whisper')),
    TACET_DIR: z.string().default(join(homedir(), 'Tacet')),
    OLLAMA_HOST: z.string().default('127.0.0.1:11434'),
    PATH: z.string().default(''),
  })
  .parse(process.env)
