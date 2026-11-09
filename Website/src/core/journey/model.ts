/**
 * The journey model: what the ingest layer produces from ANY customer-journey input
 * (diagram, slide deck, text, an IVR export, ...) and what the checklist rules consume.
 *
 * It describes the customer experience, not an implementation. Nothing here is ACXD- or
 * AWS-specific; the checklist layer decides what must be built.
 *
 * Rules the producer (an LLM behind a backend, or a hand-authored fixture) must follow:
 *  - `text` of prompts, greetings and announcements is copied VERBATIM from the source
 *    (typos included). It is never paraphrased.
 *  - Anything that cannot be classified goes to `unmapped` or becomes an `unknown` step.
 *    Never guess, never drop.
 */

export type StepKind =
  | 'greeting'
  | 'announcement'
  | 'language_detection'
  | 'intent_capture'
  | 'decision'
  | 'authentication'
  | 'data_lookup'
  | 'self_service'
  | 'confirmation'
  | 'escalation'
  | 'closing'
  | 'end'
  | 'unknown'

export type Channel = 'voice' | 'chat' | 'web'

export interface Edge {
  to: string
  /** Branch label from the source, e.g. "Y", "N", "fallback 3x". */
  label?: string
}

export interface RetryPolicy {
  /** Maximum attempts the source allows, e.g. 3. */
  maxAttempts: number
  onExhausted: 'escalate' | 'end' | 'unknown'
  /** Wording played between attempts, verbatim. */
  reprompt?: string
}

export interface DataSource {
  type: 'dynamodb' | 'http_api' | 'lambda' | 'unknown'
  description?: string
}

interface StepBase {
  id: string
  label: string
  /** Outgoing edges. Empty for terminal steps. */
  next: Edge[]
  /** Where in the source this came from, for traceability (e.g. 'slide 1, box "Main Greeting"'). */
  source: string
}

/** Wording that must survive byte for byte. */
interface Spoken {
  text: string
  /** Regulated wording (recording disclosure, consent, legal): blocks any rewrite downstream. */
  compliance?: boolean
}

export interface GreetingStep extends StepBase, Spoken {
  kind: 'greeting'
}
export interface AnnouncementStep extends StepBase, Spoken {
  kind: 'announcement'
}
export interface ClosingStep extends StepBase, Spoken {
  kind: 'closing'
}
export interface LanguageDetectionStep extends StepBase {
  kind: 'language_detection'
  languages: string[]
  /** How the source detects it, if stated (e.g. 'Lambda'). */
  method?: string
}
export interface IntentCaptureStep extends StepBase, Spoken {
  kind: 'intent_capture'
  intents: Array<{
    name: string
    description?: string
    requiresAuth: boolean
    handledBy: 'self_service' | 'agent'
  }>
  retry: RetryPolicy
}
export interface DecisionStep extends StepBase {
  kind: 'decision'
  question: string
}
export interface AuthenticationStep extends StepBase, Spoken {
  kind: 'authentication'
  /** What the caller supplies, e.g. ['Census ID', 'home zip code', 'last four digits of SSN']. */
  identifiers: string[]
  /** 'any': one identifier is enough; 'all': every identifier must match. */
  match: 'any' | 'all'
  failurePrompt?: string
  retry: RetryPolicy
  verifiesAgainst: DataSource
}
export interface DataLookupStep extends StepBase {
  kind: 'data_lookup'
  name: string
  purpose: string
  inputs: string[]
  outputs: string[]
  source: string
  dataSource: DataSource
}
export interface SelfServiceStep extends StepBase {
  kind: 'self_service'
  name: string
  mode: 'faq' | 'transaction' | 'form' | 'other'
  /** The source marks it as its own flow (e.g. blue "Separate Flow"). */
  separateFlow: boolean
  content: 'knowledge_base' | 'api' | 'unknown'
}
export interface ConfirmationStep extends StepBase, Spoken {
  kind: 'confirmation'
}
export interface EscalationStep extends StepBase {
  kind: 'escalation'
  reason: string
  /** What the agent must receive, e.g. ['conversation summary', 'caller intent', 'where the caller got stuck']. */
  context: string[]
  queue?: string
}
export interface EndStep extends StepBase {
  kind: 'end'
  disposition: 'disconnect' | 'return'
}
export interface UnknownStep extends StepBase {
  kind: 'unknown'
  raw: string
}

export type JourneyStep =
  | GreetingStep
  | AnnouncementStep
  | ClosingStep
  | LanguageDetectionStep
  | IntentCaptureStep
  | DecisionStep
  | AuthenticationStep
  | DataLookupStep
  | SelfServiceStep
  | ConfirmationStep
  | EscalationStep
  | EndStep
  | UnknownStep

export interface Scenario {
  name: string
  description: string
}

/** Something the producer inferred rather than read. Always shown to the consultant. */
export interface Assumption {
  statement: string
  source?: string
}

/** Something the producer could not classify. Becomes a requiresReview entry. */
export interface UnmappedItem {
  description: string
  source: string
}

export interface Journey {
  title: string
  /** Original file name or description, for the report. */
  origin?: string
  channels: Channel[]
  /** BCP-47 codes the journey must support, e.g. ['en-US', 'es-US']. */
  languages: string[]
  steps: JourneyStep[]
  scenarios: Scenario[]
  assumptions: Assumption[]
  unmapped: UnmappedItem[]
}

export type StepOf<K extends StepKind> = Extract<JourneyStep, { kind: K }>

export const stepsOfKind = <K extends StepKind>(journey: Journey, kind: K): Array<StepOf<K>> =>
  journey.steps.filter((s): s is StepOf<K> => s.kind === kind)
