import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RecorderState } from '../shared/contract.ts'
import { audioImporter, resolveImportPath } from './import-audio.ts'

const exists = () => 'file' as const

describe('resolveImportPath', () => {
  it('resolves dot segments before checking the extension', () => {
    expect(resolveImportPath('/a/../b.wav', 'darwin', exists)).toBe('/b.wav')
    expect(resolveImportPath('/a/./b/../c.MP3', 'linux', exists)).toBe('/a/c.MP3')
  })

  it('normalizes Windows drive paths with either slash and keeps UNC shares', () => {
    expect(resolveImportPath('C:/Users/me/../call.wav', 'win32', exists)).toBe(
      'C:\\Users\\call.wav',
    )
    expect(resolveImportPath('\\\\server\\share\\x\\..\\call.m4a', 'win32', exists)).toBe(
      '\\\\server\\share\\call.m4a',
    )
  })

  it('refuses a path that stops being audio once resolved, and a missing file', () => {
    expect(() => resolveImportPath('/a/b.wav/..', 'darwin', exists)).toThrow(
      /\.wav, \.m4a or \.mp3/,
    )
    expect(() => resolveImportPath('/a/b.wav', 'darwin', () => 'missing')).toThrow(
      'File not found: /a/b.wav',
    )
  })

  it('checks the real disk by default: a missing file or a folder named like audio is refused', () => {
    expect(() => resolveImportPath('/no/such/dir/x.wav', process.platform)).toThrow(
      /File not found/,
    )
    const dir = join(mkdtempSync(join(tmpdir(), 'tacet-imp-')), 'folder.wav')
    mkdirSync(dir)
    expect(() => resolveImportPath(dir, process.platform)).toThrow(/it is a folder or a device/)
    const file = join(dir, '..', 'real.wav')
    writeFileSync(file, '')
    expect(resolveImportPath(file, process.platform)).toBe(resolve(file))
  })
})

function setup(
  initial: RecorderState,
  run: (path: string) => Promise<string>,
  resolve: (raw: string) => string = (raw) => raw,
) {
  let state = initial
  const seen: RecorderState[] = []
  const importAudio = audioImporter({
    getState: () => state,
    setState: (s) => {
      state = s
      seen.push(s)
    },
    resolve,
    run,
  })
  return { importAudio, seen, state: () => state }
}

describe('audioImporter', () => {
  it('runs the pipeline and goes back to idle', async () => {
    const t = setup({ kind: 'idle' }, async (p) => `id:${p}`)
    await expect(t.importAudio('/x.wav')).resolves.toBe('id:/x.wav')
    expect(t.seen).toEqual([
      { kind: 'processing', stage: 'transcribing', source: 'import' },
      { kind: 'idle' },
    ])
  })

  it('refuses while recording or processing and leaves that state alone', async () => {
    for (const busy of [
      { kind: 'processing', stage: 'transcribing', source: 'import' },
      { kind: 'recording', startedAt: 1, tracks: ['mic'], warnings: [] },
      { kind: 'starting' },
    ] satisfies RecorderState[]) {
      let ran = false
      const t = setup(busy, async () => {
        ran = true
        return 'x'
      })
      await expect(t.importAudio('/x.wav')).rejects.toThrow(
        'Wait for the current meeting to finish.',
      )
      expect({ ran, seen: t.seen, state: t.state() }).toEqual({ ran: false, seen: [], state: busy })
    }
  })

  it('rejects with a pipeline failure and puts the recorder back to idle', async () => {
    const t = setup({ kind: 'error', message: 'old', cause: 'pipeline' }, async () => {
      throw new Error('ffmpeg: invalid data')
    })
    await expect(t.importAudio('/x.mp3')).rejects.toThrow('ffmpeg: invalid data')
    expect(t.seen.map((s) => s.kind)).toEqual(['processing', 'idle'])
  })

  it('refuses a path that does not resolve to a file without touching the state', async () => {
    let ran = false
    const t = setup(
      { kind: 'error', message: 'ffmpeg: invalid data', cause: 'pipeline' },
      async () => {
        ran = true
        return 'x'
      },
      (raw) => resolveImportPath(raw, 'darwin', () => 'missing'),
    )
    await expect(t.importAudio('/gone.wav')).rejects.toThrow('File not found: /gone.wav')
    expect({ ran, seen: t.seen }).toEqual({ ran: false, seen: [] })
  })

  it('hands the resolved path to the pipeline', async () => {
    const t = setup(
      { kind: 'idle' },
      async (p) => p,
      (raw) => resolveImportPath(raw, 'linux', exists),
    )
    await expect(t.importAudio('/a/../b.wav')).resolves.toBe('/b.wav')
  })
})
