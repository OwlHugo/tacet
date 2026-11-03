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
    const ill = groundMinutes(
      one('Send the release notes', '', 'I will send the release notes', [3]),
      {
        ...TRANSCRIPT,
        segments: TRANSCRIPT.segments.map((s) =>
          s.id === 3 ? { ...s, text: "I'll send the release notes by Thursday." } : s,
        ),
      },
      't',
    )
    expect(ill.actionItems[0]?.owner).toBe(TRANSCRIPT.segments[3]?.speaker)
    // "ill" the adjective takes nothing on.
    const sick = groundMinutes(
      one('Send the release notes', '', 'send the release notes', [3]),
      {
        ...TRANSCRIPT,
        segments: TRANSCRIPT.segments.map((s) =>
          s.id === 3 ? { ...s, text: 'Bia is ill, so somebody must send the release notes.' } : s,
        ),
      },
      't',
    )
    expect(sick.actionItems[0]?.owner).toBe('Unassigned')
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

  describe('the person who recorded the meeting', () => {
    const self = { name: 'Rafael', aliases: ['Rafa'] }
    // Invented one-track call: the nickname is said on line 1, and line 2 asks something of "you".
    const CALL: Transcript = {
      language: 'en',
      model: 'base',
      duration: 12,
      segments: [
        { id: 0, start: 0, end: 3, speaker: 'Speaker', text: 'The kiosk menu needs new photos.' },
        { id: 1, start: 3, end: 6, speaker: 'Speaker', text: 'Rafa, take the photos of the menu.' },
        { id: 2, start: 6, end: 9, speaker: 'Speaker', text: 'Can you print the price list?' },
        { id: 3, start: 9, end: 12, speaker: 'Speaker', text: 'Somebody prints the flyers later.' },
      ],
    }
    const owner = (o: string, task: string, quote: string, line: number, t = CALL) =>
      groundMinutes(one(task, o, quote, [line]), t, 't', { self }).actionItems[0]?.owner

    it('gets their tasks on one track, by name or nickname, when one of them was said', () => {
      expect(owner('rafa', 'Take the photos of the menu', 'take the photos of the menu', 1)).toBe(
        'Rafael',
      )
      expect(owner('Rafael', 'Take the photos of the menu', 'take the photos of the menu', 1)).toBe(
        'Rafael',
      )
      expect(owner('Pedro', 'Take the photos of the menu', 'take the photos of the menu', 1)).toBe(
        'Unassigned',
      )
    })

    it('needs every word of a full name said, not just the first', () => {
      const full = { name: 'Rafael Lima', aliases: [] }
      const said = (o: string) =>
        groundMinutes(
          one('Take the photos of the menu', o, 'take the photos of the menu', [1]),
          {
            ...CALL,
            segments: CALL.segments.map((s) => ({ ...s, text: s.text.replace('Rafa', 'Rafael') })),
          },
          't',
          { self: full },
        ).actionItems[0]?.owner
      expect(said('Rafael Lima')).toBe('Unassigned')
      expect(said('Rafael Costa')).toBe('Unassigned')
    })

    it('gets a task asked of "you" on one track, even with no name said', () => {
      const unnamed = {
        ...CALL,
        segments: CALL.segments.map((s) => (s.id === 1 ? { ...s, text: 'New menu photos.' } : s)),
      }
      expect(owner('Rafael', 'Print the price list', 'print the price list', 2, unnamed)).toBe(
        'Rafael',
      )
    })

    it('is not an owner on one track when no name of theirs was said and nothing asks "you"', () => {
      const unnamed = {
        ...CALL,
        segments: CALL.segments.map((s) => (s.id === 1 ? { ...s, text: 'New menu photos.' } : s)),
      }
      expect(owner('Rafa', 'Print the flyers later', 'prints the flyers later', 3, unnamed)).toBe(
        'Unassigned',
      )
    })

    // Same call, no name of theirs said: only the line of the task can make it theirs.
    const unnamedWith = (text: string): Transcript => ({
      ...CALL,
      segments: CALL.segments.map((s) =>
        s.id === 1 ? { ...s, text: 'New menu photos.' } : s.id === 2 ? { ...s, text } : s,
      ),
    })
    const onLine = (text: string, task: string, o = 'Rafael') =>
      owner(o, task, text.replace(/[.?!]$/, ''), 2, unnamedWith(text))

    it('gets a task on one track only when its line asks it of "you", as a request', () => {
      const asked = [
        ['Could you send the invoice?', 'Send the invoice'],
        ['Please book the room for Monday.', 'Book the room for Monday'],
        ['You need to renew the domain.', 'Renew the domain'],
        ['Você pode revisar o cardápio?', 'Revisar o cardápio'],
        ['Pode mandar o contrato hoje?', 'Mandar o contrato hoje'],
        ['Okay, can you send the invoice?', 'Send the invoice'],
        ['As we said in the last meeting, can you send the invoice?', 'Send the invoice'],
        ['Could you send the invoice? Thanks, see you.', 'Send the invoice'],
        ['🙂, can you send the invoice?', 'Send the invoice'],
        ['Please, send me the deck.', 'Send the deck'],
        ['Book the room for Monday, please.', 'Book the room for Monday'],
        ['Por favor, você pode revisar o contrato?', 'Revisar o contrato'],
        ['Por favor, revisa o contrato.', 'Revisar o contrato'],
        ['Actually, can you send the invoice?', 'Send the invoice'],
        ['Você pode revisar o contrato que eu mandei?', 'Revisar o contrato'],
        ['Could you please send the invoice?', 'Send the invoice'],
        ['O contrato fica com você.', 'Revisar o contrato'],
        ['Eu preciso que você revise o contrato.', 'Revisar o contrato'],
        ['Eu queria que você mandasse o deck.', 'Mandar o deck'],
        ['Could you cover the stand? Bia is ill.', 'Cover the stand'],
        [
          'Eu preciso que você revise o contrato, e eu quero que você assine.',
          'Revisar o contrato',
        ],
        ['Me manda o contrato amanhã.', 'Mandar o contrato amanhã'],
        ['Send me the deck tomorrow.', 'Send the deck tomorrow'],
        ['Amanhã, você pode mandar o contrato?', 'Mandar o contrato'],
        ['Can you send the invoice, by Friday?', 'Send the invoice'],
        ['Can you send the invoice to Bia?', 'Send the invoice'],
        ['Can you check the invoice in Excel?', 'Check the invoice'],
        ['Can you send the invoice Friday?', 'Send the invoice'],
      ]
      expect(asked.map(([text = '', task = '']) => onLine(text, task))).toEqual(
        asked.map(() => 'Rafael'),
      )
      // A request for other work, cited with the line of this one: the invoice is not asked.
      const other = {
        ...unnamedWith('Can you send the deck?'),
        segments: [
          ...unnamedWith('Can you send the deck?').segments,
          { id: 4, start: 12, end: 14, speaker: 'Speaker', text: 'Pedro sends the invoice.' },
        ],
      }
      expect(
        groundMinutes(one('Send the invoice', 'Rafael', 'sends the invoice', [2, 4]), other, 't', {
          self,
        }).actionItems[0]?.owner,
      ).toBe('Unassigned')
      // The request and the reply cited together: the request is enough.
      const replied = {
        ...unnamedWith('Could you print the price list?'),
        segments: [
          ...unnamedWith('Could you print the price list?').segments,
          { id: 4, start: 12, end: 14, speaker: 'Speaker', text: 'Sure.' },
        ],
      }
      expect(
        groundMinutes(
          one('Print the price list', 'Rafa', 'print the price list', [2, 4]),
          replied,
          't',
          { self },
        ).actionItems[0]?.owner,
      ).toBe('Rafael')
    })

    it('does not take "you" on a line where the one speaking takes the work on, or thanks', () => {
      const notAsked = [
        ['I will send you the deck tomorrow.', 'Send the deck tomorrow'],
        ["Thank you, I'll book the room.", 'Book the room'],
        ['Te mando o contrato amanhã.', 'Mandar o contrato amanhã'],
        ['Pode deixar, eu mando o contrato amanhã.', 'Mandar o contrato amanhã'],
        ['Can you wait? I will send the invoice.', 'Send the invoice'],
        // A request and, in the rest of the line, the one speaking taking work on: not clear whose.
        ['Could you send the invoice? Eu pago depois.', 'Send the invoice'],
        ['Somebody prints the flyers later, thank you.', 'Print the flyers later'],
        ['Your flyers get printed later.', 'Print the flyers later'],
        ['You know, the flyers get printed later.', 'Print the flyers later'],
        ['You sent the invoice yesterday.', 'Send the invoice'],
        ['Você tem razão, o contrato atrasou.', 'Revisar o contrato'],
        ['Pode crer, o fornecedor manda a nota amanhã.', 'Mandar a nota amanhã'],
        ['Pode ter certeza, o fornecedor manda a nota.', 'Mandar a nota'],
        ['Dá pra ver que o fornecedor manda a nota.', 'Mandar a nota'],
        ['Can you believe the vendor sends the invoice late?', 'Send the invoice'],
        ['Você pode ter certeza, o fornecedor manda a nota.', 'Mandar a nota'],
        ['Dá pra acreditar? O fornecedor manda a nota.', 'Mandar a nota'],
        ['Dá pra mandar a nota depois.', 'Mandar a nota depois'],
        // Said to someone else by name: theirs, even with a "you" in it.
        ['Bia, consegue mandar o contrato hoje?', 'Mandar o contrato hoje'],
        ['Pedro, please send the invoice.', 'Send the invoice'],
        ['Ana Clara Souza, can you send the invoice?', 'Send the invoice'],
        ['Ok Bia, can you send the invoice?', 'Send the invoice'],
        // "Can you" before something that is not work, then a statement about someone else.
        ['Can you see my screen? The vendor sends the invoice.', 'Send the invoice'],
        // Whisper often drops the "?": without it, "pode mandar" is not read as a request.
        ['Pode mandar o contrato hoje.', 'Mandar o contrato hoje'],
        ['You have to admit, the vendor sends the invoice late.', 'Send the invoice'],
        ['Please note that Bia sends the invoice.', 'Send the invoice'],
        ['Thanks, the vendor sends the invoice.', 'Send the invoice'],
        ['The vendor said you need to send the invoice.', 'Send the invoice'],
        ['Send the deck tomorrow.', 'Send the deck tomorrow'],
        // Said to someone else by name after the request.
        ['Can you send the invoice, Bia?', 'Send the invoice'],
        ['Pode mandar o contrato, Bia?', 'Mandar o contrato'],
        ['So, Bia, can you send the invoice?', 'Send the invoice'],
        ['Olha, Bia, você pode mandar o contrato?', 'Mandar o contrato'],
        ['Bia? Can you send the invoice?', 'Send the invoice'],
        ['Can you send the invoice Bia?', 'Send the invoice'],
        // "Que você" and "você fica com" only with work after them.
        ['Quero que você saiba que o fornecedor manda a nota.', 'Mandar a nota'],
        ['Você fica com raiva quando o fornecedor atrasa a nota.', 'Mandar a nota'],
        // The "?" of another sentence does not make this one a question.
        ['Dá pra mandar a nota depois. Alguém viu?', 'Mandar a nota depois'],
        // A request for other work on the same line: the cover is Pedro's.
        ['Can you send the invoice? Also Pedro fixes the cover.', 'Fix the cover'],
        ['Can you send the deck? Also Pedro sends the invoice.', 'Send the invoice'],
      ]
      expect(notAsked.map(([text = '', task = '']) => onLine(text, task))).toEqual(
        notAsked.map(() => 'Unassigned'),
      )
    })

    it('a name or nickname with no letter or digit never matches a task with no owner', () => {
      const blank = { name: 'Rafael', aliases: ['🙂', '-'] }
      const tracks = {
        ...CALL,
        segments: CALL.segments.map((s) => ({ ...s, speaker: s.id === 2 ? 'Me' : 'Others' })),
      }
      const run = (t: Transcript, self: { name: string; aliases: string[] }, o: string) =>
        groundMinutes(one('Print the flyers later', o, 'prints the flyers later', [3]), t, 't', {
          self,
        }).actionItems[0]?.owner
      expect(run(tracks, blank, '')).toBe('Unassigned')
      expect(run(tracks, { name: '-', aliases: [] }, '')).toBe('Unassigned')
      expect(run(CALL, blank, '')).toBe('Unassigned')
      expect(run(tracks, blank, 'Rafael')).toBe('Me')
      // A name with no letter is never shown as the owner: the first real one is.
      const asked = unnamedWith('Can you print the price list?')
      expect(
        groundMinutes(
          one('Print the price list', 'Rafa', 'print the price list', [2]),
          asked,
          't',
          {
            self: { name: '🙂', aliases: ['Rafa'] },
          },
        ).actionItems[0]?.owner,
      ).toBe('Rafa')
    })

    it('is the Me track on a recording with the microphone only', () => {
      const mic = { ...CALL, segments: CALL.segments.map((s) => ({ ...s, speaker: 'Me' })) }
      const run = (o: string) =>
        groundMinutes(one('Print the flyers later', o, 'prints the flyers later', [3]), mic, 't', {
          self,
        }).actionItems[0]?.owner
      expect([run('Rafael'), run('rafa'), run('Others')]).toEqual(['Me', 'Me', 'Unassigned'])
    })

    it('is the Me track on two tracks, whether the model wrote Me or their name', () => {
      const tracks = {
        ...CALL,
        segments: CALL.segments.map((s) => ({ ...s, speaker: s.id === 2 ? 'Me' : 'Others' })),
      }
      const owners = groundMinutes(
        {
          summary: [],
          decisions: [],
          action_items: [
            {
              task: 'Take the photos of the menu',
              owner: 'Rafael',
              due: '',
              quote: 'take the photos of the menu',
              segments: [1],
            },
            {
              task: 'Print the price list',
              owner: 'Me',
              due: '',
              quote: 'print the price list',
              segments: [2],
            },
            {
              task: 'Print the flyers later',
              owner: 'rafa',
              due: '',
              quote: 'prints the flyers later',
              segments: [3],
            },
          ],
        },
        tracks,
        't',
        { self },
      ).actionItems.map((a) => a.owner)
      expect(owners).toEqual(['Me', 'Me', 'Me'])
    })

    it('without --me, their nickname is a name like any other', () => {
      expect(
        groundMinutes(
          one('Send the release notes', 'Rafa', 'I will send the release notes', [3]),
          {
            ...TRANSCRIPT,
            segments: TRANSCRIPT.segments.map((s) => ({ ...s, speaker: 'Speaker' })),
          },
          't',
        ).actionItems[0]?.owner,
      ).toBe('Unassigned')
    })
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

  it("keeps one of a summary point said again by another chunk, in the chunks' order", () => {
    const r = groundMinutes(
      {
        summary: [
          { text: 'The agenda today: the beta launch.', segments: [0] },
          { text: 'Ship the beta on Friday.', segments: [1] },
          { text: 'Agenda today, the beta launch', segments: [0] },
          { text: 'Ship the beta Friday', segments: [2] },
          { text: 'Agenda: zeppelin, quokka, walrus.', segments: [0] },
          { text: 'Agenda: zeppelin, quokka, walrus', segments: [0] },
        ],
        decisions: [],
        action_items: [],
      },
      TRANSCRIPT,
      't',
    )
    expect(r.summary.map((s) => [s.text, s.segments])).toEqual([
      ['The agenda today: the beta launch.', [0]],
      ['Ship the beta on Friday.', [1]],
    ])
    // a point grounding rejects is not one to repeat: each is checked on its own
    expect(r.rejected.map((x) => x.text)).toEqual([
      'Agenda: zeppelin, quokka, walrus.',
      'Agenda: zeppelin, quokka, walrus',
    ])
  })

  it('keeps a summary point that says other words, or its words in another order', () => {
    const r = groundMinutes(
      {
        summary: [
          { text: 'Ship the beta on Friday.', segments: [1] },
          { text: 'Do not ship the beta on Friday.', segments: [1] },
          { text: 'Can’t ship the beta on Friday.', segments: [1] },
          { text: 'Won’t ship the beta on Friday', segments: [1] },
          { text: 'Drop the dark mode toggle for now.', segments: [4] },
          { text: 'No dark mode toggle for now.', segments: [4] },
          { text: 'Without the dark mode toggle for now.', segments: [4] },
          { text: 'Maria updates the pricing page, not the release notes.', segments: [2, 3] },
          { text: 'Maria updates the release notes, not the pricing page.', segments: [2, 3] },
          { text: 'The release notes, Maria updates the pricing page, not', segments: [2, 3] },
          { text: "Maria shouldn't update the pricing page, send the notes", segments: [2, 3] },
          { text: "Send the notes, Maria shouldn't update the pricing page", segments: [2, 3] },
          { text: 'Friday, ship the beta', segments: [1] },
          { text: 'Ship the beta, Friday', segments: [1] },
        ],
        decisions: [],
        action_items: [],
      },
      TRANSCRIPT,
      't',
    )
    expect(r.summary.map((s) => s.text)).toEqual([
      'Ship the beta on Friday.',
      'Do not ship the beta on Friday.',
      'Can’t ship the beta on Friday.',
      'Won’t ship the beta on Friday',
      'Drop the dark mode toggle for now.',
      'No dark mode toggle for now.',
      'Without the dark mode toggle for now.',
      'Maria updates the pricing page, not the release notes.',
      'Maria updates the release notes, not the pricing page.',
      'The release notes, Maria updates the pricing page, not',
      "Maria shouldn't update the pricing page, send the notes",
      "Send the notes, Maria shouldn't update the pricing page",
    ])
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
    const line = (...texts: string[]): Transcript => ({
      ...DIALOGUE,
      segments: texts.map((text, id) => ({
        id,
        start: id * 3,
        end: id * 3 + 2,
        speaker: id % 2 ? 'Others' : 'Me',
        text,
      })),
    })
    type Item = RawMinutes['action_items'][number]
    const run = (t: Transcript, ...items: Item[]) =>
      groundMinutes({ summary: [], decisions: [], action_items: items }, t, 't')
    const item = (task: string, owner: string, quote: string, segments: number[], due: string) => ({
      task,
      owner,
      quote,
      segments,
      due,
    })

    it('keeps a deadline said on a line of this task alone, in the words of the transcript', () => {
      const r = groundMinutes(
        one('Send the release notes', 'Me', 'I will send the release notes', [3], ' BY thursday '),
        TRANSCRIPT,
        't',
      )
      expect(r.actionItems[0]).toMatchObject({ due: 'by Thursday', segments: [3], at: 14.5 })
      expect(r.rejected).toEqual([])
    })

    it('leaves the deadline out when none was said', () => {
      const r = groundMinutes(
        one('Update the pricing page', 'Maria', 'Maria will update the pricing page', [2]),
        TRANSCRIPT,
        't',
      )
      expect(r.actionItems[0]).not.toHaveProperty('due')
      expect(r.rejected).toEqual([])
    })

    it('drops a deadline not said on the task lines, keeps the task and cuts it from the wording', () => {
      const r = groundMinutes(
        one(
          'Update the pricing page by Monday',
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
          text: 'Update the pricing page by Monday: by Monday',
          reason: 'deadline not said on a line of this task alone',
        },
      ])
    })

    it('takes the deadline from a cited reply that only this task cites', () => {
      const r = run(
        DIALOGUE,
        item(
          'Revisar o contrato do fornecedor',
          'Ana',
          'você fica com o contrato do fornecedor',
          [0, 1],
          'até quarta-feira',
        ),
      )
      expect(r.actionItems[0]).toMatchObject({ due: 'até quarta-feira', segments: [0, 1] })
    })

    it('never takes a deadline from an uncited line', () => {
      const r = run(
        DIALOGUE,
        item(
          'Revisar o contrato do fornecedor',
          'Ana',
          'você fica com o contrato do fornecedor',
          [0],
          'pra sexta',
        ),
      )
      expect(r.actionItems[0]).not.toHaveProperty('due')
    })

    it('needs the deadline said as one run of words, all of them', () => {
      const t = line('Sexta eu vejo, e o contrato fica até a outra semana.', 'Fechado, até sexta.')
      const due = (d: string) =>
        run(t, item('Ver o contrato', 'Me', 'o contrato fica', [0, 1], d)).actionItems[0]?.due
      expect(due('até sexta')).toBe('até sexta')
      expect(due('até sexta-feira')).toBeUndefined()
      expect(due('sexta até')).toBeUndefined()
    })

    it('drops the deadline on a line two tasks cite, for both', () => {
      const t = line('Ana revisa o contrato e o Pedro faz o deploy até sexta.')
      const r = run(
        t,
        item('Revisar o contrato até sexta', 'Ana', 'Ana revisa o contrato', [0], 'até sexta'),
        item('Fazer o deploy', 'Pedro', 'o Pedro faz o deploy até sexta', [0], 'até sexta'),
      )
      expect(r.actionItems.map((a) => [a.task, a.due])).toEqual([
        ['Revisar o contrato', undefined],
        ['Fazer o deploy', undefined],
      ])
    })

    it('drops the deadline on a line that names two people, even with one task on it', () => {
      const t = line('Ana revisa o contrato e o Pedro faz o deploy até sexta.')
      const r = run(
        t,
        item('Revisar o contrato', 'Ana', 'Ana revisa o contrato', [0], 'até sexta'),
        item('Avisar o time', 'Pedro', 'faz o deploy', [], ''),
      )
      expect(r.actionItems[0]).not.toHaveProperty('due')
    })

    it('a line shared by a task the model gave and grounding dropped is still in doubt', () => {
      const t = line('Vou mandar as notas até sexta.')
      const r = run(
        t,
        item('Mandar as notas', 'Me', 'mandar as notas', [0], 'até sexta'),
        item('Comprar passagens para Tóquio', 'Others', 'passagens para Tóquio', [0], 'até sexta'),
      )
      expect(r.actionItems).toHaveLength(1)
      expect(r.actionItems[0]).not.toHaveProperty('due')
    })

    it('a person named once, the owner, and labels like Me or Unassigned do not count as names', () => {
      const t = line('Me, Ana manda as notas até sexta.')
      const r = run(
        t,
        item('Mandar as notas', 'Ana', 'Ana manda as notas', [0], 'até sexta'),
        item('Algo', 'Me', 'nada disso foi dito', [5], ''),
        item('Outra', 'Unassigned', 'nem isso', [6], ''),
      )
      expect(r.actionItems[0]?.due).toBe('até sexta')
    })

    it('counts the lines grounding gave a task, not only the ones the model cited', () => {
      const t = line('Morning everyone.', 'I will check the logs, and you fix the build by Friday.')
      const r = run(
        t,
        item('Fix the build', 'Others', 'you fix the build by Friday', [1], 'by Friday'),
        item('Check the logs', 'Me', 'I will check the logs', [0], 'by Friday'),
      )
      expect(r.actionItems.map((a) => [a.task, a.due])).toEqual([
        ['Fix the build', undefined],
        ['Check the logs', undefined],
      ])
    })

    it('a duplicate task the model gave, dropped, still makes its line shared', () => {
      const t = line(
        'Okay.',
        'Okay, I will prepare the offer letter and send it to Legal on Wednesday.',
      )
      const offer = item(
        'Prepare the offer letter',
        'Others',
        'I will prepare the offer letter and send it to Legal on Wednesday.',
        [0],
        'Wednesday',
      )
      expect(run(t, offer).actionItems[0]?.due).toBe('Wednesday')
      const r = run(t, offer, {
        ...offer,
        task: 'Also prepare the offer letter',
        owner: 'Unassigned',
      })
      expect(r.actionItems).toHaveLength(1)
      expect(r.actionItems[0]).not.toHaveProperty('due')
    })

    it('a pronoun owner is not a second name on the line', () => {
      const t = line('Ana, eu entrego as notas até sexta.')
      const r = run(
        t,
        item('Entregar as notas', 'eu', 'eu entrego as notas', [0], 'até sexta'),
        item('Algo', 'Ana', 'nada disso', [7], ''),
      )
      expect(r.actionItems[0]?.due).toBe('até sexta')
    })

    it('drops a deadline said on a line about other work, keeps one on a short reply', () => {
      const t = line(
        'Book the hall first.',
        'On Friday we pick the band for the party?',
        'Sure, by Monday.',
      )
      const hall = (segments: number[], due: string) =>
        run(t, item('Book the hall', '', 'Book the hall first', segments, due)).actionItems[0]
      expect(hall([0, 1], 'On Friday')).not.toHaveProperty('due')
      expect(hall([0, 2], 'by Monday')?.due).toBe('by Monday')
      const band = run(t, item('Pick the band', '', 'we pick the band', [1], 'On Friday'))
      expect(band.actionItems[0]?.due).toBe('On Friday')
    })

    it('keeps a deadline on a longer reply that only agrees to the task', () => {
      const t = line(
        'Você pode revisar o cardápio do quiosque?',
        'Fechado, consigo entregar isso até sexta sem problema.',
        'Fechado, e na sexta a gente escolhe a banda da festa nova.',
      )
      const menu = (segments: number[], due: string) =>
        run(t, item('Revisar o cardápio', '', 'revisar o cardápio do quiosque', segments, due))
          .actionItems[0]
      expect(menu([0, 1], 'até sexta')?.due).toBe('até sexta')
      expect(menu([0, 2], 'na sexta')).not.toHaveProperty('due')
    })

    it('drops a deadline on a reply that agrees and then names other work to do', () => {
      const t = line(
        'Você pode revisar o cardápio do quiosque?',
        'Fechado, consigo fazer o deploy até sexta.',
        'Pode fazer o deploy até sexta?',
        'Sure, no problem, I can finish the database migration by Friday.',
        'Combinado, pode deixar, até sexta sem problema.',
        'Sure, no worries, I will deliver it by Friday.',
        'Of course, no problem, I will deliver it by Friday.',
        'Fechado, faço o deploy até sexta.',
        "Sure, I'll deploy by Friday.",
        'Fechado, esse aqui fica pronto até sexta.',
        'Sure, I’ll deploy by Friday.',
        'Sure, I’ll deliver it by Friday.',
        'Great, by Friday.',
        'Tá bom, até sexta.',
        'Claro, posso fazer até sexta.',
        'Sounds good, by Monday.',
        'Yes, works for me, by Friday.',
        'Yes, works nicely for me, by Friday.',
        'Beleza, o deploy até sexta.',
        'Sure, the migration by Friday.',
        'Não, até sexta não dá.',
        'No, not by Friday.',
        "Sure, but I can't by Friday.",
        'Fechado, entrego no sábado.',
        'Não tem problema, até sexta.',
        'A Ana atualiza o cardápio no site até sexta.',
        'Não esquece de revisar o cardápio até sexta.',
      )
      const menu = (segments: number[], due: string) =>
        run(t, item('Revisar o cardápio', '', 'revisar o cardápio do quiosque', segments, due))
          .actionItems[0]
      expect(menu([0, 1], 'até sexta')).not.toHaveProperty('due')
      expect(menu([0, 2], 'até sexta')).not.toHaveProperty('due')
      expect(menu([0, 3], 'by Friday')).not.toHaveProperty('due')
      expect(menu([0, 4], 'até sexta')?.due).toBe('até sexta')
      expect(menu([0, 5], 'by Friday')?.due).toBe('by Friday')
      expect(menu([0, 6], 'by Friday')?.due).toBe('by Friday')
      // One word of other work is enough: the deploy is not the menu.
      expect(menu([0, 7], 'até sexta')).not.toHaveProperty('due')
      expect(menu([0, 8], 'by Friday')).not.toHaveProperty('due')
      expect(menu([0, 9], 'até sexta')?.due).toBe('até sexta')
      // A curly apostrophe is still "I'll".
      expect(menu([0, 10], 'by Friday')).not.toHaveProperty('due')
      expect(menu([0, 11], 'by Friday')?.due).toBe('by Friday')
      // A short answer with no verb of its own is still a reply about the task.
      expect(menu([0, 12], 'by Friday')?.due).toBe('by Friday')
      expect(menu([0, 13], 'até sexta')?.due).toBe('até sexta')
      expect(menu([0, 14], 'até sexta')?.due).toBe('até sexta')
      expect(menu([0, 15], 'by Monday')?.due).toBe('by Monday')
      expect(menu([0, 16], 'by Friday')?.due).toBe('by Friday')
      expect(menu([0, 17], 'by Friday')?.due).toBe('by Friday')
      // A reply that names other work, even with no verb, is about that work.
      expect(menu([0, 18], 'até sexta')).not.toHaveProperty('due')
      expect(menu([0, 19], 'by Friday')).not.toHaveProperty('due')
      // A refusal keeps nothing: the deadline said is the one refused.
      expect(menu([0, 20], 'até sexta')).not.toHaveProperty('due')
      expect(menu([0, 21], 'by Friday')).not.toHaveProperty('due')
      expect(menu([0, 22], 'by Friday')).not.toHaveProperty('due')
      // In Portuguese "no" is "em + o", and "não tem problema" agrees.
      expect(menu([0, 23], 'sábado')?.due).toBe('sábado')
      expect(menu([0, 24], 'até sexta')?.due).toBe('até sexta')
      // A line that names the task keeps its deadline, with a "não" or a "no" on it.
      const own = (task: string, quote: string, segment: number) =>
        run(t, item(task, '', quote, [segment], 'até sexta')).actionItems[0]?.due
      expect(own('Atualizar o cardápio no site', 'A Ana atualiza o cardápio no site', 25)).toBe(
        'até sexta',
      )
      expect(own('Revisar o cardápio', 'revisar o cardápio', 26)).toBe('até sexta')
    })

    it('cuts the deadline from the end of the task with the word that leads into it', () => {
      const t = line(
        'Vou mandar as notas antes de sexta.',
        'Vou mandar as notas pra sexta!',
        'Vou mandar as notas sexta.',
        'Vou mandar as notas até sexta.',
      )
      const task = (wording: string, d: string, seg: number) =>
        run(t, item(wording, 'Me', 'mandar as notas', [seg], d)).actionItems[0]?.task
      expect(task('Mandar as notas antes de sexta.', 'sexta', 0)).toBe('Mandar as notas.')
      expect(task('Mandar as notas, pra sexta!', 'pra sexta', 1)).toBe('Mandar as notas!')
      expect(task('Mandar as notas sexta', 'sexta', 2)).toBe('Mandar as notas sexta')
      expect(task('Mandar as notas até sexta', 'até sexta', 3)).toBe('Mandar as notas')
      expect(task('Mandar as notas até sexta para o time', 'até sexta', 3)).toBe(
        'Mandar as notas até sexta para o time',
      )
      expect(task('até sexta', 'até sexta', 3)).toBe('até sexta')
    })
  })
})
