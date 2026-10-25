import { describe, expect, it } from 'vitest'
import { parseTracks } from './tracks.ts'

describe('parseTracks', () => {
  it('labels a single file as Speaker', () => {
    expect(parseTracks(['call.wav'])).toEqual([{ path: 'call.wav', speaker: 'Speaker' }])
  })
  it('maps --mic and --system to Me and Others', () => {
    expect(parseTracks([], 'a.wav', 'b.wav').map((t) => t.speaker)).toEqual(['Me', 'Others'])
  })
  it('names unlabelled files after themselves when there are several', () => {
    expect(parseTracks(['ana.wav'], 'me.wav').map((t) => t.speaker)).toEqual(['Me', 'ana'])
  })
  it('reads explicit labels', () => {
    expect(parseTracks(['x/me.flac:Me', 'them.wav:Ana'])).toEqual([
      { path: 'x/me.flac', speaker: 'Me' },
      { path: 'them.wav', speaker: 'Ana' },
    ])
  })
})
