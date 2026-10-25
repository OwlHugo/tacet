import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'

/** A model name ("base", "large-v3-turbo") or a path to a ggml .bin file. */
export function modelPath(model: string, modelsDir: string): string {
  return model.endsWith('.bin') ? model : join(modelsDir, `ggml-${model}.bin`)
}

const modelUrl = (model: string) =>
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`

/**
 * Make sure a whisper model exists locally. This is the only network request Tacet makes:
 * a one-time download of public weights that sends nothing about the user or their meetings.
 */
export async function ensureModel(model: string, modelsDir: string): Promise<string> {
  const path = modelPath(model, modelsDir)
  if (existsSync(path)) return path
  if (model.endsWith('.bin')) throw new Error(`Model file not found: ${model}`)
  mkdirSync(dirname(path), { recursive: true })
  const res = await fetch(modelUrl(model))
  if (!res.ok || !res.body)
    throw new Error(`Could not download whisper model "${model}": HTTP ${res.status}`)
  const partial = `${path}.partial`
  await pipeline(
    Readable.fromWeb(res.body as ReadableStream<Uint8Array>),
    createWriteStream(partial),
  )
  renameSync(partial, path)
  return path
}
