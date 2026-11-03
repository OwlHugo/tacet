import { join } from 'node:path'
import { groundMinutes, type RawMinutes } from '@tacet/core'
import { describe, expect, it } from 'vitest'
import { loadCases } from './cases.ts'
import { checkAnswerKey } from './metrics/answer-key.ts'

const CASE = loadCases(join(import.meta.dirname, 'cases')).find(
  (c) => c.id === '08-agendamento-longo-pt',
)

describe('a long call whose chunks open with the main subject again (issue #8)', () => {
  it('shows it once, and the summary keeps every point of the answer key', () => {
    const fixture = CASE?.fixture
    const key = CASE?.answer_key
    if (fixture === undefined || key === undefined) throw new Error('case 08 has no fixture or key')
    const [first, ...rest] = fixture.raw.summary
    if (first === undefined) throw new Error('case 08 recorded no summary')
    // The recorded points, with what chunks 2 and 3 write when they open with the subject again.
    const raw: RawMinutes = {
      ...fixture.raw,
      summary: [
        first,
        ...rest.slice(0, 3),
        { text: 'Lançamento do agendamento online da clínica', segments: first.segments },
        ...rest.slice(3, 6),
        { text: 'Agendamento online na clínica, lançamento', segments: first.segments },
        ...rest.slice(6),
      ],
    }
    const before = checkAnswerKey(groundMinutes(fixture.raw, fixture.transcript, 'm'), key).summary
    const repeated = checkAnswerKey(groundMinutes(raw, fixture.transcript, 'm'), key).summary
    expect(repeated).toEqual(before)
    expect(repeated.found).toBe(repeated.total)
  })
})
