import { describe, expect, it } from 'vitest'
import { coverage, findPhrase, normalize, similarity } from './words.ts'

describe('words', () => {
  it('normalizes case, accents and punctuation', () => {
    expect(normalize('  Reunião, às TRÊS! ')).toBe('reuniao as tres')
  })
  it('measures coverage of content words with plural stemming', () => {
    expect(coverage('update the pricing pages', 'Maria will update the pricing page')).toBe(1)
    expect(coverage('the a of', 'anything')).toBe(0)
  })
  it('finds a phrase said in a row and returns it as it was written', () => {
    expect(findPhrase('ate SEXTA', 'Entrego até sexta-feira, combinado?')).toBe('até sexta')
    expect(findPhrase('até sexta-feira', 'Entrego até sexta-feira, combinado?')).toBe(
      'até sexta-feira',
    )
    expect(findPhrase('sexta até', 'Entrego até sexta-feira')).toBeUndefined()
    expect(findPhrase('by Thursday', 'by the way, Thursday')).toBeUndefined()
    expect(findPhrase('!!', 'anything')).toBeUndefined()
    expect(findPhrase('end', 'the end')).toBe('end')
  })
  it('measures similarity', () => {
    expect(similarity('ship the beta friday', 'ship beta on friday')).toBe(1)
    expect(similarity('', 'x')).toBe(0)
  })
})
