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
