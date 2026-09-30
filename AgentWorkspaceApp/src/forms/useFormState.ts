/**
 * The agent's side of the forms: what they typed, dismissed and saved.
 *
 * Suggestions are recomputed from the transcript on every change; this state is
 * layered over them. The rule that matters: **an edit always beats a
 * suggestion**, forever. Once the agent has typed in a field the transcript can
 * no longer overwrite it, even if the customer later says something different —
 * the agent heard the call and is accountable for the record.
 */

import { useCallback, useMemo, useState } from 'react'
import type { FormManifest, FormSuggestion } from './types'

export interface FormView {
  formId: string
  label: string
  placeholder: boolean
  triggerEvidence: string
  saved: boolean
  values: Record<string, string>
  /** Where each non-empty field's value came from. */
  provenance: Record<string, 'transcript' | 'attribute' | 'agent'>
  evidence: Record<string, string | undefined>
}

export interface FormState {
  forms: FormView[]
  activeId: string | null
  select(formId: string): void
  setValue(formId: string, key: string, value: string): void
  save(formId: string): void
  dismiss(formId: string): void
  /** Forms that opened while another was in front, not yet looked at. */
  unseen: ReadonlySet<string>
}

export function useFormState(manifest: FormManifest, suggestions: readonly FormSuggestion[]): FormState {
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})
  // formId -> triggerCount at the moment of dismissal. It reopens only when the
  // customer raises the topic *again*, not on every poll.
  const [dismissed, setDismissed] = useState<Record<string, number>>({})
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set())
  const [chosen, setChosen] = useState<string | null>(null)
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set())

  const forms = useMemo<FormView[]>(() => {
    const out: FormView[] = []
    for (const s of suggestions) {
      const spec = manifest.forms.find((f) => f.id === s.formId)
      if (!spec) continue
      const gone = dismissed[s.formId]
      if (gone !== undefined && s.triggerCount <= gone) continue

      const values: Record<string, string> = {}
      const provenance: FormView['provenance'] = {}
      const evidence: FormView['evidence'] = {}
      for (const field of spec.fields) {
        const typed = edits[s.formId]?.[field.key]
        const suggested = s.fields[field.key]
        if (typed !== undefined) {
          values[field.key] = typed
          if (typed !== '') provenance[field.key] = 'agent'
        } else if (suggested) {
          values[field.key] = suggested.value
          provenance[field.key] = suggested.origin
          evidence[field.key] = suggested.evidence
        } else {
          values[field.key] = ''
        }
      }
      out.push({
        formId: s.formId,
        label: spec.label,
        placeholder: spec.placeholder === true,
        triggerEvidence: s.triggerEvidence,
        saved: saved.has(s.formId),
        values,
        provenance,
        evidence,
      })
    }
    return out
  }, [manifest, suggestions, edits, dismissed, saved])

  // The first form to open takes the front; later ones wait as tabs rather than
  // pulling the agent away from a form they are mid-way through.
  const activeId = forms.some((f) => f.formId === chosen) ? chosen : (forms[0]?.formId ?? null)

  const unseen = useMemo(
    () => new Set(forms.filter((f) => f.formId !== activeId && !seen.has(f.formId)).map((f) => f.formId)),
    [forms, activeId, seen],
  )

  const select = useCallback((formId: string) => {
    setChosen(formId)
    setSeen((prev) => new Set(prev).add(formId))
  }, [])

  const setValue = useCallback((formId: string, key: string, value: string) => {
    setEdits((prev) => ({ ...prev, [formId]: { ...prev[formId], [key]: value } }))
    // Changing a saved form makes the confirmation untrue.
    setSaved((prev) => {
      if (!prev.has(formId)) return prev
      const next = new Set(prev)
      next.delete(formId)
      return next
    })
  }, [])

  const save = useCallback((formId: string) => setSaved((prev) => new Set(prev).add(formId)), [])

  const dismiss = useCallback(
    (formId: string) => {
      const s = suggestions.find((x) => x.formId === formId)
      if (s) setDismissed((prev) => ({ ...prev, [formId]: s.triggerCount }))
    },
    [suggestions],
  )

  return { forms, activeId, select, setValue, save, dismiss, unseen }
}
