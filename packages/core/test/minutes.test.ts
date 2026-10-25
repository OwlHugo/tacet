import { describe, expect, it } from 'vitest';
import { checkGrounding } from '../src/eval/grounding.js';
import { chunkSegments, generateMinutes, groundMinutes, type RawMinutes } from '../src/minutes.js';
import { transcript } from './fixtures.js';

const raw: RawMinutes = {
  summary: [
    { text: 'The team planned the beta launch for Friday.', segments: [0, 1, 2] },
    { text: 'Budget for Q3 was approved.', segments: [0] },
  ],
  decisions: [
    { text: 'Ship the beta on Friday', quote: 'Agreed, Friday it is.', segments: [2] },
    { text: 'Drop the dark mode toggle', quote: 'drop the dark mode toggle for now', segments: [3] },
    { text: 'Hire two engineers', quote: 'we will hire two engineers', segments: [1] },
  ],
  action_items: [
    { task: 'Update the pricing page', owner: 'Maria', quote: 'Maria will update the pricing page.', segments: [2] },
    { task: 'Send the release notes to the team by Thursday', owner: 'Me', quote: 'I will send the release notes', segments: [3] },
    { task: 'Book the venue', owner: 'John', quote: 'John books the venue', segments: [1] },
  ],
};

describe('groundMinutes', () => {
  const m = groundMinutes(raw, transcript, 'test');

  it('keeps only items backed by the transcript', () => {
    expect(m.summary.map((s) => s.text)).toEqual(['The team planned the beta launch for Friday.']);
    expect(m.decisions.map((d) => d.text)).toEqual(['Ship the beta on Friday', 'Drop the dark mode toggle']);
    expect(m.actionItems.map((a) => a.task)).toEqual(['Update the pricing page', 'Send the release notes to the team by Thursday']);
    expect(m.rejected.map((r) => r.text).sort()).toEqual(['Book the venue', 'Budget for Q3 was approved.', 'Hire two engineers']);
  });

  it('re-anchors a quote cited on the wrong line and takes the timestamp from the transcript', () => {
    const dark = m.decisions.find((d) => d.text.startsWith('Drop'));
    expect(dark?.segments).toEqual([4]);
    expect(dark?.at).toBe(20.5);
  });

  it('keeps named owners only when the name was said', () => {
    expect(m.actionItems[0]?.owner).toBe('Maria');
    const fake = groundMinutes(
      { summary: [], decisions: [], action_items: [{ task: 'Update the pricing page', owner: 'Pedro', quote: 'Maria will update the pricing page', segments: [2] }] },
      transcript,
      'test',
    );
    expect(fake.actionItems[0]?.owner).toBe('Unassigned');
  });

  it('passes the independent grounding check', () => {
    const report = checkGrounding(m, transcript, [['pricing', 'page'], ['release', 'notes']]);
    expect(report.grounded).toBe(report.items);
    expect(report.expectedFound).toBe(2);
  });

  it('ignores invalid segment ids without crashing', () => {
    const r = groundMinutes(
      { summary: [], decisions: [], action_items: [{ task: 'Send the release notes', owner: 'Me', quote: 'send the release notes', segments: [99] }] },
      transcript,
      't',
    );
    expect(r.actionItems[0]?.segments).toEqual([3]);
  });
});

describe('generateMinutes', () => {
  it('chunks long transcripts and grounds the merged result', async () => {
    const calls: string[] = [];
    const { minutes } = await generateMinutes(transcript, {
      generate: async (_s, user) => {
        calls.push(user);
        return raw;
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('[3] 00:14 Me: I will send the release notes');
    expect(minutes.actionItems).toHaveLength(2);
  });

  it('splits by size', () => {
    expect(chunkSegments(transcript.segments, 120).length).toBeGreaterThan(1);
  });
});
