/**
 * Topic forms: what the manifest declares, and what detection produces.
 *
 * Detection is rule-based on purpose — deterministic, no new service, and an
 * agent can be told exactly why a form opened (the sentence that triggered it).
 */

export type FormFieldType = 'text' | 'number' | 'select'

export interface FormFieldSpec {
  key: string
  label: string
  type: FormFieldType
  options?: string[]
  /** Name of a function in `extract.ts`. */
  extractor: string
  /** Contact attribute that seeds the field when the call did not say it. */
  prefillFrom?: string
}

export interface FormSpec {
  id: string
  label: string
  /** True when the field list is a stand-in the business has not signed off. */
  placeholder?: boolean
  /** Case-insensitive regex sources, tested against customer turns only. */
  triggers: string[]
  fields: FormFieldSpec[]
}

export interface FormManifest {
  version: number
  source: string
  forms: FormSpec[]
}

export interface FieldSuggestion {
  value: string
  origin: 'transcript' | 'attribute'
  /** The sentence the value came from. Absent for attribute prefills. */
  evidence?: string
}

export interface FormSuggestion {
  formId: string
  /** The customer sentence that first opened the form. */
  triggerEvidence: string
  /** How many customer turns matched a trigger; grows when the topic recurs. */
  triggerCount: number
  fields: Record<string, FieldSuggestion>
}

/** The slice of a transcript turn that detection reads. */
export interface Utterance {
  id: string
  role: 'AGENT' | 'CUSTOMER' | 'OTHER'
  text: string
}
