/** Events from main to renderer: progress only, everything else is request/response. */
export const EVENTS = {
  state: 'event:state',
  meetingsChanged: 'event:meetings-changed',
  recorderStart: 'event:recorder-start',
  recorderStop: 'event:recorder-stop',
  /** Loudness (0..1) of each chunk while recording, for the level meters. */
  level: 'event:level',
} as const
