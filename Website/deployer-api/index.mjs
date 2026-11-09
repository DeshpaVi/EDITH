// Deployer API: a Lambda Function URL that deploys the templates this tool generates into a target AWS
// account, through a role the customer created. Two phases, enforced here and not only in the UI:
//   POST /plan    validates the template, creates a CloudFormation CHANGE SET and returns what would change,
//                 plus a signed confirmation token bound to that exact change set.
//   POST /execute runs the change set, only with a valid token.
// Also: GET /targets, POST /status, POST /cancel, POST /delete.
//
// The ACXD API key never reaches this function (templates take a secret ARN). Template and parameter values
// are never logged. AWS credentials never exist in the browser.

import { createHash, timingSafeEqual } from 'node:crypto'
import { signConfirm, verifyConfirm } from './confirm.mjs'
import { buildCreateChangeSetInput, isManaged, isNoChanges, phaseOf, summarizeChangeSet, summarizeStack, waitForChangeSet } from './cfn.mjs'
import { MAX_TEMPLATE_BYTES, RESERVED_PARAMETERS, parameterProblems, templateProblems, validStackName } from './policy.mjs'

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

function tokenMatches(header, expected) {
  const given = Buffer.from(String(header ?? '').replace(/^Bearer\s+/i, ''))
  const want = Buffer.from(expected)
  return given.length === want.length && timingSafeEqual(given, want)
}

function mapAwsError(err) {
  if (err instanceof HttpError) return err
  const name = err?.name ?? ''
  const message = String(err?.message ?? '')
  if (name === 'AccessDenied' || name === 'AccessDeniedException' || /not authorized to perform|AccessDenied/i.test(message)) {
    return new HttpError(502, 'AWS refused the request. Check that the deploy role exists, trusts this tool with the right external id, and has the permissions in customer-role.template.json.')
  }
  if (name.includes('Throttling')) return new HttpError(429, 'AWS is throttling requests. Try again in a moment.')
  if (name === 'AlreadyExistsException') return new HttpError(409, 'That already exists.')
  if (name === 'ValidationError' || name === 'ValidationException') return new HttpError(400, `CloudFormation rejected the request: ${message.slice(0, 300)}`)
  return new HttpError(502, 'The AWS request failed.')
}

export function makeHandler(deps) {
  const env = deps.env

  const targets = () => {
    try {
      const parsed = JSON.parse(env.TARGETS ?? '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  const findTarget = (id) => {
    const t = targets().find((x) => x.id === id)
    if (!t) throw new HttpError(400, 'Unknown target.')
    return t
  }
  const clientFor = async (target) => deps.cfn(await deps.assumeRole({ roleArn: target.roleArn, externalId: target.externalId, sessionName: 'edith-deploy' }), target.region)

  async function getStack(cfn, name) {
    try {
      const out = await cfn.describeStacks({ StackName: name })
      return out.Stacks?.[0] ?? null
    } catch (err) {
      if (/does not exist/i.test(String(err?.message ?? ''))) return null
      throw err
    }
  }
  const mustBeManaged = (stack, name) => {
    if (!stack) throw new HttpError(404, `Stack ${name} does not exist.`)
    if (!isManaged(stack)) throw new HttpError(403, 'That stack was not created by this tool, so it will not touch it.')
  }
  const stackNameOf = (body) => {
    if (!validStackName(body.stackName)) throw new HttpError(400, 'Stack name must start with "edith-" and use lowercase letters, digits and hyphens.')
    return body.stackName
  }

  const routes = {
    async plan(body) {
      const target = findTarget(body.targetId)
      const stackName = stackNameOf(body)
      let template
      try {
        template = typeof body.template === 'string' ? JSON.parse(body.template) : body.template
      } catch {
        throw new HttpError(400, 'The template is not valid JSON.')
      }
      const problems = templateProblems(template)
      if (problems.length > 0) throw new HttpError(400, `This template is not one the tool may deploy: ${problems.slice(0, 5).join(' ')}`)
      const templateBody = JSON.stringify(template)
      if (templateBody.length > MAX_TEMPLATE_BYTES) throw new HttpError(413, 'The template is larger than CloudFormation allows inline (51,200 bytes).')
      const paramProblems = parameterProblems(template.Parameters, body.parameters ?? {})
      if (paramProblems.length > 0) throw new HttpError(400, paramProblems.slice(0, 5).join(' '))

      const parameters = { ...(body.parameters ?? {}) }
      for (const [key, value] of [['ProvisionerCodeBucket', env.ARTIFACT_BUCKET], ['ProvisionerCodeKey', env.ARTIFACT_KEY]]) {
        if (key in (template.Parameters ?? {})) {
          if (!value) throw new HttpError(500, 'The deployer has no provisioner artifact configured.')
          parameters[key] = value
        }
      }

      const cfn = await clientFor(target)
      const stack = await getStack(cfn, stackName)
      let type = 'CREATE'
      if (stack) {
        if (!isManaged(stack)) throw new HttpError(409, 'A stack with that name exists and was not created by this tool.')
        if (stack.StackStatus === 'REVIEW_IN_PROGRESS') type = 'CREATE'
        else if (phaseOf(stack.StackStatus) === 'working') throw new HttpError(409, 'That stack is still changing. Wait for it to finish.')
        else if (stack.StackStatus === 'ROLLBACK_COMPLETE') throw new HttpError(409, 'That stack rolled back after a failed first deployment. Delete it, then deploy again.')
        else type = 'UPDATE'
      }

      const changeSetName = `edith-${deps.now()}`
      await cfn.createChangeSet(buildCreateChangeSetInput({ stackName, changeSetName, type, templateBody, parameters, stackRoleArn: target.stackRoleArn }))
      const desc = await waitForChangeSet(() => cfn.describeChangeSet({ StackName: stackName, ChangeSetName: changeSetName }), { sleep: deps.sleep })
      if (isNoChanges(desc)) {
        await cfn.deleteChangeSet({ StackName: stackName, ChangeSetName: changeSetName }).catch(() => undefined)
        return { status: 'no_changes', stackName }
      }
      if (desc.Status === 'FAILED') throw new HttpError(400, `CloudFormation could not prepare the change: ${String(desc.StatusReason ?? '').slice(0, 400)}`)

      const changeSetId = desc.ChangeSetId
      const hash = createHash('sha256').update(templateBody).digest('hex')
      const token = signConfirm(env.CONFIRM_KEY, { targetId: target.id, stackName, changeSetId, hash }, deps.now())
      return { ...summarizeChangeSet(desc), status: 'ready', stackName, changeSetId, type, token, expiresInMinutes: 15 }
    },

    async execute(body) {
      const target = findTarget(body.targetId)
      const stackName = stackNameOf(body)
      const check = verifyConfirm(env.CONFIRM_KEY, body.token, { targetId: target.id, stackName, changeSetId: body.changeSetId }, deps.now())
      if (!check.ok) throw new HttpError(403, check.reason)
      const cfn = await clientFor(target)
      const desc = await cfn.describeChangeSet({ StackName: stackName, ChangeSetName: body.changeSetId })
      if (desc.Status !== 'CREATE_COMPLETE' || desc.ExecutionStatus !== 'AVAILABLE') throw new HttpError(409, 'That change set can no longer be executed. Preview the changes again.')
      await cfn.executeChangeSet({ StackName: stackName, ChangeSetName: body.changeSetId })
      return { status: 'started', stackName }
    },

    async status(body) {
      const target = findTarget(body.targetId)
      const stackName = stackNameOf(body)
      const cfn = await clientFor(target)
      const stack = await getStack(cfn, stackName)
      if (!stack) return { phase: 'not_found', stackName }
      mustBeManaged(stack, stackName)
      const events = (await cfn.describeStackEvents({ StackName: stackName })).StackEvents ?? []
      return { stackName, ...summarizeStack(stack, events) }
    },

    async cancel(body) {
      const target = findTarget(body.targetId)
      const stackName = stackNameOf(body)
      const cfn = await clientFor(target)
      const stack = await getStack(cfn, stackName)
      mustBeManaged(stack, stackName)
      await cfn.deleteChangeSet({ StackName: stackName, ChangeSetName: body.changeSetId })
      // A first-time plan leaves an empty stack in REVIEW_IN_PROGRESS; remove it so the name is free again.
      if (stack.StackStatus === 'REVIEW_IN_PROGRESS') await cfn.deleteStack({ StackName: stackName })
      return { status: 'cancelled', stackName }
    },

    async delete(body) {
      const target = findTarget(body.targetId)
      const stackName = stackNameOf(body)
      if (body.confirmName !== stackName) throw new HttpError(400, 'Type the stack name to confirm deleting it.')
      const cfn = await clientFor(target)
      const stack = await getStack(cfn, stackName)
      mustBeManaged(stack, stackName)
      await cfn.deleteStack({ StackName: stackName })
      return { status: 'deleting', stackName }
    },
  }

  return async function handler(event) {
    const started = deps.now()
    const method = event.requestContext?.http?.method ?? 'POST'
    const route = (event.rawPath ?? event.requestContext?.http?.path ?? '/').replace(/^\/+|\/+$/g, '')
    let target
    try {
      if (!env.ACCESS_TOKEN || !env.CONFIRM_KEY) return json(500, { error: 'The deployer is not configured.' })
      if (!tokenMatches((event.headers ?? {}).authorization, env.ACCESS_TOKEN)) return json(401, { error: 'Unauthorized.' })

      if (method === 'GET' && route === 'targets') {
        return json(200, { targets: targets().map((t) => ({ id: t.id, label: t.label ?? t.id, region: t.region })) })
      }
      if (method !== 'POST' || !(route in routes)) return json(404, { error: 'Not found.' })

      let body
      try {
        const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '')
        body = JSON.parse(raw)
      } catch {
        throw new HttpError(400, 'The request body is not valid JSON.')
      }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'The request body must be a JSON object.')
      target = body.targetId

      const result = await routes[route](body)
      console.log(JSON.stringify({ route, target, stack: body.stackName, status: 200, ms: deps.now() - started }))
      return json(200, result)
    } catch (raw) {
      const err = mapAwsError(raw)
      console.log(JSON.stringify({ route, target, status: err.status ?? 500, ms: deps.now() - started, error: err.message.slice(0, 200) }))
      return json(err.status ?? 500, { error: err.message })
    }
  }
}

/** Real dependencies, loaded lazily so tests never need the AWS SDK. The Node.js runtime bundles it. */
const defaultDeps = {
  env: process.env,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async assumeRole({ roleArn, externalId, sessionName }) {
    const { STSClient, AssumeRoleCommand } = await import('@aws-sdk/client-sts')
    const out = await new STSClient({}).send(new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: sessionName, ExternalId: externalId, DurationSeconds: 900 }))
    return { accessKeyId: out.Credentials.AccessKeyId, secretAccessKey: out.Credentials.SecretAccessKey, sessionToken: out.Credentials.SessionToken }
  },
  cfn(credentials, region) {
    // One client per request; commands are created on demand so the SDK loads only when used.
    const call = async (name, input) => {
      const sdk = await import('@aws-sdk/client-cloudformation')
      const client = new sdk.CloudFormationClient({ region, credentials })
      return client.send(new sdk[`${name}Command`](input))
    }
    return {
      describeStacks: (i) => call('DescribeStacks', i),
      createChangeSet: (i) => call('CreateChangeSet', i),
      describeChangeSet: (i) => call('DescribeChangeSet', i),
      executeChangeSet: (i) => call('ExecuteChangeSet', i),
      deleteChangeSet: (i) => call('DeleteChangeSet', i),
      describeStackEvents: (i) => call('DescribeStackEvents', i),
      deleteStack: (i) => call('DeleteStack', i),
    }
  },
}

export const handler = makeHandler(defaultDeps)
export { RESERVED_PARAMETERS }
