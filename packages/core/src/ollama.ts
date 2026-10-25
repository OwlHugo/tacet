export interface OllamaOptions {
  /** Default http://127.0.0.1:11434 (or $OLLAMA_HOST). Only loopback hosts are accepted. */
  host?: string;
  model: string;
  temperature?: number;
  signal?: AbortSignal;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function ollamaHost(host?: string): string {
  let raw = host ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
  if (!/^https?:\/\//.test(raw)) raw = `http://${raw}`;
  const url = new URL(raw);
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
  if (!LOOPBACK.has(url.hostname)) {
    throw new Error(`Refusing to send a transcript to ${url.hostname}: Tacet only talks to an Ollama running on this machine.`);
  }
  return url.origin;
}

export async function ollamaAvailable(host?: string): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaHost(host)}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ollamaModels(host?: string): Promise<string[]> {
  const res = await fetch(`${ollamaHost(host)}/api/tags`);
  const json = (await res.json()) as { models: { name: string }[] };
  return json.models.map((m) => m.name);
}

/** Chat completion constrained to a JSON schema (Ollama structured outputs). */
export async function ollamaJson<T>(system: string, user: string, schema: object, opts: OllamaOptions): Promise<T> {
  const res = await fetch(`${ollamaHost(opts.host)}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      format: schema,
      options: { temperature: opts.temperature ?? 0, num_ctx: 16384 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { message: { content: string } };
  return JSON.parse(json.message.content) as T;
}
