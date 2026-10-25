import { describe, expect, it } from 'vitest'
import { transcribe } from './transcribe.ts'
import type { TranscribeTrack } from './types.ts'

describe('transcribe', () => {
  it('transcribes each track with its speaker and reports the detected language', async () => {
    const fake: TranscribeTrack = async (t) => ({
      segments:
        t.speaker === 'Me'
          ? [{ start: 4, end: 5, speaker: 'Me', text: 'sounds good' }]
          : [{ start: 0, end: 3, speaker: 'Others', text: 'shall we start' }],
      language: t.speaker === 'Me' ? 'auto' : 'pt',
    })
    const r = await transcribe(
      [
        { path: 'me.wav', speaker: 'Me' },
        { path: 'others.wav', speaker: 'Others' },
      ],
      fake,
      'base',
    )
    expect(r.segments.map((s) => s.speaker)).toEqual(['Others', 'Me'])
    expect(r.language).toBe('pt')
    expect(r.duration).toBe(5)
    expect(r.model).toBe('base')
  })
})
