import { describe, it, expect } from 'vitest'
import { createDeployerClient } from './client'
import type { DeployerClient, PlanResult, StackStatus } from './client'
import {
  buildParameters, canExecute, connectPrefill, describePlan, executePlan, phaseView, previewChanges, suggestStackName, validateDeployForm, watchStack,
} from './controller'
import type { DeployForm, DeployableTemplate } from './controller'

const template: DeployableTemplate = {
  Parameters: {
    AcxdWorkspaceId: { Type: 'String' },
    AcxdApiKeySecretArn: { Type: 'String' },
    ProvisionerCodeBucket: { Type: 'String' },
    ProvisionerCodeKey: { Type: 'String' },
    TableName: { Type: 'String', Default: 'x' },
  },
}
const form = (extra: Partial<DeployForm> = {}): DeployForm => ({
  url: 'https://deployer.example.test',
  token: 'tok',
  targetId: 't1',
  stackName: 'edith-census',
  workspaceId: 'ws-1',
  apiKeySecretArn: 'arn:aws:secretsmanager:us-east-1:111122223333:secret:acxd-key-AbCdEf',
  tableName: 'CensusIds',
  ...extra,
})
const ready = (extra: Partial<Extract<PlanResult, { status: 'ready' }>> = {}): PlanResult => ({
  status: 'ready', stackName: 'edith-census', changeSetId: 'cs-1', type: 'CREATE', token: 'signed', counts: { add: 2, modify: 0, remove: 0 }, expiresInMinutes: 15,
  changes: [{ action: 'Add', logicalId: 'RespondentsTable', type: 'AWS::DynamoDB::Table', replacement: false }, { action: 'Add', logicalId: 'AcxdProvision', type: 'Custom::AcxdProvision', replacement: false }],
  ...extra,
})

/** A fake deployer that records every call. */
function fakeClient(over: Partial<DeployerClient> = {}): DeployerClient & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = []
  const c: DeployerClient = {
    targets: async () => (calls.push(['targets', null]), [{ id: 't1', label: 'Sandbox', region: 'us-east-1' }]),
    plan: async (b) => (calls.push(['plan', b]), ready()),
    execute: async (b) => void calls.push(['execute', b]),
    status: async (b) => (calls.push(['status', b]), { stackName: b.stackName, phase: 'done' as const }),
    cancel: async (b) => void calls.push(['cancel', b]),
    remove: async (b) => void calls.push(['remove', b]),
    ...over,
  }
  return Object.assign(c, { calls })
}

describe('stack names and form checks', () => {
  it('suggests a valid name from the journey title', () => {
    expect(suggestStackName('2030 Census Questionnaire Assistance (CQA) demo')).toBe('edith-2030-census-questionnaire-assistance-cqa-demo')
    expect(suggestStackName('!!!')).toBe('edith-journey')
    expect(suggestStackName('x'.repeat(200)).length).toBeLessThanOrEqual(56)
  })

  it('accepts a complete form', () => {
    expect(validateDeployForm(form(), template)).toEqual([])
  })

  it('reports every problem at once', () => {
    const errors = validateDeployForm(form({ url: 'http://evil.test', token: '', targetId: '', stackName: 'census', workspaceId: '', tableName: 'x' }), template)
    expect(errors.length).toBeGreaterThanOrEqual(6)
  })

  it('refuses an ACXD API key where a secret ARN is expected', () => {
    const errors = validateDeployForm(form({ apiKeySecretArn: 'acxd_live_abc123.secret' }), template)
    expect(errors.join(' ')).toContain('Do not paste the key')
    expect(errors.join(' ')).toContain('looks like an ACXD API key')
  })

  it('refuses a template that still has a secret parameter', () => {
    const t: DeployableTemplate = { Parameters: { ...template.Parameters, AcxdApiKey: { NoEcho: true } } }
    expect(validateDeployForm(form(), t).join(' ')).toContain('secret parameter')
  })
})

describe('parameters', () => {
  it('sends only declared parameters and never the ones the tool fills in', () => {
    expect(buildParameters(form(), template)).toEqual({
      AcxdWorkspaceId: 'ws-1',
      AcxdApiKeySecretArn: 'arn:aws:secretsmanager:us-east-1:111122223333:secret:acxd-key-AbCdEf',
      TableName: 'CensusIds',
    })
    expect(buildParameters(form(), { Parameters: { AcxdWorkspaceId: {} } })).toEqual({ AcxdWorkspaceId: 'ws-1' })
  })
})

describe('reviewing the plan', () => {
  it('summarises what will be created', () => {
    const v = describePlan(ready())
    expect(v.headline).toBe('Create stack edith-census: 2 to create.')
    expect(v.rows).toHaveLength(2)
    expect(v.warnings.join(' ')).toContain('provisioner')
  })
  it('warns about replacements and deletions', () => {
    const v = describePlan(ready({ type: 'UPDATE', counts: { add: 0, modify: 1, remove: 1 }, changes: [{ action: 'Modify', logicalId: 'RespondentsTable', type: 'AWS::DynamoDB::Table', replacement: true }] }))
    expect(v.headline.startsWith('Update')).toBe(true)
    expect(v.warnings.join(' ')).toContain('losing their data')
    expect(v.warnings.join(' ')).toContain('will be deleted')
  })
  it('says so when there is nothing to change', () => {
    expect(describePlan({ status: 'no_changes', stackName: 's' }).headline).toContain('Nothing to change')
  })
})

describe('the confirmation gate', () => {
  const plan = ready()
  it('needs the plan, the typed stack name and the ticked review', () => {
    expect(canExecute(plan, { typedName: 'edith-census', reviewed: true })).toBe(true)
    expect(canExecute(plan, { typedName: 'edith-cens', reviewed: true })).toBe(false)
    expect(canExecute(plan, { typedName: 'edith-census', reviewed: false })).toBe(false)
    expect(canExecute(null, { typedName: 'edith-census', reviewed: true })).toBe(false)
    expect(canExecute({ status: 'no_changes', stackName: 'edith-census' }, { typedName: 'edith-census', reviewed: true })).toBe(false)
  })

  it('never calls execute without the confirmation', async () => {
    const c = fakeClient()
    const r = await executePlan(c, form(), plan, { typedName: '', reviewed: true })
    expect(r.ok).toBe(false)
    expect(c.calls.filter(([n]) => n === 'execute')).toHaveLength(0)
  })

  it('executes the previewed change set with its signed token', async () => {
    const c = fakeClient()
    const r = await executePlan(c, form(), plan, { typedName: 'edith-census', reviewed: true })
    expect(r.ok).toBe(true)
    expect(c.calls.find(([n]) => n === 'execute')![1]).toEqual({ targetId: 't1', stackName: 'edith-census', changeSetId: 'cs-1', token: 'signed' })
  })

  it('reports a refusal from the server', async () => {
    const c = fakeClient({ execute: async () => { throw new Error('The confirmation expired. Preview the changes again.') } })
    const r = await executePlan(c, form(), plan, { typedName: 'edith-census', reviewed: true })
    expect(!r.ok && r.errors[0]).toContain('expired')
  })
})

describe('previewChanges', () => {
  it('sends the template and the declared parameters to the planner', async () => {
    const c = fakeClient()
    const r = await previewChanges(c, form(), template)
    expect(r.ok).toBe(true)
    const sent = c.calls.find(([n]) => n === 'plan')![1] as { parameters: Record<string, string>; template: unknown }
    expect(sent.template).toBe(template)
    expect(Object.keys(sent.parameters).sort()).toEqual(['AcxdApiKeySecretArn', 'AcxdWorkspaceId', 'TableName'])
  })
  it('does not call the server when the form is invalid', async () => {
    const c = fakeClient()
    const r = await previewChanges(c, form({ stackName: 'bad' }), template)
    expect(r.ok).toBe(false)
    expect(c.calls).toHaveLength(0)
  })
  it('turns a server error into a message', async () => {
    const c = fakeClient({ plan: async () => { throw new Error('This template is not one the tool may deploy: x') } })
    const r = await previewChanges(c, form(), template)
    expect(!r.ok && r.errors[0]).toContain('may deploy')
  })
})

describe('watching a stack', () => {
  const statuses = (...phases: StackStatus['phase'][]) => {
    let i = 0
    const client = fakeClient({ status: async (b) => (client.calls.push(['status', b]), { stackName: b.stackName, phase: phases[Math.min(i++, phases.length - 1)] }) })
    return client
  }
  const noSleep = { sleep: async () => {} }

  it('polls until the stack finishes and reports each update', async () => {
    const seen: string[] = []
    const out = await watchStack(statuses('working', 'working', 'done'), { targetId: 't1', stackName: 's' }, { ...noSleep, onUpdate: (s) => seen.push(s.phase) })
    expect(out?.phase).toBe('done')
    expect(seen).toEqual(['working', 'working', 'done'])
  })
  it('stops on a failure', async () => {
    expect((await watchStack(statuses('working', 'failed'), { targetId: 't1', stackName: 's' }, noSleep))?.phase).toBe('failed')
  })
  it('retries a hiccup but gives up after repeated errors', async () => {
    let n = 0
    const flaky = fakeClient({ status: async (b) => { if (n++ < 2) throw new Error('net'); return { stackName: b.stackName, phase: 'done' as const } } })
    expect((await watchStack(flaky, { targetId: 't1', stackName: 's' }, noSleep))?.phase).toBe('done')
    const dead = fakeClient({ status: async () => { throw new Error('net') } })
    expect(await watchStack(dead, { targetId: 't1', stackName: 's' }, noSleep)).toBeNull()
  })
  it('stops when asked and when it has polled enough', async () => {
    const c = statuses('working')
    const out = await watchStack(c, { targetId: 't1', stackName: 's' }, { ...noSleep, maxPolls: 3 })
    expect(out?.phase).toBe('working')
    expect(c.calls.filter(([n]) => n === 'status')).toHaveLength(3)
    let cancelled = false
    const c2 = statuses('working')
    await watchStack(c2, { targetId: 't1', stackName: 's' }, { ...noSleep, onUpdate: () => { cancelled = true }, isCancelled: () => cancelled })
    expect(c2.calls.filter(([n]) => n === 'status')).toHaveLength(1)
  })
})

describe('outputs and phases', () => {
  it('prefills the Connect flow from the stack outputs', () => {
    expect(connectPrefill({ stackName: 's', phase: 'done', outputs: { AcxdApplicationId: 'app-1', AcxdWorkspaceId: 'ws-1' } })).toEqual({ workspaceId: 'ws-1', applicationId: 'app-1' })
    expect(connectPrefill({ stackName: 's', phase: 'done', outputs: {} })).toBeNull()
    expect(connectPrefill(null)).toBeNull()
  })
  it('labels each phase', () => {
    expect(phaseView('working').finished).toBe(false)
    expect(phaseView('done')).toMatchObject({ label: 'Deployed', tone: 'good', finished: true })
    expect(phaseView('failed').tone).toBe('bad')
  })
})

describe('deployer client', () => {
  const answer = (status: number, body: unknown) => (async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response) as unknown as typeof fetch

  it('sends the bearer token and JSON, and reads the reply', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return { ok: true, status: 200, json: async () => ({ status: 'no_changes', stackName: 's' }) } as unknown as Response
    }) as unknown as typeof fetch
    const out = await createDeployerClient({ url: 'https://d.test/', token: 'tok', fetchImpl }).plan({ targetId: 't', stackName: 's', template: {}, parameters: {} })
    expect(out.status).toBe('no_changes')
    expect(seen!.url).toBe('https://d.test/plan')
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })
  it('lists targets with a GET', async () => {
    let method = ''
    const fetchImpl = (async (_u: string, init: RequestInit) => { method = String(init.method); return { ok: true, status: 200, json: async () => ({ targets: [{ id: 'a', label: 'A', region: 'r' }] }) } as unknown as Response }) as unknown as typeof fetch
    expect(await createDeployerClient({ url: 'https://d.test', token: 't', fetchImpl }).targets()).toHaveLength(1)
    expect(method).toBe('GET')
  })
  it('shows the server message, a network failure and a timeout', async () => {
    await expect(createDeployerClient({ url: 'u', token: 't', fetchImpl: answer(403, { error: 'The confirmation expired. Preview the changes again.' }) }).status({ targetId: 't', stackName: 's' })).rejects.toThrow('expired')
    const down = (async () => { throw new TypeError('x') }) as unknown as typeof fetch
    await expect(createDeployerClient({ url: 'u', token: 't', fetchImpl: down }).targets()).rejects.toThrow('Could not reach')
    const slow = (async () => { throw Object.assign(new Error('a'), { name: 'AbortError' }) }) as unknown as typeof fetch
    await expect(createDeployerClient({ url: 'u', token: 't', fetchImpl: slow }).targets()).rejects.toThrow('too long')
  })
})
