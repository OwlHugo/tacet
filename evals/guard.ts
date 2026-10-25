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

/** A deadline nobody said, pinned on every real task: it must never reach the minutes. */
const FAKE_DUE = 'before the Lisbon offsite'

/**
 * Deadlines that were said, each moved onto another real task of the same meeting, as a model that
 * mixes up who promised what would do: Maria's "before that" on the release notes. A moved deadline
 * may only survive on a task whose own line or reply says it too.
 */
function swapped(raw: RawMinutes): RawMinutes['action_items'] {
  const said = raw.action_items.map((a) => a.due).filter((d) => d.trim() !== '')
  return raw.action_items.flatMap((a) => {
    const other = said.find((d) => d !== a.due)
    return other === undefined ? [] : [{ ...a, due: other }]
  })
}

/**
 * Mix the fabricated items into real model output, a made-up deadline into each real task, and a
 * deadline said for another task into each real task, and count how many the guard throws away.
 */
export function guardCheck(
  raw: RawMinutes,
  transcript: Transcript,
): { injected: number; rejected: number } {
  const m = groundMinutes(
    {
      summary: [...raw.summary, ...INJECTED.summary],
      decisions: [...raw.decisions, ...INJECTED.decisions],
      action_items: [
        ...raw.action_items.map((a) => ({ ...a, due: FAKE_DUE })),
        ...INJECTED.action_items,
      ],
    },
    transcript,
    'guard',
  )
  const survived = [
    ...m.summary.map((x) => x.text),
    ...m.decisions.map((x) => x.text),
    ...m.actionItems.map((x) => x.task),
  ].filter((t) => FAKE.has(t)).length
  // Only tasks that reach the minutes test the deadline check; a task dropped for its wording does not.
  const real = m.actionItems.filter((a) => !FAKE.has(a.task))
  const fakeDue = real.filter((a) => a.due === FAKE_DUE).length
  const moved = swappedCheck(raw, transcript)
  const injected = FAKE.size + real.length + moved.injected
  return { injected, rejected: injected - survived - fakeDue - moved.survived }
}

/** A deadline moved to another task survives only where the transcript says it for that task too. */
function swappedCheck(raw: RawMinutes, transcript: Transcript) {
  const tasks = swapped(raw)
  const m = groundMinutes({ summary: [], decisions: [], action_items: tasks }, transcript, 'guard')
  const honest = groundMinutes(raw, transcript, 'guard')
  const ownDue = new Map(honest.actionItems.map((a) => [a.task, a.due]))
  const kept = m.actionItems.filter((a) => a.due !== undefined)
  // Two tasks can share a deadline that was said for both ("both by Friday"): not a leak.
  const survived = kept.filter((a) => a.due !== ownDue.get(a.task)).length
  return { injected: m.actionItems.length, survived }
}
