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
let lastBody: { model: string; format: unknown; messages: { role: string }[] } | undefined
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
      res.end(JSON.stringify({ message: { content: JSON.stringify(chatReply) } }))
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

  it('asks for structured output and validates the answer', async () => {
    chatReply = {
      summary: [],
      decisions: [],
      action_items: [{ task: 'x', owner: 'Me', due: '', quote: 'x', segments: [0] }],
    }
    const raw = await ollamaMinutes({ host, model: 'qwen2.5:7b' })('system', 'user')
    expect(raw.action_items[0]?.task).toBe('x')
    expect(lastBody?.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(lastBody?.format).toMatchObject({ type: 'object' })
  })

  it('rejects an answer outside the schema and surfaces HTTP errors', async () => {
    chatReply = { summary: 'not a list' }
    await expect(ollamaMinutes({ host, model: 'qwen2.5:7b' })('s', 'u')).rejects.toThrow()
    await expect(ollamaMinutes({ host, model: 'missing' })('s', 'u')).rejects.toThrow(
      /Ollama 404: model "missing" not found/,
    )
  })
})
