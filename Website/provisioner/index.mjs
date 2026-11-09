// ACXD provisioner: a CloudFormation custom-resource handler that creates the ACXD resources in a
// generated spec, in dependency order, idempotently (create or update by name), and removes them again
// when the stack is deleted. It never logs or returns secret values.
//
// The ACXD SDK calls follow the documented Command pattern (see the skill's reference files):
// Create/Get/Update/Delete/List<Resource>Command with <resource>Identifier fields.
// TODO(acxd-schema): the secret, guardrail and application identifier semantics (name vs server id)
// and the command shapes have not been exercised against a real workspace from this code; the first
// deployment is the real test.

import https from 'node:https'

/** Resource kinds, in creation order. `lookup: 'get'` means the identifier is a name we choose. */
export const KINDS = {
  secret: { name: 'Secret', idField: 'secretIdentifier', keyField: 'name', lookup: 'get' },
  // The SDK has no GetContextVariableCommand (confirmed from its exports), so existence is checked through the list call; the identifier is the name.
  contextVariable: { name: 'ContextVariable', idField: 'contextVariableIdentifier', keyField: 'name', lookup: 'list', nameField: 'name' },
  dataRequest: { name: 'DataRequest', idField: 'dataRequestIdentifier', keyField: 'dataRequestId', lookup: 'get' },
  flow: { name: 'Flow', idField: 'flowIdentifier', keyField: 'flowId', lookup: 'get' },
  // Server-assigned ids: find an existing one by name through the list call.
  guardrail: { name: 'Guardrail', idField: 'guardrailIdentifier', keyField: 'guardrailId', lookup: 'list', nameField: 'name' },
  application: { name: 'Application', idField: 'applicationIdentifier', keyField: 'applicationId', lookup: 'list', nameField: 'name' },
}

const isNotFound = (err) => err && (err.type === 'ResourceNotFoundException' || err.name === 'ResourceNotFoundException')

/**
 * Adapts the ACXD SDK to { ensure, remove }.
 * @param {object} client an AgenticCXDesignerClient
 * @param {object} sdk the SDK module namespace (for the *Command classes)
 */
export function createAcxdApi(client, sdk) {
  /** The command class for a verb and kind. A missing one is reported by name, with the SDK's similar exports, instead of a bare TypeError. */
  const command = (verb, name) => {
    const className = `${verb}${name}Command`
    if (typeof sdk[className] !== 'function') {
      const similar = Object.keys(sdk).filter((k) => k.includes(name)).sort().join(', ') || 'none'
      throw new Error(`The ACXD SDK has no ${className}. Exports containing "${name}": ${similar}.`)
    }
    return sdk[className]
  }
  const send = (kind, verb, input) => client.send(new (command(verb, KINDS[kind].name))(input))

  async function listAll(kind) {
    const items = []
    let nextToken
    do {
      const page = await client.send(new (command('List', `${KINDS[kind].name}s`))(nextToken ? { nextToken } : {}))
      items.push(...(page.items ?? []))
      nextToken = page.nextToken
    } while (nextToken)
    return items
  }

  /** Returns the identifier to use for an existing resource, or null. */
  async function findExisting(kind, key, name) {
    const k = KINDS[kind]
    if (k.lookup === 'get') {
      try {
        await send(kind, 'Get', { [k.idField]: key })
        return key
      } catch (err) {
        if (isNotFound(err)) return null
        throw err
      }
    }
    const match = (await listAll(kind)).find((item) => item[k.nameField] === name)
    return match ? match[k.keyField] : null
  }

  return {
    /** Create or update by name. Returns the resource id (a server id for guardrails and applications). */
    async ensure(kind, key, payload) {
      const k = KINDS[kind]
      const existing = await findExisting(kind, key, payload[k.nameField] ?? key)
      if (existing === null) {
        const created = await send(kind, 'Create', payload)
        return created?.[k.keyField] ?? key
      }
      const { [k.keyField]: _omit, ...rest } = payload
      await send(kind, 'Update', { [k.idField]: existing, ...rest })
      return existing
    },
    /** Delete if present; a missing resource is not an error. */
    async remove(kind, key, name) {
      const k = KINDS[kind]
      const existing = await findExisting(kind, key, name ?? key)
      if (existing === null) return false
      try {
        await send(kind, 'Delete', { [k.idField]: existing })
      } catch (err) {
        if (isNotFound(err)) return false
        throw err
      }
      return true
    },
  }
}

/**
 * Creates every resource in the spec, in dependency order.
 * @param {object} spec the AcxdSpec
 * @param {{ ensure: Function, readSecretValue: (arn: string) => Promise<string> }} api
 * @returns {Promise<{ applicationId: string }>}
 */
export async function provision(spec, api, log = () => {}) {
  for (const s of spec.secrets) {
    log(`secret ${s.name}`)
    const secretValue = await api.readSecretValue(s.sourceSecretArn)
    await api.ensure('secret', s.name, { name: s.name, secretValue, isSensitive: true })
  }
  for (const v of spec.contextVariables) {
    log(`context variable ${v.name}`)
    await api.ensure('contextVariable', v.name, v)
  }
  for (const d of spec.dataRequests) {
    log(`data request ${d.dataRequestId}`)
    await api.ensure('dataRequest', d.dataRequestId, d)
  }
  // Flows are created in spec order, which puts redirect targets first.
  for (const f of spec.flows) {
    log(`flow ${f.flowId}`)
    await api.ensure('flow', f.flowId, f)
  }
  const guardrailIds = {}
  for (const g of spec.guardrails) {
    log(`guardrail ${g.name}`)
    guardrailIds[g.name] = await api.ensure('guardrail', g.name, g)
  }
  const app = spec.application
  log(`application ${app.name}`)
  const applicationId = await api.ensure('application', app.name, {
    name: app.name,
    description: app.description,
    flows: app.flowIds.map((flowId) => ({ flowId })),
    settings: { ...app.settings, guardrails: app.guardrailNames.map((n) => ({ guardrailId: guardrailIds[n] })) },
  })
  return { applicationId }
}

/** Removes everything the spec created, in reverse order. Missing resources are ignored. */
export async function deprovision(spec, api, log = () => {}) {
  log(`application ${spec.application.name}`)
  await api.remove('application', spec.application.name, spec.application.name)
  for (const g of [...spec.guardrails].reverse()) {
    log(`guardrail ${g.name}`)
    await api.remove('guardrail', g.name, g.name)
  }
  for (const f of [...spec.flows].reverse()) {
    log(`flow ${f.flowId}`)
    await api.remove('flow', f.flowId)
  }
  for (const d of [...spec.dataRequests].reverse()) {
    log(`data request ${d.dataRequestId}`)
    await api.remove('dataRequest', d.dataRequestId)
  }
  for (const v of [...spec.contextVariables].reverse()) {
    log(`context variable ${v.name}`)
    await api.remove('contextVariable', v.name)
  }
  for (const s of [...spec.secrets].reverse()) {
    log(`secret ${s.name}`)
    await api.remove('secret', s.name)
  }
}

/** Sends the CloudFormation custom-resource response (the same protocol as the cfn-response module). */
function sendResponse(event, body) {
  const payload = JSON.stringify(body)
  const url = new URL(event.ResponseURL)
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: url.hostname, port: 443, path: url.pathname + url.search, method: 'PUT', headers: { 'content-type': '', 'content-length': Buffer.byteLength(payload) } },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode))
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/** Real dependencies; created lazily so tests never load the AWS or ACXD SDKs. */
const defaultDeps = {
  send: sendResponse,
  async getApiKey(arn) {
    const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager')
    const res = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: arn }))
    return res.SecretString
  },
  async makeApi({ apiKey, workspaceId, readSecretValue }) {
    const sdk = await import('amazon-connect-acxd-sdk')
    const client = new sdk.AgenticCXDesignerClient({ apiKey, workspaceId })
    return { ...createAcxdApi(client, sdk), readSecretValue }
  },
}

export function makeHandler(deps = defaultDeps) {
  return async function handler(event) {
    const physicalId = event.PhysicalResourceId ?? `acxd-${String(event.RequestId).slice(0, 8)}`
    const respond = (status, data = {}, reason = '') =>
      deps.send(event, {
        Status: status,
        Reason: reason,
        PhysicalResourceId: physicalId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: data,
      })
    try {
      const props = event.ResourceProperties
      const spec = JSON.parse(props.Spec)
      const apiKey = await deps.getApiKey(props.ApiKeySecretArn)
      const api = await deps.makeApi({ apiKey, workspaceId: props.WorkspaceId, readSecretValue: deps.getApiKey })
      const log = (m) => console.log(`${event.RequestType}: ${m}`)
      if (event.RequestType === 'Delete') {
        await deprovision(spec, api, log)
        return await respond('SUCCESS')
      }
      const { applicationId } = await provision(spec, api, log)
      return await respond('SUCCESS', { ApplicationId: applicationId })
    } catch (err) {
      // The message can name a resource but must never carry a secret value.
      console.error('provisioner failed:', err?.type ?? err?.name, err?.message)
      return await respond('FAILED', {}, `${err?.type ?? err?.name ?? 'Error'}: ${err?.message ?? 'provisioning failed'}`.slice(0, 900))
    }
  }
}

export const handler = makeHandler()
