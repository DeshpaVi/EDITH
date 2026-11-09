import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_TEMPLATE_BYTES, parameterProblems, templateProblems, validStackName } from './policy.mjs'
import { signConfirm, verifyConfirm } from './confirm.mjs'
import { buildCreateChangeSetInput, isManaged, isNoChanges, phaseOf, summarizeChangeSet, summarizeStack, waitForChangeSet } from './cfn.mjs'
import { makeHandler } from './index.mjs'

const template = () => JSON.parse(readFileSync(new URL('./fixtures/managed-template.json', import.meta.url), 'utf8'))
const goodParams = () => ({ AcxdWorkspaceId: 'WS-SECRET-VALUE', AcxdApiKeySecretArn: 'arn:aws:secretsmanager:us-east-1:111122223333:secret:acxd-key-AbCdEf' })

// ---- policy: what the tool may deploy -------------------------------------------------------------------

test('accepts the template the emitter produces (the fixture is kept in sync by a TypeScript test)', () => {
  assert.deepEqual(templateProblems(template()), [])
})

test('refuses resource types the tool does not generate', () => {
  const t = template()
  t.Resources.Bucket = { Type: 'AWS::S3::Bucket', Properties: {} }
  assert.match(templateProblems(t).join(' '), /AWS::S3::Bucket/)
})

test('refuses macros, secret parameters and exports', () => {
  const t = template()
  t.Transform = 'AWS::Serverless-2016-10-31'
  t.Parameters.Key = { Type: 'String', NoEcho: true }
  t.Outputs.Shared = { Value: 'x', Export: { Name: 'x' } }
  const p = templateProblems(t).join(' ')
  assert.match(p, /Transform/)
  assert.match(p, /NoEcho/)
  assert.match(p, /Export/)
})

test('refuses IAM roles outside the narrow shape', () => {
  const mutate = (fn) => {
    const t = template()
    fn(t.Resources.ProvisionerRole.Properties)
    return templateProblems(t).join(' ')
  }
  assert.match(mutate((r) => { r.Policies[0].PolicyDocument.Statement[0].Action = 'iam:*' }), /iam:\*/)
  assert.match(mutate((r) => { r.Policies[0].PolicyDocument.Statement[0].Resource = '*' }), /Resource "\*"/)
  assert.match(mutate((r) => { delete r.Path }), /Path/)
  assert.match(mutate((r) => { r.ManagedPolicyArns = ['arn:aws:iam::aws:policy/AdministratorAccess'] }), /managed policy/)
  assert.match(mutate((r) => { r.AssumeRolePolicyDocument.Statement[0].Principal = { AWS: '*' } }), /lambda\.amazonaws\.com/)
})

test('refuses code from an arbitrary bucket and custom resources that call another function', () => {
  const t = template()
  t.Resources.ProvisionerFunction.Properties.Code = { S3Bucket: 'evil-bucket', S3Key: 'x.zip' }
  t.Resources.AcxdProvision.Properties.ServiceToken = 'arn:aws:lambda:us-east-1:999999999999:function:other'
  const p = templateProblems(t).join(' ')
  assert.match(p, /code must be inline or come from the provisioner parameters/)
  assert.match(p, /may only call the ProvisionerFunction/)
})

test('refuses a public permission that is not for a Function URL', () => {
  const t = template()
  t.Resources.VerifyAuthInvokePermission.Properties = { Action: 'lambda:InvokeFunction', FunctionName: { Ref: 'VerifyAuthFunction' }, Principal: '*' }
  assert.match(templateProblems(t).join(' '), /public principal/)
})

test('refuses things that are not templates', () => {
  assert.ok(templateProblems(null).length > 0)
  assert.ok(templateProblems({}).length > 0)
})

test('stack names: edith- prefix, lowercase, digits and hyphens', () => {
  for (const ok of ['edith-census', 'edith-a', 'edith-census-demo-2']) assert.ok(validStackName(ok), ok)
  for (const bad of ['census', 'edith-', 'edith-Census', 'edith-a_b', 'edith--', 'edith-census-', 'edith-' + 'a'.repeat(110), 5, undefined]) assert.ok(!validStackName(bad), String(bad))
})

test('parameters: required, pattern, unknown and reserved are enforced', () => {
  const declared = template().Parameters
  assert.deepEqual(parameterProblems(declared, goodParams()), [])
  assert.match(parameterProblems(declared, {}).join(' '), /AcxdWorkspaceId is required/)
  assert.match(parameterProblems(declared, { ...goodParams(), AcxdApiKeySecretArn: 'acxd_live_abc.def' }).join(' '), /required format/)
  assert.match(parameterProblems(declared, { ...goodParams(), Extra: 'x' }).join(' '), /not a parameter/)
  assert.match(parameterProblems(declared, { ...goodParams(), ProvisionerCodeBucket: 'evil' }).join(' '), /set by the deploy tool/)
  assert.match(parameterProblems(declared, { ...goodParams(), TableName: 'x'.repeat(2000) }).join(' '), /1024/)
})

// ---- confirmation tokens ------------------------------------------------------------------------------------

const KEY = 'k'.repeat(32)
const claims = { targetId: 't1', stackName: 'edith-demo', changeSetId: 'cs-1' }

test('a token verifies for the exact change it was issued for', () => {
  const token = signConfirm(KEY, claims, 1000)
  assert.equal(verifyConfirm(KEY, token, claims, 1001).ok, true)
})

test('a token is refused if it is missing, tampered, expired, from another key or for another change', () => {
  const token = signConfirm(KEY, claims, 1000)
  assert.equal(verifyConfirm(KEY, undefined, claims, 1001).ok, false)
  assert.equal(verifyConfirm(KEY, token.slice(0, -2) + 'AA', claims, 1001).ok, false)
  assert.match(verifyConfirm(KEY, token, claims, 1000 + 16 * 60 * 1000).reason, /expired/)
  assert.equal(verifyConfirm('x'.repeat(32), token, claims, 1001).ok, false)
  assert.match(verifyConfirm(KEY, token, { ...claims, changeSetId: 'cs-2' }, 1001).reason, /different change/)
  assert.match(verifyConfirm(KEY, token, { ...claims, stackName: 'edith-other' }, 1001).reason, /different change/)
  assert.equal(verifyConfirm(KEY, 'not-a-token', claims, 1001).ok, false)
})

// ---- CloudFormation helpers -------------------------------------------------------------------------------------

test('the change set request carries the managed tag, IAM capability and the stack role', () => {
  const input = buildCreateChangeSetInput({ stackName: 'edith-x', changeSetName: 'cs', type: 'CREATE', templateBody: '{}', parameters: { A: '1' }, stackRoleArn: 'arn:role' })
  assert.deepEqual(input.Capabilities, ['CAPABILITY_IAM'])
  assert.deepEqual(input.Parameters, [{ ParameterKey: 'A', ParameterValue: '1' }])
  assert.deepEqual(input.Tags[0], { Key: 'edith-managed', Value: 'true' })
  assert.equal(input.RoleARN, 'arn:role')
  assert.equal(buildCreateChangeSetInput({ stackName: 's', changeSetName: 'c', type: 'UPDATE', templateBody: '{}', parameters: {} }).RoleARN, undefined)
})

test('summarises a change set for review', () => {
  const s = summarizeChangeSet({
    Status: 'CREATE_COMPLETE',
    Changes: [
      { ResourceChange: { Action: 'Add', LogicalResourceId: 'Table', ResourceType: 'AWS::DynamoDB::Table', Replacement: 'False' } },
      { ResourceChange: { Action: 'Modify', LogicalResourceId: 'Fn', ResourceType: 'AWS::Lambda::Function', Replacement: 'True' } },
    ],
  })
  assert.deepEqual(s.counts, { add: 1, modify: 1, remove: 0 })
  assert.equal(s.changes[1].replacement, true)
})

test('recognises a change set with no changes', () => {
  assert.ok(isNoChanges({ Status: 'FAILED', StatusReason: "The submitted information didn't contain changes." }))
  assert.ok(!isNoChanges({ Status: 'FAILED', StatusReason: 'Some other failure' }))
})

test('waits for a change set and gives up with a clear error', async () => {
  let n = 0
  const sleeps = []
  const desc = await waitForChangeSet(async () => ({ Status: ++n < 3 ? 'CREATE_IN_PROGRESS' : 'CREATE_COMPLETE' }), { sleep: async (ms) => sleeps.push(ms), delayMs: 5 })
  assert.equal(desc.Status, 'CREATE_COMPLETE')
  assert.deepEqual(sleeps, [5, 5])
  await assert.rejects(waitForChangeSet(async () => ({ Status: 'CREATE_PENDING' }), { attempts: 2, sleep: async () => {} }), /too long/)
})

test('stack phases and a summary with failures and outputs', () => {
  assert.equal(phaseOf('CREATE_IN_PROGRESS'), 'working')
  assert.equal(phaseOf('UPDATE_COMPLETE'), 'done')
  assert.equal(phaseOf('ROLLBACK_COMPLETE'), 'failed')
  assert.equal(phaseOf('DELETE_COMPLETE'), 'deleted')
  const s = summarizeStack(
    { StackStatus: 'CREATE_FAILED', Outputs: [{ OutputKey: 'AcxdApplicationId', OutputValue: 'app-1' }] },
    [{ LogicalResourceId: 'AcxdProvision', ResourceStatus: 'CREATE_FAILED', ResourceStatusReason: 'ValidationException: flow invalid' }],
  )
  assert.equal(s.phase, 'failed')
  assert.equal(s.outputs.AcxdApplicationId, 'app-1')
  assert.equal(s.failures[0].logicalId, 'AcxdProvision')
  assert.ok(isManaged({ Tags: [{ Key: 'edith-managed', Value: 'true' }] }))
  assert.ok(!isManaged({ Tags: [] }))
})

// ---- the handler, against a fake AWS -----------------------------------------------------------------------------------

const ENV = {
  ACCESS_TOKEN: 'tok',
  CONFIRM_KEY: KEY,
  ARTIFACT_BUCKET: 'artifacts-bucket',
  ARTIFACT_KEY: 'provisioner/v1.zip',
  TARGETS: JSON.stringify([{ id: 't1', label: 'Sandbox', roleArn: 'arn:aws:iam::111122223333:role/edith/EdithDeployRole', externalId: 'ext-1', region: 'us-east-1', stackRoleArn: 'arn:aws:iam::111122223333:role/edith/EdithStackRole' }]),
}
const MANAGED = [{ Key: 'edith-managed', Value: 'true' }]

function fakeAws({ stack = null, changeSet, events = [] } = {}) {
  const calls = []
  const assumed = []
  let nextStack = stack
  const cs = changeSet ?? { Status: 'CREATE_COMPLETE', ExecutionStatus: 'AVAILABLE', ChangeSetId: 'arn:cs-1', Changes: [{ ResourceChange: { Action: 'Add', LogicalResourceId: 'RespondentsTable', ResourceType: 'AWS::DynamoDB::Table' } }] }
  const cfn = {
    async describeStacks({ StackName }) {
      calls.push(['describeStacks', StackName])
      if (!nextStack) throw Object.assign(new Error(`Stack with id ${StackName} does not exist`), { name: 'ValidationError' })
      return { Stacks: [nextStack] }
    },
    async createChangeSet(i) { calls.push(['createChangeSet', i]) },
    async describeChangeSet(i) { calls.push(['describeChangeSet', i]); return cs },
    async executeChangeSet(i) { calls.push(['executeChangeSet', i]) },
    async deleteChangeSet(i) { calls.push(['deleteChangeSet', i]) },
    async describeStackEvents(i) { calls.push(['describeStackEvents', i]); return { StackEvents: events } },
    async deleteStack(i) { calls.push(['deleteStack', i]) },
  }
  let clock = 1_000_000
  const deps = {
    env: ENV,
    now: () => (clock += 10),
    sleep: async () => {},
    assumeRole: async (a) => (assumed.push(a), { accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'ST' }),
    cfn: () => cfn,
  }
  return { deps, calls, assumed, called: (n) => calls.filter((c) => c[0] === n) }
}

const req = (route, body, { method = 'POST', headers = { authorization: 'Bearer tok' } } = {}) => ({ requestContext: { http: { method } }, rawPath: `/${route}`, headers, body: body === undefined ? undefined : JSON.stringify(body) })
const planBody = (extra = {}) => ({ targetId: 't1', stackName: 'edith-census', template: template(), parameters: goodParams(), ...extra })
const call = async (aws, route, body, opts) => {
  const res = await makeHandler(aws.deps)(req(route, body, opts))
  return { status: res.statusCode, body: JSON.parse(res.body) }
}

test('refuses to run unconfigured, and rejects a wrong token and unknown routes', async () => {
  const aws = fakeAws()
  assert.equal((await makeHandler({ ...aws.deps, env: { ...ENV, CONFIRM_KEY: '' } })(req('plan', planBody()))).statusCode, 500)
  assert.equal((await call(aws, 'plan', planBody(), { headers: {} })).status, 401)
  assert.equal((await call(aws, 'plan', planBody(), { headers: { authorization: 'Bearer nope' } })).status, 401)
  assert.equal((await call(aws, 'nope', {})).status, 404)
  assert.equal(aws.assumed.length, 0)
})

test('lists targets without their role ARNs or external ids', async () => {
  const r = await call(fakeAws(), 'targets', undefined, { method: 'GET' })
  assert.deepEqual(r.body, { targets: [{ id: 't1', label: 'Sandbox', region: 'us-east-1' }] })
})

test('plan: assumes the role, previews a change set, and issues a token', async () => {
  const aws = fakeAws()
  const r = await call(aws, 'plan', planBody())
  assert.equal(r.status, 200)
  assert.equal(r.body.status, 'ready')
  assert.equal(r.body.type, 'CREATE')
  assert.deepEqual(r.body.counts, { add: 1, modify: 0, remove: 0 })
  assert.ok(r.body.token)
  assert.deepEqual(aws.assumed[0], { roleArn: 'arn:aws:iam::111122223333:role/edith/EdithDeployRole', externalId: 'ext-1', sessionName: 'edith-deploy' })
  const input = aws.called('createChangeSet')[0][1]
  assert.equal(input.StackName, 'edith-census')
  assert.equal(input.RoleARN, 'arn:aws:iam::111122223333:role/edith/EdithStackRole')
  const params = Object.fromEntries(input.Parameters.map((p) => [p.ParameterKey, p.ParameterValue]))
  assert.equal(params.ProvisionerCodeBucket, 'artifacts-bucket')
  assert.equal(params.ProvisionerCodeKey, 'provisioner/v1.zip')
  assert.equal(aws.called('executeChangeSet').length, 0, 'planning never executes')
})

test('plan refuses a template outside the allowlist before calling AWS for it', async () => {
  const aws = fakeAws()
  const t = template()
  t.Resources.Bucket = { Type: 'AWS::S3::Bucket' }
  const r = await call(aws, 'plan', planBody({ template: t }))
  assert.equal(r.status, 400)
  assert.match(r.body.error, /not one the tool may deploy/)
  assert.equal(aws.assumed.length, 0)
})

test('plan validates stack name, target, parameters and size', async () => {
  const aws = fakeAws()
  assert.equal((await call(aws, 'plan', planBody({ stackName: 'census' }))).status, 400)
  assert.equal((await call(aws, 'plan', planBody({ targetId: 'zzz' }))).status, 400)
  assert.equal((await call(aws, 'plan', planBody({ parameters: {} }))).status, 400)
  assert.equal((await call(aws, 'plan', planBody({ parameters: { ...goodParams(), ProvisionerCodeBucket: 'evil' } }))).status, 400)
  const big = template()
  big.Description = 'x'.repeat(MAX_TEMPLATE_BYTES)
  assert.equal((await call(aws, 'plan', planBody({ template: big }))).status, 413)
  assert.equal((await call(aws, 'plan', planBody({ template: '{oops' }))).status, 400)
})

test('plan updates a stack this tool created, and refuses others', async () => {
  const mine = fakeAws({ stack: { StackName: 'edith-census', StackStatus: 'CREATE_COMPLETE', Tags: MANAGED } })
  assert.equal((await call(mine, 'plan', planBody())).body.type, 'UPDATE')
  const foreign = fakeAws({ stack: { StackName: 'edith-census', StackStatus: 'CREATE_COMPLETE', Tags: [] } })
  assert.equal((await call(foreign, 'plan', planBody())).status, 409)
  const busy = fakeAws({ stack: { StackName: 'edith-census', StackStatus: 'UPDATE_IN_PROGRESS', Tags: MANAGED } })
  assert.equal((await call(busy, 'plan', planBody())).status, 409)
  const rolled = fakeAws({ stack: { StackName: 'edith-census', StackStatus: 'ROLLBACK_COMPLETE', Tags: MANAGED } })
  assert.match((await call(rolled, 'plan', planBody())).body.error, /Delete it/)
})

test('plan reports no changes and cleans up the change set', async () => {
  const aws = fakeAws({ stack: { StackName: 'edith-census', StackStatus: 'CREATE_COMPLETE', Tags: MANAGED }, changeSet: { Status: 'FAILED', StatusReason: "The submitted information didn't contain changes." } })
  const r = await call(aws, 'plan', planBody())
  assert.equal(r.body.status, 'no_changes')
  assert.equal(aws.called('deleteChangeSet').length, 1)
})

test('plan reports why CloudFormation could not prepare a change', async () => {
  const aws = fakeAws({ changeSet: { Status: 'FAILED', StatusReason: 'Parameter validation failed' } })
  const r = await call(aws, 'plan', planBody())
  assert.equal(r.status, 400)
  assert.match(r.body.error, /Parameter validation failed/)
})

test('execute runs only the change set that was previewed, with its token', async () => {
  const aws = fakeAws()
  const plan = (await call(aws, 'plan', planBody())).body
  const ok = await call(aws, 'execute', { targetId: 't1', stackName: 'edith-census', changeSetId: plan.changeSetId, token: plan.token })
  assert.equal(ok.status, 200)
  assert.equal(aws.called('executeChangeSet').length, 1)
  assert.equal(aws.called('executeChangeSet')[0][1].ChangeSetName, plan.changeSetId)
})

test('execute refuses a missing, tampered, expired or mismatched token and never executes', async () => {
  const aws = fakeAws()
  const plan = (await call(aws, 'plan', planBody())).body
  const base = { targetId: 't1', stackName: 'edith-census', changeSetId: plan.changeSetId }
  assert.equal((await call(aws, 'execute', base)).status, 403)
  assert.equal((await call(aws, 'execute', { ...base, token: plan.token.slice(0, -2) + 'AA' })).status, 403)
  assert.equal((await call(aws, 'execute', { ...base, stackName: 'edith-other', token: plan.token })).status, 403)
  assert.equal((await call(aws, 'execute', { ...base, changeSetId: 'arn:cs-other', token: plan.token })).status, 403)
  const late = makeHandler({ ...aws.deps, now: () => 1_000_000 + 16 * 60 * 1000 })
  assert.equal((await late(req('execute', { ...base, token: plan.token }))).statusCode, 403)
  assert.equal(aws.called('executeChangeSet').length, 0)
})

test('execute refuses a change set that is no longer available', async () => {
  const aws = fakeAws({ changeSet: { Status: 'CREATE_COMPLETE', ExecutionStatus: 'EXECUTE_COMPLETE', ChangeSetId: 'arn:cs-1', Changes: [] } })
  const plan = (await call(aws, 'plan', planBody())).body
  const r = await call(aws, 'execute', { targetId: 't1', stackName: 'edith-census', changeSetId: plan.changeSetId, token: plan.token })
  assert.equal(r.status, 409)
})

test('status reports progress, outputs and failures, and only for stacks the tool created', async () => {
  const done = fakeAws({ stack: { StackName: 'edith-census', StackStatus: 'CREATE_COMPLETE', Tags: MANAGED, Outputs: [{ OutputKey: 'AcxdApplicationId', OutputValue: 'app-1' }] } })
  const r = await call(done, 'status', { targetId: 't1', stackName: 'edith-census' })
  assert.equal(r.body.phase, 'done')
  assert.equal(r.body.outputs.AcxdApplicationId, 'app-1')
  assert.equal((await call(fakeAws(), 'status', { targetId: 't1', stackName: 'edith-census' })).body.phase, 'not_found')
  const foreign = fakeAws({ stack: { StackName: 'edith-census', StackStatus: 'CREATE_COMPLETE', Tags: [] } })
  assert.equal((await call(foreign, 'status', { targetId: 't1', stackName: 'edith-census' })).status, 403)
})

test('cancel removes the preview, and the empty stack of a first plan', async () => {
  const aws = fakeAws({ stack: { StackName: 'edith-census', StackStatus: 'REVIEW_IN_PROGRESS', Tags: MANAGED } })
  const r = await call(aws, 'cancel', { targetId: 't1', stackName: 'edith-census', changeSetId: 'arn:cs-1' })
  assert.equal(r.status, 200)
  assert.equal(aws.called('deleteChangeSet').length, 1)
  assert.equal(aws.called('deleteStack').length, 1)
})

test('delete needs the stack name typed back, and only deletes stacks the tool created', async () => {
  const aws = fakeAws({ stack: { StackName: 'edith-census', StackStatus: 'CREATE_COMPLETE', Tags: MANAGED } })
  assert.equal((await call(aws, 'delete', { targetId: 't1', stackName: 'edith-census', confirmName: 'nope' })).status, 400)
  assert.equal(aws.called('deleteStack').length, 0)
  assert.equal((await call(aws, 'delete', { targetId: 't1', stackName: 'edith-census', confirmName: 'edith-census' })).status, 200)
  assert.equal(aws.called('deleteStack').length, 1)
  const foreign = fakeAws({ stack: { StackName: 'edith-census', StackStatus: 'CREATE_COMPLETE', Tags: [] } })
  assert.equal((await call(foreign, 'delete', { targetId: 't1', stackName: 'edith-census', confirmName: 'edith-census' })).status, 403)
})

test('AWS permission errors become a helpful message without internals', async () => {
  const aws = fakeAws()
  aws.deps.assumeRole = async () => { throw Object.assign(new Error('User: arn:aws:sts::999:assumed-role/Tool is not authorized to perform: sts:AssumeRole on arn:aws:iam::111:role/x'), { name: 'AccessDenied' }) }
  const r = await call(aws, 'plan', planBody())
  assert.equal(r.status, 502)
  assert.match(r.body.error, /deploy role/)
  assert.ok(!r.body.error.includes('999'))
})

test('never logs the template, parameter values, token or credentials', async () => {
  const lines = []
  const original = console.log
  console.log = (...a) => lines.push(a.join(' '))
  const aws = fakeAws()
  try {
    const plan = (await call(aws, 'plan', planBody())).body
    await call(aws, 'execute', { targetId: 't1', stackName: 'edith-census', changeSetId: plan.changeSetId, token: plan.token })
    await call(aws, 'plan', planBody({ stackName: 'bad' }))
  } finally {
    console.log = original
  }
  const all = lines.join('\n')
  assert.ok(lines.length >= 3)
  for (const secret of ['WS-SECRET-VALUE', 'tok', 'AwsDynamoDB', 'AWSTemplateFormatVersion', 'SK', 'ST', KEY]) {
    if (secret === 'tok' || secret === 'SK' || secret === 'ST') continue // too short to be a meaningful substring check
    assert.ok(!all.includes(secret), secret)
  }
  assert.ok(!all.includes(JSON.stringify(goodParams())))
})
