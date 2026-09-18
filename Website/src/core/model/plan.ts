/**
 * The ACXD plan — the design layer's output and the emitter's input.
 *
 * Every field here is one the ACXD docs actually specify. Anything the docs leave open
 * (per-node `metadata` internals, `childNodes[].conditions`, built-in slot type names,
 * how a `user_choice` binds to its slot type) is NOT invented — it is recorded as a
 * SchemaGap so the emitter writes a TODO(acxd-schema) marker instead of a plausible guess
 * that fails at build time.
 */

export interface AcxdPlan {
  application: PlannedApplication
  flows: PlannedFlow[]
  slotTypes: PlannedSlotType[]
  dataRequests: PlannedDataRequest[]
  guardrails: PlannedGuardrail[]
  contextVariables: PlannedContextVariable[]
  /** Routing that stays in the trimmed Connect contact flow, upstream of ACXD. */
  contactFlow: TrimmedContactFlow
  risks: Risk[]
  recommendations: Recommendation[]
  schemaGaps: SchemaGap[]
}

export interface PlannedApplication {
  name: string
  description: string
  settings: {
    languageCode: string
    languageCodes: string[]
    languageSettings: Array<{ languageCode: string; useNativeLanguage?: boolean; voice?: string }>
    defaultFlows: Partial<Record<'welcome' | 'fallback' | 'escalation' | 'repeat' | 'help' | 'frustration', { flowId: string }>>
    thresholds: { incomprehensionCount: number }
    conversationTTL: number
    repeatOnIncomprehension: boolean
    guardrails: Array<{ guardrailId: string }>
  }
}

export interface PlannedFlow {
  flowId: string
  description: string
  mainLanguageCode: string
  languageCodes: string[]
  /** Attached Slots, per the Flow docs. */
  slotTypes: AttachedSlot[]
  contextVariables: Array<{ name: string; type: 'text' | 'number' | 'boolean' }>
  nodes: Record<string, PlannedNode>
}

export interface AttachedSlot {
  name: string
  type: string
  sensitive?: boolean
  examples?: string[]
  aiDescription?: string
  regex?: string
}

export type AcxdNodeType =
  | 'start' | 'end' | 'basic' | 'user_input' | 'user_choice' | 'choice'
  | 'data_request' | 'redirect' | 'escalate' | 'split' | 'loop' | 'define'
  | 'wait' | 'transform' | 'note' | 'knowledge_base' | 'intent_capture'
  | 'application_handoff'

export interface PlannedNode {
  nodeId: string
  type: AcxdNodeType
  messages?: Array<{ body: string; type: 'text' }>
  childNodes?: Array<{ nodeId: string; name?: string }>
  dataRequests?: string[]
  /** Traceability back to the source block. Not an ACXD field — stripped by the emitter. */
  sourceNodeId?: string
  /** Wording that must survive byte-for-byte. Blocks any rewrite downstream. */
  compliance?: boolean
}

export interface PlannedSlotType {
  slotTypeId: string
  description: string
  values: Array<{ value: string; synonyms: string[]; choicePayload?: string }>
  sensitive?: boolean
  mainLanguageCode: string
  languageCodes: string[]
}

export interface PlannedDataRequest {
  dataRequestId: string
  type: 'text' | 'number' | 'boolean' | 'list<text>' | 'object' | 'list<object>'
  description: string
  sensitive: boolean
  webhook: { implementation: string; method?: string; url?: string }
  /** Source Lambda ARN, for the human wiring the webhook up. */
  sourceSystem: string
}

export interface PlannedGuardrail {
  guardrailId: string
  name: string
  description: string
  trigger: 'input' | 'output'
  active: boolean
  rules: Array<{
    name: string
    detection: { method: 'regex' | 'keyword'; pattern?: string; keywords?: string[] }
    enforcement: { action: 'mask' | 'route' | 'block' | 'flag'; behavior?: Record<string, unknown> }
    active: boolean
  }>
}

export interface PlannedContextVariable {
  name: string
  schema: { type: 'string' | 'number' | 'boolean'; isSensitive?: boolean }
  origin: string
}

/** What must NOT move into ACXD — it stays in the Connect contact flow. */
export interface TrimmedContactFlow {
  queueAssignments: string[]
  hoursOfOperation: boolean
  recordingBehavior: boolean
  voice?: { provider?: string; voiceId?: string; languageCode?: string }
  /**
   * The manual, console-side step that actually completes the cutover.
   * Per the Agentic CX block docs, it is configured with three identifiers — workspace,
   * application and alias — and exposes four branches.
   */
  agenticCxBlock: {
    workspaceId: string
    applicationName: string
    alias: string
    /** Documented exit conditions. Every one needs a target in the trimmed flow. */
    branches: Array<{ name: 'Default' | 'Error' | 'Idle chat timeout' | 'Escalation'; target: string }>
  }
}

export interface Risk {
  id: string
  severity: 'info' | 'warn' | 'blocker'
  title: string
  detail: string
  nodeIds: string[]
}

/** Beyond-parity opportunities. Advisory — a human accepts or rejects each one. */
export interface Recommendation {
  id: string
  title: string
  detail: string
  nodeIds: string[]
}

/** A shape the ACXD docs do not publish. The emitter marks it, never guesses it. */
export interface SchemaGap {
  marker: string
  what: string
  needed: string
  nodeIds: string[]
}
