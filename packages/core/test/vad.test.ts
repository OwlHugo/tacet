import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanText } from '../src/transcribe.js';
import { readWav, snapToSpeech, speechRegions } from '../src/vad.js';
import { WavWriter, wavDuration } from '../src/wav.js';

function tone(seconds: number, rate = 16000, amp = 0.3): Float32Array {
  const a = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin((2 * Math.PI * 220 * i) / rate);
  return a;
}

describe('wav + vad', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'tacet-vad-')), 'x.wav');
  const w = new WavWriter(path);
  w.write(new Float32Array(16000)); // 1s silence
  w.write(tone(2)); // speech 1..3
  w.write(new Float32Array(32000)); // silence 3..5
  w.write(tone(1)); // speech 5..6
  w.close();

  it('writes a valid wav header', () => {
    expect(wavDuration(path)).toBeCloseTo(6, 2);
    expect(readWav(path).samples.length).toBe(96000);
  });

  it('finds the speech regions', () => {
    const r = speechRegions(readWav(path));
    expect(r).toHaveLength(2);
    expect(r[0]!.start).toBeCloseTo(1, 1);
    expect(r[0]!.end).toBeCloseTo(3, 1);
    expect(r[1]!.start).toBeCloseTo(5, 1);
  });

  it('snaps drifting whisper segments onto speech and drops segments over silence', () => {
    const regions = speechRegions(readWav(path));
    const out = snapToSpeech(
      [
        { start: 0, end: 3.2, text: 'a' },
        { start: 3.2, end: 6, text: 'b' },
        { start: 3.3, end: 4.6, text: 'ghost' },
      ],
      regions,
    );
    expect(out.map((s) => s.text)).toEqual(['a', 'b']);
    expect(out[0]!.start).toBeCloseTo(1, 1);
    expect(out[1]!.start).toBeCloseTo(5, 1);
  });

  it('is silent-safe', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'tacet-vad-')), 's.wav');
    const s = new WavWriter(p);
    s.write(new Float32Array(16000));
    s.close();
    expect(speechRegions(readWav(p))).toEqual([]);
  });
});

describe('cleanText', () => {
  it('drops an unmatched leading quote', () => {
    expect(cleanText(' "I think we ship')).toBe('I think we ship');
    expect(cleanText('He said "ship it"')).toBe('He said "ship it"');
  });
});
