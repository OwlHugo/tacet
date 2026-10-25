import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { snapToSpeech, speechRegions } from './speech.ts'
import { readWav, WavWriter } from './wav.ts'

const tone = (seconds: number, rate = 16000, amp = 0.3) =>
  Float32Array.from(
    { length: Math.round(seconds * rate) },
    (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / rate),
  )

const wav = (...parts: Float32Array[]) => {
  const path = join(mkdtempSync(join(tmpdir(), 'tacet-')), 'x.wav')
  const w = new WavWriter(path)
  for (const p of parts) w.write(p)
  w.close()
  return path
}

describe('wav + speech regions', () => {
  // 1s silence, speech 1..3, silence 3..5, speech 5..6
  const path = wav(new Float32Array(16000), tone(2), new Float32Array(32000), tone(1))

  it('round-trips samples through the writer', () => {
    const pcm = readWav(path)
    expect(pcm.samples.length).toBe(96000)
    expect(pcm.sampleRate).toBe(16000)
  })

  it('finds the speech regions', () => {
    const r = speechRegions(readWav(path))
    expect(r).toHaveLength(2)
    expect(r[0]?.start).toBeCloseTo(1, 1)
    expect(r[0]?.end).toBeCloseTo(3, 1)
    expect(r[1]?.start).toBeCloseTo(5, 1)
  })

  it('snaps drifting segments onto speech and drops segments over silence', () => {
    const out = snapToSpeech(
      [
        { start: 0, end: 3.2, text: 'a' },
        { start: 3.2, end: 6, text: 'b' },
        { start: 3.3, end: 4.6, text: 'ghost' },
      ],
      speechRegions(readWav(path)),
    )
    expect(out.map((s) => s.text)).toEqual(['a', 'b'])
    expect(out[0]?.start).toBeCloseTo(1, 1)
    expect(out[1]?.start).toBeCloseTo(5, 1)
  })

  it('finds nothing in silence', () => {
    expect(speechRegions(readWav(wav(new Float32Array(16000))))).toEqual([])
  })

  it('rejects files that are not WAV', () => {
    expect(() => readWav(join(import.meta.dirname, 'speech.ts'))).toThrow(/not a WAV/)
  })
})
