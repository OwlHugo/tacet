import {
  groundMinutes,
  type Minutes,
  normalize,
  type RawMinutes,
  type Transcript,
} from '@tacet/core'

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

/** A deadline nobody said: it must never reach the minutes, not even through the task's wording. */
const FAKE_DUE = 'before the Lisbon offsite'

type Item = RawMinutes['action_items'][number]

/** Whether the task's wording still ends with the deadline. */
const shows = (a: Minutes['actionItems'][number], due: string) =>
  normalize(a.task).endsWith(normalize(due))

/**
 * The deadline cases a model gets wrong, each built on the real output of the case. Every attack is
 * grounded on its own, against the honest result, and counts as rejected when the attacked task
 * shows no deadline other than the one the honest run gave it.
 */
function deadlineAttacks(
  raw: RawMinutes,
): { name: string; items: Item[]; target: number; due: string }[] {
  const said = raw.action_items.map((a) => a.due.trim())
  return raw.action_items.flatMap((a, k) => {
    const other = said.find((d, j) => j !== k && d !== '' && d !== a.due.trim())
    const pin = (due: string, items: Item[] = raw.action_items) =>
      items.map((x, j) =>
        j === k ? { ...x, due, task: `${x.task.replace(/[.!?]$/, '')} by ${due}` } : x,
      )
    return [
      // A deadline nobody said, in the field and in the wording.
      { name: 'made up', items: pin(FAKE_DUE), target: k, due: FAKE_DUE },
      // A deadline said in the meeting for another task, moved onto this one.
      ...(other === undefined ? [] : [{ name: 'moved', items: pin(other), target: k, due: other }]),
      // Another task said on the same line: that line no longer tells whose its deadline is.
      ...(a.due.trim() === ''
        ? []
        : [
            {
              name: 'shared line',
              items: [
                ...raw.action_items,
                {
                  task: a.task,
                  owner: 'Unassigned',
                  due: a.due,
                  quote: a.quote,
                  segments: a.segments,
                },
              ].map((x, j) =>
                j === raw.action_items.length ? { ...x, task: `Also ${x.task}` } : x,
              ),
              target: k,
              due: a.due,
            },
          ]),
    ]
  })
}

/**
 * Mix the fabricated items into real model output, and run every deadline attack on it, and count
 * how many the guard throws away.
 */
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
  const honest = groundMinutes(raw, transcript, 'guard').actionItems
  let attacks = 0
  let leaked = 0
  for (const at of deadlineAttacks(raw)) {
    const task = at.items[at.target]
    const own = honest.find((h) => h.quote === task?.quote.trim())
    // Only a task that reaches the minutes tests the deadline check.
    if (own === undefined) continue
    const hit = groundMinutes(
      { ...raw, action_items: at.items },
      transcript,
      'guard',
    ).actionItems.find((x) => x.quote === own.quote && x.owner === own.owner)
    if (hit === undefined) continue
    attacks++
    // A missing deadline is acceptable; the attack's deadline, in the field or the wording, is not.
    const wrong =
      at.name === 'shared line'
        ? hit.due !== undefined
        : (hit.due !== undefined && hit.due !== own.due) || shows(hit, at.due)
    if (wrong) leaked++
  }
  const injected = FAKE.size + attacks
  return { injected, rejected: injected - survived - leaked }
}
