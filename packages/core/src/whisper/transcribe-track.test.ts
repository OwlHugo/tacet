import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WavWriter } from '../audio/wav.ts'
import { findFfmpeg, findWhisper, findWhisperOrUndefined } from './binaries.ts'
import { defaultModel, ensureModel, installedModels, modelPath } from './models.ts'
import { echoesVocabulary, vocabularyPrompt, whisperTranscriber } from './transcribe-track.ts'

const dir = () => mkdtempSync(join(tmpdir(), 'tacet-whisper-'))

/** A stand-in for whisper-cli: writes the JSON whisper.cpp would, to the -of path. */
function fakeWhisper(json: unknown, exitCode = 0): string {
  const bin = join(dir(), 'whisper-cli')
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const a = process.argv.slice(2)
if (${exitCode}) { process.stderr.write('model not found\\n'); process.exit(${exitCode}) }
require('node:fs').writeFileSync(a[a.indexOf('-of') + 1] + '.json', ${JSON.stringify(JSON.stringify(json))})
`,
  )
  chmodSync(bin, 0o755)
  return bin
}

/** 1 s of silence, then 2 s of tone: real speech starts at 1 s. */
function wav(): string {
  const path = join(dir(), 'me.wav')
  const w = new WavWriter(path)
  w.write(new Float32Array(16000))
  w.write(
    Float32Array.from({ length: 32000 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / 16000)),
  )
  w.close()
  return path
}

const opts = { model: 'm.bin', language: 'en', vocabulary: [], env: process.env } as const
const posix = process.platform !== 'win32'

describe.runIf(posix)('whisperTranscriber', () => {
  it('reads whisper JSON, drops silence artifacts and snaps timestamps to speech', async () => {
    const bin = fakeWhisper({
      result: { language: 'en' },
      transcription: [
        { offsets: { from: 0, to: 3000 }, text: ' "Ship it on Friday.' },
        { offsets: { from: 1200, to: 2800 }, text: ' [BLANK_AUDIO]' },
      ],
    })
    const r = await whisperTranscriber({ ...opts, bin })({ path: wav(), speaker: 'Me' })
    expect(r.language).toBe('en')
    expect(r.segments).toHaveLength(1)
    expect(r.segments[0]).toMatchObject({ speaker: 'Me', text: 'Ship it on Friday.' })
    expect(r.segments[0]?.start).toBeCloseTo(1, 1)
  })

  it('fails with whisper stderr when the binary fails', async () => {
    const bin = fakeWhisper({}, 3)
    await expect(
      whisperTranscriber({ ...opts, bin })({ path: wav(), speaker: 'Me' }),
    ).rejects.toThrow(/exited with 3: model not found/)
  })

  it('refuses formats it cannot read without ffmpeg', async () => {
    const bin = fakeWhisper({ transcription: [] })
    await expect(
      whisperTranscriber({ ...opts, bin })({ path: 'call.m4a', speaker: 'Me' }),
    ).rejects.toThrow(/without ffmpeg/)
  })

  it('hands the vocabulary to whisper as its initial prompt', async () => {
    const d = dir()
    const bin = join(d, 'whisper-cli')
    writeFileSync(
      bin,
      `#!/usr/bin/env node
const a = process.argv.slice(2)
const fs = require('node:fs')
fs.writeFileSync(${JSON.stringify(join(d, 'args.json'))}, JSON.stringify(a))
fs.writeFileSync(a[a.indexOf('-of') + 1] + '.json', JSON.stringify({ transcription: [] }))
`,
    )
    chmodSync(bin, 0o755)
    await whisperTranscriber({ ...opts, bin, vocabulary: ['Rafaela'] })({
      path: wav(),
      speaker: 'Me',
    })
    const args: string[] = JSON.parse(readFileSync(join(d, 'args.json'), 'utf8'))
    expect(args.slice(args.indexOf('--prompt'))).toEqual(['--prompt', 'Rafaela.'])
  })

  it('rejects output that is not whisper JSON', async () => {
    const bin = fakeWhisper({ segments: 'nope' })
    await expect(
      whisperTranscriber({ ...opts, bin })({ path: wav(), speaker: 'Me' }),
    ).rejects.toThrow()
  })
})

describe('binaries', () => {
  it('finds a binary on the given PATH and honours an explicit path', () => {
    const d = dir()
    const name = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
    writeFileSync(join(d, name), '')
    const base = { searchPath: d, platform: process.platform } as const
    expect(
      findWhisper({
        ...base,
        platform: process.platform === 'darwin' ? 'linux' : process.platform,
      }),
    ).toBe(join(d, name))
    expect(findWhisper({ ...base, explicit: join(d, name) })).toBe(join(d, name))
    expect(() => findWhisper({ ...base, explicit: join(d, 'missing') })).toThrow(/not found at/)
  })

  it('explains how to install whisper when it is nowhere', () => {
    const none = { searchPath: dir(), platform: 'linux' } as const
    expect(findWhisperOrUndefined(none)).toBeUndefined()
    expect(() => findWhisper(none)).toThrow(/brew install whisper-cpp/)
    expect(findFfmpeg(none)).toBeUndefined()
  })
})

describe('models', () => {
  it('maps names to ggml files and accepts explicit paths', async () => {
    expect(modelPath('base', '/m')).toBe(join('/m', 'ggml-base.bin'))
    expect(modelPath('/x/custom.bin', '/m')).toBe('/x/custom.bin')
    const d = dir()
    writeFileSync(join(d, 'ggml-base.bin'), '')
    expect(await ensureModel('base', d)).toBe(join(d, 'ggml-base.bin'))
    await expect(ensureModel(join(d, 'missing.bin'), d)).rejects.toThrow(/Model file not found/)
  })

  it('defaults to the best model already on disk, so nothing is downloaded behind your back', () => {
    const d = dir()
    expect(defaultModel(d)).toBe('base')
    writeFileSync(join(d, 'ggml-tiny.bin'), '')
    expect(defaultModel(d)).toBe('tiny')
    writeFileSync(join(d, 'ggml-base.bin'), '')
    writeFileSync(join(d, 'ggml-small.bin'), '')
    expect(defaultModel(d)).toBe('small')
    writeFileSync(join(d, 'ggml-large-v3-turbo.bin'), '')
    expect(installedModels(d)).toEqual(['large-v3-turbo', 'small', 'base', 'tiny'])
    expect(defaultModel(d)).toBe('large-v3-turbo')
  })
})

describe('vocabularyPrompt', () => {
  it('passes the words as one initial prompt, or nothing', () => {
    expect(vocabularyPrompt([])).toEqual([])
    expect(vocabularyPrompt([' ', ''])).toEqual([])
    expect(vocabularyPrompt(['Kubernetes', ' Rafaela '])).toEqual([
      '--prompt',
      'Kubernetes, Rafaela.',
    ])
  })
})

describe('echoesVocabulary', () => {
  it('flags a segment made only of vocabulary words, never one that also says something else', () => {
    const vocab = ['Kubernetes', 'Rafaela Souza']
    expect(echoesVocabulary('Rafaela.', vocab)).toBe(true)
    expect(echoesVocabulary('Kubernetes, Rafaela Souza.', vocab)).toBe(true)
    expect(echoesVocabulary('Rafaela, você sobe o Kubernetes?', vocab)).toBe(false)
    expect(echoesVocabulary('Rafaela.', [])).toBe(false)
    expect(echoesVocabulary('...', vocab)).toBe(false)
  })
})
