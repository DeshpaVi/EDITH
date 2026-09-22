/**
 * The attribute manifest is the contract between the handoff document and this
 * app. The handoff document says "the IVR hands the agent these fields"; the
 * manifest turns that list into labels, ordering, grouping, formatting and
 * masking. Editing `attribute-manifest.json` is the supported way to change
 * what the panel shows — no component edit is required.
 *
 * The manifest deliberately does NOT decide what the app *receives*. Everything
 * the contact carries is read; the manifest only decides what is named and
 * where it sits. Anything present on the contact but absent from the manifest
 * is surfaced in an "Unmapped" section rather than dropped, so a flow that
 * starts setting a new attribute is visible on the next call instead of
 * silently invisible until someone re-reads the handoff doc.
 */

import manifestJson from './attribute-manifest.json'

export const ATTRIBUTE_FORMATS = [
  'text',
  'multiline',
  'phone',
  'currency',
  'date',
  'datetime',
  'duration',
  'boolean',
  'badge',
  'url',
] as const

export type AttributeFormat = (typeof ATTRIBUTE_FORMATS)[number]

export type BadgeTone = 'good' | 'warn' | 'bad' | 'neutral'

/** How much of a sensitive value survives to the screen. */
export type MaskMode =
  /** Show only the final four characters: `••••1234`. */
  | 'last4'
  /** Show nothing until the agent explicitly reveals it. */
  | 'all'
  /** The value is already safe to show (e.g. the flow stored only the last 4). */
  | 'none'

export interface AttributeSpec {
  /** Contact attribute key, exactly as the contact flow writes it. Case-sensitive. */
  key: string
  label: string
  format: AttributeFormat
  /**
   * Masked on screen and excluded from copy-all. Reveal is per-value, per-call,
   * and is not persisted.
   */
  sensitive?: boolean
  mask?: MaskMode
  /** Absence is a visible gap in the panel rather than a missing row. */
  required?: boolean
  /** Rendered verbatim — never truncated, re-cased, or re-wrapped. */
  compliance?: boolean
  help?: string
  badgeMap?: Record<string, BadgeTone>
  /**
   * `currency` format only: the attribute key holding the ISO currency code.
   * Connect flows almost always carry the amount and the currency as two
   * separate attributes, and guessing the currency from the agent's locale
   * would put the wrong symbol in front of a real number.
   */
  currencyFrom?: string
}

export interface AttributeGroup {
  id: string
  label: string
  attributes: AttributeSpec[]
}

export interface AttributeManifest {
  version: number
  source: string
  groups: AttributeGroup[]
}

/**
 * Validates the JSON against the type above. The manifest is hand-edited by
 * whoever owns the handoff document, so a typo here is expected, ordinary, and
 * must produce a readable message rather than a broken panel.
 */
export function validateManifest(input: unknown): { manifest: AttributeManifest; problems: string[] } {
  const problems: string[] = []
  const raw = (input ?? {}) as Partial<AttributeManifest>
  const groups: AttributeGroup[] = []
  const seenKeys = new Map<string, string>()

  for (const [gi, group] of (Array.isArray(raw.groups) ? raw.groups : []).entries()) {
    const where = `groups[${gi}]`
    if (!group || typeof group.id !== 'string' || typeof group.label !== 'string') {
      problems.push(`${where}: needs a string \`id\` and \`label\`.`)
      continue
    }
    const attributes: AttributeSpec[] = []
    for (const [ai, attr] of (Array.isArray(group.attributes) ? group.attributes : []).entries()) {
      const at = `${where}.attributes[${ai}]`
      if (!attr || typeof attr.key !== 'string' || attr.key.length === 0) {
        problems.push(`${at}: needs a non-empty string \`key\`.`)
        continue
      }
      if (typeof attr.label !== 'string' || attr.label.length === 0) {
        problems.push(`${at} (${attr.key}): needs a non-empty \`label\`.`)
        continue
      }
      if (!ATTRIBUTE_FORMATS.includes(attr.format)) {
        problems.push(`${at} (${attr.key}): unknown format "${String(attr.format)}". Falling back to \`text\`.`)
      }
      const duplicate = seenKeys.get(attr.key)
      if (duplicate !== undefined) {
        problems.push(`${at}: key "${attr.key}" is already declared in group "${duplicate}". The first wins.`)
        continue
      }
      seenKeys.set(attr.key, group.id)
      attributes.push({
        ...attr,
        format: ATTRIBUTE_FORMATS.includes(attr.format) ? attr.format : 'text',
      })
    }
    groups.push({ id: group.id, label: group.label, attributes })
  }

  if (groups.length === 0) problems.push('The manifest declares no groups — the attribute panel will be empty.')

  return {
    manifest: {
      version: typeof raw.version === 'number' ? raw.version : 0,
      source: typeof raw.source === 'string' ? raw.source : '',
      groups,
    },
    problems,
  }
}

const validated = validateManifest(manifestJson)

export const attributeManifest = validated.manifest
export const manifestProblems = validated.problems
