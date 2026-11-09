import test from 'node:test'
import assert from 'node:assert/strict'
import { createAcxdApi, provision, deprovision, makeHandler } from './index.mjs'

const spec = () => ({
  secrets: [{ name: 'verifyAuthApiKey', sourceSecretArn: 'arn:secret' }],
  slotTypes: [{ slotTypeId: 'Freeformtext', values: [], sensitive: false, mainLanguageCode: 'en-US', languageCodes: ['en-US'] }],
  contextVariables: [{ name: 'isAuthenticated', schema: { type: 'boolean' } }, { name: 'transferSummary', schema: { type: 'string' } }],
  dataRequests: [{ dataRequestId: 'verifyAuth', type: 'object' }],
  flows: [{ flowId: 'Escalation' }, { flowId: 'Authentication' }, { flowId: 'MainConversation' }],
  guardrails: [{ name: 'Safety' }, { name: 'Toxicity' }],
  analyticsTags: [{ name: 'safety', type: 'negative', description: 'd' }, { name: 'toxicity', type: 'negative', description: 'd' }],
  application: {
    name: 'CQA Demo',
    description: 'd',
    flowIds: ['Escalation', 'Authentication', 'MainConversation'],
    guardrailNames: ['Safety', 'Toxicity'],
    settings: { languageCode: 'en-US', thresholds: { incomprehensionCount: 3 } },
  },
})

/** A fake ensure/remove that records calls and hands out server ids for guardrails and applications. */
function fakeApi() {
  const calls = []
  return {
    calls,
    async readSecretValue(arn) {
      calls.push(['read', arn])
      return 'SECRET-VALUE'
    },
    async ensure(kind, key, payload) {
      calls.push(['ensure', kind, key, payload])
      return kind === 'guardrail' ? `gr-${key}` : kind === 'application' ? 'app-1' : key
    },
    async remove(kind, key) {
      calls.push(['remove', kind, key])
    },
  }
}

test('provision creates resources in dependency order', async () => {
  const api = fakeApi()
  await provision(spec(), api)
  const order = api.calls.filter((c) => c[0] === 'ensure').map((c) => c[1])
  assert.deepEqual(order, ['secret', 'slotType', 'contextVariable', 'contextVariable', 'dataRequest', 'flow', 'flow', 'flow', 'analyticsTag', 'analyticsTag', 'guardrail', 'guardrail', 'application'])
  assert.ok(order.indexOf('slotType') < order.indexOf('flow'), 'the slot type exists before the flows that attach it')
  assert.ok(order.indexOf('analyticsTag') < order.indexOf('guardrail'), 'tags exist before the guardrails that reference them')
  assert.deepEqual(
    api.calls.filter((c) => c[1] === 'flow').map((c) => c[2]),
    ['Escalation', 'Authentication', 'MainConversation'],
  )
})

test('the ACXD secret value is read from Secrets Manager at deploy time and marked sensitive', async () => {
  const api = fakeApi()
  await provision(spec(), api)
  assert.deepEqual(api.calls[0], ['read', 'arn:secret'])
  const secret = api.calls.find((c) => c[1] === 'secret')
  assert.deepEqual(secret[3], { name: 'verifyAuthApiKey', secretValue: 'SECRET-VALUE', isSensitive: true })
})

test('the application gets the server ids of the guardrails it attaches', async () => {
  const api = fakeApi()
  const { applicationId } = await provision(spec(), api)
  const app = api.calls.find((c) => c[1] === 'application')[3]
  assert.deepEqual(app.settings.guardrails, [{ guardrailId: 'gr-Safety' }, { guardrailId: 'gr-Toxicity' }])
  assert.deepEqual(app.flows, [{ flowId: 'Escalation' }, { flowId: 'Authentication' }, { flowId: 'MainConversation' }])
  assert.equal(applicationId, 'app-1')
})

test('deprovision removes in reverse order', async () => {
  const api = fakeApi()
  await deprovision(spec(), api)
  assert.deepEqual(
    api.calls.map((c) => `${c[1]}:${c[2]}`),
    ['application:CQA Demo', 'guardrail:Toxicity', 'guardrail:Safety', 'flow:MainConversation', 'flow:Authentication', 'flow:Escalation', 'dataRequest:verifyAuth', 'contextVariable:transferSummary', 'contextVariable:isAuthenticated', 'secret:verifyAuthApiKey'],
  )
})

// ---- SDK adapter ------------------------------------------------------------------------------------

function fakeSdk(store) {
  const log = []
  const notFound = () => Object.assign(new Error('missing'), { type: 'ResourceNotFoundException' })
  const sdk = {}
  for (const name of ['Secret', 'ContextVariable', 'DataRequest', 'Flow', 'Guardrail', 'Application', 'AnalyticsTag', 'SlotType']) {
    // The real SDK (0.3.0) has no GetContextVariableCommand or GetAnalyticsTagCommand.
    for (const verb of name === 'ContextVariable' || name === 'AnalyticsTag' ? ['Create', 'Update', 'Delete'] : ['Create', 'Get', 'Update', 'Delete']) sdk[`${verb}${name}Command`] = class { constructor(input) { this.verb = verb; this.kind = name; this.input = input } }
    sdk[`List${name}sCommand`] = class { constructor(input) { this.verb = 'List'; this.kind = name; this.input = input } }
  }
  const client = {
    log,
    async send(cmd) {
      log.push([cmd.verb, cmd.kind, cmd.input])
      const table = (store[cmd.kind] ??= {})
      if (cmd.verb === 'Get') {
        const id = Object.values(cmd.input)[0]
        if (!(id in table)) throw notFound()
        return table[id]
      }
      if (cmd.verb === 'List') return { items: Object.values(table) }
      if (cmd.verb === 'Create') {
        const id = cmd.kind === 'Guardrail' ? 'server-g1' : cmd.kind === 'Application' ? 'server-a1' : cmd.input.flowId ?? cmd.input.slotTypeId ?? cmd.input.name ?? cmd.input.dataRequestId
        const keyField = { Guardrail: 'guardrailId', Application: 'applicationId' }[cmd.kind]
        table[id] = { ...cmd.input, ...(keyField ? { [keyField]: id } : {}) }
        return table[id]
      }
      if (cmd.verb === 'Update') return {}
      if (cmd.verb === 'Delete') {
        const id = Object.values(cmd.input)[0]
        if (!(id in table)) throw notFound()
        delete table[id]
        return {}
      }
    },
  }
  return { client, sdk, log }
}

test('adapter creates a missing flow, then updates it on the second run (idempotent)', async () => {
  const store = {}
  const { client, sdk, log } = fakeSdk(store)
  const api = createAcxdApi(client, sdk)
  await api.ensure('flow', 'Escalation', { flowId: 'Escalation', nodes: {} })
  assert.deepEqual(log.map((l) => l[0]), ['Get', 'Create'])
  log.length = 0
  await api.ensure('flow', 'Escalation', { flowId: 'Escalation', nodes: { a: 1 } })
  assert.deepEqual(log.map((l) => l[0]), ['Get', 'Update'])
  assert.deepEqual(log[1][2], { flowIdentifier: 'Escalation', nodes: { a: 1 } }, 'flowId is replaced by flowIdentifier on update')
})

test('adapter finds server-id resources by name and returns the server id', async () => {
  const store = {}
  const { client, sdk, log } = fakeSdk(store)
  const api = createAcxdApi(client, sdk)
  assert.equal(await api.ensure('guardrail', 'Safety', { name: 'Safety', rules: [] }), 'server-g1')
  log.length = 0
  assert.equal(await api.ensure('guardrail', 'Safety', { name: 'Safety', rules: [1] }), 'server-g1')
  assert.deepEqual(log.map((l) => l[0]), ['List', 'Update'])
  assert.equal(log[1][2].guardrailIdentifier, 'server-g1')
})

test('adapter remove ignores a missing resource', async () => {
  const { client, sdk } = fakeSdk({})
  const api = createAcxdApi(client, sdk)
  assert.equal(await api.remove('flow', 'Nope'), false)
})

test('adapter rethrows errors that are not "not found"', async () => {
  const sdk = { GetFlowCommand: class { constructor(i) { this.i = i } }, CreateFlowCommand: class {} }
  const client = { send: async () => { throw Object.assign(new Error('boom'), { type: 'InternalServerException' }) } }
  await assert.rejects(createAcxdApi(client, sdk).ensure('flow', 'X', { flowId: 'X' }), /boom/)
})

// ---- handler ---------------------------------------------------------------------------------------

const event = (type) => ({
  RequestType: type,
  RequestId: 'abcdef1234567890',
  StackId: 'stack',
  LogicalResourceId: 'AcxdProvision',
  ResponseURL: 'https://example.invalid/',
  ResourceProperties: { Spec: JSON.stringify(spec()), WorkspaceId: 'ws', ApiKeySecretArn: 'arn:key' },
})
const depsFor = (api, sent) => ({
  send: async (_e, body) => sent.push(body),
  getApiKey: async () => 'acxd_live_SECRET',
  makeApi: async ({ readSecretValue }) => ({ ...api, readSecretValue }),
})

test('Create responds SUCCESS with the application id', async () => {
  const sent = []
  await makeHandler(depsFor(fakeApi(), sent))(event('Create'))
  assert.equal(sent[0].Status, 'SUCCESS')
  assert.equal(sent[0].Data.ApplicationId, 'app-1')
  assert.match(sent[0].PhysicalResourceId, /^acxd-abcdef12$/)
})

test('Update keeps the existing physical id (otherwise CloudFormation would delete the resources)', async () => {
  const sent = []
  await makeHandler(depsFor(fakeApi(), sent))({ ...event('Update'), PhysicalResourceId: 'acxd-keep' })
  assert.equal(sent[0].PhysicalResourceId, 'acxd-keep')
})

test('Delete removes resources and responds SUCCESS', async () => {
  const sent = []
  const api = fakeApi()
  await makeHandler(depsFor(api, sent))(event('Delete'))
  assert.equal(sent[0].Status, 'SUCCESS')
  assert.equal(api.calls[0][0], 'remove')
})

test('a failure responds FAILED with a reason and never leaks the API key', async () => {
  const sent = []
  const api = { ...fakeApi(), ensure: async () => { throw Object.assign(new Error('flow invalid'), { type: 'ValidationException' }) } }
  await makeHandler(depsFor(api, sent))(event('Create'))
  assert.equal(sent[0].Status, 'FAILED')
  assert.match(sent[0].Reason, /ValidationException: flow invalid/)
  assert.ok(!JSON.stringify(sent).includes('acxd_live_SECRET'))
})

test('invalid spec JSON is a clean FAILED response', async () => {
  const sent = []
  const e = event('Create')
  e.ResourceProperties.Spec = '{not json'
  await makeHandler(depsFor(fakeApi(), sent))(e)
  assert.equal(sent[0].Status, 'FAILED')
})

test('a command the SDK does not export is reported by name with the similar exports, not as a bare TypeError', async () => {
  const sdk = { GetSecretsCommand: class {}, ListSecretsCommand: class {} }
  const api = createAcxdApi({ send: async () => ({}) }, sdk)
  await assert.rejects(() => api.ensure('secret', 'my_secret', { name: 'my_secret' }), /no GetSecretCommand.*GetSecretsCommand, ListSecretsCommand/)
})

test('a context variable is looked up through the list call, because the SDK has no Get for it', async () => {
  const store = {}
  const { client, sdk, log } = fakeSdk(store)
  const api = createAcxdApi(client, sdk)
  await api.ensure('contextVariable', 'isAuthenticated', { name: 'isAuthenticated', schema: { type: 'boolean' } })
  assert.deepEqual(log.map((l) => l[0]), ['List', 'Create'])
  log.length = 0
  await api.ensure('contextVariable', 'isAuthenticated', { name: 'isAuthenticated', schema: { type: 'boolean' } })
  assert.deepEqual(log.map((l) => l[0]), ['List', 'Update'])
  assert.equal(log[1][2].contextVariableIdentifier, 'isAuthenticated')
  assert.equal(await api.remove('contextVariable', 'isAuthenticated'), true)
  assert.equal(await api.remove('contextVariable', 'isAuthenticated'), false)
})

test('every SDK command the provisioner can call exists in the real SDK 0.3.0 export list', async () => {
  const { readFileSync } = await import('node:fs')
  const real = new Set(JSON.parse(readFileSync(new URL('./fixtures-sdk-exports.json', import.meta.url), 'utf8')).commands)
  const { KINDS } = await import('./index.mjs')
  for (const k of Object.values(KINDS)) {
    const lookup = k.lookup === 'get' ? `Get${k.name}Command` : `List${k.name}sCommand`
    for (const c of [lookup, `Create${k.name}Command`, `Update${k.name}Command`, `Delete${k.name}Command`]) assert.ok(real.has(c), `${c} is not exported by the SDK`)
  }
})

test('analytics tags are created idempotently through the list call and are not deleted with the stack (shared workspace labels)', async () => {
  const store = {}
  const { client, sdk, log } = fakeSdk(store)
  const api = createAcxdApi(client, sdk)
  const tag = { name: 'safety', type: 'negative', description: 'd' }
  await api.ensure('analyticsTag', 'safety', tag)
  assert.deepEqual(log.map((l) => l[0]), ['List', 'Create'])
  log.length = 0
  await api.ensure('analyticsTag', 'safety', tag)
  assert.deepEqual(log.map((l) => l[0]), ['List', 'Update'])
  assert.deepEqual(log[1][2], { name: 'safety', type: 'negative', description: 'd' })
  const calls = []
  await deprovision(spec(), { ...fakeApi(), remove: async (k, n) => calls.push(k) })
  assert.ok(!calls.includes('analyticsTag'))
})

test('the Freeformtext slot type is created with no values, and is not deleted with the stack', async () => {
  const store = {}
  const { client, sdk, log } = fakeSdk(store)
  const api = createAcxdApi(client, sdk)
  const t = { slotTypeId: 'Freeformtext', values: [], sensitive: false, mainLanguageCode: 'en-US', languageCodes: ['en-US'] }
  await api.ensure('slotType', 'Freeformtext', t)
  assert.deepEqual(log.map((l) => l[0]), ['Get', 'Create'])
  assert.deepEqual(log[1][2], t)
  log.length = 0
  await api.ensure('slotType', 'Freeformtext', t)
  assert.deepEqual(log.map((l) => l[0]), ['Get', 'Update'])
  assert.equal(log[1][2].slotTypeIdentifier, 'Freeformtext')
  const calls = []
  await deprovision(spec(), { ...fakeApi(), remove: async (k) => calls.push(k) })
  assert.ok(!calls.includes('slotType'))
})

test('an SDK error says which resource it was about and keeps its type', async () => {
  const sdk = { GetSecretCommand: class {}, CreateSecretCommand: class {} }
  const client = { send: async (cmd) => { if (cmd instanceof sdk.GetSecretCommand) throw Object.assign(new Error('missing'), { type: 'ResourceNotFoundException' }); throw Object.assign(new Error('name is not in the expected format.'), { type: 'ValidationException' }) } }
  const api = createAcxdApi(client, sdk)
  await assert.rejects(() => api.ensure('secret', 'bad name', { name: 'bad name' }), (err) => err.message === 'secret "bad name": name is not in the expected format.' && err.type === 'ValidationException')
})
