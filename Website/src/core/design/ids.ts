/**
 * Deterministic identifiers and ACXD-legal names.
 *
 * Node IDs are UUIDs in ACXD, but a migration tool cannot mint random ones: parse →
 * design → emit has to be reproducible, so re-running the same input must produce the
 * same plan byte for byte. These UUIDs are therefore a stable hash of the source node id.
 *
 * The length/charset rules below are real ACXD constraints from the SDK reference, not
 * style preferences — a name that violates them fails at CreateFlow time.
 */

/** FNV-1a, 32-bit. Small, fast, and — critically — stable across runs and machines. */
function fnv1a(input: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const hex8 = (n: number): string => n.toString(16).padStart(8, '0')

/**
 * A stable UUID-shaped identifier derived from `seed`. Carries the version-4 nibble and
 * the RFC variant bits so it is well-formed, but it is a hash, not a random UUID.
 */
export function stableUuid(seed: string): string {
  const a = hex8(fnv1a(seed, 0x811c9dc5))
  const b = hex8(fnv1a(seed, 0x9e3779b9))
  const c = hex8(fnv1a(seed, 0x85ebca6b))
  const d = hex8(fnv1a(seed, 0xc2b2ae35))
  const variant = ((parseInt(c.slice(0, 1), 16) & 0x3) | 0x8).toString(16)
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-${variant}${c.slice(1, 4)}-${c.slice(4)}${d}`
}

const ALPHA_WORDS = /[^a-zA-Z]+/g
const ALNUM_WORDS = /[^a-zA-Z0-9]+/g

function pascal(source: string, strip: RegExp): string {
  return source
    .split(strip)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')
}

function pad(name: string, min: number, filler: string): string {
  return name.length >= min ? name : (name + filler).slice(0, Math.max(min, name.length + filler.length))
}

/** `slotTypeId` — alphabetic only, 3–100 characters. */
export function slotTypeId(source: string, fallback = 'Choice'): string {
  const base = pascal(source, ALPHA_WORDS) || fallback
  return pad(base, 3, 'Type').slice(0, 100)
}

/** Attached Slot `name` — alphabetic only, 3–30 characters. */
export function slotName(source: string, fallback = 'Value'): string {
  const base = pascal(source, ALPHA_WORDS) || fallback
  const named = pad(base, 3, 'Val').slice(0, 30)
  return named[0].toLowerCase() + named.slice(1)
}

/** `flowId` — alphanumeric, 3–64 characters. */
export function flowId(source: string, fallback = 'MainFlow'): string {
  const base = pascal(source, ALNUM_WORDS) || fallback
  return pad(base, 3, 'Flow').slice(0, 64)
}

/** `dataRequestId` / `guardrailId` — alphanumeric, kept camelCase by convention. */
export function resourceId(source: string, fallback = 'resource'): string {
  const base = pascal(source, ALNUM_WORDS) || fallback
  const named = pad(base, 3, 'Res').slice(0, 64)
  return named[0].toLowerCase() + named.slice(1)
}

/** Context variable names are snake_case in the ACXD examples (`customer_tier`). */
export function contextVariableName(source: string): string {
  const snake = source
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  return (snake || 'value').slice(0, 64)
}

/** Flow `description` is capped at 200 characters. */
export function description(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= 200 ? flat : `${flat.slice(0, 197)}...`
}

/** Slot Type `choicePayload` is capped at 200 characters. */
export function choicePayload(text: string): string {
  return text.slice(0, 200)
}

/** Derive a Lambda ARN's function name, for naming the Data Request after it. */
export function lambdaFunctionName(arn: string): string {
  const fromArn = arn.match(/function:([^:]+)/)?.[1]
  return fromArn ?? arn.split(/[:/]/).filter(Boolean).pop() ?? 'lookup'
}
