/**
 * The pop-up form: opens by itself when the customer raises a topic, fills
 * itself from what they say, and stays fully editable.
 *
 * A slide-in panel rather than a modal, deliberately: a modal would sit on top
 * of the live transcript the agent is reading to fill the form in. Nothing here
 * takes focus when it opens — an agent typing in a field must not have it
 * stolen mid-word — and its arrival is announced politely instead.
 *
 * Every auto-filled field says where it came from ("from call" with the
 * sentence, or "from IVR"), because a value the agent cannot trace is a value
 * they have to re-verify from scratch.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { formManifest } from '../config/forms'
import type { ContactSnapshot } from '../connect'
import { detectForms } from '../forms/detect'
import { useFormState, type FormView } from '../forms/useFormState'
import type { TranscriptItem } from '../transcript/types'

const NO_ATTRIBUTES: Record<string, string> = {}

export function FormPanel({ items, contact }: { items: readonly TranscriptItem[]; contact: ContactSnapshot | null }) {
  const attributes = contact?.attributes ?? NO_ATTRIBUTES
  const suggestions = useMemo(() => detectForms(formManifest, items, attributes), [items, attributes])
  const state = useFormState(formManifest, suggestions)
  const fresh = useFreshFields(state.forms)

  const active = state.forms.find((f) => f.formId === state.activeId)
  if (!active) return null
  const spec = formManifest.forms.find((f) => f.id === active.formId)!

  return (
    <aside className="formpanel" aria-label="Suggested form">
      <p className="visually-hidden" aria-live="polite">
        {state.forms.length === 1 ? `${active.label} form opened from the conversation.` : `${state.forms.length} forms available.`}
      </p>

      <div className="card formpanel__card">
        <div className="card__head">
          <h2 className="card__title">{active.label}</h2>
          {active.placeholder ? (
            <span className="badge" data-tone="warn" title="Field list is a stand-in until the business confirms it">
              Placeholder
            </span>
          ) : null}
          <span className="card__spacer" />
          <button type="button" className="link" onClick={() => state.dismiss(active.formId)} aria-label={`Dismiss ${active.label} form`}>
            Dismiss
          </button>
        </div>

        {state.forms.length > 1 ? (
          <div className="formtabs" role="tablist" aria-label="Forms opened from this call">
            {state.forms.map((f) => (
              <button
                key={f.formId}
                type="button"
                role="tab"
                aria-selected={f.formId === active.formId}
                className="formtabs__tab"
                onClick={() => state.select(f.formId)}
              >
                {f.label}
                {state.unseen.has(f.formId) ? <span className="formtabs__dot" aria-label="new" /> : null}
                {f.saved ? <span aria-label="saved"> ✓</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        <div className="card__body formpanel__body">
          <p className="formpanel__why">
            Opened because the customer said: <q>{active.triggerEvidence}</q>
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              state.save(active.formId)
            }}
          >
            {spec.fields.map((field) => {
              const id = `${active.formId}-${field.key}`
              const origin = active.provenance[field.key]
              const isFresh = fresh.has(`${active.formId}.${field.key}`)
              return (
                <div className="field" key={field.key} data-fresh={isFresh || undefined}>
                  <div className="field__row">
                    <label htmlFor={id}>{field.label}</label>
                    {origin === 'transcript' ? <span className="badge" data-tone="good">from call</span> : null}
                    {origin === 'attribute' ? <span className="badge" data-tone="neutral">from IVR</span> : null}
                    {origin === 'agent' ? <span className="badge" data-tone="neutral">edited</span> : null}
                  </div>

                  {field.type === 'select' ? (
                    <select id={id} value={active.values[field.key] ?? ''} onChange={(e) => state.setValue(active.formId, field.key, e.target.value)}>
                      <option value="">Select…</option>
                      {field.options?.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={id}
                      type={field.type === 'number' ? 'number' : 'text'}
                      inputMode={field.type === 'number' ? 'numeric' : undefined}
                      min={field.type === 'number' ? 0 : undefined}
                      value={active.values[field.key] ?? ''}
                      onChange={(e) => state.setValue(active.formId, field.key, e.target.value)}
                    />
                  )}

                  {origin === 'transcript' && active.evidence[field.key] ? (
                    <p className="field__evidence">
                      <q>{active.evidence[field.key]}</q>
                    </p>
                  ) : null}
                </div>
              )
            })}

            <div className="formpanel__actions">
              <button type="submit" className="primary">
                Save
              </button>
              {active.saved ? (
                <span className="badge" data-tone="good" role="status">
                  Saved ✓
                </span>
              ) : null}
            </div>
            {active.saved ? (
              <p className="formpanel__saved" role="status">
                Details saved for this contact.
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </aside>
  )
}

/**
 * Field ids that were just filled or changed by the transcript, for ~2.5s, so
 * an agent glancing back from the transcript sees *what* moved.
 */
function useFreshFields(forms: readonly FormView[]): ReadonlySet<string> {
  const previous = useRef<Record<string, string>>({})
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const changed: string[] = []
    const next: Record<string, string> = {}
    for (const f of forms) {
      for (const [key, value] of Object.entries(f.values)) {
        const id = `${f.formId}.${key}`
        next[id] = value
        if (f.provenance[key] === 'transcript' && value !== '' && previous.current[id] !== value) changed.push(id)
      }
    }
    previous.current = next
    if (changed.length === 0) return
    setFresh((prev) => new Set([...prev, ...changed]))
    // No cleanup: a later poll re-running this effect must not strand the flag.
    setTimeout(() => setFresh((prev) => new Set([...prev].filter((id) => !changed.includes(id)))), 2500)
  }, [forms])

  return fresh
}
