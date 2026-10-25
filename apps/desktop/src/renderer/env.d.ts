import type { TacetApi } from '../preload/preload.ts'

declare global {
  interface Window {
    readonly tacet: TacetApi
  }
}
