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
          kind: 'deadline',
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

    it("keeps the transcript wording of the deadline, not the model's", () => {
      const r = groundMinutes(
        one('Escrever os testes', 'Me', 'Eu vou escrever os testes até sexta', [0], 'ATE SEXTA!!'),
        {
          ...DIALOGUE,
          segments: [
            {
              id: 0,
              start: 0,
              end: 3,
              speaker: 'Me',
              text: 'Eu vou escrever os testes até sexta.',
            },
          ],
        },
        't',
      )
      expect(r.actionItems[0]?.due).toBe('até sexta')
    })

    it('needs the quote said in a row on the line, so a rewritten quote cannot carry a deadline', () => {
      const lines = (text: string): Transcript => ({
        ...DIALOGUE,
        segments: [{ id: 0, start: 0, end: 5, speaker: 'Me', text }],
      })
      const ana = groundMinutes(
        one('Revisar o contrato', 'Ana', 'Ana revisa o contrato até sexta', [0], 'até sexta'),
        lines('Ana revisa o contrato e o Pedro faz o deploy até sexta.'),
        't',
      )
      expect(ana.actionItems[0]?.task).toBe('Revisar o contrato')
      expect(ana.actionItems[0]).not.toHaveProperty('due')
      const notes = groundMinutes(
        one(
          'Send the release notes',
          'Me',
          'I will send the release notes by Thursday',
          [0],
          'by Thursday',
        ),
        lines('By Thursday the office closes, so I will send the release notes.'),
        't',
      )
      expect(notes.actionItems[0]).not.toHaveProperty('due')
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

    it('reads the reply after the line that says the quote, not after a line that only shares its words', () => {
      const t: Transcript = {
        ...DIALOGUE,
        segments: [
          { id: 0, start: 0, end: 2, speaker: 'Me', text: 'Ana, contrato do fornecedor?' },
          { id: 1, start: 2.5, end: 4, speaker: 'Others', text: 'Até segunda.' },
          {
            id: 2,
            start: 4.5,
            end: 6,
            speaker: 'Me',
            text: 'Então Ana revisa o contrato do fornecedor.',
          },
          { id: 3, start: 6.5, end: 8, speaker: 'Others', text: 'Entrego até quarta.' },
        ],
      }
      const due = (d: string) =>
        groundMinutes(
          one(
            'Revisar o contrato do fornecedor',
            'Ana',
            'Ana revisa o contrato do fornecedor',
            [0, 1, 2, 3],
            d,
          ),
          t,
          't',
        ).actionItems[0]
      expect(due('até quarta')).toMatchObject({ due: 'até quarta' })
      expect(due('até quarta')?.segments).toContain(3)
      expect(due('até segunda')).not.toHaveProperty('due')
    })

    it('takes a deadline from the line after the task, never from a line before it', () => {
      const t: Transcript = {
        ...DIALOGUE,
        segments: [
          { id: 0, start: 0, end: 3, speaker: 'Others', text: 'O deploy fica pra sexta.' },
          {
            id: 1,
            start: 3.5,
            end: 7,
            speaker: 'Me',
            text: 'Ana, você fica com o contrato do fornecedor.',
          },
          { id: 2, start: 7.5, end: 9, speaker: 'Me', text: 'Até quarta-feira, tá?' },
        ],
      }
      const due = (d: string, segments: number[]) =>
        groundMinutes(
          one(
            'Revisar o contrato do fornecedor',
            'Ana',
            'você fica com o contrato do fornecedor',
            segments,
            d,
          ),
          t,
          't',
        ).actionItems[0]?.due
      expect(due('sexta', [0, 1])).toBeUndefined()
      // the same speaker going on in the next line is the rest of the sentence: still about the task
      expect(due('até quarta-feira', [1, 2])).toBe('Até quarta-feira')
    })

    it('with a paraphrased quote, reads the reply after the line that supports it best', () => {
      const t: Transcript = {
        ...DIALOGUE,
        segments: [
          { id: 0, start: 0, end: 2, speaker: 'Me', text: 'Ana, o contrato.' },
          { id: 1, start: 2.5, end: 4, speaker: 'Others', text: 'Até segunda.' },
          {
            id: 2,
            start: 4.5,
            end: 6,
            speaker: 'Me',
            text: 'Ana revisa o contrato do fornecedor.',
          },
          { id: 3, start: 6.5, end: 8, speaker: 'Others', text: 'Entrego até quarta.' },
        ],
      }
      const r = groundMinutes(
        one(
          'Revisar o contrato do fornecedor',
          'Ana',
          'contrato do fornecedor Ana revisa',
          [0, 1, 2, 3],
          'até quarta',
        ),
        t,
        't',
      )
      expect(r.actionItems[0]?.due).toBe('até quarta')
    })

    it('takes the reply on one mixed track, and a sentence whisper split in two', () => {
      const t: Transcript = {
        ...DIALOGUE,
        segments: [
          {
            id: 0,
            start: 0,
            end: 3,
            speaker: 'Speaker',
            text: 'Tom, can you fix the mobile layout?',
          },
          { id: 1, start: 3.5, end: 6, speaker: 'Speaker', text: 'Yes, by Wednesday.' },
        ],
      }
      const r = groundMinutes(
        one(
          'Fix the mobile layout',
          'Tom',
          'Tom, can you fix the mobile layout?',
          [0, 1],
          'by Wednesday',
        ),
        t,
        't',
      )
      expect(r.actionItems[0]).toMatchObject({ due: 'by Wednesday', segments: [0, 1] })
      const sameMe = groundMinutes(
        one(
          'Fix the mobile layout',
          'Tom',
          'Tom, can you fix the mobile layout?',
          [0, 1],
          'by Wednesday',
        ),
        { ...t, segments: t.segments.map((s) => ({ ...s, speaker: 'Me' })) },
        't',
      )
      expect(sameMe.actionItems[0]?.due).toBe('by Wednesday')
    })

    it('takes from the reply only a deadline said about the task, not another one in it', () => {
      const t = (reply: string): Transcript => ({
        ...DIALOGUE,
        segments: [
          {
            id: 0,
            start: 0,
            end: 3,
            speaker: 'Me',
            text: 'Ana, você revisa o contrato do fornecedor?',
          },
          { id: 1, start: 3.5, end: 6, speaker: 'Others', text: reply },
        ],
      })
      const due = (reply: string, d: string) =>
        groundMinutes(
          one(
            'Revisar o contrato do fornecedor',
            'Ana',
            'você revisa o contrato do fornecedor',
            [0, 1],
            d,
          ),
          t(reply),
          't',
        ).actionItems[0]?.due
      expect(due('Reviso. Ah, e o deploy fica pra sexta.', 'pra sexta')).toBeUndefined()
      expect(due('Sure. By the way Thursday is a holiday.', 'Thursday')).toBeUndefined()
      expect(due('Fechado, entrego até quarta.', 'até quarta')).toBe('até quarta')
      expect(due('Fechado; e o deploy até quarta.', 'até quarta')).toBeUndefined()
      expect(due('Sim, a Ana reviso até quarta.', 'até quarta')).toBe('até quarta')
      expect(due('Reviso o contrato até segunda, pode ser.', 'até segunda')).toBe('até segunda')
    })

    it('keeps a deadline said in the task line, even outside the quote, when the clause is about the task', () => {
      const r = groundMinutes(
        one(
          'Send the release notes to the team by Thursday',
          'Me',
          'I will send the release notes',
          [3],
          'by Thursday',
        ),
        TRANSCRIPT,
        't',
      )
      expect(r.actionItems[0]).toMatchObject({
        task: 'Send the release notes to the team',
        due: 'by Thursday',
      })
    })

    it('shows the deadline on its own: cut from the end of the task, kept or made up', () => {
      const task = (t: string, quote: string, d: string) =>
        groundMinutes(one(t, 'Me', quote, [3], d), TRANSCRIPT, 't').actionItems[0]
      expect(
        task(
          'Send the release notes by Thursday.',
          'I will send the release notes to the team by Thursday',
          'by Thursday',
        ),
      ).toMatchObject({ task: 'Send the release notes.', due: 'by Thursday' })
      const unsaid = groundMinutes(
        one(
          'Update the pricing page by Monday',
          'Maria',
          'Maria will update the pricing page',
          [2],
          'by Monday',
        ),
        TRANSCRIPT,
        't',
      ).actionItems[0]
      expect(unsaid?.task).toBe('Update the pricing page')
      expect(unsaid).not.toHaveProperty('due')
      expect(task('Send the release notes', 'I will send the release notes', 'notes')?.task).toBe(
        'Send the release notes',
      )
      expect(
        task(
          'Send the release notes, by Thursday',
          'I will send the release notes to the team by Thursday',
          'by Thursday',
        )?.task,
      ).toBe('Send the release notes')
      expect(
        task('by Thursday', 'I will send the release notes to the team by Thursday', 'by Thursday')
          ?.task,
      ).toBe('by Thursday')
      expect(
        task(
          'Send the notes by Thursday to the team',
          'I will send the release notes',
          'by Thursday',
        )?.task,
      ).toBe('Send the notes by Thursday to the team')
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
