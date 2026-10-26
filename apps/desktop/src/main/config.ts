import { z } from 'zod'

const flag = z
  .enum(['0', '1'])
  .optional()
  .transform((v) => v === '1')

/** The only place the main process reads the environment. Test and docs hooks live here too. */
export const config = z
  .object({
    TACET_WHISPER_BIN: z.string().optional(),
    TACET_FFMPEG_BIN: z.string().optional(),
    TACET_MODELS_DIR: z.string().optional(),
    OLLAMA_HOST: z.string().default('127.0.0.1:11434'),
    PATH: z.string().default(''),
    /** Overrides the saved notes folder (e2e and screenshots). */
    TACET_OUTPUT_DIR: z.string().optional(),
    /** Use the Core Audio tap for loopback on macOS instead of ScreenCaptureKit. */
    TACET_CATAP: flag,
    /** e2e: feed the microphone from this WAV instead of the real device. */
    TACET_FAKE_MIC: z.string().optional(),
    /** e2e: feed the system audio from this WAV instead of the loopback capture. */
    TACET_FAKE_SYSTEM: z.string().optional(),
    /** e2e: record this many seconds on start, process, then quit. */
    TACET_AUTORECORD: z.coerce.number().int().positive().optional(),
    /** Docs: render the main window into this PNG and quit. */
    TACET_SCREENSHOT: z.string().optional(),
    /** Start in the tray without opening the window. */
    TACET_HIDDEN: flag,
    ELECTRON_RENDERER_URL: z.url().optional(),
  })
  .parse(process.env)
