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

  it('drops a mic echo whisper stretched over the silence before it', () => {
    const merged = mergeTracks([
      [
        { start: 0, end: 4, speaker: 'Me', text: 'We should ship on Friday' },
        { start: 31.88, end: 32.9, speaker: 'Me', text: 'Beleza, obrigado.' },
      ],
      [
        { start: 2.5, end: 4, speaker: 'Others', text: 'We should ship on Friday' },
        { start: 31.74, end: 32.24, speaker: 'Others', text: 'Beleza' },
      ],
    ])
    expect(merged.map((s) => s.speaker)).toEqual(['Others', 'Others'])
  })

  it('keeps my answer that repeats the question and only touches its edge', () => {
    const merged = mergeTracks([
      [{ start: 13.8, end: 15, speaker: 'Me', text: 'Placar final pronto, sim.' }],
      [{ start: 10, end: 14, speaker: 'Others', text: 'O placar final tá pronto?' }],
    ])
    expect(merged.map((s) => s.speaker)).toEqual(['Others', 'Me'])
  })

  it('keeps a short reply said over the others', () => {
    const merged = mergeTracks([
      [{ start: 11, end: 11.5, speaker: 'Me', text: 'Tá.' }],
      [{ start: 10, end: 14, speaker: 'Others', text: 'Tá, então fecha o placar hoje.' }],
    ])
    expect(merged.map((s) => s.speaker)).toEqual(['Others', 'Me'])
  })

  it('keeps a mic line whisper gave no duration', () => {
    const merged = mergeTracks([
      [{ start: 12, end: 12, speaker: 'Me', text: 'placar final' }],
      [{ start: 10, end: 14, speaker: 'Others', text: 'placar final' }],
    ])
    expect(merged.map((s) => s.speaker)).toEqual(['Others', 'Me'])
  })

  it('keeps a mic line that one system line with its words overlaps by only 0.3', () => {
    const merged = mergeTracks([
      [{ start: 0, end: 10, speaker: 'Me', text: 'placar final atualizado amanhã' }],
      [{ start: 7, end: 20, speaker: 'Others', text: 'placar final atualizado amanhã' }],
    ])
    expect(merged.map((s) => s.speaker)).toEqual(['Me', 'Others'])
  })

  it('keeps every mic line when the system track is empty', () => {
    const mic = [
      { start: 0, end: 2, speaker: 'Me', text: 'Bom dia, pessoal.' },
      { start: 3, end: 5, speaker: 'Me', text: 'Bom dia, pessoal.' },
    ]
    expect(mergeTracks([mic, []]).map((s) => s.text)).toEqual(mic.map((s) => s.text))
  })

  const line = { start: 10, end: 14, speaker: 'Me', text: 'placar final atualizado amanhã' }
  /** Words that keep a single system piece from matching the mic line on its own. */
  const chatter = 'reunião cliente sprint deploy servidor'
  const others = (...pieces: [number, number, string][]) =>
    pieces.map(([start, end, text]) => ({ start, end, speaker: 'Others', text }))

  it.each([
    [
      'the rest is said just after it',
      true,
      others([12, 14, 'placar'], [14, 16, 'final atualizado']),
    ],
    [
      'the rest is said just before it',
      true,
      others([10, 12, 'placar'], [8, 10, 'final atualizado']),
    ],
    [
      'unrelated talk covers it and its words come right after',
      true,
      others([10, 14, 'reunião cliente'], [14.5, 16, 'placar final atualizado amanhã']),
    ],
    [
      'the same words come much later',
      true,
      others([11, 12, 'beleza'], [20, 22, 'placar final atualizado amanhã']),
    ],
    ['half of the words are heard', false, others([10, 14, `placar final ${chatter}`])],
    ['the others talk over half of it', false, others([12, 14, `${line.text} ${chatter}`])],
    ['the others talk over less than half', true, others([12.1, 14, `${line.text} ${chatter}`])],
    ['the others only start in its last second', true, others([13, 30, line.text])],
    [
      'the system pieces come out of order',
      false,
      others([12.5, 14, `atualizado amanhã ${chatter}`], [10, 13, `placar final ${chatter}`]),
    ],
    [
      'overlapping system pieces cover under half',
      true,
      others([10, 11.5, `placar final ${chatter}`], [10, 11.5, `atualizado amanhã ${chatter}`]),
    ],
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
