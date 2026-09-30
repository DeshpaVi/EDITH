/**
 * A scripted conversation that reveals itself over time, so the transcript
 * panel can be developed — including its empty, partial and growing states —
 * without a live call or a deployed backend.
 */

import type { TranscriptClient } from './client'
import type { TranscriptItem } from './types'

const BILLING: Array<{ atMs: number; item: TranscriptItem }> = [
  { atMs: 0, item: { kind: 'turn', id: 's1', sortKey: 0, role: 'SYSTEM', content: 'This call may be recorded and monitored for training and quality assurance purposes.', offsetMillis: 0 } },
  { atMs: 1500, item: { kind: 'turn', id: 's2', sortKey: 4200, role: 'AGENT', content: 'Thanks for holding — this is Sam in billing. I can see you were looking at a charge on your account.', offsetMillis: 4200 } },
  { atMs: 4000, item: { kind: 'turn', id: 's3', sortKey: 11800, role: 'CUSTOMER', content: "Yes, there's a charge from the third that I don't recognise at all.", offsetMillis: 11800, sentiment: 'NEGATIVE' } },
  { atMs: 7000, item: { kind: 'turn', id: 's4', sortKey: 19000, role: 'AGENT', content: 'Understood. Let me pull that up — can you confirm the last four digits of the card?', offsetMillis: 19000 } },
  { atMs: 10000, item: { kind: 'turn', id: 's5', sortKey: 24500, role: 'CUSTOMER', content: 'It ends ****.', offsetMillis: 24500, redactions: [{ begin: 9, end: 13 }] } },
  { atMs: 13000, item: { kind: 'turn', id: 's6', sortKey: 31000, role: 'AGENT', content: "Got it. I'm raising a dispute for that transaction now.", offsetMillis: 31000, sentiment: 'POSITIVE', categories: ['DisputeRaised'] } },
]

/** Builds a scripted call from [role, text] pairs, one turn every 3.5s. */
function script(lines: Array<['AGENT' | 'CUSTOMER', string]>): Array<{ atMs: number; item: TranscriptItem }> {
  return lines.map(([role, content], i) => ({
    atMs: 1000 + i * 3500,
    item: { kind: 'turn', id: `m${i}`, sortKey: i * 5000, role, content, offsetMillis: i * 5000 },
  }))
}

// Scenarios for demoing the auto-opening forms without a live call:
// open the app with ?scenario=card | relative | password (default: billing).
const SCENARIOS: Record<string, Array<{ atMs: number; item: TranscriptItem }>> = {
  billing: BILLING,
  card: script([
    ['AGENT', 'Thanks for calling, how can I help you today?'],
    ['CUSTOMER', 'Hi, I want to enroll for a new credit card.'],
    ['AGENT', 'Happy to help. Would you like the Gold or the Platinum card?'],
    ['CUSTOMER', 'Platinum.'],
    ['AGENT', 'Are you an existing customer with us?'],
    ['CUSTOMER', 'Yes, I am.'],
    ['AGENT', 'And which city do you live in?'],
    ['CUSTOMER', 'Pune.'],
  ]),
  relative: script([
    ['AGENT', 'How can I help you?'],
    ['CUSTOMER', 'I want to add details of my mother.'],
    ['AGENT', 'Sure. What is her name?'],
    ['CUSTOMER', 'Sunita Deshpande.'],
    ['AGENT', 'How old is she?'],
    ['CUSTOMER', 'She is sixty two.'],
    ['AGENT', 'And which city does she live in?'],
    ['CUSTOMER', 'She lives in Nagpur.'],
  ]),
  password: script([
    ['AGENT', 'How can I help you?'],
    ['CUSTOMER', "I forgot my password and I'm locked out."],
    ['AGENT', 'I can send you a reset link. Email or SMS?'],
    ['CUSTOMER', 'Email please.'],
  ]),
}

export function createMockTranscriptClient(): TranscriptClient {
  const startedAt = Date.now()
  const name = new URLSearchParams(globalThis.location?.search ?? '').get('scenario') ?? 'billing'
  const SCRIPT = SCENARIOS[name] ?? BILLING
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
