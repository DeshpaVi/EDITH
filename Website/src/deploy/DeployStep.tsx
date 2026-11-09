import { useEffect, useRef, useState } from 'react'
import { createDeployerClient } from './client'
import type { DeployTarget, PlanResult, StackStatus } from './client'
import { canExecute, describePlan, executePlan, phaseView, previewChanges, suggestStackName, watchStack } from './controller'
import type { ConfirmState, DeployForm, DeployableTemplate } from './controller'
import { generateBundle } from '../implementation/controller'
import type { BuildResult, Details, Session } from '../implementation/controller'
import { Button, Code, Field, Panel, Problems, Summary, TextInput } from '../implementation/ui'
import { color, heading, input as inputStyle, muted } from '../implementation/theme'

const TONE = { working: color.accent, good: color.good, bad: color.bad, neutral: color.textMuted } as const

/**
 * Deploy the generated bundle into a target account through the deployer API. Preview first (a CloudFormation
 * change set), then an explicit confirmation, then progress. The ACXD API key is never an input here.
 */
export function DeployStep({ session, details, onDeployed }: { session: Session; details: Details; onDeployed: (prefill: { workspaceId: string; applicationId: string }) => void }) {
  const [prepared, setPrepared] = useState<BuildResult | null>(null)
  const [form, setForm] = useState<DeployForm>({
    url: import.meta.env.VITE_DEPLOYER_URL ?? '',
    token: '',
    targetId: '',
    stackName: suggestStackName(session.journey.title),
    workspaceId: '',
    apiKeySecretArn: '',
    tableName: details.tableName,
  })
  const [targets, setTargets] = useState<DeployTarget[]>([])
  const [plan, setPlan] = useState<PlanResult | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>({ typedName: '', reviewed: false })
  const [status, setStatus] = useState<StackStatus | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [deleteName, setDeleteName] = useState('')
  const cancelled = useRef(false)

  // Stop polling when the screen is left; the stack keeps deploying either way.
  useEffect(() => () => { cancelled.current = true }, [])

  const client = () => createDeployerClient({ url: form.url.trim(), token: form.token.trim() })
  const template = (): DeployableTemplate | null => {
    if (!prepared?.ok) return null
    return prepared.bundle.template as unknown as DeployableTemplate
  }
  const set = <K extends keyof DeployForm>(key: K, value: DeployForm[K]) => {
    setForm({ ...form, [key]: value })
    setErrors([])
    setPlan(null)
  }

  const prepare = () => {
    const built = generateBundle(session, details, {}, 'managed')
    setPrepared(built)
    setPlan(null)
    setErrors(built.ok ? [] : built.errors)
  }

  const loadTargets = async () => {
    setBusy(true)
    setErrors([])
    try {
      const list = await client().targets()
      setTargets(list)
      if (list.length === 1) setForm({ ...form, targetId: list[0].id })
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Could not load targets.'])
    } finally {
      setBusy(false)
    }
  }

  const preview = async () => {
    const t = template()
    if (!t) return
    setBusy(true)
    setErrors([])
    setConfirm({ typedName: '', reviewed: false })
    try {
      const out = await previewChanges(client(), form, t)
      if (out.ok) setPlan(out.plan)
      else setErrors(out.errors)
    } finally {
      setBusy(false)
    }
  }

  const startWatching = async () => {
    cancelled.current = false
    const final = await watchStack(client(), { targetId: form.targetId, stackName: form.stackName }, { onUpdate: setStatus, isCancelled: () => cancelled.current })
    if (final) setStatus(final)
  }

  const deploy = async () => {
    if (!plan) return
    setBusy(true)
    setErrors([])
    try {
      const out = await executePlan(client(), form, plan, confirm)
      if (!out.ok) {
        setErrors(out.errors)
        return
      }
      setStatus({ stackName: form.stackName, phase: 'working' })
      setPlan(null)
      void startWatching()
    } finally {
      setBusy(false)
    }
  }

  const discard = async () => {
    if (plan?.status !== 'ready') return
    setBusy(true)
    try {
      await client().cancel({ targetId: form.targetId, stackName: form.stackName, changeSetId: plan.changeSetId })
    } catch {
      // The preview expires by itself; nothing was created.
    } finally {
      setPlan(null)
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setErrors([])
    try {
      await client().remove({ targetId: form.targetId, stackName: form.stackName, confirmName: deleteName })
      setDeleteName('')
      setStatus({ stackName: form.stackName, phase: 'working' })
      void startWatching()
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Could not delete the stack.'])
    } finally {
      setBusy(false)
    }
  }

  const bundle = prepared?.ok ? prepared.bundle : null
  const view = plan ? describePlan(plan) : null
  const phase = status ? phaseView(status.phase) : null
  const prefill = status?.phase === 'done' && status.outputs?.AcxdApplicationId ? { workspaceId: status.outputs.AcxdWorkspaceId ?? form.workspaceId, applicationId: status.outputs.AcxdApplicationId } : null

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel>
        <h3 style={{ ...heading, fontSize: 20, marginBottom: 8 }}>Deploy to an AWS account</h3>
        <p style={muted}>
          The deployer previews every change before anything is created, and runs only what you confirm. It deploys into the account through a role the customer
          created. Your ACXD API key is never entered here: create a secret in the target account and give its ARN.
        </p>
        <Button onClick={prepare}>{bundle ? 'Prepare again' : 'Prepare deployment'}</Button>
        {prepared && !prepared.ok && <Problems items={prepared.errors} />}
        {bundle && (
          <div style={{ marginTop: 12 }}>
            <p style={{ ...muted, fontSize: 13 }}>{Object.keys(bundle.template.Resources).length} resources in the template. Review what was not generated before you deploy.</p>
            <Summary title="Not generated" tone={color.warn} lines={bundle.skipped.map((s) => `${s.id}: ${s.reason}`)} />
            <Summary title="Warnings" tone={color.warn} lines={bundle.warnings} />
            <Summary title="Blockers" tone={color.bad} lines={bundle.blockers.map((x) => `${x.title}: ${x.detail}`)} />
            <Summary title="Console steps after deploying" tone={color.accent} lines={bundle.consoleSteps} />
          </div>
        )}
      </Panel>

      {bundle && (
        <Panel>
          <h3 style={{ ...heading, fontSize: 16, marginBottom: 12 }}>Connect to the deployer</h3>
          <Field label="Deployer URL" hint="The DeployerUrl output of the deployer stack (or set VITE_DEPLOYER_URL)."><TextInput value={form.url} onChange={(v) => set('url', v)} placeholder="https://..." /></Field>
          <Field label="Access token" hint="Kept in memory only."><input type="password" style={inputStyle} value={form.token} onChange={(e) => set('token', e.target.value)} autoComplete="off" /></Field>
          <div style={{ marginBottom: 16 }}><Button kind="ghost" onClick={() => { void loadTargets() }} disabled={busy}>Load target accounts</Button></div>
          {targets.length > 0 && (
            <Field label="Target account">
              <select value={form.targetId} onChange={(e) => set('targetId', e.target.value)} style={{ ...inputStyle, background: '#111' }}>
                <option value="">Choose…</option>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.region})</option>)}
              </select>
            </Field>
          )}
          <h3 style={{ ...heading, fontSize: 16, margin: '16px 0 12px' }}>Stack details</h3>
          <Field label="Stack name" hint="Starts with edith-, lowercase letters, digits and hyphens."><TextInput value={form.stackName} onChange={(v) => set('stackName', v)} /></Field>
          <Field label="ACXD workspace id"><TextInput value={form.workspaceId} onChange={(v) => set('workspaceId', v)} /></Field>
          <Field label="ACXD API key secret ARN" hint="A Secrets Manager secret in the target account whose value is the ACXD API key. Create it with the AWS CLI or console; paste only its ARN here.">
            <TextInput value={form.apiKeySecretArn} onChange={(v) => set('apiKeySecretArn', v)} placeholder="arn:aws:secretsmanager:region:account:secret:name-AbCdEf" />
          </Field>
          {'TableName' in (bundle.template.Parameters ?? {}) && <Field label="DynamoDB table name"><TextInput value={form.tableName} onChange={(v) => set('tableName', v)} /></Field>}
          <Button onClick={() => { void preview() }} disabled={busy}>{busy ? 'Working…' : 'Preview changes'}</Button>
          <Problems items={errors} />
        </Panel>
      )}

      {view && plan && (
        <Panel>
          <h3 style={{ ...heading, fontSize: 16, marginBottom: 8 }}>Review the changes</h3>
          <p style={{ color: color.text, fontSize: 14 }}>{view.headline}</p>
          <Summary title="Take note" tone={color.warn} lines={view.warnings} />
          {view.rows.length > 0 && (
            <Code maxHeight={260}>{view.rows.map((r) => `${r.action.padEnd(7)} ${r.logicalId.padEnd(28)} ${r.type}`).join('\n')}</Code>
          )}
          {plan.status === 'ready' && (
            <div style={{ marginTop: 16 }}>
              <label style={{ display: 'flex', gap: 8, color: color.text, fontSize: 14, marginBottom: 12 }}>
                <input type="checkbox" checked={confirm.reviewed} onChange={() => setConfirm({ ...confirm, reviewed: !confirm.reviewed })} />
                I have reviewed these changes and the blockers, warnings and skipped items above.
              </label>
              <Field label={`Type ${plan.stackName} to confirm`}><TextInput value={confirm.typedName} onChange={(v) => setConfirm({ ...confirm, typedName: v })} /></Field>
              <div style={{ display: 'flex', gap: 12 }}>
                <Button onClick={() => { void deploy() }} disabled={!canExecute(plan, confirm) || busy}>Deploy</Button>
                <Button kind="ghost" onClick={() => { void discard() }} disabled={busy}>Discard preview</Button>
              </div>
              <p style={{ ...muted, fontSize: 12, marginTop: 8 }}>The preview expires in {plan.expiresInMinutes} minutes.</p>
            </div>
          )}
        </Panel>
      )}

      {status && phase && (
        <Panel>
          <h3 style={{ ...heading, fontSize: 16, marginBottom: 8 }}>
            <span style={{ color: TONE[phase.tone] }}>{phase.label}</span> {status.stackName}
          </h3>
          {status.status && <p style={{ ...muted, fontSize: 13 }}>CloudFormation status: {status.status}{status.reason ? `. ${status.reason}` : ''}</p>}
          <Summary title="Failures" tone={color.bad} lines={(status.failures ?? []).map((f) => `${f.logicalId}: ${f.reason}`)} />
          {status.recent && status.recent.length > 0 && <Code maxHeight={180}>{status.recent.map((e) => `${e.status.padEnd(24)} ${e.logicalId}`).join('\n')}</Code>}
          {status.phase === 'done' && status.outputs && Object.keys(status.outputs).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Summary title="Outputs" tone={color.good} lines={Object.entries(status.outputs).map(([k, v]) => `${k}: ${v}`)} />
            </div>
          )}
          {prefill && <div style={{ marginTop: 12 }}><Button onClick={() => onDeployed(prefill)}>Continue to the Connect flow</Button></div>}
          {(status.phase === 'done' || status.phase === 'failed') && (
            <div style={{ marginTop: 20, borderTop: `1px solid ${color.border}`, paddingTop: 16 }}>
              <Field label={`To remove everything this stack created, type ${status.stackName}`}><TextInput value={deleteName} onChange={setDeleteName} /></Field>
              <Button kind="ghost" onClick={() => { void remove() }} disabled={busy || deleteName !== status.stackName}>Delete stack</Button>
              <Problems items={errors} />
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}
