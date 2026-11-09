import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import provisionerIndex from '../../provisioner/index.mjs?raw'
import provisionerPackage from '../../provisioner/package.json?raw'
import censusExample from '../core/journey/fixtures/census-cqa.journey.json'
import exampleSafety from '../core/emit/acxd/fixtures/guardrail.Safety.json'
import exampleInjection from '../core/emit/acxd/fixtures/guardrail.PromptInjection.json'
import exampleToxicity from '../core/emit/acxd/fixtures/guardrail.Toxicity.json'
import type { Journey, ValidationIssue } from '../core/journey'
import { defaultContactFlowForm, describeChecklist, generateBundle, generateContactFlow, toggleItem, zipFiles } from './controller'
import type { BuildResult, ContactFlowForm, ContactFlowResult, Details, Session } from './controller'
import { ACCEPTED_FILES, readAndExtract } from './extraction'
import type { ExtractionForm } from './extraction'
import { color, heading, input as inputStyle, muted, severityColor, statusColor } from './theme'
import { Button, Chip, Code, Field, Panel, Problems, Summary, TextArea, TextInput, download } from './ui'

export const provisionerFiles = { 'index.mjs': provisionerIndex, 'package.json': provisionerPackage }

// ---- 1. journey ---------------------------------------------------------------------------------------------

export function JourneyStep({ issues, onLoad, onExtracted }: { issues: ValidationIssue[]; onLoad: (text: string, example: boolean) => void; onExtracted: (journey: Journey, summary: string[]) => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const sourceInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ fileName: string; bytes: Uint8Array } | null>(null)
  const [form, setForm] = useState<ExtractionForm>({ url: import.meta.env.VITE_EXTRACTOR_URL ?? '', token: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const update = (next: ExtractionForm) => {
    setForm(next)
    setErrors([])
  }
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onLoad(await f.text(), false)
    e.target.value = ''
  }
  const pickSource = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setFile({ fileName: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })
    setErrors([])
    e.target.value = ''
  }
  const read = async () => {
    if (!file) return
    setBusy(true)
    setErrors([])
    try {
      const out = await readAndExtract(file, form)
      if (out.ok) onExtracted(out.journey, out.summary)
      else setErrors(out.errors)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel>
        <h3 style={{ ...heading, fontSize: 20, marginBottom: 8 }}>Read a diagram, deck or document</h3>
        <p style={muted}>
          Upload a PowerPoint deck, Word document, PDF, image or text file. Decks are read as shapes and arrows, so the connections come from the file itself;
          a model then interprets them. Every prompt is checked against the source wording afterwards. Nothing is stored.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0' }}>
          <Button kind="ghost" onClick={() => sourceInput.current?.click()}>Choose a file</Button>
          <span style={{ ...muted, fontSize: 13 }}>{file ? file.fileName : 'No file chosen'}</span>
          <input ref={sourceInput} type="file" accept={ACCEPTED_FILES} hidden onChange={(e) => { void pickSource(e) }} />
        </div>
        <Field label="Extractor URL" hint="The Function URL from the extractor stack (or set VITE_EXTRACTOR_URL)."><TextInput value={form.url} onChange={(v) => update({ ...form, url: v })} placeholder="https://..." /></Field>
        <Field label="Access token" hint="Kept in memory only; you re-enter it each visit."><input type="password" style={inputStyle} value={form.token} onChange={(e) => update({ ...form, token: e.target.value })} autoComplete="off" /></Field>
        <Field label="Notes for the reader (optional)" hint="Facts the file does not say, for example that records live in DynamoDB or that any one identifier is enough."><TextArea value={form.notes} onChange={(v) => update({ ...form, notes: v })} rows={3} /></Field>
        <Button onClick={() => { void read() }} disabled={!file || busy}>{busy ? 'Reading…' : 'Read journey'}</Button>
        <Problems items={errors} />
      </Panel>
      <Panel>
        <h3 style={{ ...heading, fontSize: 20, marginBottom: 8 }}>Or load a structured journey</h3>
        <p style={muted}>Journey JSON needs no extraction. The Census CQA example is a ready-made one.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0' }}>
          <Button onClick={() => onLoad(JSON.stringify(censusExample), true)}>Load the Census CQA example</Button>
          <Button kind="ghost" onClick={() => fileInput.current?.click()}>Upload journey JSON</Button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { void pick(e) }} />
        </div>
        <Problems items={issues.map((i) => `${i.path}: ${i.message}`)} />
      </Panel>
    </div>
  )
}

// ---- 2. checklist -------------------------------------------------------------------------------------------

export function ChecklistStep({ session, readSummary, onChange, onNext }: { session: Session; readSummary: string[]; onChange: (s: Session) => void; onNext: () => void }) {
  const view = describeChecklist(session)
  const s = view.summary
  // Decisions that block or warn stay in view; plain assumptions are one click away.
  const decisions = view.reviews.filter((r) => r.severity !== 'info')
  const assumptions = view.reviews.filter((r) => r.severity === 'info')
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel>
        <h3 style={{ ...heading, fontSize: 20, marginBottom: 8 }}>{session.journey.title}</h3>
        <p style={muted}>
          {view.selectedCount} of {s.total} items selected. {s.bySchemaStatus.confirmed} are built from confirmed schema, {s.bySchemaStatus.partial} partly, {s.bySchemaStatus.unconfirmed} cannot be generated yet.
          {s.fullyEmittable ? ' Everything selected can be generated.' : ' Some selected items still need a decision or manual work (see below).'}
        </p>
        {readSummary.length > 0 && <ul style={{ ...muted, fontSize: 13, margin: '8px 0 0', paddingLeft: 18 }}>{readSummary.map((l) => <li key={l}>{l}</li>)}</ul>}
        {session.notices.length > 0 && <ul aria-live="polite" style={{ color: color.warn, fontSize: 14, margin: '8px 0 0', paddingLeft: 18 }}>{session.notices.map((n) => <li key={n}>{n}</li>)}</ul>}
      </Panel>

      {decisions.length > 0 && (
        <Panel>
          <h3 style={{ ...heading, fontSize: 16, marginBottom: 12 }}>Needs a human decision</h3>
          {decisions.map((r) => (
            <div key={r.id} style={{ borderLeft: `3px solid ${severityColor[r.severity]}`, paddingLeft: 12, marginBottom: 12 }}>
              <div style={{ color: color.text, fontSize: 14, fontWeight: 600 }}><Chip tone={severityColor[r.severity]}>{r.severity}</Chip> {r.title}</div>
              <div style={{ ...muted, fontSize: 13 }}>{r.detail}</div>
            </div>
          ))}
        </Panel>
      )}

      {assumptions.length > 0 && (
        <Panel>
          <details>
            <summary style={{ ...heading, fontSize: 16, cursor: 'pointer' }}>Assumptions to confirm ({assumptions.length})</summary>
            <ul style={{ ...muted, margin: '12px 0 0', paddingLeft: 18 }}>{assumptions.map((r) => <li key={r.id}>{r.detail}</li>)}</ul>
          </details>
        </Panel>
      )}

      {view.sections.map((section) => (
        <Panel key={section.need}>
          <h3 style={{ ...heading, fontSize: 16, marginBottom: 12 }}>{section.heading}</h3>
          {section.items.map(({ item, checked, locked, neededBy }) => (
            <div key={item.id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderTop: `1px solid ${color.border}` }}>
              <input id={item.id} type="checkbox" checked={checked} disabled={locked} aria-describedby={`${item.id}-why`} onChange={() => onChange(toggleItem(session, item.id))} style={{ marginTop: 4 }} />
              <div style={{ flex: 1 }}>
                <label htmlFor={item.id} style={{ color: color.text, fontSize: 14, fontWeight: 600 }}>
                  {item.title} <Chip tone={statusColor[item.schemaStatus]}>{item.schemaStatus}</Chip>
                </label>
                <div id={`${item.id}-why`} style={{ ...muted, fontSize: 13 }}>{item.reason}</div>
                {neededBy.length > 0 && <div style={{ ...muted, fontSize: 12 }}>Needed by: {neededBy.join(', ')}</div>}
                {item.params.length > 0 && <div style={{ ...muted, fontSize: 12 }}>You supply: {item.params.map((p) => (p.secret ? `${p.label} (secret, entered at deploy time)` : p.label)).join('; ')}</div>}
                {item.notes.length > 0 && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ ...muted, fontSize: 12, cursor: 'pointer' }}>{item.notes.length} note{item.notes.length === 1 ? '' : 's'}</summary>
                    <ul style={{ ...muted, fontSize: 12, margin: '4px 0 0', paddingLeft: 18 }}>{item.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                  </details>
                )}
              </div>
            </div>
          ))}
        </Panel>
      ))}
      <div><Button onClick={onNext}>Continue to the bundle</Button></div>
    </div>
  )
}

// ---- 3. bundle ----------------------------------------------------------------------------------------------

export function BundleStep({ session, details, onDetails, result, onResult, isExample }: { session: Session; details: Details; onDetails: (d: Details) => void; result: BuildResult | null; onResult: (r: BuildResult) => void; isExample: boolean }) {
  const set = <K extends keyof Details>(key: K, value: Details[K]) => onDetails({ ...details, [key]: value })
  const [preview, setPreview] = useState('README.md')
  const useExampleWording = () =>
    onDetails({ ...details, guardrails: { safety: JSON.stringify(exampleSafety, null, 2), promptInjection: JSON.stringify(exampleInjection, null, 2), toxicity: JSON.stringify(exampleToxicity, null, 2) } })

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel>
        <h3 style={{ ...heading, fontSize: 20, marginBottom: 16 }}>Details</h3>
        <Field label="Application name"><TextInput value={details.applicationName} onChange={(v) => set('applicationName', v)} /></Field>
        <Field label="DynamoDB table name" hint="Used only if the verification table is selected."><TextInput value={details.tableName} onChange={(v) => set('tableName', v)} /></Field>
        {details.identifierFields.length > 0 && (
          <Field label="Attribute names for the identifiers (first one is the table key)" hint="Comma separated, in the journey's order.">
            <TextInput value={details.identifierFields.join(', ')} onChange={(v) => set('identifierFields', v.split(',').map((x) => x.trim()).filter(Boolean))} />
          </Field>
        )}
        <Field label="Knowledge base id (optional)" hint="Create the knowledge base in the console first; the main conversation uses it for answers."><TextInput value={details.knowledgeBaseId} onChange={(v) => set('knowledgeBaseId', v)} /></Field>
        <Field label="Safety message (optional)" hint="Fixed wording spoken before a safety escalation. Leave empty to use the US default, flagged for review."><TextArea value={details.safetyMessage} onChange={(v) => set('safetyMessage', v)} rows={3} /></Field>
        <Field label="Main conversation prompt (optional)" hint="The customer's persona and rules. Leave empty to use a neutral baseline, flagged for review."><TextArea value={details.mainPrompt} onChange={(v) => set('mainPrompt', v)} rows={4} /></Field>
        <h4 style={{ ...heading, fontSize: 15, margin: '8px 0 4px' }}>Guardrail wording</h4>
        <p style={{ ...muted, fontSize: 13, marginTop: 0 }}>Paste guardrail exports. Wording is customer-specific, so a guardrail without it is skipped, never invented.</p>
        {isExample && <div style={{ marginBottom: 12 }}><Button kind="ghost" onClick={useExampleWording}>Use the Census example wording</Button></div>}
        <Field label="Safety guardrail (JSON)"><TextArea value={details.guardrails.safety} onChange={(v) => set('guardrails', { ...details.guardrails, safety: v })} rows={3} /></Field>
        <Field label="Prompt injection guardrail (JSON)"><TextArea value={details.guardrails.promptInjection} onChange={(v) => set('guardrails', { ...details.guardrails, promptInjection: v })} rows={3} /></Field>
        <Field label="Toxicity guardrail (JSON)"><TextArea value={details.guardrails.toxicity} onChange={(v) => set('guardrails', { ...details.guardrails, toxicity: v })} rows={3} /></Field>
        <Button onClick={() => onResult(generateBundle(session, details, provisionerFiles))}>Generate bundle</Button>
        {result && !result.ok && <Problems items={result.errors} />}
      </Panel>

      {result?.ok && (() => {
        const b = result.bundle
        const names = Object.keys(b.files)
        return (
          <Panel>
            <h3 style={{ ...heading, fontSize: 20, marginBottom: 8 }}>Your bundle</h3>
            <p style={muted}>{names.length} files. Generated from confirmed ACXD schema only. It has not been deployed: the first deployment is the real test.</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '12px 0' }}>
              <Button onClick={() => download('implementation-bundle.zip', zipFiles(b.files), 'application/zip')}>Download everything (.zip)</Button>
            </div>
            <Summary title="Not generated" tone={color.warn} lines={b.skipped.map((s) => `${s.id}: ${s.reason}`)} />
            <Summary title="Warnings" tone={color.warn} lines={b.warnings} />
            <Summary title="Blockers" tone={color.bad} lines={b.blockers.map((x) => `${x.title}: ${x.detail}`)} />
            <Summary title="Console steps after deploying" tone={color.accent} lines={b.consoleSteps} />
            <div role="tablist" aria-label="Files" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0 8px' }}>
              {names.map((n) => (
                <button key={n} type="button" role="tab" aria-selected={preview === n} onClick={() => setPreview(n)}
                  style={{ padding: '4px 12px', borderRadius: 980, border: `1px solid ${preview === n ? color.accent : color.border}`, background: 'transparent', color: preview === n ? color.accent : color.textMuted, fontSize: 12, cursor: 'pointer' }}>{n}</button>
              ))}
            </div>
            <Code>{b.files[preview] ?? b.files[names[0]]}</Code>
            <div style={{ marginTop: 8 }}><Button kind="ghost" onClick={() => download(preview.split('/').pop() as string, b.files[preview] ?? '', 'text/plain')}>Download {preview}</Button></div>
          </Panel>
        )
      })()}
    </div>
  )
}

// ---- 4. connect contact flow ----------------------------------------------------------------------------------

export function ContactFlowStep({ session, prefill, onGenerated }: { session: Session; prefill: { workspaceId: string; applicationId: string } | null; onGenerated?: () => void }) {
  const [form, setForm] = useState<ContactFlowForm>(() => ({ ...defaultContactFlowForm(session), ...(prefill ?? {}) }))
  const [out, setOut] = useState<ContactFlowResult | null>(null)
  const set = <K extends keyof ContactFlowForm>(key: K, value: ContactFlowForm[K]) => { setForm({ ...form, [key]: value }); setOut(null) }
  return (
    <Panel>
      <h3 style={{ ...heading, fontSize: 20, marginBottom: 8 }}>Amazon Connect contact flow</h3>
      <p style={muted}>
        Needs ids that only exist after you deploy the stack (the application id is a stack output) and the deployment alias id from the ACXD Deploy tab.
        The Set voice block is not generated: add it in the Connect console for voice channels.
      </p>
      <Field label="Flow name"><TextInput value={form.name} onChange={(v) => set('name', v)} /></Field>
      <Field label="Channel">
        <select value={form.channel} onChange={(e) => set('channel', e.target.value as 'voice' | 'chat')} style={{ width: '100%', padding: 10, borderRadius: 10, background: color.input, color: color.text, border: `1px solid ${color.border}` }}>
          <option value="voice">Voice</option>
          <option value="chat">Chat</option>
        </select>
      </Field>
      <Field label="ACXD workspace id"><TextInput value={form.workspaceId} onChange={(v) => set('workspaceId', v)} /></Field>
      <Field label="ACXD application id (stack output)"><TextInput value={form.applicationId} onChange={(v) => set('applicationId', v)} /></Field>
      <Field label="Deployment alias id"><TextInput value={form.aliasId} onChange={(v) => set('aliasId', v)} /></Field>
      <Field label="Escalation queue name"><TextInput value={form.queueName} onChange={(v) => set('queueName', v)} /></Field>
      <Field label="Escalation queue ARN" hint="arn:aws:connect:<region>:<account>:instance/<instance-id>/queue/<queue-id>"><TextInput value={form.queueArn} onChange={(v) => set('queueArn', v)} /></Field>
      <p style={{ ...muted, fontSize: 13 }}>Hand-back attributes: {form.attributes.join(', ') || 'none'}</p>
      <Button onClick={() => { const r = generateContactFlow(form); setOut(r); if (r.ok) onGenerated?.() }}>Generate contact flow</Button>
      {out && !out.ok && <Problems items={out.errors} />}
      {out?.ok && (
        <div style={{ marginTop: 16 }}>
          <Code maxHeight={280}>{out.json}</Code>
          <div style={{ marginTop: 8 }}><Button onClick={() => download(`${form.name}.json`, out.json, 'application/json')}>Download {form.name}.json</Button></div>
        </div>
      )}
    </Panel>
  )
}
