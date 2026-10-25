import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groundMinutes } from '../src/minutes.js';
import { MeetingStore } from '../src/store.js';
import type { Meeting } from '../src/types.js';
import { transcript } from './fixtures.js';

const meeting: Meeting = {
  id: 'm1',
  title: 'Beta launch sync',
  date: new Date(2026, 9, 24, 14, 30).toISOString(),
  transcript,
  minutes: groundMinutes(
    {
      summary: [{ text: 'Beta launch planned for Friday', segments: [1] }],
      decisions: [],
      action_items: [{ task: 'Update the pricing page', owner: 'Maria', quote: 'Maria will update the pricing page', segments: [2] }],
    },
    transcript,
    'test',
  ),
  timings: { transcribeSeconds: 1 },
};

describe('MeetingStore', () => {
  it('writes Obsidian markdown with timestamp links to block ids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tacet-store-'));
    const store = new MeetingStore(dir);
    const path = store.save(meeting);
    expect(path.endsWith('2026-10-24 1430 Beta launch sync.md')).toBe(true);
    const md = readFileSync(path, 'utf8');
    expect(md).toContain('title: "Beta launch sync"');
    expect(md).toContain('- [ ] Update the pricing page (**Maria**) [[#^t0002|00:09]]');
    expect(md).toContain('**00:09 Others:** Agreed, Friday it is. Maria will update the pricing page. ^t0002');
    expect(md).toContain('_No decisions found in the transcript._');
  });

  it('renames the markdown when the title changes and searches across meetings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tacet-store-'));
    const store = new MeetingStore(dir);
    store.save(meeting);
    store.save({ ...meeting, title: 'Renamed' });
    expect(readdirSync(dir).filter((f) => f.endsWith('.md'))).toEqual(['2026-10-24 1430 Renamed.md']);
    const hits = store.search('PRICING maria');
    expect(hits.map((h) => h.where)).toEqual(['action', 'transcript']);
    expect(hits[1]?.timestamp).toBe('00:09');
  });
});
