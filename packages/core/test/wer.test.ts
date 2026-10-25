import { describe, expect, it } from 'vitest';
import { wer } from '../src/eval/wer.js';

describe('wer', () => {
  it('is zero for identical text, ignoring case and punctuation', () => {
    expect(wer('Hello, World!', 'hello world').wer).toBe(0);
  });
  it('counts substitutions, deletions and insertions', () => {
    const r = wer('the cat sat on the mat', 'the cat sit on mat');
    expect(r.substitutions).toBe(1);
    expect(r.deletions).toBe(1);
    expect(r.wer).toBeCloseTo(2 / 6);
    expect(wer('ship it', 'ship it now').insertions).toBe(1);
  });
  it('ignores accents', () => {
    expect(wer('reunião às três', 'reuniao as tres').wer).toBe(0);
  });
  it('handles empty reference', () => {
    expect(wer('', '').wer).toBe(0);
    expect(wer('', 'noise').wer).toBe(1);
  });
});
