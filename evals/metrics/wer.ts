import { words } from '@tacet/core'

export interface WerResult {
  readonly wer: number
  readonly errors: number
  readonly substitutions: number
  readonly deletions: number
  readonly insertions: number
  readonly referenceWords: number
}

type Cell = readonly [cost: number, sub: number, del: number, ins: number]

const cheapest = (cells: readonly Cell[]): Cell =>
  cells.reduce((best, c) => (c[0] < best[0] ? c : best))

/** Word error rate after normalization (case, accents, punctuation). Levenshtein alignment. */
export function wer(reference: string, hypothesis: string): WerResult {
  const ref = words(reference)
  const hyp = words(hypothesis)
  let prev: Cell[] = Array.from({ length: hyp.length + 1 }, (_, j): Cell => [j, 0, 0, j])
  ref.forEach((r, i) => {
    const row: Cell[] = [[i + 1, 0, i + 1, 0]]
    hyp.forEach((h, j) => {
      const diag = prev[j] as Cell
      const up = prev[j + 1] as Cell
      const left = row[j] as Cell
      row.push(
        r === h
          ? diag
          : cheapest([
              [diag[0] + 1, diag[1] + 1, diag[2], diag[3]],
              [up[0] + 1, up[1], up[2] + 1, up[3]],
              [left[0] + 1, left[1], left[2], left[3] + 1],
            ]),
      )
    })
    prev = row
  })
  const [errors, substitutions, deletions, insertions] = prev[hyp.length] as Cell
  const rate = ref.length > 0 ? errors / ref.length : Math.min(hyp.length, 1)
  return { wer: rate, errors, substitutions, deletions, insertions, referenceWords: ref.length }
}
