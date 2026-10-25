import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCases } from './cases.ts'

describe('loadCases', () => {
  it('loads every case with its fixture, sorted by id', () => {
    const cases = loadCases(join(import.meta.dirname, 'cases'))
    expect(cases.map((c) => c.id)).toEqual([
      '01-launch-sync-en',
      '02-hiring-en',
      '03-planejamento-pt',
    ])
    for (const c of cases) {
      expect(c.tracks.map((t) => t.speaker).sort()).toEqual(['Me', 'Others'])
      expect(c.fixture.transcript.segments.length).toBeGreaterThan(0)
      expect(c.reference.length).toBeGreaterThan(0)
    }
  })
})
