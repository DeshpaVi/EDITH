/**
 * Pure value formatting. No React, no I/O, no clock reads beyond what is passed
 * in — so every rule here is testable against a fixture and produces the same
 * output on every machine an agent might be sitting at.
 *
 * Two rules override everything else in this file:
 *
 *  - A `compliance` value is returned byte-for-byte. Recording disclosures and
 *    consent wording are regulated text; re-casing, trimming or truncating them
 *    changes what the agent reads back to the caller.
 *  - A value that does not parse as its declared format is shown raw, with a
 *    warning. Rendering "Invalid Date" or silently blanking the row would hide
 *    a flow that is writing the wrong shape.
 */

import type { AttributeSpec, BadgeTone, MaskMode } from '../config/attributes'

export interface FormattedValue {
  /** What the agent reads, masking not yet applied. */
  text: string
  /** Present when the raw value did not parse as the declared format. */
  warning?: string
  tone?: BadgeTone
  /** `tel:` target for phone values, when the raw value looks dialable. */
  telHref?: string
}

const TRUTHY = new Set(['true', '1', 'yes', 'y'])
const FALSY = new Set(['false', '0', 'no', 'n'])

export function formatValue(
  spec: AttributeSpec,
  raw: string,
  siblings: Readonly<Record<string, string>> = {},
): FormattedValue {
  // Regulated wording leaves this function exactly as it arrived.
  if (spec.compliance) return { text: raw }

  const value = raw.trim()
  if (value === '') return { text: '', warning: 'The flow set this attribute to an empty string.' }

  switch (spec.format) {
    case 'phone': {
      const digits = value.replace(/[^\d+]/g, '')
      const result: FormattedValue = { text: value }
      if (/^\+?\d{6,15}$/.test(digits)) result.telHref = `tel:${digits}`
      else result.warning = 'Not a recognisable phone number.'
      return result
    }

    case 'currency': {
      const amount = Number(value.replace(/,/g, ''))
      if (!Number.isFinite(amount)) return { text: value, warning: 'Not a number.' }
      const code = spec.currencyFrom ? siblings[spec.currencyFrom]?.trim().toUpperCase() : undefined
      if (!code || !/^[A-Z]{3}$/.test(code)) {
        // No currency code: show the bare number. A symbol guessed from the
        // agent's browser locale would be wrong for most cross-border queues.
        return {
          text: amount.toFixed(2),
          warning: spec.currencyFrom
            ? `No valid currency in "${spec.currencyFrom}" — amount shown without a symbol.`
            : undefined,
        }
      }
      try {
        return { text: new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(amount) }
      } catch {
        return { text: `${amount.toFixed(2)} ${code}` }
      }
    }

    case 'date':
    case 'datetime': {
      const parsed = parseDate(value)
      if (!parsed) return { text: value, warning: 'Not a parseable date.' }
      const opts: Intl.DateTimeFormatOptions =
        spec.format === 'date'
          ? { year: 'numeric', month: 'short', day: '2-digit' }
          : { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }
      return { text: new Intl.DateTimeFormat(undefined, opts).format(parsed) }
    }

    case 'duration': {
      const seconds = Number(value)
      if (!Number.isFinite(seconds) || seconds < 0) {
        return { text: value, warning: 'Not a duration in seconds.' }
      }
      return { text: formatDuration(seconds) }
    }

    case 'boolean': {
      const lower = value.toLowerCase()
      if (TRUTHY.has(lower)) return { text: 'Yes' }
      if (FALSY.has(lower)) return { text: 'No' }
      return { text: value, warning: 'Not a boolean.' }
    }

    case 'badge': {
      const tone = spec.badgeMap?.[value]
      const result: FormattedValue = { text: prettifyToken(value), tone: tone ?? 'neutral' }
      if (spec.badgeMap && tone === undefined) {
        result.warning = `"${value}" is not one of the values this attribute is documented to take.`
      }
      return result
    }

    case 'url': {
      if (!/^https?:\/\//i.test(value)) return { text: value, warning: 'Not an http(s) URL.' }
      return { text: value }
    }

    case 'multiline':
    case 'text':
    default:
      return { text: value }
  }
}

/**
 * Masking is a display control, not a security control: the raw value is
 * already in the page's memory because the workspace handed it over. It exists
 * so an account number is not sitting in plain sight on a shared screen or in a
 * screen-share, and so a reveal is a deliberate act.
 */
export function maskValue(text: string, mask: MaskMode): string {
  if (text === '') return ''
  switch (mask) {
    case 'none':
      return text
    case 'last4': {
      const visible = text.slice(-4)
      return visible.length < text.length ? `${'•'.repeat(Math.min(8, text.length - visible.length))}${visible}` : text
    }
    case 'all':
    default:
      return '•'.repeat(Math.min(12, Math.max(4, text.length)))
  }
}

export function effectiveMask(spec: AttributeSpec): MaskMode {
  if (!spec.sensitive) return 'none'
  return spec.mask ?? 'all'
}

function parseDate(value: string): Date | null {
  // `new Date('2026-03-11')` is UTC midnight, which renders as the previous day
  // west of Greenwich. Date-only strings are therefore built as local dates.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    const parsed = new Date(Number(y), Number(m) - 1, Number(d))
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

function prettifyToken(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) return value
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
