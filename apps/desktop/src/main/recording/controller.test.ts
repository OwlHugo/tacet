import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RecorderState } from '../../shared/contract.ts'
import { EVENTS } from '../../shared/events.ts'
import { recordingController } from './controller.ts'
import type { RecordedTrack } from './session.ts'

function setup(fakeMic?: string) {
  let state: RecorderState = { kind: 'idle' }
  const sent: { channel: string; args: unknown[] }[] = []
  const recorded: RecordedTrack[][] = []
  const states: string[] = []
  const saw: RecorderState[] = []
  let asked = 0
  const c = recordingController({
    recorder: () => ({ webContents: { send: (channel, ...args) => sent.push({ channel, args }) } }),
    notesFolder: () => mkdtempSync(join(tmpdir(), 'tacet-ctl-')),
    getState: () => state,
    setState: (s) => {
      state = s
      states.push(s.kind)
      saw.push(s)
    },
    askMicrophone: async () => {
      asked++
    },
    fakeMic,
    onRecorded: (_session, tracks) => recorded.push(tracks),
  })
  return { c, sent, recorded, states, saw, asked: () => asked, state: () => state }
}

describe('recordingController', () => {
  it('asks for the mic, tells the recorder to start and records the tracks it streams', async () => {
    const t = setup()
    await t.c.toggle()
    expect(t.asked()).toBe(1)
    expect(t.sent[0]).toEqual({ channel: EVENTS.recorderStart, args: [{ fakeMic: undefined }] })
    expect(t.state().kind).toBe('starting')

    t.c.open('mic', 16000)
    t.c.started(['mic'], ['System audio unavailable'])
    expect(t.state()).toMatchObject({
      kind: 'recording',
      tracks: ['mic'],
      warnings: ['System audio unavailable'],
    })
    t.c.chunk('mic', new Float32Array(16000).fill(0.2))

    const stopping = t.c.toggle()
    expect(t.sent[1]?.channel).toBe(EVENTS.recorderStop)
    t.c.closed()
    await stopping
    expect(t.states).toContain('processing')
    expect(t.saw).toContainEqual({ kind: 'processing', stage: 'saving audio', source: 'recording' })
    expect(t.recorded[0]?.map((r) => r.track)).toEqual(['mic'])
  })

  it('reports an error when nothing was captured', async () => {
    const t = setup()
    await t.c.toggle()
    t.c.open('mic', 16000)
    t.c.started(['mic'], [])
    const stopping = t.c.toggle()
    t.c.closed()
    await stopping
    expect(t.state()).toMatchObject({ kind: 'error', cause: 'capture' })
    expect(t.recorded).toEqual([])
  })

  it('ignores toggles while starting and recovers from a failed start', async () => {
    const t = setup()
    await t.c.toggle()
    await t.c.toggle()
    expect(t.sent).toHaveLength(1)
    t.c.failed('no devices')
    expect(t.state()).toEqual({ kind: 'error', message: 'no devices', cause: 'capture' })
    await t.c.toggle()
    expect(t.sent).toHaveLength(2)
  })

  it('sends the fake microphone bytes in e2e runs', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'tacet-ctl-')), 'mic.wav')
    writeFileSync(file, Buffer.from([1, 2, 3]))
    const t = setup(file)
    await t.c.toggle()
    expect(t.sent[0]?.args[0]).toEqual({ fakeMic: new Uint8Array([1, 2, 3]) })
  })

  it('does nothing on stop without a recording', async () => {
    const t = setup()
    await t.c.stop()
    expect(t.sent).toEqual([])
  })
})
