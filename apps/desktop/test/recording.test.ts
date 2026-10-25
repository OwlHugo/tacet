import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWav } from '@tacet/core';
import { describe, expect, it } from 'vitest';
import { RecordingSession } from '../src/main/recording';

describe('RecordingSession', () => {
  it('writes one wav per track and skips empty tracks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tacet-rec-'));
    const s = new RecordingSession('x', dir);
    s.open('mic', 16000);
    s.open('system', 16000);
    for (let i = 0; i < 10; i++) s.write('mic', new Float32Array(4096).fill(0.25));
    const tracks = s.close();
    expect(tracks.map((t) => t.track)).toEqual(['mic']);
    expect(tracks[0]!.seconds).toBeCloseTo(2.56, 2);
    expect(readWav(tracks[0]!.path).samples[100]).toBeCloseTo(0.25, 3);
  });
});
