import { describe, expect, it } from 'vitest'
import { INVOKE } from './contract.ts'

const importPath = INVOKE['meetings:import']

describe('meetings:import contract', () => {
  it('accepts absolute paths to wav, m4a and mp3 files', () => {
    for (const p of ['/Users/me/call.wav', '/tmp/x/memo.M4A', 'C:\\Users\\me\\talk.mp3'])
      expect(importPath.parse([p])).toEqual([p])
  })

  it('rejects relative paths, other formats and extra arguments', () => {
    for (const args of [
      ['call.wav'],
      ['../call.wav'],
      ['/tmp/notes.txt'],
      ['/tmp/a.wav.exe'],
      ['/tmp/a.wav', 1],
      [],
    ])
      expect(importPath.safeParse(args).success).toBe(false)
  })
})
