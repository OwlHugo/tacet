import { groundMinutes, type RawMinutes, type Transcript } from '@tacet/core'

/** Fabricated items that cite real segment ids but are not in any transcript. */
const INJECTED: RawMinutes = {
  summary: [
    { text: 'The team approved a budget increase for the marketing department.', segments: [0] },
  ],
  decisions: [
    {
      text: 'Move the office to Lisbon.',
      quote: 'we will move the office to Lisbon next quarter',
      segments: [0],
    },
  ],
  action_items: [
    {
      task: 'Book flights for the offsite in Tokyo',
      owner: 'Others',
      due: '',
      quote: 'please book the flights to Tokyo',
      segments: [1],
    },
    {
      task: 'Renegotiate the cloud contract with the vendor',
      owner: 'Me',
      due: '',
      quote: 'renegotiate the cloud vendor contract',
      segments: [0],
    },
  ],
}

const FAKE = new Set([
  ...INJECTED.summary.map((x) => x.text),
  ...INJECTED.decisions.map((x) => x.text),
  ...INJECTED.action_items.map((x) => x.task),
])

/** Mix the fabricated items into real model output and count how many the guard throws away. */
export function guardCheck(
  raw: RawMinutes,
  transcript: Transcript,
): { injected: number; rejected: number } {
  const m = groundMinutes(
    {
      summary: [...raw.summary, ...INJECTED.summary],
      decisions: [...raw.decisions, ...INJECTED.decisions],
      action_items: [...raw.action_items, ...INJECTED.action_items],
    },
    transcript,
    'guard',
  )
  const survived = [
    ...m.summary.map((x) => x.text),
    ...m.decisions.map((x) => x.text),
    ...m.actionItems.map((x) => x.task),
  ].filter((t) => FAKE.has(t)).length
  return { injected: FAKE.size, rejected: FAKE.size - survived }
}
