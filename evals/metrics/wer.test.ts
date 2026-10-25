import { describe, expect, it } from 'vitest'
import { wer } from './wer.ts'

describe('wer', () => {
  it('is zero for identical text, ignoring case and punctuation', () => {
    expect(wer('Hello, World!', 'hello world').wer).toBe(0)
  })
  it('counts substitutions and deletions', () => {
    const r = wer('the cat sat on the mat', 'the cat sit on mat')
    expect([r.substitutions, r.deletions, r.insertions]).toEqual([1, 1, 0])
    expect(r.wer).toBeCloseTo(2 / 6)
  })
  it('counts insertions', () => {
    expect(wer('ship it', 'ship it now').insertions).toBe(1)
  })
  it('ignores accents', () => {
    expect(wer('reunião às três', 'reuniao as tres').wer).toBe(0)
  })
  it('handles an empty reference', () => {
    expect(wer('', '').wer).toBe(0)
    expect(wer('', 'noise').wer).toBe(1)
  })
})
