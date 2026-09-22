/**
 * The transcript wire format — shared by the browser and the Lambda.
 *
 * It exists because Contact Lens real-time has *two* different APIs with two
 * different shapes, and which one applies depends on the contact's channel:
 *
 *  | Channel | API                                                    | Timing field       |
 *  | ------- | ------------------------------------------------------ | ------------------ |
 *  | VOICE   | `connect-contact-lens:ListRealtimeContactAnalysisSegments`   | `BeginOffsetMillis` |
 *  | CHAT    | `connect:ListRealtimeContactAnalysisSegmentsV2`        | `Time.AbsoluteTime` |
 *
 * The V2 API explicitly rejects VOICE contacts with `InvalidRequestException`,
 * so "just use the newer one" is not available. Normalising both into the types
 * below keeps that split entirely inside the Lambda.
 */

export type ParticipantRole = 'AGENT' | 'CUSTOMER' | 'SYSTEM' | 'CUSTOM_BOT' | 'SUPERVISOR' | 'UNKNOWN'

export type Sentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE'

export type TranscriptChannel = 'VOICE' | 'CHAT'

export type AnalysisStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'UNKNOWN'

export interface CharacterRange {
  begin: number
  end: number
}

interface ItemBase {
  /** Contact Lens segment id. Stable across polls — the dedupe key. */
  id: string
  /**
   * Channel-independent ordering key: milliseconds from call start for voice,
   * epoch milliseconds for chat. Comparable only within one contact.
   */
  sortKey: number
}

export interface TranscriptTurn extends ItemBase {
  kind: 'turn'
  role: ParticipantRole
  displayName?: string
  content: string
  /** Milliseconds from the start of the call. Voice only. */
  offsetMillis?: number
  /** ISO 8601. Chat only. */
  timestamp?: string
  sentiment?: Sentiment
  /**
   * Character ranges Contact Lens redacted, when the contact runs with a
   * redaction policy. The content already has the redaction applied; the ranges
   * are what lets the UI mark *where* rather than silently showing `[PII]`.
   */
  redactions?: CharacterRange[]
  /** Contact Lens rule categories matched on this turn. */
  categories?: string[]
}

export interface TranscriptEvent extends ItemBase {
  kind: 'event'
  /** e.g. `PARTICIPANT_JOINED`, `PARTICIPANT_LEFT`, `TYPING`. */
  eventType: string
  role?: ParticipantRole
  timestamp?: string
}

export interface TranscriptSummary extends ItemBase {
  kind: 'summary'
  status: 'COMPLETED' | 'FAILED'
  content?: string
  failureCode?: string
}

/**
 * A segment type this app does not model. Kept rather than dropped, for the
 * same reason an unrecognised flow block is kept: an agent should be able to
 * see that something arrived, even when the app cannot render it well.
 */
export interface TranscriptUnknown extends ItemBase {
  kind: 'unknown'
  segmentType: string
}

export type TranscriptItem = TranscriptTurn | TranscriptEvent | TranscriptSummary | TranscriptUnknown

export interface TranscriptPage {
  channel: TranscriptChannel
  status: AnalysisStatus
  items: TranscriptItem[]
  /** Pass back on the next poll to resume rather than re-reading from the start. */
  nextToken?: string
  /** True when Contact Lens returned nothing yet — analysis may still be spinning up. */
  empty: boolean
}

/** The backend's error envelope. Rendered to the agent as-is. */
export interface TranscriptError {
  code:
    | 'not-enabled'
    | 'not-found'
    | 'forbidden'
    | 'throttled'
    | 'unsupported-channel'
    | 'unauthorized'
    | 'bad-request'
    | 'upstream-error'
  message: string
}
