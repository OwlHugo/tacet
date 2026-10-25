import { describe, expect, it } from 'vitest'
import type { TranscribeTrack } from '../transcript/types.ts'
import { processMeeting } from './process.ts'

const input = {
  id: 'm1',
  title: 'Sync',
  date: new Date('2026-10-24T14:30:00Z'),
  tracks: [{ path: 'a.wav', speaker: 'Me' }],
}
const clock = () => {
  let t = 0
  return () => (t += 500)
}
const speaking: TranscribeTrack = async (t) => ({
  segments: [{ start: 0, end: 2, speaker: t.speaker, text: 'I will send the release notes' }],
  language: 'en',
})

describe('processMeeting', () => {
  it('writes grounded minutes when there is an LLM', async () => {
    const stages: string[] = []
    const m = await processMeeting(input, {
      transcribeTrack: speaking,
      whisperModel: 'base',
      now: clock(),
      onStage: (s) => stages.push(s),
      minutes: {
        model: 'fake',
        generate: async () => ({
          summary: [],
          decisions: [],
          action_items: [
            {
              task: 'Send the release notes',
              owner: '',
              due: '',
              quote: 'I will send the release notes',
              segments: [0],
            },
          ],
        }),
      },
    })
    expect(stages).toEqual(['transcribing', 'minutes'])
    expect(m.minutes?.actionItems[0]?.owner).toBe('Me')
    expect(m.timings).toEqual({ transcribeSeconds: 0.5, minutesSeconds: 0.5 })
    expect(m.date).toBe('2026-10-24T14:30:00.000Z')
  })

  it('saves the transcript only without an LLM or without speech', async () => {
    const silent: TranscribeTrack = async () => ({ segments: [], language: 'auto' })
    const noLlm = await processMeeting(input, {
      transcribeTrack: speaking,
      whisperModel: 'base',
      now: clock(),
    })
    expect(noLlm.minutes).toBeUndefined()
    const generate = async () => {
      throw new Error('must not be called')
    }
    const quiet = await processMeeting(input, {
      transcribeTrack: silent,
      whisperModel: 'base',
      now: clock(),
      minutes: { model: 'x', generate },
    })
    expect(quiet.minutes).toBeUndefined()
  })
})
