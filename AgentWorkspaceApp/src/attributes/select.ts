/**
 * Manifest + contact attributes -> the model the attribute panel renders.
 *
 * Pure, and the only place that decides what the agent sees. The invariant it
 * enforces is the one that matters most for a handoff screen: **nothing the
 * contact carries is discarded**. A declared attribute that is absent becomes a
 * visible gap; an attribute nobody declared becomes an Unmapped row. Dropping
 * either would mean an agent confidently reading a screen that is missing what
 * the IVR actually collected.
 */

import type { AttributeFormat, AttributeManifest, AttributeSpec, BadgeTone, MaskMode } from '../config/attributes'
import { effectiveMask, formatValue, maskValue } from './format'

export interface AttributeRow {
  key: string
  label: string
  format: AttributeFormat
  state: 'present' | 'missing'
  /** Exactly what the contact carried. Undefined when absent. */
  raw?: string
  /** Formatted and masked — safe to render without a deliberate reveal. */
  display: string
  /** Formatted, unmasked. Rendered only after the agent reveals the row. */
  revealed: string
  sensitive: boolean
  mask: MaskMode
  compliance: boolean
  required: boolean
  tone?: BadgeTone
  help?: string
  telHref?: string
  /** The value did not parse as its declared format. */
  warning?: string
}

export interface AttributeGroupView {
  id: string
  label: string
  rows: AttributeRow[]
  presentCount: number
}

export interface UnmappedAttribute {
  key: string
  value: string
}

export interface AttributePanelModel {
  groups: AttributeGroupView[]
  /** Present on the contact, absent from the manifest. */
  unmapped: UnmappedAttribute[]
  /** Declared `required`, absent from the contact. */
  missingRequired: AttributeRow[]
  totals: {
    declared: number
    present: number
    unmapped: number
  }
}

const EMPTY_PLACEHOLDER = 'Not set'

/**
 * The workspace SDK declares `getAttributes` as `Record<string, string>`, but
 * that is a compile-time promise about data arriving over postMessage from
 * another origin, and it is not what actually turns up. A live workspace
 * returns each attribute as a `{ name, value }` pair:
 *
 *   { relation: { name: 'relation', value: 'care-giver' } }
 *
 * Trusting the declared type cost a live call — `.trim()` on an object threw
 * during render, React unmounted the tree, and the agent got a blank panel.
 * Stringifying instead of unwrapping then cost a second one: no crash, but the
 * agent read raw JSON off the screen.
 *
 * So values are unwrapped here, at the single point all attribute data enters
 * the panel, and nothing is dropped: a wrapper's inner value wins, primitives
 * stringify, and a shape this does not recognise still renders as JSON rather
 * than vanishing.
 */
function coerceAttributes(raw: Readonly<Record<string, unknown>>): Record<string, string> {
  const coerced: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw ?? {})) {
    const text = toDisplayString(value)
    if (text !== null) coerced[key] = text
  }
  return coerced
}

function toDisplayString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (typeof value === 'object') {
    // The `{ name, value }` wrapper. Only unwrap when the inner value is itself
    // a primitive — a nested object is a shape worth seeing in full rather than
    // silently reaching into.
    const inner = (value as { value?: unknown }).value
    if (inner !== null && inner !== undefined && typeof inner !== 'object') {
      return String(inner)
    }
    try {
      return JSON.stringify(value) ?? String(value)
    } catch {
      return String(value)
    }
  }

  return String(value)
}

export function selectAttributes(
  manifest: AttributeManifest,
  rawAttributes: Readonly<Record<string, unknown>>,
): AttributePanelModel {
  const attributes = coerceAttributes(rawAttributes)
  const claimed = new Set<string>()
  const groups: AttributeGroupView[] = []
  const missingRequired: AttributeRow[] = []
  let declared = 0
  let present = 0

  for (const group of manifest.groups) {
    const rows: AttributeRow[] = []
    let presentCount = 0

    for (const spec of group.attributes) {
      declared += 1
      claimed.add(spec.key)
      const raw = attributes[spec.key]
      const row = raw === undefined ? missingRow(spec) : presentRow(spec, raw, attributes)
      if (row.state === 'present') {
        present += 1
        presentCount += 1
      } else if (row.required) {
        missingRequired.push(row)
      }
      rows.push(row)
    }

    groups.push({ id: group.id, label: group.label, rows, presentCount })
  }

  const unmapped = Object.entries(attributes)
    .filter(([key]) => !claimed.has(key))
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key))

  return {
    groups,
    unmapped,
    missingRequired,
    totals: { declared, present, unmapped: unmapped.length },
  }
}

function missingRow(spec: AttributeSpec): AttributeRow {
  const row: AttributeRow = {
    key: spec.key,
    label: spec.label,
    format: spec.format,
    state: 'missing',
    display: EMPTY_PLACEHOLDER,
    revealed: EMPTY_PLACEHOLDER,
    sensitive: spec.sensitive === true,
    mask: effectiveMask(spec),
    compliance: spec.compliance === true,
    required: spec.required === true,
  }
  if (spec.help !== undefined) row.help = spec.help
  return row
}

function presentRow(
  spec: AttributeSpec,
  raw: string,
  siblings: Readonly<Record<string, string>>,
): AttributeRow {
  const formatted = formatValue(spec, raw, siblings)
  const mask = effectiveMask(spec)
  const revealed = formatted.text === '' ? EMPTY_PLACEHOLDER : formatted.text

  const row: AttributeRow = {
    key: spec.key,
    label: spec.label,
    format: spec.format,
    state: 'present',
    raw,
    display: formatted.text === '' ? EMPTY_PLACEHOLDER : maskValue(formatted.text, mask),
    revealed,
    sensitive: spec.sensitive === true,
    mask,
    compliance: spec.compliance === true,
    required: spec.required === true,
  }
  if (formatted.tone !== undefined) row.tone = formatted.tone
  if (formatted.telHref !== undefined && mask === 'none') row.telHref = formatted.telHref
  if (formatted.warning !== undefined) row.warning = formatted.warning
  if (spec.help !== undefined) row.help = spec.help
  return row
}

/**
 * The agent-visible summary, for the "copy for case notes" action.
 *
 * Sensitive values are excluded whatever their mask, and compliance text is
 * copied verbatim. Copying a masked string would paste bullets into a CRM,
 * which is worse than an explicit omission.
 */
export function toClipboardText(model: AttributePanelModel, contactId: string): string {
  const lines: string[] = [`Contact: ${contactId}`, '']
  for (const group of model.groups) {
    const usable = group.rows.filter((r) => r.state === 'present' && !r.sensitive)
    if (usable.length === 0) continue
    lines.push(group.label)
    for (const row of usable) lines.push(`  ${row.label}: ${row.revealed}`)
    lines.push('')
  }
  const omitted = model.groups
    .flatMap((g) => g.rows)
    .filter((r) => r.state === 'present' && r.sensitive)
  if (omitted.length > 0) {
    lines.push(`Omitted (sensitive): ${omitted.map((r) => r.label).join(', ')}`)
    lines.push('')
  }
  if (model.unmapped.length > 0) {
    lines.push('Unmapped attributes')
    for (const attr of model.unmapped) lines.push(`  ${attr.key}: ${attr.value}`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
