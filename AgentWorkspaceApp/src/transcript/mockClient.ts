/**
 * A scripted conversation that reveals itself over time, so the transcript
 * panel can be developed — including its empty, partial and growing states —
 * without a live call or a deployed backend.
 */

import type { TranscriptClient } from './client'
import type { TranscriptItem } from './types'

const SCRIPT: Array<{ atMs: number; item: TranscriptItem }> = [
  { atMs: 0, item: { kind: 'turn', id: 's1', sortKey: 0, role: 'SYSTEM', content: 'This call may be recorded and monitored for training and quality assurance purposes.', offsetMillis: 0 } },
  { atMs: 1500, item: { kind: 'turn', id: 's2', sortKey: 4200, role: 'AGENT', content: 'Thanks for holding — this is Sam in billing. I can see you were looking at a charge on your account.', offsetMillis: 4200 } },
  { atMs: 4000, item: { kind: 'turn', id: 's3', sortKey: 11800, role: 'CUSTOMER', content: "Yes, there's a charge from the third that I don't recognise at all.", offsetMillis: 11800, sentiment: 'NEGATIVE' } },
  { atMs: 7000, item: { kind: 'turn', id: 's4', sortKey: 19000, role: 'AGENT', content: 'Understood. Let me pull that up — can you confirm the last four digits of the card?', offsetMillis: 19000 } },
  { atMs: 10000, item: { kind: 'turn', id: 's5', sortKey: 24500, role: 'CUSTOMER', content: 'It ends ****.', offsetMillis: 24500, redactions: [{ begin: 9, end: 13 }] } },
  { atMs: 13000, item: { kind: 'turn', id: 's6', sortKey: 31000, role: 'AGENT', content: "Got it. I'm raising a dispute for that transaction now.", offsetMillis: 31000, sentiment: 'POSITIVE', categories: ['DisputeRaised'] } },
]

export function createMockTranscriptClient(): TranscriptClient {
  const startedAt = Date.now()
  return {
    kind: 'mock',
    async fetchPage() {
      const elapsed = Date.now() - startedAt
      const items = SCRIPT.filter((entry) => entry.atMs <= elapsed).map((entry) => entry.item)
      return {
        ok: true,
        page: {
          channel: 'VOICE',
          status: 'IN_PROGRESS',
          items,
          empty: items.length === 0,
        },
      }
    },
  }
}
