import { describe, expect, it } from 'vitest'
import { INVOKE, invalidArguments } from './contract.ts'

const importPath = INVOKE['meetings:import']

describe('meetings:import contract', () => {
  it('accepts absolute POSIX, Windows drive and UNC paths to wav, m4a and mp3 files', () => {
    for (const p of [
      '/Users/me/call.wav',
      '/tmp/x/memo.M4A',
      '/a/../b.wav',
      'C:\\Users\\me\\talk.mp3',
      'C:/Users/me/talk.mp3',
      '\\\\server\\share\\reuniao.wav',
    ])
      expect(importPath.parse([p])).toEqual([p])
  })

  it('rejects relative paths, other formats and extra arguments', () => {
    for (const args of [
      ['call.wav'],
      ['../call.wav'],
      ['C:call.wav'],
      ['\\\\server.wav'],
      ['/tmp/notes.txt'],
      ['/tmp/a.wav.exe'],
      ['/tmp/a.ogg'],
      ['/tmp/a.wav', 1],
      [],
    ])
      expect(importPath.safeParse(args).success).toBe(false)
  })

  it('turns a rejection into one readable line instead of zod JSON', () => {
    const { error } = importPath.safeParse([''])
    expect(error && invalidArguments('meetings:import', error)).toBe(
      'Invalid meetings:import: expected an absolute path; expected a .wav, .m4a or .mp3 file',
    )
  })
})
