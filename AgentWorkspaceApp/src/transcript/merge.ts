/**
 * Page merging for a polled transcript.
 *
 * Polling Contact Lens is not "append what arrived". A poll can return segments
 * already seen (a resumed token overlaps), segments revised since the last poll,
 * and — for voice — segments that arrive slightly out of offset order because
 * the two participants are transcribed independently. So the merge is keyed on
 * the segment id, takes the newest version of each, and sorts on the
 * channel-independent `sortKey`.
 *
 * Pure, so the polling hook above it holds no merge logic worth testing twice.
 */

import type { TranscriptItem } from './types'

export interface TranscriptState {
  /** Newest version of every segment seen, keyed by segment id. */
  byId: ReadonlyMap<string, TranscriptItem>
  /** Sorted for rendering: oldest first. */
  ordered: readonly TranscriptItem[]
}

export const emptyTranscript: TranscriptState = { byId: new Map(), ordered: [] }

export function mergePage(state: TranscriptState, incoming: readonly TranscriptItem[]): TranscriptState {
  if (incoming.length === 0) return state

  let changed = false
  const byId = new Map(state.byId)
  for (const item of incoming) {
    const existing = byId.get(item.id)
    if (existing !== undefined && sameItem(existing, item)) continue
    byId.set(item.id, item)
    changed = true
  }
  if (!changed) return state

  // Insertion order is the tiebreaker for equal sort keys: two segments at the
  // same millisecond offset should stay in the order Contact Lens emitted them.
  const order = new Map<string, number>()
  for (const [index, id] of [...byId.keys()].entries()) order.set(id, index)

  const ordered = [...byId.values()].sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
  })

  return { byId, ordered }
}

function sameItem(a: TranscriptItem, b: TranscriptItem): boolean {
  if (a.kind !== b.kind || a.sortKey !== b.sortKey) return false
  if (a.kind === 'turn' && b.kind === 'turn') {
    return a.content === b.content && a.sentiment === b.sentiment && a.role === b.role
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Voice offsets render as elapsed call time; chat renders as a wall clock. */
export function itemTimeLabel(item: TranscriptItem): string {
  if (item.kind === 'turn' || item.kind === 'event') {
    if ('offsetMillis' in item && item.offsetMillis !== undefined) {
      const total = Math.floor(item.offsetMillis / 1000)
      return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
    }
    if (item.timestamp !== undefined) {
      const parsed = new Date(item.timestamp)
      if (!Number.isNaN(parsed.getTime())) {
        return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(parsed)
      }
    }
  }
  return ''
}
