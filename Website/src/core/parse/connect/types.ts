/**
 * Raw Amazon Connect contact flow JSON shapes.
 *
 * TODO(source-schema): written from the Connect flow language documentation, not from a
 * confirmed export. Action Type strings and Parameters key names may drift by version.
 * Verify against a real exported flow before trusting the parser. Nothing here throws on
 * a mismatch — unrecognized shapes fall through to UnknownNode by design.
 */

export interface RawContactFlow {
  Version?: string
  StartAction?: string
  Metadata?: unknown
  Actions?: RawAction[]
}

export interface RawAction {
  Identifier?: string
  Type?: string
  Parameters?: Record<string, unknown>
  Transitions?: RawTransitions
}

export interface RawTransitions {
  NextAction?: string
  Errors?: Array<{ NextAction?: string; ErrorType?: string }>
  Conditions?: Array<{
    NextAction?: string
    Condition?: { Operator?: string; Operands?: unknown[] }
  }>
}

/** Action types that carry routing, not conversation — they stay upstream of ACXD. */
export const ROUTING_ACTIONS = new Set([
  'SetWorkingQueue',
  'UpdateContactTargetQueue',
  'UpdateContactRecordingBehavior',
  'UpdateFlowLoggingBehavior',
  'UpdateContactEventHooks',
  'UpdateContactTextToSpeechVoice',
  'CheckHoursOfOperation',
])

/** Routing actions with a single exit can be lifted out of the graph and rewired past. */
export const SINGLE_EXIT_ROUTING = new Set([
  'SetWorkingQueue',
  'UpdateContactTargetQueue',
  'UpdateContactRecordingBehavior',
  'UpdateFlowLoggingBehavior',
  'UpdateContactEventHooks',
  'UpdateContactTextToSpeechVoice',
])

/**
 * Wording that carries regulatory weight. A match forces `compliance: true`, which makes
 * the text read-only for every downstream layer — never paraphrased, never "improved".
 */
export const COMPLIANCE_PATTERNS: RegExp[] = [
  /\brecorded\b/i,
  /\brecording\b/i,
  /\bmonitored\b/i,
  /\bquality (assurance|purposes|and training)\b/i,
  /\bconsent\b/i,
  /\byour call may be\b/i,
  /\bthis call is being\b/i,
]

export function isComplianceText(text: string): boolean {
  return COMPLIANCE_PATTERNS.some((re) => re.test(text))
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function bool(v: unknown): boolean {
  return v === true || v === 'True' || v === 'true'
}

export function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return undefined
}

/** Prompt text lives under different keys depending on how the block was authored. */
export function promptText(p: Record<string, unknown> | undefined): string {
  if (!p) return ''
  return str(p.Text) ?? str(p.SSML) ?? str(p.PromptId) ?? ''
}
