import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large-v3-turbo', 'large-v3'] as const;
export type WhisperModelName = (typeof WHISPER_MODELS)[number];

export function modelsDir(): string {
  return process.env.TACET_MODELS_DIR ?? join(homedir(), '.cache', 'whisper');
}

/** Accepts a model name ("base") or a path to a ggml .bin file. */
export function modelPath(model: string): string {
  if (model.endsWith('.bin')) return model;
  return join(modelsDir(), `ggml-${model}.bin`);
}

export function modelUrl(model: string): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;
}

/**
 * Make sure a whisper model exists locally. Downloading the model is the only network call Tacet ever makes,
 * it is a one-time download of public weights and sends nothing about you or your meetings.
 */
export async function ensureModel(model: string, onProgress?: (fraction: number) => void): Promise<string> {
  const path = modelPath(model);
  if (existsSync(path)) return path;
  if (model.endsWith('.bin')) throw new Error(`Model file not found: ${model}`);
  mkdirSync(dirname(path), { recursive: true });
  const res = await fetch(modelUrl(model));
  if (!res.ok || !res.body) throw new Error(`Could not download whisper model "${model}": HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (total && onProgress) onProgress(received / total);
  });
  const tmp = `${path}.partial`;
  await pipeline(body, createWriteStream(tmp));
  renameSync(tmp, path);
  return path;
}
