import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ollamaHost, ollamaMinutes, ollamaModels } from './ollama.ts'

describe('ollamaHost', () => {
  it('accepts loopback hosts only', () => {
    expect(ollamaHost('127.0.0.1:11434')).toBe('http://127.0.0.1:11434')
    expect(ollamaHost('http://localhost:11434')).toBe('http://localhost:11434')
    expect(ollamaHost('0.0.0.0:11434')).toBe('http://127.0.0.1:11434')
    expect(() => ollamaHost('https://ollama.example.com')).toThrow(
      /only talks to an Ollama running on this machine/,
    )
    expect(() => ollamaHost('http://192.168.0.10:11434')).toThrow()
  })
})

/** A local stand-in for the Ollama HTTP API. */
let server: Server
let host: string
let lastBody:
  | {
      model: string
      stream: boolean
      format: unknown
      options: unknown
      messages: { role: string }[]
    }
  | undefined
let chatReply: unknown

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c: Buffer) => {
      body += c.toString()
    })
    req.on('end', () => {
      if (req.url === '/api/tags')
        return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }] }))
      lastBody = JSON.parse(body)
      if (lastBody?.model === 'missing') {
        res.statusCode = 404
        return res.end('model "missing" not found')
      }
      if (lastBody?.model === 'crashes') {
        res.write(`${JSON.stringify({ message: { content: '{"sum' }, done: false })}\n`)
        return res.end(`${JSON.stringify({ error: 'llama runner process has terminated' })}\n`)
      }
      // Streamed like Ollama: one JSON line per piece of the content, split mid-line on the wire.
      const content = JSON.stringify(chatReply)
      const half = Math.floor(content.length / 2)
      const lines = [content.slice(0, half), content.slice(half)]
        .map((piece) => `${JSON.stringify({ message: { content: piece }, done: false })}\n`)
        .join('')
      const wire = `${lines}${JSON.stringify({ message: { content: '' }, done: true })}`
      res.write(wire.slice(0, 7))
      setTimeout(() => res.end(wire.slice(7)), 5)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

describe('ollama adapter', () => {
  it('lists models, and reports a stopped Ollama as undefined', async () => {
    expect(await ollamaModels(host)).toEqual(['qwen2.5:7b'])
    expect(await ollamaModels('127.0.0.1:1')).toBeUndefined()
  })

  it('asks for the schema of the part, greedy and seeded, and validates the answer', async () => {
    const items = [{ task: 'x', owner: 'Me', due: '', quote: 'x', segments: [0] }]
    chatReply = { action_items: items }
    const raw = await ollamaMinutes({ host, model: 'qwen2.5:7b' })('system', 'user', 'tasks')
    expect(raw).toEqual({ action_items: items })
    expect(lastBody?.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(lastBody?.stream).toBe(true)
    expect(lastBody?.format).toMatchObject({ required: ['action_items'] })
    expect(lastBody?.options).toEqual({ temperature: 0, seed: 7, num_ctx: 8192 })
    chatReply = { kind: 'joke', agreed: false }
    const check = await ollamaMinutes({ host, model: 'qwen2.5:7b' })('s', 'u', 'confirm')
    expect(check).toEqual({ kind: 'joke', agreed: false })
    expect(lastBody?.format).toMatchObject({ required: ['kind', 'agreed'] })
  })

  it('rejects an answer outside the schema and surfaces HTTP errors', async () => {
    chatReply = { summary: 'not a list' }
    await expect(
      ollamaMinutes({ host, model: 'qwen2.5:7b' })('s', 'u', 'summary'),
    ).rejects.toThrow()
    await expect(ollamaMinutes({ host, model: 'missing' })('s', 'u', 'tasks')).rejects.toThrow(
      /Ollama 404: model "missing" not found/,
    )
  })

  it("surfaces Ollama's own message when the runner fails in the middle of the answer", async () => {
    await expect(ollamaMinutes({ host, model: 'crashes' })('s', 'u', 'summary')).rejects.toThrow(
      'Ollama: llama runner process has terminated',
    )
  })
})
