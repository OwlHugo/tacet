import { describe, expect, it } from 'vitest';
import { parseTracks } from '../src/args.js';

describe('parseTracks', () => {
  it('labels a single file as Speaker', () => {
    expect(parseTracks(['call.wav'])).toEqual([{ path: 'call.wav', speaker: 'Speaker' }]);
  });
  it('maps --mic and --system to Me and Others', () => {
    expect(parseTracks([], 'a.wav', 'b.wav').map((t) => t.speaker)).toEqual(['Me', 'Others']);
  });
  it('reads explicit labels', () => {
    expect(parseTracks(['x/me.flac:Me', 'them.wav:Ana'])).toEqual([
      { path: 'x/me.flac', speaker: 'Me' },
      { path: 'them.wav', speaker: 'Ana' },
    ]);
  });
});
