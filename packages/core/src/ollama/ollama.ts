import { z } from 'zod'
import { type GenerateRawMinutes, RawMinutesSchema } from '../minutes/types.ts'

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

const Chat = z.object({ message: z.object({ content: z.string() }) })

const MINUTES_JSON_SCHEMA = z.toJSONSchema(RawMinutesSchema)

/** Ollama adapter for the GenerateRawMinutes port: structured output constrained to the minutes schema. */
export function ollamaMinutes(opts: {
  readonly host: string
  readonly model: string
}): GenerateRawMinutes {
  const origin = ollamaHost(opts.host)
  return async (system, user) => {
    const res = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        format: MINUTES_JSON_SCHEMA,
        options: { temperature: 0, num_ctx: 16384 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`)
    const content = Chat.parse(await res.json()).message.content
    return RawMinutesSchema.parse(JSON.parse(content))
  }
}
