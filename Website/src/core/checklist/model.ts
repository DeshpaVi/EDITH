/**
 * The checklist: what the journey implies must be built, shown to the consultant to select from.
 * It is the design layer's output for slice 1 and the emitter's input for the next slice.
 *
 * Every item says WHY it exists (the journey steps that triggered it), what the consultant must
 * supply, and whether the emitter can generate it from CONFIRMED schema. Gaps are never hidden:
 * `schemaStatus` is `confirmed`, `partial` or `unconfirmed`, and the latter two carry notes.
 */

export type ResourceKind =
  | 'platform.provisioner'
  | 'platform.apiKeySecret'
  | 'dynamodb.table'
  | 'lambda.function'
  | 'iam.role'
  | 'connect.contactFlow'
  | 'connect.contactAttributes'
  | 'acxd.application'
  | 'acxd.flow'
  | 'acxd.dataRequest'
  | 'acxd.contextVariable'
  | 'acxd.guardrail'
  | 'acxd.knowledgeBase'
  | 'acxd.languages'

/** required: always built; recommended: on by default, can be turned off; optional: off by default. */
export type Need = 'required' | 'recommended' | 'optional'

/**
 * confirmed:   the emitter can generate it from schema verified against a real workspace.
 * partial:     part is confirmed; the rest carries TODO(acxd-schema) or a manual console step.
 * unconfirmed: the schema or behaviour is not verified; do not generate, flag for review.
 */
export type SchemaStatus = 'confirmed' | 'partial' | 'unconfirmed'

export interface ChecklistParam {
  key: string
  label: string
  /** True when it is a secret and must be a NoEcho parameter, never stored by the app. */
  secret?: boolean
  example?: string
}

export interface ChecklistItem {
  id: string
  kind: ResourceKind
  title: string
  reason: string
  need: Need
  /** Default selection. Required items are always selected. */
  selected: boolean
  /** Ids of items that must also be selected for this one to work. */
  requires: string[]
  /** Journey step ids that triggered the item ([] for platform items and recommendations). */
  sources: string[]
  params: ChecklistParam[]
  schemaStatus: SchemaStatus
  notes: string[]
}

export type ReviewSeverity = 'info' | 'warn' | 'blocker'

/** Something a human must decide or confirm. Never a silent drop (CLAUDE.md constraint 3). */
export interface RequiresReview {
  id: string
  severity: ReviewSeverity
  title: string
  detail: string
  sources: string[]
}

export interface Checklist {
  items: ChecklistItem[]
  reviews: RequiresReview[]
}

export interface ChecklistSummary {
  total: number
  byNeed: Record<Need, number>
  bySchemaStatus: Record<SchemaStatus, number>
  reviews: Record<ReviewSeverity, number>
  /** Can the emitter generate every selected item from confirmed schema? */
  fullyEmittable: boolean
}
