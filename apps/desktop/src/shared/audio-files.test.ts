import { describe, expect, it } from 'vitest'
import { IMPORT_EXTENSIONS, IMPORT_EXTENSIONS_LABEL, isImportableAudio } from './audio-files.ts'

describe('audio files', () => {
  it('derives the check and the label from the one extension list', () => {
    expect(IMPORT_EXTENSIONS_LABEL).toBe('.wav, .m4a or .mp3')
    for (const ext of IMPORT_EXTENSIONS)
      expect(isImportableAudio(`call.${ext.toUpperCase()}`)).toBe(true)
    for (const name of ['notes.txt', 'a.wav.exe', 'wav', 'x.ogg'])
      expect(isImportableAudio(name)).toBe(false)
  })
})
