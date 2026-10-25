import type { Transcript } from './transcript/types.ts'

/** Shared fixture for the core tests. */
export const TRANSCRIPT: Transcript = {
  language: 'en',
  model: 'base',
  duration: 26,
  segments: [
    {
      id: 0,
      start: 0,
      end: 4,
      speaker: 'Others',
      text: 'Morning everyone, the agenda today is the beta launch.',
    },
    {
      id: 1,
      start: 4.5,
      end: 9,
      speaker: 'Me',
      text: 'I think we should ship the beta on Friday.',
    },
    {
      id: 2,
      start: 9.5,
      end: 14,
      speaker: 'Others',
      text: 'Agreed, Friday it is. Maria will update the pricing page.',
    },
    {
      id: 3,
      start: 14.5,
      end: 20,
      speaker: 'Me',
      text: 'I will send the release notes to the team by Thursday.',
    },
    {
      id: 4,
      start: 20.5,
      end: 26,
      speaker: 'Others',
      text: 'We also decided to drop the dark mode toggle for now.',
    },
  ],
}
