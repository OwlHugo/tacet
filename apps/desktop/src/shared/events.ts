/** Events from main to renderer: progress only, everything else is request/response. */
export const EVENTS = {
  state: 'event:state',
  meetingsChanged: 'event:meetings-changed',
  recorderStart: 'event:recorder-start',
  recorderStop: 'event:recorder-stop',
} as const
