import { describe, expect, it } from 'vitest'
import { TRANSCRIPT } from '../testing.ts'
import type { Transcript } from '../transcript/types.ts'
import { groundMinutes } from './ground.ts'
import type { RawMinutes } from './types.ts'

const RAW: RawMinutes = {
  summary: [
    { text: 'The team planned the beta launch for Friday.', segments: [0, 1, 2] },
    { text: 'Budget for Q3 was approved.', segments: [0] },
  ],
  decisions: [
    { text: 'Ship the beta on Friday', quote: 'Agreed, Friday it is.', segments: [2] },
    {
      text: 'Drop the dark mode toggle',
      quote: 'drop the dark mode toggle for now',
      segments: [3],
    },
    { text: 'Hire two engineers', quote: 'we will hire two engineers', segments: [1] },
  ],
  action_items: [
    {
      task: 'Update the pricing page',
      owner: 'Maria',
      due: '',
      quote: 'Maria will update the pricing page.',
      segments: [2],
    },
    {
      task: 'Send the release notes to the team by Thursday',
      owner: 'Me',
      due: '',
      quote: 'I will send the release notes',
      segments: [3],
    },
    {
      task: 'Book the venue',
      owner: 'John',
      due: '',
      quote: 'John books the venue',
      segments: [1],
    },
  ],
}

const one = (
  task: string,
  owner: string,
  quote: string,
  segments: number[],
  due = '',
): RawMinutes => ({
  summary: [],
  decisions: [],
  action_items: [{ task, owner, due, quote, segments }],
})

const DIALOGUE: Transcript = {
  language: 'pt',
  model: 'base',
  duration: 12,
  segments: [
    {
      id: 0,
      start: 0,
      end: 4,
      speaker: 'Me',
      text: 'Ana, você fica com o contrato do fornecedor.',
    },
    { id: 1, start: 4.5, end: 7, speaker: 'Others', text: 'Fechado, entrego até quarta-feira.' },
    { id: 2, start: 7.5, end: 12, speaker: 'Me', text: 'E o deploy fica pra sexta.' },
  ],
}

describe('groundMinutes', () => {
  const m = groundMinutes(RAW, TRANSCRIPT, 'test')

  it('keeps only items backed by the transcript', () => {
    expect(m.summary.map((s) => s.text)).toEqual(['The team planned the beta launch for Friday.'])
    expect(m.decisions.map((d) => d.text)).toEqual([
      'Ship the beta on Friday',
      'Drop the dark mode toggle',
    ])
    expect(m.actionItems.map((a) => a.task)).toEqual([
      'Update the pricing page',
      'Send the release notes to the team by Thursday',
    ])
    expect(m.rejected.map((r) => r.text).sort()).toEqual([
      'Book the venue',
      'Budget for Q3 was approved.',
      'Hire two engineers',
    ])
  })

  it('re-anchors a quote cited on the wrong line and takes the time from the transcript', () => {
    const dark = m.decisions.find((d) => d.text.startsWith('Drop'))
    expect(dark?.segments).toEqual([4])
    expect(dark?.at).toBe(20.5)
  })

  it('keeps a named owner only when the name was said', () => {
    expect(m.actionItems[0]?.owner).toBe('Maria')
    const fake = groundMinutes(
      one('Update the pricing page', 'Pedro', 'Maria will update the pricing page', [2]),
      TRANSCRIPT,
      't',
    )
    expect(fake.actionItems[0]?.owner).toBe('Unassigned')
  })

  it('gives an unnamed commitment to whoever said it', () => {
    const r = groundMinutes(
      one('Send the release notes', '', 'I will send the release notes', [3]),
      TRANSCRIPT,
      't',
    )
    expect(r.actionItems[0]?.owner).toBe('Me')
  })

  it('maps "eu"/"outros" owners to the track labels', () => {
    const r = groundMinutes(
      one('Send the release notes', 'eu', 'I will send the release notes', [3]),
      TRANSCRIPT,
      't',
    )
    expect(r.actionItems[0]?.owner).toBe('Me')
  })

  it('never invents Me/Others on a single mixed track (imported file)', () => {
    const mixed = {
      ...TRANSCRIPT,
      segments: TRANSCRIPT.segments.map((s) => ({ ...s, speaker: 'Speaker' })),
    }
    const self = groundMinutes(
      one('Send the release notes', 'Me', 'I will send the release notes', [3]),
      mixed,
      't',
    )
    const them = groundMinutes(
      one('Send the release notes', 'Others', 'I will send the release notes', [3]),
      mixed,
      't',
    )
    const named = groundMinutes(
      one('Update the pricing page', 'Maria', 'Maria will update the pricing page', [2]),
      mixed,
      't',
    )
    expect([self, them].map((r) => r.actionItems[0]?.owner)).toEqual(['Unassigned', 'Unassigned'])
    expect(named.actionItems[0]?.owner).toBe('Maria')
  })

  it('keeps CLI labels as owners and never maps "Me" onto tracks that are not Me/Others', () => {
    const labelled = {
      ...TRANSCRIPT,
      segments: TRANSCRIPT.segments.map((s) => ({
        ...s,
        speaker: s.speaker === 'Me' ? 'Ana' : 'Bob',
      })),
    }
    const said = groundMinutes(
      one('Send the release notes', '', 'I will send the release notes', [3]),
      labelled,
      't',
    )
    const me = groundMinutes(
      one('Send the release notes', 'Me', 'I will send the release notes', [3]),
      labelled,
      't',
    )
    expect(said.actionItems[0]?.owner).toBe('Ana')
    expect(me.actionItems[0]?.owner).toBe('Ana')
    // a label that was never spoken, on a line with no commitment, is not an owner
    const bob = groundMinutes(
      one('Update the pricing page', 'Bob', 'Maria will update the pricing page', [2]),
      labelled,
      't',
    )
    expect(bob.actionItems[0]?.owner).toBe('Unassigned')
  })

  it('never takes the single-track label as a name, even when "speaker" was said', () => {
    const mixed = {
      ...TRANSCRIPT,
      segments: TRANSCRIPT.segments.map((s, i) => ({
        ...s,
        speaker: 'Speaker',
        text:
          i === 3
            ? 'Next speaker please, a 1 minute update: I will send the release notes'
            : s.text,
      })),
    }
    for (const label of ['Speaker', 'speaker', ' SPEAKER ', 'Speaker A', 'speaker 1'])
      expect(
        groundMinutes(
          one('Send the release notes', label, 'I will send the release notes', [3]),
          mixed,
          't',
        ).actionItems[0]?.owner,
      ).toBe('Unassigned')
  })

  it('finds the source when the cited id does not exist', () => {
    const r = groundMinutes(
      one('Send the release notes', 'Me', 'send the release notes', [99]),
      TRANSCRIPT,
      't',
    )
    expect(r.actionItems[0]?.segments).toEqual([3])
  })

  it('rejects a task whose wording is unrelated to a real quote', () => {
    const r = groundMinutes(
      one('Renegotiate the cloud contract', 'Me', 'I will send the release notes', [3]),
      TRANSCRIPT,
      't',
    )
    expect(r.actionItems).toEqual([])
    expect(r.rejected[0]?.reason).toMatch(/wording/)
  })

  it('drops duplicates and blank items', () => {
    const r = groundMinutes(
      {
        summary: [{ text: '  ', segments: [0] }],
        decisions: [
          { text: 'Ship the beta on Friday', quote: 'Friday it is', segments: [2] },
          { text: 'Ship the beta Friday', quote: 'Friday it is', segments: [2] },
        ],
        action_items: [],
      },
      TRANSCRIPT,
      't',
    )
    expect(r.summary).toEqual([])
    expect(r.decisions).toHaveLength(1)
  })

  describe('deadlines', () => {
    it('keeps a deadline said in the task line, as it was said', () => {
      const r = groundMinutes(
        one(
          'Send the release notes',
          'Me',
          'I will send the release notes to the team by Thursday',
          [3],
          ' by Thursday ',
        ),
        TRANSCRIPT,
        't',
      )
      expect(r.actionItems[0]).toMatchObject({ due: 'by Thursday', segments: [3], at: 14.5 })
      const outside = groundMinutes(
        one('Send the release notes', 'Me', 'I will send the release notes', [3], 'by Thursday'),
        TRANSCRIPT,
        't',
      )
      expect(outside.actionItems[0]).not.toHaveProperty('due')
      const spaced = groundMinutes(
        one('Send the release notes', 'Me', '  I will send the release notes ', [3], 'by Thursday'),
        TRANSCRIPT,
        't',
      )
      expect(spaced.actionItems[0]?.quote).toBe('I will send the release notes')
      expect(r.rejected).toEqual([])
    })

    it('leaves the deadline out when none was said', () => {
      const r = groundMinutes(
        one('Update the pricing page', 'Maria', 'Maria will update the pricing page', [2]),
        TRANSCRIPT,
        't',
      )
      expect(r.actionItems[0]).not.toHaveProperty('due')
    })

    it('drops a deadline that is not in the cited lines and keeps the task', () => {
      const r = groundMinutes(
        one(
          'Update the pricing page',
          'Maria',
          'Maria will update the pricing page',
          [2],
          'by Monday',
        ),
        TRANSCRIPT,
        't',
      )
      expect(r.actionItems[0]?.task).toBe('Update the pricing page')
      expect(r.actionItems[0]).not.toHaveProperty('due')
      expect(r.rejected).toEqual([
        {
          kind: 'action',
          text: 'Update the pricing page: by Monday',
          reason: 'deadline not said in the cited lines',
        },
      ])
    })

    it('drops a deadline said elsewhere in the meeting, not next to the task', () => {
      const r = groundMinutes(
        one(
          'Revisar o contrato do fornecedor',
          'Ana',
          'você fica com o contrato do fornecedor',
          [0, 2],
          'sexta',
        ),
        DIALOGUE,
        't',
      )
      expect(r.actionItems[0]).not.toHaveProperty('due')
    })

    it('takes the deadline from the cited reply next to the task and cites that line too', () => {
      const r = groundMinutes(
        one(
          'Revisar o contrato do fornecedor',
          'Ana',
          'você fica com o contrato do fornecedor',
          [0, 1],
          'até quarta-feira',
        ),
        DIALOGUE,
        't',
      )
      expect(r.actionItems[0]).toMatchObject({ due: 'até quarta-feira', segments: [0, 1], at: 0 })
    })

    it('needs the deadline said as one phrase, not its words scattered over the line', () => {
      const t: Transcript = {
        ...DIALOGUE,
        language: 'en',
        segments: [
          {
            id: 0,
            start: 0,
            end: 4,
            speaker: 'Me',
            text: 'I will send the release notes, by the way Thursday is a holiday.',
          },
        ],
      }
      const due = (d: string) =>
        groundMinutes(
          one('Send the release notes', 'Me', 'I will send the release notes', [0], d),
          t,
          't',
        ).actionItems[0]?.due
      expect(due('by Thursday')).toBeUndefined()
      expect(due('Thursday')).toBeUndefined()
      expect(due('—')).toBeUndefined()
    })

    it('keeps a deadline only on the task whose part of the line says it', () => {
      const t: Transcript = {
        ...DIALOGUE,
        segments: [
          {
            id: 0,
            start: 0,
            end: 5,
            speaker: 'Me',
            text: 'Ana revisa o contrato e o Pedro faz o deploy até sexta.',
          },
        ],
      }
      const r = groundMinutes(
        {
          summary: [],
          decisions: [],
          action_items: [
            {
              task: 'Revisar o contrato',
              owner: 'Ana',
              due: 'até sexta',
              quote: 'Ana revisa o contrato',
              segments: [0],
            },
            {
              task: 'Fazer o deploy',
              owner: 'Pedro',
              due: 'até sexta',
              quote: 'o Pedro faz o deploy até sexta',
              segments: [0],
            },
          ],
        },
        t,
        't',
      )
      expect(r.actionItems.map((a) => [a.owner, a.due])).toEqual([
        ['Ana', undefined],
        ['Pedro', 'até sexta'],
      ])
    })

    it('needs every word of the deadline: "sexta-feira" is not "sexta"', () => {
      const r = groundMinutes(
        one('Rever o deploy', 'Me', 'o deploy fica pra sexta', [2], 'sexta-feira'),
        DIALOGUE,
        't',
      )
      expect(r.actionItems[0]).not.toHaveProperty('due')
    })

    it('reads the deadline around the line that carries the quote, the first one on a tie', () => {
      const lines = (texts: string[]): Transcript => ({
        ...DIALOGUE,
        segments: texts.map((text, id) => ({
          id,
          start: id * 2,
          end: id * 2 + 1,
          speaker: 'Me',
          text,
        })),
      })
      const t = lines([
        'Até segunda alguém revisa.',
        'Ana revisa o contrato do fornecedor.',
        'Ana revisa o contrato do fornecedor, combinado.',
        'Entrego até quarta.',
        'Bom dia.',
        'Bom dia.',
      ])
      const due = (d: string, quote: string) =>
        groundMinutes(
          one('Revisar o contrato do fornecedor', 'Ana', quote, [0, 1, 2, 3], d),
          t,
          't',
        ).actionItems[0]?.due
      expect(due('até segunda', 'Ana revisa o contrato do fornecedor')).toBe('até segunda')
      expect(due('até quarta', 'Ana revisa o contrato do fornecedor')).toBeUndefined()
      expect(due('até quarta', 'contrato do fornecedor, combinado')).toBe('até quarta')
    })

    it('adds the cited question that held the deadline to the citation, in transcript order', () => {
      const t: Transcript = {
        ...DIALOGUE,
        segments: [
          { id: 0, start: 0, end: 3, speaker: 'Me', text: 'Quem fecha isso até quarta-feira?' },
          {
            id: 1,
            start: 3.5,
            end: 7,
            speaker: 'Me',
            text: 'Ana, você fica com o contrato do fornecedor.',
          },
          { id: 2, start: 7.5, end: 9, speaker: 'Others', text: 'Fechado.' },
        ],
      }
      const r = groundMinutes(
        one(
          'Revisar o contrato do fornecedor',
          'Ana',
          'você fica com o contrato do fornecedor',
          [0],
          'até quarta-feira',
        ),
        t,
        't',
      )
      expect(r.actionItems[0]).toMatchObject({ due: 'até quarta-feira', segments: [0, 1], at: 0 })
    })

    it('never moves the deadline of one task onto the next one cited with it', () => {
      const t: Transcript = {
        ...DIALOGUE,
        language: 'en',
        segments: [
          {
            id: 0,
            start: 0,
            end: 4,
            speaker: 'Others',
            text: 'I will prepare the offer letter and send it to legal on Wednesday.',
          },
          {
            id: 1,
            start: 4.5,
            end: 8,
            speaker: 'Me',
            text: 'And I will schedule a reference call with her last manager.',
          },
        ],
      }
      const r = groundMinutes(
        {
          summary: [],
          decisions: [],
          action_items: [
            {
              task: 'Prepare the offer letter',
              owner: 'Others',
              due: 'on Wednesday',
              quote: 'I will prepare the offer letter and send it to legal on Wednesday',
              segments: [0],
            },
            {
              task: 'Schedule a reference call',
              owner: 'Me',
              due: 'on Wednesday',
              quote: 'I will schedule a reference call',
              segments: [0, 1],
            },
          ],
        },
        t,
        't',
      )
      expect(r.actionItems.map((a) => [a.task, a.due])).toEqual([
        ['Prepare the offer letter', 'on Wednesday'],
        ['Schedule a reference call', undefined],
      ])
    })

    it('does not use an uncited neighbour as evidence', () => {
      const r = groundMinutes(
        one(
          'Revisar o contrato do fornecedor',
          'Ana',
          'você fica com o contrato do fornecedor',
          [0],
          'até quarta-feira',
        ),
        DIALOGUE,
        't',
      )
      expect(r.actionItems[0]).not.toHaveProperty('due')
    })
  })
})
