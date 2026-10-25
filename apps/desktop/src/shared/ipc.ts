import type { Meeting, SearchHit } from '@tacet/core';

export type Track = 'mic' | 'system';

export interface Settings {
  outputDir: string;
  whisperModel: string;
  language: string;
  llmModel: string;
  shortcut: string;
  keepAudio: boolean;
}

export type RecorderState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'recording'; startedAt: number; tracks: Track[]; warnings: string[] }
  | { kind: 'processing'; stage: string }
  | { kind: 'error'; message: string };

export interface MeetingSummary {
  id: string;
  title: string;
  date: string;
  duration: number;
  actionItems: number;
  hasMinutes: boolean;
}

export interface Health {
  whisper: string | null;
  whisperError?: string;
  ollama: boolean;
  ollamaModels: string[];
  platform: NodeJS.Platform;
  permissions: { microphone: string; screen: string };
}

/** API exposed to the renderer through the preload bridge. */
export interface TacetApi {
  toggleRecording(): Promise<void>;
  onState(cb: (s: RecorderState) => void): () => void;
  onMeetingsChanged(cb: () => void): () => void;
  listMeetings(): Promise<MeetingSummary[]>;
  getMeeting(id: string): Promise<Meeting | undefined>;
  renameMeeting(id: string, title: string): Promise<void>;
  search(q: string): Promise<SearchHit[]>;
  getSettings(): Promise<Settings>;
  setSettings(s: Partial<Settings>): Promise<Settings>;
  chooseFolder(): Promise<string | undefined>;
  revealMeeting(id: string): Promise<void>;
  health(): Promise<Health>;
  /** Recorder side: used by the capture code living in the same renderer. */
  recorder: {
    onStart(cb: (opts: { id: string; fakeMic?: Uint8Array }) => void): () => void;
    onStop(cb: () => void): () => void;
    open(track: Track, sampleRate: number): void;
    chunk(track: Track, data: Float32Array): void;
    started(tracks: Track[], warnings: string[]): void;
    failed(message: string): void;
    closed(): void;
  };
}
