/**
 * Conversational assets a contact flow references but does not contain.
 *
 * A Connect flow that calls a Lex bot carries only the bot's alias ARN and the intent
 * names it branches on. Everything that makes the conversation a conversation —
 * utterances, slot prompts, slot types, synonyms — lives in the bot export.
 */

export interface NluModel {
  bots: NluBot[]
}

export interface NluBot {
  /** Join key: the alias ARN as written in the flow, or the bot name as a fallback. */
  ref: string
  name: string
  locales: string[]
  /** Lex `nluIntentConfidenceThreshold`. Feeds the NLU-confidence risk item. */
  confidenceThreshold?: number
  intents: NluIntent[]
  slotTypes: NluSlotType[]
}

export interface NluIntent {
  name: string
  utterances: string[]
  slots: NluSlot[]
  /** Sent on intent invocation, before any slot is elicited. */
  initialResponse?: string
  confirmationPrompt?: string
  /** Sent when the user declines the confirmation — a distinct path, not a variant. */
  declinationResponse?: string
  /** Post-fulfilment messages: success, failure, timeout. */
  fulfillmentResponses?: { success?: string; failure?: string; timeout?: string }
  closingResponse?: string
  /** Lex contexts are state gates on intent recognition — nearest ACXD kin is a Context Variable. */
  inputContexts?: string[]
  outputContexts?: string[]
  /**
   * Bots created after 2022-08-17 can define conversation paths and conditional branches
   * declaratively. That is genuine structure, and dropping it silently would migrate the
   * intents while losing the dialogue they were wired into.
   */
  hasConversationPaths?: boolean
  /** Lambda ARN — becomes a Data Request + `data_request` node. */
  fulfillmentHook?: string
  /** Always a judgment call; the designer raises it as requiresReview. */
  dialogHook?: string
}

export interface NluSlot {
  name: string
  slotType: string
  prompt?: string
  required: boolean
  /** Rolls up into `thresholds.incomprehensionCount` at the application level. */
  maxRetries?: number
  sensitive: boolean
}

export interface NluSlotType {
  name: string
  /** Built-in (`AMAZON.*`) names have no published ACXD equivalent — TODO(acxd-schema). */
  builtIn: boolean
  values: Array<{ value: string; synonyms: string[] }>
}
