import type { NluModel } from './nlu'
import type { CoverageReport } from './coverage'

/**
 * The canonical intermediate model — the contract between parse, design, and emit.
 *
 * N parsers produce it, one designer consumes it. ACXD knowledge lives downstream of
 * this type, never inside a parser.
 */
export interface IvrModel {
  /** One entry per uploaded artifact: a flow export plus zero or more bot exports. */
  sources: SourceRef[]
  entryNodeId: string
  nodes: Record<string, IvrNode>
  /** Present when at least one Lex export was supplied. */
  nlu?: NluModel
  /** Behavior that belongs upstream of ACXD, in the trimmed contact flow. */
  routing: RoutingConfig
  /** Global conversational behavior the legacy IVR enforced. */
  containment: ContainmentConfig
  languages: string[]
  coverage: CoverageReport
}

export interface SourceRef {
  platform: 'amazon-connect' | 'amazon-lex'
  kind: 'contact-flow' | 'lex-bot'
  name: string
  importedAt: string
}

export type IvrNode =
  | PromptNode | MenuNode | IntentNode | CaptureNode | LookupNode
  | BranchNode | TransferNode | SetVarNode | WaitNode
  | LoopNode | EndNode | UnknownNode

export type IvrNodeKind = IvrNode['kind']

export interface PromptNode {
  kind: 'prompt'
  id: string
  text: string
  /** True when wording is regulated and must survive migration byte-for-byte. */
  compliance: boolean
  next?: string
}

/** A DTMF menu. Becomes `user_choice` + a Slot Type whose values carry `choicePayload`. */
export interface MenuNode {
  kind: 'menu'
  id: string
  prompt: string
  options: Array<{ key: string; label: string; next: string }>
  timeoutSeconds?: number
  maxAttempts?: number
  next?: string
}

/**
 * A `GetParticipantInput` backed by a Lex bot. Kept distinct from MenuNode because the
 * two diverge at the ACXD end (`intent_capture` vs `user_choice`) — a single overloaded
 * node would force the designer to sniff which flavour it was holding.
 */
export interface IntentNode {
  kind: 'intent'
  id: string
  /** Bot alias ARN exactly as written in the flow. The join key. */
  botRef: string
  cases: Array<{ intent: string; next: string }>
  /** Did the join find this bot among the uploaded exports? */
  resolved: boolean
  next?: string
}

export interface CaptureNode {
  kind: 'capture'
  id: string
  prompt: string
  variable: string
  validation?: { regex?: string; minLength?: number; maxLength?: number }
  /** Drives ACXD `sensitive` + a masking guardrail. */
  sensitive: boolean
  next?: string
}

export interface LookupNode {
  kind: 'lookup'
  id: string
  system: string
  requestVars: string[]
  responseVars: string[]
  next?: string
  onError?: string
}

export interface BranchNode {
  kind: 'branch'
  id: string
  on: string
  cases: Array<{ when: string; next: string }>
  default?: string
}

export interface TransferNode {
  kind: 'transfer'
  id: string
  target: { type: 'queue' | 'flow' | 'number'; ref: string }
}

export interface SetVarNode {
  kind: 'setVar'
  id: string
  assignments: Array<{ name: string; value: string }>
  next?: string
}

export interface WaitNode {
  kind: 'wait'
  id: string
  seconds?: number
  next?: string
}

export interface LoopNode {
  kind: 'loop'
  id: string
  maxIterations?: number
  next?: string
  onComplete?: string
}

export interface EndNode {
  kind: 'end'
  id: string
}

/**
 * An Action type the parser doesn't handle. Preserved verbatim and surfaced in coverage.
 * Never dropped — silent omission means a migrated IVR is quietly missing behavior.
 */
export interface UnknownNode {
  kind: 'unknown'
  id: string
  sourceType: string
  raw: unknown
  next?: string
}

export interface RoutingConfig {
  /** Stays in the Connect contact flow, upstream of the Agentic CX block. */
  hoursOfOperation?: unknown
  queueAssignments: string[]
  recordingBehavior?: unknown
  voice?: { provider?: string; voiceId?: string; languageCode?: string }
}

export interface ContainmentConfig {
  maxInvalidAttempts?: number
  repeatOnInvalid?: boolean
  onExhausted?: string
  globalCommands: Array<{ key: string; intent: 'agent' | 'repeat' | 'help'; target?: string }>
}
