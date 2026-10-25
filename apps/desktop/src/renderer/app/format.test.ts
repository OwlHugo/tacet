import { describe, expect, it } from 'vitest'
import { capitalize, duration, shortcutLabel } from './format.ts'

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
})
