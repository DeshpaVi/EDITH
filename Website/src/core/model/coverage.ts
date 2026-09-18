/**
 * Coverage is two-dimensional on purpose.
 *
 * A run that maps every flow block but resolves none of the bot's intents is not a 100%
 * migration; a single percentage would report it as one. Flow structure and
 * conversational content are counted separately because they come from separate files
 * and fail independently.
 */
export interface CoverageReport {
  flow: {
    totalActions: number
    mapped: number
    unknown: Array<{ id: string; sourceType: string }>
  }
  nlu: {
    totalIntents: number
    /** Intents the flow actually branches on AND the bot defines. */
    resolved: number
    /** Defined by the bot, never branched on by the flow. Possibly dead, possibly not. */
    orphaned: string[]
    /** Branched on by the flow, absent from every uploaded bot. */
    dangling: string[]
  }
  /** Things a human must decide. Not defects. */
  requiresReview: ReviewItem[]
}

export interface ReviewItem {
  nodeId: string
  reason: string
  severity: 'info' | 'warn' | 'blocker'
}

export function emptyCoverage(): CoverageReport {
  return {
    flow: { totalActions: 0, mapped: 0, unknown: [] },
    nlu: { totalIntents: 0, resolved: 0, orphaned: [], dangling: [] },
    requiresReview: [],
  }
}
