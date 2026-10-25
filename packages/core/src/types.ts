/** Who said a segment. Track-based: the mic track is "Me", the system track is "Others". */
export type Speaker = 'Me' | 'Others' | (string & {});

export interface Segment {
  /** Stable index inside the transcript, used by the minutes to cite sources. */
  id: number;
  /** Seconds from the start of the meeting. */
  start: number;
  end: number;
  speaker: Speaker;
  text: string;
}

export interface Transcript {
  segments: Segment[];
  /** Total audio duration in seconds. */
  duration: number;
  language: string;
  model: string;
}

/** Anything in the minutes points back to one or more transcript segments. */
export interface Citation {
  segments: number[];
  /** Start time (seconds) of the first cited segment. Derived from the transcript, never from the LLM. */
  at: number;
}

export interface SummaryPoint extends Citation {
  text: string;
}

export interface Decision extends Citation {
  text: string;
  quote: string;
}

export interface ActionItem extends Citation {
  task: string;
  owner: string;
  quote: string;
}

export interface RejectedItem {
  kind: 'summary' | 'decision' | 'action';
  text: string;
  reason: string;
}

export interface Minutes {
  summary: SummaryPoint[];
  decisions: Decision[];
  actionItems: ActionItem[];
  /** Items the LLM produced that could not be traced back to the transcript. Kept for transparency, never rendered as facts. */
  rejected: RejectedItem[];
  model: string;
}

export interface Meeting {
  id: string;
  title: string;
  /** ISO date-time of when the meeting started. */
  date: string;
  transcript: Transcript;
  minutes?: Minutes;
  timings: {
    transcribeSeconds: number;
    minutesSeconds?: number;
  };
}
