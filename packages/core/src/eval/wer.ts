import { words } from '../text.js';

export interface WerResult {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceWords: number;
}

/** Word error rate after normalization (case, accents, punctuation). Standard Levenshtein alignment. */
export function wer(reference: string, hypothesis: string): WerResult {
  const r = words(reference);
  const h = words(hypothesis);
  const n = r.length;
  const m = h.length;
  // dp[i][j] = [cost, sub, del, ins]
  let prev: [number, number, number, number][] = Array.from({ length: m + 1 }, (_, j) => [j, 0, 0, j]);
  for (let i = 1; i <= n; i++) {
    const cur: [number, number, number, number][] = [[i, 0, i, 0]];
    for (let j = 1; j <= m; j++) {
      const p = prev[j - 1]!;
      const up = prev[j]!;
      const left = cur[j - 1]!;
      if (r[i - 1] === h[j - 1]) {
        cur.push([p[0], p[1], p[2], p[3]]);
        continue;
      }
      const opts: [number, number, number, number][] = [
        [p[0] + 1, p[1] + 1, p[2], p[3]],
        [up[0] + 1, up[1], up[2] + 1, up[3]],
        [left[0] + 1, left[1], left[2], left[3] + 1],
      ];
      cur.push(opts.reduce((a, b) => (b[0] < a[0] ? b : a)));
    }
    prev = cur;
  }
  const [cost, substitutions, deletions, insertions] = prev[m]!;
  return { wer: n ? cost / n : m ? 1 : 0, substitutions, deletions, insertions, referenceWords: n };
}
