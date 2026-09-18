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
  confirmationPrompt?: string
  closingResponse?: string
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
