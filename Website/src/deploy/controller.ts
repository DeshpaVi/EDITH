import type { DeployerClient, PlanResult, StackPhase, StackStatus } from './client'

/**
 * Deploy logic as pure functions so it is testable without a browser. The rules that matter:
 *  - nothing is executed without a previewed change set, a typed confirmation of the stack name and a ticked review;
 *  - the ACXD API key is never an input: only the ARN of a secret the consultant created in the target account.
 */

export interface TemplateParameter {
  Type?: string
  Default?: string
  AllowedPattern?: string
  NoEcho?: boolean
}
export interface DeployableTemplate {
  Parameters?: Record<string, TemplateParameter>
  Description?: string
}

export interface DeployForm {
  url: string
  token: string
  targetId: string
  stackName: string
  workspaceId: string
  /** ARN of a Secrets Manager secret in the TARGET account holding the ACXD API key. */
  apiKeySecretArn: string
  tableName: string
}

/** The tool fills these in; the consultant never supplies them. */
const TOOL_SET = ['ProvisionerCodeBucket', 'ProvisionerCodeKey']
const SECRET_ARN = /^arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+$/

/** 'Census CQA demo' -> 'edith-census-cqa-demo'. Lowercase letters, digits and hyphens, at most 60 characters. */
export function suggestStackName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/g, '')
  return `edith-${slug || 'journey'}`
}

export const validStackName = (name: string): boolean => /^edith-[a-z0-9]([a-z0-9-]{0,100}[a-z0-9])?$/.test(name)

export function validateDeployForm(form: DeployForm, template: DeployableTemplate): string[] {
  const errors: string[] = []
  const url = form.url.trim()
  if (!/^https:\/\/\S+$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/.test(url)) errors.push('Deployer URL must start with https:// (or http://localhost for local development).')
  if (form.token.trim() === '') errors.push('Enter the deployer access token.')
  if (form.targetId === '') errors.push('Choose a target account.')
  if (!validStackName(form.stackName)) errors.push('Stack name must start with "edith-" and use lowercase letters, digits and hyphens.')
  if (form.workspaceId.trim() === '') errors.push('Enter the ACXD workspace id.')
  if (!SECRET_ARN.test(form.apiKeySecretArn.trim())) {
    errors.push('Enter the ARN of the Secrets Manager secret (in the target account) that holds the ACXD API key. Do not paste the key itself.')
  }
  if (/acxd_live_/.test(form.apiKeySecretArn) || /acxd_live_/.test(form.workspaceId)) errors.push('That looks like an ACXD API key. Never enter the key here: create a secret and give its ARN.')
  if ('TableName' in (template.Parameters ?? {}) && !/^[A-Za-z0-9_.-]{3,255}$/.test(form.tableName)) errors.push('Table name must be 3 to 255 characters: letters, digits, underscore, dot or hyphen.')
  const secretParam = Object.entries(template.Parameters ?? {}).find(([, p]) => p.NoEcho)
  if (secretParam) errors.push(`The template has a secret parameter (${secretParam[0]}). Regenerate the bundle for deployment from the tool.`)
  return errors
}

/** Parameter values for the template, from the form. Only parameters the template declares are sent. */
export function buildParameters(form: DeployForm, template: DeployableTemplate): Record<string, string> {
  const declared = template.Parameters ?? {}
  const values: Record<string, string> = {
    AcxdWorkspaceId: form.workspaceId.trim(),
    AcxdApiKeySecretArn: form.apiKeySecretArn.trim(),
    TableName: form.tableName.trim(),
  }
  return Object.fromEntries(Object.entries(values).filter(([key]) => key in declared && !TOOL_SET.includes(key)))
}

export interface PlanView {
  headline: string
  warnings: string[]
  rows: Array<{ action: string; logicalId: string; type: string }>
}

export function describePlan(plan: PlanResult): PlanView {
  if (plan.status === 'no_changes') return { headline: 'Nothing to change: the stack already matches.', warnings: [], rows: [] }
  const { add, modify, remove } = plan.counts
  const parts = [add && `${add} to create`, modify && `${modify} to change`, remove && `${remove} to remove`].filter(Boolean)
  const warnings: string[] = []
  const replaced = plan.changes.filter((c) => c.replacement)
  if (replaced.length > 0) warnings.push(`These will be replaced (deleted and created again, losing their data): ${replaced.map((c) => c.logicalId).join(', ')}.`)
  if (remove > 0) warnings.push(`${remove} resource${remove === 1 ? '' : 's'} will be deleted.`)
  if (plan.changes.some((c) => c.type.startsWith('Custom::'))) warnings.push('The ACXD resources are created or updated by the provisioner while the stack deploys.')
  return {
    headline: `${plan.type === 'CREATE' ? 'Create' : 'Update'} stack ${plan.stackName}: ${parts.join(', ') || 'no resource changes'}.`,
    warnings,
    rows: plan.changes.map((c) => ({ action: c.action, logicalId: c.logicalId, type: c.type })),
  }
}

export interface ConfirmState {
  typedName: string
  reviewed: boolean
}

/** The deploy button is enabled only with a previewed plan, the stack name typed back, and the review ticked. */
export function canExecute(plan: PlanResult | null, confirm: ConfirmState): boolean {
  return plan?.status === 'ready' && confirm.typedName === plan.stackName && confirm.reviewed
}

export interface PhaseView {
  label: string
  tone: 'working' | 'good' | 'bad' | 'neutral'
  finished: boolean
}

export function phaseView(phase: StackPhase): PhaseView {
  switch (phase) {
    case 'working': return { label: 'Deploying…', tone: 'working', finished: false }
    case 'done': return { label: 'Deployed', tone: 'good', finished: true }
    case 'failed': return { label: 'Failed', tone: 'bad', finished: true }
    case 'deleted': return { label: 'Deleted', tone: 'neutral', finished: true }
    case 'not_found': return { label: 'Not found', tone: 'neutral', finished: true }
  }
}

/** Ids the next step needs. The application id is a stack output; the workspace id the consultant already gave. */
export function connectPrefill(status: StackStatus | null): { workspaceId: string; applicationId: string } | null {
  const out = status?.outputs
  if (!out?.AcxdApplicationId) return null
  return { workspaceId: out.AcxdWorkspaceId ?? '', applicationId: out.AcxdApplicationId }
}

// ---- orchestration (the client is injected, so it runs against a fake in tests) ---------------------------------------

export type PreviewResult = { ok: true; plan: PlanResult } | { ok: false; errors: string[] }

export async function previewChanges(client: DeployerClient, form: DeployForm, template: DeployableTemplate): Promise<PreviewResult> {
  const errors = validateDeployForm(form, template)
  if (errors.length > 0) return { ok: false, errors }
  try {
    const plan = await client.plan({ targetId: form.targetId, stackName: form.stackName, template, parameters: buildParameters(form, template) })
    return { ok: true, plan }
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : 'Could not preview the changes.'] }
  }
}

export async function executePlan(client: DeployerClient, form: DeployForm, plan: PlanResult, confirm: ConfirmState): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  if (!canExecute(plan, confirm) || plan.status !== 'ready') return { ok: false, errors: ['Type the stack name and tick the review box before deploying.'] }
  try {
    await client.execute({ targetId: form.targetId, stackName: plan.stackName, changeSetId: plan.changeSetId, token: plan.token })
    return { ok: true }
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : 'Could not start the deployment.'] }
  }
}

export interface WatchOptions {
  sleep?: (ms: number) => Promise<void>
  /** Poll interval in ms. */
  intervalMs?: number
  /** Give up watching (the stack keeps deploying) after this many polls. */
  maxPolls?: number
  onUpdate?: (status: StackStatus) => void
  isCancelled?: () => boolean
}

/** Polls until the stack finishes, fails, or the caller stops. Never throws: a polling hiccup is retried. */
export async function watchStack(client: DeployerClient, ref: { targetId: string; stackName: string }, opts: WatchOptions = {}): Promise<StackStatus | null> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const max = opts.maxPolls ?? 360
  let last: StackStatus | null = null
  let misses = 0
  for (let i = 0; i < max; i++) {
    if (opts.isCancelled?.()) return last
    try {
      last = await client.status(ref)
      misses = 0
      opts.onUpdate?.(last)
      if (phaseView(last.phase).finished) return last
    } catch {
      misses += 1
      if (misses >= 5) return last
    }
    await sleep(opts.intervalMs ?? 5000)
  }
  return last
}
