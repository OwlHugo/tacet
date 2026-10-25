import { describe, expect, it } from 'vitest'
import { coverage, normalize, similarity } from './words.ts'

describe('words', () => {
  it('normalizes case, accents and punctuation', () => {
    expect(normalize('  Reunião, às TRÊS! ')).toBe('reuniao as tres')
  })
  it('measures coverage of content words with plural stemming', () => {
    expect(coverage('update the pricing pages', 'Maria will update the pricing page')).toBe(1)
    expect(coverage('the a of', 'anything')).toBe(0)
  })
  it('measures similarity', () => {
    expect(similarity('ship the beta friday', 'ship beta on friday')).toBe(1)
    expect(similarity('', 'x')).toBe(0)
  })
})
