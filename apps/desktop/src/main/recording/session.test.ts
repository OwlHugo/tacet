import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWav } from '@tacet/core'
import { describe, expect, it } from 'vitest'
import { chunkLevel, RecordingSession } from './session.ts'

describe('RecordingSession', () => {
  it('writes one wav per track and skips empty tracks', () => {
    const s = new RecordingSession('x', mkdtempSync(join(tmpdir(), 'tacet-rec-')))
    s.open('mic', 16000)
    s.open('system', 16000)
    for (let i = 0; i < 10; i++) s.write('mic', new Float32Array(4096).fill(0.25))
    const tracks = s.close()
    expect(tracks.map((t) => t.track)).toEqual(['mic'])
    expect(tracks[0]?.seconds).toBeCloseTo(2.56, 2)
    expect(readWav(tracks[0]?.path ?? '').samples[100]).toBeCloseTo(0.25, 3)
  })
})

describe('chunkLevel', () => {
  it('maps silence to 0, full scale to 1 and a quiet voice in between', () => {
    expect(chunkLevel(new Float32Array(0))).toBe(0)
    expect(chunkLevel(new Float32Array(4096))).toBe(0)
    expect(chunkLevel(new Float32Array(4096).fill(1))).toBeCloseTo(1, 5)
    expect(chunkLevel(new Float32Array(4096).fill(-1))).toBeCloseTo(1, 5)
    expect(chunkLevel(new Float32Array(4096).fill(0.03))).toBeCloseTo(0.49, 2)
  })
})
