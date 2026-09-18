/**
 * Recover option labels from menu prompt wording.
 *
 * A contact flow's Conditions give you digits and nothing else — "1", "2", "3". The
 * human-readable label only exists inside the prompt text. Extracting it deterministically
 * here means the designer gets `Billing` instead of `Option 1` without an LLM call.
 */

const PATTERNS: RegExp[] = [
  // "press 1 for billing" / "press one for billing"
  /(?:press|dial|enter|choose|select)\s+(\d|one|two|three|four|five|six|seven|eight|nine|zero)\s*(?:,|\.)?\s*(?:for|to)\s+([^.,;?!]+)/gi,
  // "for billing, press 1"
  /(?:for|to)\s+([^.,;?!]+?)[,.]?\s*(?:press|dial|enter|choose|select)\s+(\d|one|two|three|four|five|six|seven|eight|nine|zero)/gi,
]

const WORD_DIGITS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
}

function toDigit(token: string): string {
  const t = token.toLowerCase()
  return WORD_DIGITS[t] ?? t
}

function clean(label: string): string {
  return label
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(the|your|a|an)\s+/i, '')
    .replace(/[.,;:]+$/, '')
}

export function extractMenuLabels(prompt: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!prompt) return out

  // First pattern puts the digit first; the second puts the label first.
  for (const [index, re] of PATTERNS.entries()) {
    re.lastIndex = 0
    for (const m of prompt.matchAll(re)) {
      const digit = toDigit(index === 0 ? m[1] : m[2])
      const label = clean(index === 0 ? m[2] : m[1])
      if (digit && label && !out.has(digit)) out.set(digit, label)
    }
  }
  return out
}

/** Heuristic: does this option exist only to switch language and re-enter the menu? */
const LANGUAGE_HINTS = /\b(espa[ñn]ol|spanish|fran[çc]ais|french|deutsch|german|portugu[êe]s|portuguese|italiano|italian|中文|chinese|日本語|japanese|한국어|korean|language|idioma)\b/i

export function looksLikeLanguageOption(label: string): boolean {
  return LANGUAGE_HINTS.test(label)
}
