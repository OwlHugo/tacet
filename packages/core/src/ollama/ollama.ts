import { z } from 'zod'
import { type GenerateRawMinutes, type MinutesPart, PART_SCHEMA } from '../minutes/types.ts'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Normalize an Ollama host and refuse anything that is not this machine, so a misconfigured
 * OLLAMA_HOST can never send a transcript elsewhere.
 */
export function ollamaHost(host: string): string {
  const url = new URL(/^https?:\/\//.test(host) ? host : `http://${host}`)
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1'
  if (!LOOPBACK.has(url.hostname)) {
    throw new Error(
      `Refusing to send a transcript to ${url.hostname}: Tacet only talks to an Ollama running on this machine.`,
    )
  }
  return url.origin
}

const Tags = z.object({ models: z.array(z.object({ name: z.string() })) })

/** Installed models, or undefined when Ollama is not running. Not running is an expected state. */
export async function ollamaModels(host: string): Promise<string[] | undefined> {
  const res = await fetch(`${ollamaHost(host)}/api/tags`, {
    signal: AbortSignal.timeout(1500),
  }).catch(() => undefined)
  if (!res?.ok) return undefined
  return Tags.parse(await res.json()).models.map((m) => m.name)
}

/** One line of a streamed chat answer: a piece of the content, until `done`. */
const ChatChunk = z.object({ message: z.object({ content: z.string() }), done: z.boolean() })

/**
 * The content of a streamed answer. Streaming keeps bytes flowing while a large model thinks: a
 * whole answer at once leaves the connection silent for minutes, and fetch gives up on it after
 * five (headers timeout).
 */
async function streamedContent(body: ReadableStream<Uint8Array>): Promise<string> {
  let content = ''
  let pending = ''
  const take = (line: string) => {
    if (line.trim() !== '') content += ChatChunk.parse(JSON.parse(line)).message.content
  }
  for await (const text of body.pipeThrough(new TextDecoderStream())) {
    const buffer = pending + text
    const end = buffer.lastIndexOf('\n') + 1
    for (const line of buffer.slice(0, end).split('\n')) take(line)
    pending = buffer.slice(end)
  }
  take(pending)
  return content
}

const JSON_SCHEMA: Record<MinutesPart, unknown> = {
  overview: z.toJSONSchema(PART_SCHEMA.overview),
  tasks: z.toJSONSchema(PART_SCHEMA.tasks),
}

/**
 * Same answer for the same transcript: greedy decoding and a fixed seed. Real recordings still vary;
 * what this rules out is two runs on one transcript disagreeing.
 */
const SEED = 7

/**
 * Ollama adapter for the GenerateRawMinutes port: structured output constrained by the JSON schema
 * of the part asked for, so the model cannot leave a list out or answer outside it.
 */
export function ollamaMinutes(opts: {
  readonly host: string
  readonly model: string
}): GenerateRawMinutes {
  const origin = ollamaHost(opts.host)
  return async (system, user, part) => {
    const res = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        stream: true,
        format: JSON_SCHEMA[part],
        options: { temperature: 0, seed: SEED, num_ctx: 16384 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!res.ok || res.body === null) throw new Error(`Ollama ${res.status}: ${await res.text()}`)
    const content = await streamedContent(res.body)
    return {
      summary: [],
      decisions: [],
      action_items: [],
      ...PART_SCHEMA[part].parse(JSON.parse(content)),
    }
  }
}
