/**
 * The primary pane: the attributes the IVR collected, laid out the way the
 * handoff document describes them.
 *
 * Three behaviours here are deliberate and are the reason this is not a plain
 * key/value dump:
 *
 *  - A declared attribute that the contact did not carry stays on screen as
 *    "Not set". An agent scanning for "Authentication" needs to find it and see
 *    that it is blank, not fail to find it and assume they missed it.
 *  - An attribute the contact carried that nobody declared is listed under
 *    "Unmapped". That is how a flow change becomes visible instead of silent.
 *  - Compliance text renders verbatim in its own block, never masked, never
 *    truncated, and never reflowed into a value cell.
 */

import { useMemo, useState } from 'react'
import { attributeManifest, manifestProblems } from '../config/attributes'
import { selectAttributes, toClipboardText, type AttributeRow } from '../attributes/select'
import type { ContactSnapshot } from '../connect'
import { Notice } from './Notice'

export function AttributePanel({ contact }: { contact: ContactSnapshot | null }) {
  const model = useMemo(
    () => selectAttributes(attributeManifest, contact?.attributes ?? {}),
    [contact?.attributes],
  )
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  const [copied, setCopied] = useState(false)

  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const toggleReveal = (key: string) =>
    setRevealed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const copy = async () => {
    if (!contact) return
    await navigator.clipboard.writeText(toClipboardText(model, contact.contactId))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="card" aria-label="Attributes collected during the call">
      <div className="card__head">
        <h2 className="card__title">Collected attributes</h2>
        <span className="card__count">
          {model.totals.present}/{model.totals.declared}
        </span>
        <span className="card__spacer" />
        {contact ? (
          <button type="button" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy for notes'}
          </button>
        ) : null}
      </div>

      <div className="card__body">
        {manifestProblems.length > 0 ? (
          <Notice tone="warn" title="The attribute manifest has problems">
            <ul>
              {manifestProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {!contact ? (
          <p className="empty">
            Nothing to show until a contact is connected. Open this app while on a call and the
            attributes the IVR collected appear here.
          </p>
        ) : (
          <>
            {model.missingRequired.length > 0 ? (
              <Notice tone="warn" title="Expected but not set by the flow">
                {model.missingRequired.map((row) => row.label).join(', ')}. Treat these as unknown
                rather than assuming a default.
              </Notice>
            ) : null}

            {model.groups.map((group) => {
              const open = !collapsed.has(group.id)
              return (
                <div className="group" key={group.id}>
                  <button
                    type="button"
                    className="group__head"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={open}
                  >
                    <span className="group__chevron" data-open={open} aria-hidden="true">
                      ▾
                    </span>
                    {group.label}
                    <span className="card__spacer" />
                    <span className="card__count">
                      {group.presentCount}/{group.rows.length}
                    </span>
                  </button>
                  {open
                    ? group.rows.map((row) => (
                        <AttributeRowView
                          key={row.key}
                          row={row}
                          revealed={revealed.has(row.key)}
                          onToggleReveal={() => toggleReveal(row.key)}
                        />
                      ))
                    : null}
                </div>
              )
            })}

            {model.unmapped.length > 0 ? (
              <div className="group">
                <button
                  type="button"
                  className="group__head"
                  onClick={() => toggleGroup('__unmapped')}
                  aria-expanded={!collapsed.has('__unmapped')}
                  title="Set by the contact flow but not described in the handoff document."
                >
                  <span className="group__chevron" data-open={!collapsed.has('__unmapped')} aria-hidden="true">
                    ▾
                  </span>
                  Unmapped
                  <span className="card__spacer" />
                  <span className="card__count">{model.unmapped.length}</span>
                </button>
                {!collapsed.has('__unmapped') ? (
                  <>
                    <p className="attr__help attr__help--block">
                      The flow set these, but the attribute manifest does not describe them. Add them
                      to <code>attribute-manifest.json</code> to give them a label and a place.
                    </p>
                    {model.unmapped.map((attr) => (
                      <div className="attr" key={attr.key}>
                        <span className="attr__label attr__value--mono">{attr.key}</span>
                        <span className="attr__value attr__value--mono">{attr.value}</span>
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

function AttributeRowView({
  row,
  revealed,
  onToggleReveal,
}: {
  row: AttributeRow
  revealed: boolean
  onToggleReveal: () => void
}) {
  const missingRequired = row.state === 'missing' && row.required
  const canReveal = row.state === 'present' && row.sensitive && row.mask !== 'none'

  return (
    <div className={`attr${missingRequired ? ' attr--missing-required' : ''}`}>
      <span className="attr__label" title={row.key}>
        {row.label}
      </span>

      <span
        className={[
          'attr__value',
          row.format === 'multiline' ? 'attr__value--multiline' : '',
          row.state === 'missing' ? 'attr__value--missing' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {row.compliance && row.state === 'present' ? null : row.tone ? (
          <span className="badge" data-tone={row.tone} title={row.raw}>
            {revealed || !row.sensitive ? row.revealed : row.display}
          </span>
        ) : row.telHref ? (
          <a href={row.telHref}>{row.display}</a>
        ) : (
          (revealed ? row.revealed : row.display)
        )}

        {canReveal ? (
          <button type="button" className="link attr__reveal" onClick={onToggleReveal}>
            {revealed ? 'hide' : 'reveal'}
          </button>
        ) : null}
      </span>

      {row.compliance && row.state === 'present' ? (
        <div className="compliance">
          <span className="compliance__tag">Verbatim — do not paraphrase</span>
          {row.raw}
        </div>
      ) : null}

      {row.warning ? <span className="attr__note">{row.warning}</span> : null}
      {row.help ? <span className="attr__help">{row.help}</span> : null}
    </div>
  )
}
