import type { Minutes } from './types.ts'

/**
 * Items the model wrote that are not in the transcript: what grounding dropped as made up. A dropped
 * deadline leaves its task, and an unconfirmed decision was said, so neither counts.
 */
export const madeUp = (m: Minutes): number =>
  m.rejected.filter((r) => r.kind !== 'deadline' && r.kind !== 'unconfirmed').length
