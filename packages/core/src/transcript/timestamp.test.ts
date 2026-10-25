import { describe, expect, it } from 'vitest'
import { blockId, formatTimestamp } from './timestamp.ts'

describe('formatTimestamp', () => {
  it('formats minutes and hours', () => {
    expect(formatTimestamp(9.7)).toBe('00:09')
    expect(formatTimestamp(3725)).toBe('1:02:05')
    expect(formatTimestamp(-1)).toBe('00:00')
  })
  it('builds block ids', () => {
    expect(blockId(3)).toBe('t0003')
  })
})
