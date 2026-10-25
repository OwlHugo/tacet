const STOPWORDS = new Set(
  (
    'a an the and or but of to in on at for with is are was were be been it this that these those i you he she we they ' +
    'me my your our their us them so do does did will would can could should just ok okay yeah yes no not ' +
    'o a os as um uma de da do das dos e ou em no na nos nas por para pra com que se eu voce você ele ela nos nós eles elas ' +
    'meu minha seu sua é foi ser vai vou sim não nao tá ta então entao'
  ).split(' '),
)

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function words(text: string): string[] {
  const n = normalize(text)
  return n ? n.split(' ') : []
}

const contentWords = (text: string): string[] =>
  words(text).filter((w) => w.length > 1 && !STOPWORDS.has(w))

const stem = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)

/** Share of the content words of `needle` found in `haystack` (0..1), with light plural stemming. */
export function coverage(needle: string, haystack: string): number {
  const target = contentWords(needle).map(stem)
  if (target.length === 0) return 0
  const hay = new Set(contentWords(haystack).map(stem))
  return target.filter((w) => hay.has(w)).length / target.length
}

/** Jaccard similarity of the content-word sets. */
export function similarity(a: string, b: string): number {
  const sa = new Set(contentWords(a))
  const sb = new Set(contentWords(b))
  if (sa.size === 0 || sb.size === 0) return 0
  const inter = [...sa].filter((w) => sb.has(w)).length
  return inter / (sa.size + sb.size - inter)
}
