/**
 * Contact Lens real-time responses -> `TranscriptPage`.
 *
 * Pure, and shared between the Lambda (which calls AWS) and the tests (which
 * feed it recorded shapes). The AWS response types are declared structurally
 * here rather than imported from `@aws-sdk/client-connect` so that this module
 * stays usable from the browser bundle and from a test file without pulling a
 * service client into either. The field names below are taken from the SDK's
 * own model definitions:
 *
 *  - voice: `@aws-sdk/client-connect-contact-lens`, `ListRealtimeContactAnalysisSegments`
 *  - chat:  `@aws-sdk/client-connect`, `ListRealtimeContactAnalysisSegmentsV2`
 */

import type {
  AnalysisStatus,
  CharacterRange,
  ParticipantRole,
  Sentiment,
  TranscriptItem,
  TranscriptPage,
} from './types'

// --- Structural mirrors of the two AWS response shapes ---------------------

/**
 * Every field is optional, matching the generated AWS SDK models: the service
 * documents most of these as required, but the wire types do not enforce it,
 * and a normaliser that assumes otherwise throws on the one response that
 * differs. Missing values are defaulted here, visibly.
 */
export interface VoiceSegmentsResponse {
  Segments?: Array<{
    Transcript?: {
      Id?: string
      ParticipantId?: string
      ParticipantRole?: string
      Content?: string
      BeginOffsetMillis?: number
      EndOffsetMillis?: number
      Sentiment?: string
      IssuesDetected?: unknown[]
    }
    Categories?: {
      MatchedCategories?: string[]
      MatchedDetails?: Record<string, { PointsOfInterest?: Array<{ BeginOffsetMillis?: number }> } | undefined>
    }
    PostContactSummary?: { Content?: string; Status?: string; FailureCode?: string }
  }>
  NextToken?: string
}

export interface ChatSegmentsResponse {
  Channel?: string
  Status?: string
  Segments?: Array<{
    Transcript?: {
      Id?: string
      ParticipantId?: string
      ParticipantRole?: string
      DisplayName?: string
      Content?: string
      ContentType?: string
      Time?: { AbsoluteTime?: string | Date }
      Redaction?: { CharacterOffsets?: Array<{ BeginOffsetChar?: number; EndOffsetChar?: number }> }
      Sentiment?: string
    }
    Categories?: { MatchedDetails?: Record<string, unknown> }
    Event?: {
      Id?: string
      ParticipantRole?: string
      DisplayName?: string
      EventType?: string
      Time?: { AbsoluteTime?: string | Date }
    }
    PostContactSummary?: { Content?: string; Status?: string; FailureCode?: string }
    Issues?: unknown
    Attachments?: unknown
    ExtractedInformation?: unknown
  }>
  NextToken?: string
}

// --- Normalisers -----------------------------------------------------------

const ROLES: ReadonlySet<string> = new Set([
  'AGENT',
  'CUSTOMER',
  'SYSTEM',
  'CUSTOM_BOT',
  'SUPERVISOR',
])

function role(value: string | undefined): ParticipantRole {
  return value !== undefined && ROLES.has(value) ? (value as ParticipantRole) : 'UNKNOWN'
}

function sentiment(value: string | undefined): Sentiment | undefined {
  return value === 'POSITIVE' || value === 'NEGATIVE' || value === 'NEUTRAL' ? value : undefined
}

function status(value: string | undefined): AnalysisStatus {
  return value === 'IN_PROGRESS' || value === 'COMPLETED' || value === 'FAILED' ? value : 'UNKNOWN'
}

function epochMillis(time: string | Date | undefined): number | undefined {
  if (time === undefined) return undefined
  const parsed = time instanceof Date ? time.getTime() : Date.parse(time)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isoString(time: string | Date | undefined): string | undefined {
  const ms = epochMillis(time)
  return ms === undefined ? undefined : new Date(ms).toISOString()
}

function ranges(
  offsets: Array<{ BeginOffsetChar?: number; EndOffsetChar?: number }> | undefined,
): CharacterRange[] | undefined {
  const usable = (offsets ?? []).filter(
    (o): o is { BeginOffsetChar: number; EndOffsetChar: number } =>
      typeof o.BeginOffsetChar === 'number' && typeof o.EndOffsetChar === 'number',
  )
  if (usable.length === 0) return undefined
  return usable.map((o) => ({ begin: o.BeginOffsetChar, end: o.EndOffsetChar }))
}

/**
 * Voice segments carry no wall-clock time at all — only millisecond offsets
 * from the start of the call — so `sortKey` is the offset directly and the UI
 * renders "02:14" rather than a clock time.
 */
export function normalizeVoice(response: VoiceSegmentsResponse): TranscriptPage {
  const items: TranscriptItem[] = []
  // Category matches arrive as their own segments, keyed back to a transcript
  // by offset. Collect them first so a turn can carry its own categories.
  const categoriesByOffset = new Map<number, string[]>()

  for (const segment of response.Segments ?? []) {
    const details = segment.Categories?.MatchedDetails
    if (!details) continue
    for (const [name, detail] of Object.entries(details)) {
      for (const poi of detail?.PointsOfInterest ?? []) {
        if (typeof poi.BeginOffsetMillis !== 'number') continue
        const existing = categoriesByOffset.get(poi.BeginOffsetMillis) ?? []
        existing.push(name)
        categoriesByOffset.set(poi.BeginOffsetMillis, existing)
      }
    }
  }

  for (const [index, segment] of (response.Segments ?? []).entries()) {
    const t = segment.Transcript
    if (t) {
      const offset = t.BeginOffsetMillis ?? 0
      const categories = categoriesByOffset.get(offset)
      items.push({
        kind: 'turn',
        // The offset+role fallback is stable across polls in a way an array
        // index is not, so a segment with no id still dedupes correctly.
        id: t.Id ?? `voice-${offset}-${t.ParticipantRole ?? 'UNKNOWN'}`,
        sortKey: offset,
        role: role(t.ParticipantRole),
        content: t.Content ?? '',
        offsetMillis: offset,
        ...(sentiment(t.Sentiment) ? { sentiment: sentiment(t.Sentiment) } : {}),
        ...(categories && categories.length > 0 ? { categories } : {}),
      })
      continue
    }

    const summary = segment.PostContactSummary
    if (summary) {
      items.push({
        kind: 'summary',
        id: `summary-${index}`,
        sortKey: Number.MAX_SAFE_INTEGER,
        status: summary.Status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
        ...(summary.Content !== undefined ? { content: summary.Content } : {}),
        ...(summary.FailureCode !== undefined ? { failureCode: summary.FailureCode } : {}),
      })
      continue
    }

    // Pure category segments were folded into their turns above; anything else
    // is a segment type this app does not model yet. Keep it visible.
    if (!segment.Categories) {
      items.push({
        kind: 'unknown',
        id: `unknown-${index}`,
        sortKey: Number.MAX_SAFE_INTEGER - 1,
        segmentType: Object.keys(segment)[0] ?? 'empty',
      })
    }
  }

  const page: TranscriptPage = {
    channel: 'VOICE',
    // The voice API carries no analysis status field; the caller infers
    // completion from the contact's own lifecycle instead.
    status: 'UNKNOWN',
    items,
    empty: items.length === 0,
  }
  if (response.NextToken) page.nextToken = response.NextToken
  return page
}

/**
 * Chat segments carry absolute timestamps and a wider set of segment kinds
 * (events, attachments, extracted information). Everything recognised is
 * modelled; everything else becomes an `unknown` item rather than vanishing.
 */
export function normalizeChat(response: ChatSegmentsResponse): TranscriptPage {
  const items: TranscriptItem[] = []

  for (const [index, segment] of (response.Segments ?? []).entries()) {
    const t = segment.Transcript
    if (t) {
      const at = epochMillis(t.Time?.AbsoluteTime)
      const redactions = ranges(t.Redaction?.CharacterOffsets)
      items.push({
        kind: 'turn',
        id: t.Id ?? `chat-${at ?? index}-${t.ParticipantRole ?? 'UNKNOWN'}`,
        sortKey: at ?? index,
        role: role(t.ParticipantRole),
        content: t.Content ?? '',
        ...(t.DisplayName !== undefined ? { displayName: t.DisplayName } : {}),
        ...(isoString(t.Time?.AbsoluteTime) ? { timestamp: isoString(t.Time?.AbsoluteTime) } : {}),
        ...(sentiment(t.Sentiment) ? { sentiment: sentiment(t.Sentiment) } : {}),
        ...(redactions ? { redactions } : {}),
      })
      continue
    }

    const e = segment.Event
    if (e) {
      const at = epochMillis(e.Time?.AbsoluteTime)
      items.push({
        kind: 'event',
        id: e.Id ?? `chat-event-${at ?? index}`,
        sortKey: at ?? index,
        eventType: e.EventType ?? 'UNKNOWN_EVENT',
        ...(e.ParticipantRole ? { role: role(e.ParticipantRole) } : {}),
        ...(isoString(e.Time?.AbsoluteTime) ? { timestamp: isoString(e.Time?.AbsoluteTime) } : {}),
      })
      continue
    }

    const summary = segment.PostContactSummary
    if (summary) {
      items.push({
        kind: 'summary',
        id: `summary-${index}`,
        sortKey: Number.MAX_SAFE_INTEGER,
        status: summary.Status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
        ...(summary.Content !== undefined ? { content: summary.Content } : {}),
        ...(summary.FailureCode !== undefined ? { failureCode: summary.FailureCode } : {}),
      })
      continue
    }

    if (segment.Categories) continue

    items.push({
      kind: 'unknown',
      id: `unknown-${index}`,
      sortKey: Number.MAX_SAFE_INTEGER - 1,
      segmentType: Object.keys(segment)[0] ?? 'empty',
    })
  }

  const page: TranscriptPage = {
    channel: 'CHAT',
    status: status(response.Status),
    items,
    empty: items.length === 0,
  }
  if (response.NextToken) page.nextToken = response.NextToken
  return page
}
