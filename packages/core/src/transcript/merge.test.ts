import { describe, expect, it } from 'vitest'
import { cleanText, isHallucination, mergeTracks } from './merge.ts'

describe('mergeTracks', () => {
  it('interleaves tracks by time and assigns ids', () => {
    const merged = mergeTracks([
      [{ start: 5, end: 7, speaker: 'Me', text: 'second' }],
      [{ start: 1, end: 3, speaker: 'Others', text: 'first' }],
    ])
    expect(merged.map((s) => [s.id, s.text])).toEqual([
      [0, 'first'],
      [1, 'second'],
    ])
  })

  it('drops mic echo of the system audio', () => {
    const merged = mergeTracks([
      [
        { start: 1.1, end: 3.9, speaker: 'Me', text: 'We should ship on Friday.' },
        { start: 10, end: 12, speaker: 'Me', text: 'Sounds good to me.' },
      ],
      [{ start: 1, end: 4, speaker: 'Others', text: 'We should ship on Friday' }],
    ])
    expect(merged.map((s) => `${s.speaker}:${s.text}`)).toEqual([
      'Others:We should ship on Friday',
      'Me:Sounds good to me.',
    ])
  })

  it('drops a long mic echo of a line the system track split into short pieces', () => {
    const merged = mergeTracks([
      [
        {
          start: 16.7,
          end: 21.5,
          speaker: 'Me',
          text: 'Bia, por favor, revisa a planilha de horários do mutirão, se der ainda hoje, tá?',
        },
      ],
      [
        {
          start: 16.6,
          end: 18.6,
          speaker: 'Others',
          text: 'Bia, por favor, revisa a planilha',
        },
        { start: 18.6, end: 19.9, speaker: 'Others', text: 'De horários do mutirão' },
        { start: 19.9, end: 21.5, speaker: 'Others', text: 'Se der ainda hoje, tá?' },
      ],
    ])
    expect(merged.map((s) => s.speaker)).toEqual(['Others', 'Others', 'Others'])
  })

  it('keeps my own line that shares words with an answer that comes after it', () => {
    const merged = mergeTracks([
      [{ start: 0.96, end: 4.26, speaker: 'Me', text: 'Opa! Bom dia, pessoal! Tão me ouvindo?' }],
      [{ start: 5.64, end: 7.6, speaker: 'Others', text: 'Bom dia, Hugo, estou ouvindo.' }],
    ])
    expect(merged.map((s) => s.speaker)).toEqual(['Me', 'Others'])
  })

  const line = { start: 10, end: 14, speaker: 'Me', text: 'placar final atualizado amanhã' }
  const others = (...pieces: [number, number, string][]) =>
    pieces.map(([start, end, text]) => ({ start, end, speaker: 'Others', text }))

  it.each([
    [
      'the rest is said just after',
      false,
      others([12, 14, 'placar'], [15, 16, 'final atualizado']),
    ],
    [
      'the rest starts right at the slack',
      true,
      others([12, 14, 'placar'], [15.5, 16, 'final atualizado']),
    ],
    [
      'the rest is said just before',
      false,
      others([10, 12, 'placar'], [7.6, 9, 'final atualizado']),
    ],
    [
      'the rest ends right at the slack',
      true,
      others([10, 12, 'placar'], [7.5, 8.5, 'final atualizado']),
    ],
    [
      'the same words come much later',
      true,
      others([11, 12, 'beleza'], [20, 22, 'placar final atualizado amanhã']),
    ],
    ['half of the words are heard', false, others([10, 14, 'placar final'])],
  ])('when %s, keeps the mic line: %s', (_, kept, system) => {
    const merged = mergeTracks([[line], system])
    expect(merged.some((s) => s.speaker === 'Me')).toBe(kept)
  })
})

describe('isHallucination', () => {
  it('flags whisper silence artifacts only', () => {
    expect(isHallucination('[BLANK_AUDIO]')).toBe(true)
    expect(isHallucination('(music)')).toBe(true)
    expect(isHallucination('Thank you.')).toBe(true)
    expect(isHallucination('Thank you for joining, let us start.')).toBe(false)
  })
})

describe('cleanText', () => {
  it('drops an unmatched leading quote', () => {
    expect(cleanText(' "I think we ship')).toBe('I think we ship')
    expect(cleanText('He said "ship it"')).toBe('He said "ship it"')
  })
})
