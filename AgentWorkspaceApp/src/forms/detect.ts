/**
 * Transcript + attributes -> which forms apply and what they already know.
 *
 * Pure and stateless: every call re-reads the whole transcript. Calls are
 * short, and recomputing from scratch means a page refresh, a late-arriving
 * segment or a revised transcript can never leave the form out of step with
 * what was actually said. The hook above this keeps the agent's edits.
 */

import type { TranscriptItem } from '../transcript/types'
import { buildWindow, EXTRACTORS } from './extract'
import type { FieldSuggestion, FormManifest, FormSpec, FormSuggestion, Utterance } from './types'

export function toUtterances(items: readonly TranscriptItem[]): Utterance[] {
  const out: Utterance[] = []
  for (const item of items) {
    if (item.kind !== 'turn') continue
    // The compliance announcement and bot prompts are not the customer's words.
    const role = item.role === 'CUSTOMER' ? 'CUSTOMER' : item.role === 'AGENT' ? 'AGENT' : 'OTHER'
    out.push({ id: item.id, role, text: item.content })
  }
  return out
}

function compile(triggers: readonly string[]): RegExp[] {
  return triggers.flatMap((source) => {
    try {
      return [new RegExp(source, 'i')]
    } catch {
      // A bad pattern in the manifest must not take the panel down.
      return []
    }
  })
}

export function detectForms(
  manifest: FormManifest,
  items: readonly TranscriptItem[],
  attributes: Readonly<Record<string, string>>,
): FormSuggestion[] {
  const utterances = toUtterances(items)
  const found: Array<FormSuggestion & { firstIndex: number }> = []

  for (const form of manifest.forms) {
    const patterns = compile(form.triggers)
    let firstIndex = -1
    let firstText = ''
    let count = 0
    utterances.forEach((u, index) => {
      if (u.role !== 'CUSTOMER' || !patterns.some((re) => re.test(u.text))) return
      if (firstIndex < 0) {
        firstIndex = index
        firstText = u.text
      }
      count += 1
    })
    if (firstIndex < 0) continue

    found.push({
      formId: form.id,
      triggerEvidence: firstText,
      triggerCount: count,
      fields: suggestFields(form, utterances, firstIndex, attributes),
      firstIndex,
    })
  }

  return found.sort((a, b) => a.firstIndex - b.firstIndex).map(({ firstIndex: _drop, ...rest }) => rest)
}

function suggestFields(
  form: FormSpec,
  utterances: readonly Utterance[],
  from: number,
  attributes: Readonly<Record<string, string>>,
): Record<string, FieldSuggestion> {
  const window = buildWindow(utterances, from)
  const fields: Record<string, FieldSuggestion> = {}

  for (const spec of form.fields) {
    const said = EXTRACTORS[spec.extractor]?.(window)
    // Only accept a spoken value the field can actually hold.
    const valid = said && (!spec.options || spec.options.includes(said.value)) ? said : undefined
    if (valid) {
      fields[spec.key] = valid
      continue
    }
    const seeded = spec.prefillFrom ? attributes[spec.prefillFrom]?.trim() : undefined
    if (seeded) fields[spec.key] = { value: seeded, origin: 'attribute' }
  }
  return fields
}
