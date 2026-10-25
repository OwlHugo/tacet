import { describe, expect, it } from 'vitest'
import { importedMeeting, recordedTracks } from './pipeline.ts'

describe('pipeline input', () => {
  it('turns an imported file into one track titled after the file', () => {
    expect(importedMeeting('/Users/me/Sprint review.m4a')).toEqual({
      title: 'Sprint review',
      tracks: [{ path: '/Users/me/Sprint review.m4a', speaker: 'Speaker' }],
    })
  })

  it('labels recorded tracks Me and Others', () => {
    expect(
      recordedTracks([
        { track: 'mic', path: '/a/mic.wav', seconds: 3 },
        { track: 'system', path: '/a/system.wav', seconds: 3 },
      ]).map((t) => t.speaker),
    ).toEqual(['Me', 'Others'])
  })
})
