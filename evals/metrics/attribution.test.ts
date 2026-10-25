import type { Transcript } from '@tacet/core'
import { describe, expect, it } from 'vitest'
import { speakerAccuracy, timestampError } from './attribution.ts'

const T: Transcript = {
  language: 'en',
  model: 'base',
  duration: 10,
  segments: [
    {
      id: 0,
      start: 0.5,
      end: 4,
      speaker: 'Others',
      text: 'Morning everyone, the agenda is the launch.',
    },
    { id: 1, start: 5.2, end: 9, speaker: 'Others', text: 'We should ship the beta on Friday.' },
  ],
}

describe('attribution', () => {
  const reference = [
    { speaker: 'Others', text: 'Morning everyone. The agenda is the launch.', start: 0.5 },
    { speaker: 'Me', text: 'We should ship the beta on Friday.', start: 5 },
  ]
  it('counts a line heard on the wrong track as misattributed', () => {
    expect(speakerAccuracy(reference, T)).toBe(0.5)
  })
  it('measures timestamp error on the lines it can find', () => {
    expect(timestampError(reference, T)).toBe(0)
    expect(timestampError([], T)).toBeUndefined()
  })
})
