import type { Journey } from '../journey/model'
import type { Checklist, ChecklistItem, ChecklistSummary, Need, RequiresReview, ReviewSeverity, SchemaStatus } from './model'
import { RULES } from './rules'

const SEVERITY_ORDER: Record<ReviewSeverity, number> = { blocker: 0, warn: 1, info: 2 }

/**
 * Journey in, checklist out. Deterministic: same journey, same checklist, same order.
 * An item produced by two rules is merged (notes and sources unioned), never duplicated.
 */
export function buildChecklist(journey: Journey): Checklist {
  const byId = new Map<string, ChecklistItem>()
  const reviews = new Map<string, RequiresReview>()

  for (const rule of RULES) {
    const draft = rule(journey)
    for (const it of draft.items) {
      const existing = byId.get(it.id)
      if (!existing) {
        byId.set(it.id, it)
        continue
      }
      existing.sources = [...new Set([...existing.sources, ...it.sources])]
      existing.notes = [...new Set([...existing.notes, ...it.notes])]
      existing.requires = [...new Set([...existing.requires, ...it.requires])]
      existing.params = [...new Map([...existing.params, ...it.params].map((p) => [p.key, p])).values()]
    }
    for (const r of draft.reviews) reviews.set(r.id, r)
  }

  // Dangling requirements would break selection later; fail loudly in development.
  for (const it of byId.values()) {
    for (const dep of it.requires) {
      if (!byId.has(dep)) throw new Error(`Checklist item "${it.id}" requires unknown item "${dep}"`)
    }
  }

  return {
    items: [...byId.values()],
    reviews: [...reviews.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
  }
}

export function summarize(checklist: Checklist, selectedIds?: Iterable<string>): ChecklistSummary {
  const selected = selectedIds ? new Set(selectedIds) : null
  const items = selected ? checklist.items.filter((i) => selected.has(i.id)) : checklist.items
  const byNeed: Record<Need, number> = { required: 0, recommended: 0, optional: 0 }
  const bySchemaStatus: Record<SchemaStatus, number> = { confirmed: 0, partial: 0, unconfirmed: 0 }
  for (const i of items) {
    byNeed[i.need] += 1
    bySchemaStatus[i.schemaStatus] += 1
  }
  const reviews: Record<ReviewSeverity, number> = { info: 0, warn: 0, blocker: 0 }
  for (const r of checklist.reviews) reviews[r.severity] += 1
  return {
    total: items.length,
    byNeed,
    bySchemaStatus,
    reviews,
    fullyEmittable: bySchemaStatus.unconfirmed === 0 && reviews.blocker === 0,
  }
}

export interface SelectionResult {
  /** Final selection: what the consultant chose, required items, and dependencies. */
  selected: string[]
  /** Added only because something selected needs them. */
  autoAdded: string[]
  /** Required items the consultant tried to deselect; they stay selected. */
  forcedRequired: string[]
  /** Ids that do not exist in the checklist (ignored). */
  unknown: string[]
}

/** Applies a consultant's choices: required items stay on, dependencies are pulled in. */
export function resolveSelection(checklist: Checklist, chosen: Iterable<string>): SelectionResult {
  const byId = new Map(checklist.items.map((i) => [i.id, i]))
  const chosenSet = new Set(chosen)
  const unknown = [...chosenSet].filter((id) => !byId.has(id))
  const selected = new Set([...chosenSet].filter((id) => byId.has(id)))

  const forcedRequired: string[] = []
  for (const i of checklist.items) {
    if (i.need === 'required' && !selected.has(i.id)) {
      forcedRequired.push(i.id)
      selected.add(i.id)
    }
  }
  const direct = new Set(selected)
  const queue = [...selected]
  while (queue.length > 0) {
    const id = queue.pop() as string
    for (const dep of byId.get(id)?.requires ?? []) {
      if (!selected.has(dep)) {
        selected.add(dep)
        queue.push(dep)
      }
    }
  }
  return {
    selected: checklist.items.filter((i) => selected.has(i.id)).map((i) => i.id),
    autoAdded: checklist.items.filter((i) => selected.has(i.id) && !direct.has(i.id)).map((i) => i.id),
    forcedRequired: forcedRequired.filter((id) => !chosenSet.has(id)),
    unknown,
  }
}

/** The default selection a consultant starts from. */
export const defaultSelection = (checklist: Checklist): string[] => checklist.items.filter((i) => i.selected).map((i) => i.id)
