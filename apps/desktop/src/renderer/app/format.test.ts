import { describe, expect, it } from 'vitest'
import { audioFiles, capitalize, duration, shortcutLabel } from './format.ts'

describe('format', () => {
  it('shows short durations in seconds and longer ones in minutes', () => {
    expect(duration(23)).toBe('23s')
    expect(duration(150)).toBe('3 min')
  })
  it('renders shortcuts per platform', () => {
    expect(shortcutLabel('CommandOrControl+Shift+M', true)).toBe('⌘⇧M')
    expect(shortcutLabel('CommandOrControl+Shift+M', false)).toBe('Ctrl+Shift+M')
  })
  it('capitalizes', () => {
    expect(capitalize('transcribing')).toBe('Transcribing')
  })

  it('keeps only the audio files Tacet can import', () => {
    const names = ['call.WAV', 'memo.m4a', 'talk.mp3', 'notes.txt', 'video.mp4', 'wav']
    expect(audioFiles(names.map((name) => ({ name }))).map((f) => f.name)).toEqual([
      'call.WAV',
      'memo.m4a',
      'talk.mp3',
    ])
  })
})
