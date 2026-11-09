import { describe, it, expect } from 'vitest'
import type { Journey } from '../journey/model'
import { buildChecklist, defaultSelection, IDS } from '../checklist'
import { emitBundle } from './bundle'
import type { BundleOptions } from './bundle'
import { TOKENS } from './acxd/resources'
import { VERIFY_LAMBDA_SOURCE } from './cfn/verifyLambda'
import { emitContactFlow } from './connect/agenticContactFlow'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import census from '../journey/fixtures/census-cqa.journey.json'
import safety from './acxd/fixtures/guardrail.Safety.json'
import toxicity from './acxd/fixtures/guardrail.Toxicity.json'
import injection from './acxd/fixtures/guardrail.PromptInjection.json'
import realContactFlow from './acxd/fixtures/connect-contact-flow.AgenticCX.json'

const journey = (): Journey => JSON.parse(JSON.stringify(census)) as unknown as Journey
const options = (extra: Partial<BundleOptions> = {}): BundleOptions => ({
  applicationName: 'CQA Demo',
  tableName: 'CensusIds',
  identifierFields: ['censusId', 'zipCode', 'ssnLastFour'],
  content: { knowledgeBaseId: 'kb-1' },
  guardrails: { safety, promptInjection: injection, toxicity },
  provisionerFiles: { 'index.mjs': '// provisioner', 'package.json': '{}' },
  ...extra,
})
const selection = (j: Journey) => defaultSelection(buildChecklist(j))
const bundle = (j = journey(), extra: Partial<BundleOptions> = {}) => emitBundle(j, selection(j), options(extra))

describe('emitBundle for the Census CQA journey', () => {
  const b = bundle()

  it('writes the template, the spec, a README and the provisioner', () => {
    expect(Object.keys(b.files).sort()).toEqual(['README.md', 'acxd-spec.json', 'provisioner/index.mjs', 'provisioner/package.json', 'template.json'])
  })

  it('creates the ACXD flows in dependency order (redirect targets first)', () => {
    expect(b.spec.flows.map((f) => f.flowId)).toEqual(['Escalation', 'SafetyEscalation', 'Authentication', 'MainConversation'])
  })

  it('creates the data request, secret and context variables the flows use', () => {
    expect(b.spec.dataRequests.map((d) => d.dataRequestId)).toEqual(['verifyAuth'])
    expect(b.spec.secrets.map((s) => s.name)).toEqual(['verifyAuthApiKey'])
    expect(b.spec.contextVariables.map((c) => c.name).sort()).toEqual(['customerIntent', 'isAuthenticated', 'stuckPoint', 'transferSummary'])
    expect(b.spec.contextVariables.find((c) => c.name === 'isAuthenticated')).toEqual({ name: 'isAuthenticated', schema: { type: 'boolean' }, disallowExternalModification: true })
  })

  it('marks the data request and its field sensitive and sends the shared key from a secret reference', () => {
    const d = b.spec.dataRequests[0]
    expect(d.sensitive).toBe(true)
    expect(d.webhook.headers).toEqual([{ key: 'x-api-key', value: '{{secrets.verifyAuthApiKey}}', sensitive: true }])
    expect(JSON.stringify(d.requestSchema)).toContain('"isSensitive":true')
  })

  it('attaches the guardrails the consultant kept, from supplied wording', () => {
    expect(b.spec.guardrails.map((g) => g.name)).toEqual(['Safety', 'Prompt injection jailbreak', 'Toxicity'])
    expect(b.spec.guardrails.every((g) => !('guardrailId' in g))).toBe(true)
    expect(b.spec.application.guardrailNames).toEqual(['Safety', 'Prompt injection jailbreak', 'Toxicity'])
  })

  it('sets the application defaults and the retry threshold from the journey', () => {
    const s = b.spec.application.settings
    expect(s.defaultFlows).toEqual({ welcome: { flowId: 'MainConversation' }, unknown: { flowId: 'MainConversation' }, fallback: { flowId: 'Escalation' } })
    expect(s.thresholds.incomprehensionCount).toBe(3)
    expect(s.languageCodes).toEqual(['en-US', 'es-US'])
  })

  it('leaves the SDK-undocumented Incomprehension default to the console, and says so', () => {
    expect(b.consoleSteps.join(' ')).toContain('Incomprehension')
    expect(b.files['README.md']).toContain('Incomprehension')
  })

  it('reports what it did not generate instead of dropping it', () => {
    expect(b.skipped.map((s) => s.id)).toEqual([IDS.languages])
    expect(b.blockers.map((r) => r.title)).toContain('Language detection and switching in ACXD is unverified')
    expect(b.files['README.md']).toContain('Language settings, voices and translations are unconfirmed')
    expect(b.files['README.md']).toContain('Blockers that still need a human decision')
  })

  it('is deterministic', () => {
    expect(bundle().files).toEqual(b.files)
  })

  it('never contains an API key, and the key parameter is NoEcho', () => {
    for (const content of Object.values(b.files)) expect(content).not.toMatch(/acxd_live_[A-Za-z0-9]{6}/)
    expect(b.template.Parameters.AcxdApiKey).toMatchObject({ NoEcho: true })
    expect(JSON.stringify(b.template)).not.toContain('"Default":"acxd')
  })
})

describe('CloudFormation template', () => {
  const b = bundle()
  const r = b.template.Resources as Record<string, { Type: string; Properties: Record<string, any> }>

  it('creates the AWS resources and a custom resource for ACXD', () => {
    expect(Object.entries(r).map(([k, v]) => `${k}:${v.Type}`).sort()).toEqual([
      'AcxdApiKeySecret:AWS::SecretsManager::Secret',
      'AcxdProvision:Custom::AcxdProvision',
      'ProvisionerFunction:AWS::Lambda::Function',
      'ProvisionerRole:AWS::IAM::Role',
      'RespondentsTable:AWS::DynamoDB::Table',
      'VerifyAuthFunction:AWS::Lambda::Function',
      'VerifyAuthInvokePermission:AWS::Lambda::Permission',
      'VerifyAuthRole:AWS::IAM::Role',
      'VerifyAuthUrl:AWS::Lambda::Url',
      'VerifyAuthUrlPermission:AWS::Lambda::Permission',
      'VerifyKeySecret:AWS::SecretsManager::Secret',
    ])
  })

  it('keys the table on the first identifier with a keys-only index per other identifier', () => {
    const t = r.RespondentsTable.Properties
    expect(t.KeySchema).toEqual([{ AttributeName: 'censusId', KeyType: 'HASH' }])
    expect(t.GlobalSecondaryIndexes.map((g: { IndexName: string }) => g.IndexName)).toEqual(['zipCode-index', 'ssnLastFour-index'])
    expect(t.GlobalSecondaryIndexes.every((g: { Projection: unknown }) => JSON.stringify(g.Projection) === '{"ProjectionType":"KEYS_ONLY"}')).toBe(true)
    expect(t.AttributeDefinitions.map((a: { AttributeName: string }) => a.AttributeName)).toEqual(['censusId', 'zipCode', 'ssnLastFour'])
  })

  it('grants the verification role GetItem and Query on the table and its indexes only', () => {
    const statements = r.VerifyAuthRole.Properties.Policies[0].PolicyDocument.Statement
    expect(statements.map((s: { Action: string }) => s.Action)).toEqual(['dynamodb:GetItem', 'dynamodb:Query'])
  })

  it('keeps the inline Lambda within CloudFormation\'s 4096-character limit', () => {
    expect(VERIFY_LAMBDA_SOURCE.length).toBeLessThan(4096)
    expect(r.VerifyAuthFunction.Properties.Code.ZipFile).toBe(VERIFY_LAMBDA_SOURCE)
    expect(r.VerifyAuthFunction.Properties.Environment.Variables.IDENTIFIER_FIELDS).toBe('censusId,zipCode,ssnLastFour')
  })

  it('verification Lambda source rejects a missing key and bad JSON without touching the table', async () => {
    // Loaded the way Lambda loads inline code: as CommonJS, with no export or import statements.
    expect(VERIFY_LAMBDA_SOURCE).not.toMatch(/^\s*(export|import)\s/m)
    const mod = { exports: {} as Record<string, unknown> }
    new Function('exports', 'module', VERIFY_LAMBDA_SOURCE)(mod.exports, mod)
    process.env.API_KEY = 'k'
    process.env.IDENTIFIER_FIELDS = 'censusId'
    const handler = mod.exports.handler as (e: unknown) => Promise<{ statusCode: number; body: string }>
    expect(typeof handler).toBe('function')
    expect((await handler({ headers: {}, body: '{}' })).statusCode).toBe(401)
    expect((await handler({ headers: { 'x-api-key': 'k' }, body: '{' })).statusCode).toBe(400)
    expect(JSON.parse((await handler({ headers: { 'x-api-key': 'k' }, body: '{"authValue":"  "}' })).body)).toEqual({ verified: false })
    delete process.env.API_KEY
  })

  it('passes the spec as one JSON string whose placeholders become intrinsics', () => {
    const spec = r.AcxdProvision.Properties.Spec as { 'Fn::Sub': [string, Record<string, unknown>] }
    const [text, vars] = spec['Fn::Sub']
    expect(Object.keys(vars).sort()).toEqual(['VerifyKeyArn', 'VerifyUrl'])
    expect(text).not.toContain(TOKENS.verifyUrl)
    const restored = text.split('${VerifyUrl}').join(TOKENS.verifyUrl).split('${VerifyKeyArn}').join(TOKENS.verifyKeySecretArn).split('${!').join('${')
    expect(JSON.parse(restored)).toEqual(b.spec)
  })

  it('escapes literal ${ in the spec so CloudFormation does not interpolate it', () => {
    const j = journey()
    const greeting = j.steps.find((s) => s.kind === 'greeting')!
    if (greeting.kind === 'greeting') greeting.text = 'Hello ${name}'
    const out = bundle(j)
    const [text] = (out.template.Resources.AcxdProvision.Properties as { Spec: { 'Fn::Sub': [string] } }).Spec['Fn::Sub']
    expect(text).toContain('Hello ${!name}')
  })

  it('reads the ACXD key from Secrets Manager only through the provisioner role', () => {
    const resource = r.ProvisionerRole.Properties.Policies[0].PolicyDocument.Statement[0]
    expect(resource.Action).toBe('secretsmanager:GetSecretValue')
    expect(r.AcxdApiKeySecret.Properties.SecretString).toEqual({ Ref: 'AcxdApiKey' })
  })

  it('packages the provisioner from a local path and gives it the maximum timeout', () => {
    expect(r.ProvisionerFunction.Properties.Code).toBe('./provisioner')
    expect(r.ProvisionerFunction.Properties.Timeout).toBe(900)
  })

  it('exposes the application id for the contact flow', () => {
    expect(JSON.stringify(b.template.Outputs.AcxdApplicationId)).toContain('AcxdProvision')
  })
})

describe('selection and gaps', () => {
  it('creates the analytics tags the guardrail rules reference, so the application builds', () => {
    const b = bundle()
    const tags = b.spec.analyticsTags.map((t) => t.name).sort()
    expect(tags).toEqual(['promptinjection', 'safety', 'toxicity'])
    expect(b.spec.analyticsTags.every((t) => t.description.length <= 64 && /^[A-Za-z0-9_]{1,36}$/.test(t.name))).toBe(true)
    for (const g of b.spec.guardrails) for (const rule of g.rules as Array<{ tags?: Array<{ label: string }> }>) for (const t of rule.tags ?? []) expect(tags).toContain(t.label)
  })

  it('creates the custom slot type the authentication flow attaches, with no values, and leaves built-in types alone', () => {
    const b = bundle()
    expect(b.spec.slotTypes).toEqual([{ slotTypeId: 'Freeformtext', values: [], sensitive: false, mainLanguageCode: 'en-US', languageCodes: ['en-US', 'es-US'] }])
    const used = b.spec.flows.flatMap((f) => f.slotTypes.map((s) => s.type))
    for (const type of used) expect(type.startsWith('NLX.') || b.spec.slotTypes.some((t) => t.slotTypeId === type)).toBe(true)
  })

  it('drops the recommended guardrails when the consultant deselects them', () => {
    const j = journey()
    const chosen = selection(j).filter((id) => ![IDS.guardrailSafety, IDS.guardrailInjection, IDS.guardrailToxicity, IDS.safetyFlow].includes(id as never))
    const out = emitBundle(j, chosen, options())
    expect(out.spec.guardrails).toEqual([])
    expect(out.spec.flows.map((f) => f.flowId)).not.toContain('SafetyEscalation')
  })

  it('skips a guardrail whose wording was not supplied, with the reason', () => {
    const out = bundle(journey(), { guardrails: { safety } })
    expect(out.spec.guardrails.map((g) => g.name)).toEqual(['Safety'])
    expect(out.skipped.map((s) => s.id)).toEqual(expect.arrayContaining([IDS.guardrailInjection, IDS.guardrailToxicity]))
  })

  it('skips the knowledge base and warns when its id is not supplied', () => {
    const out = bundle(journey(), { content: {} })
    expect(out.skipped.map((s) => s.id)).toContain(IDS.knowledgeBase)
    expect(out.warnings.join(' ')).toContain('knowledge base')
  })

  it('generates no backend, no data request and no authentication flow when the backend is unknown', () => {
    const j = journey()
    const auth = j.steps.find((s) => s.kind === 'authentication')!
    if (auth.kind === 'authentication') auth.verifiesAgainst = { type: 'unknown' }
    const out = bundle(j)
    expect(out.spec.dataRequests).toEqual([])
    expect(out.spec.flows.map((f) => f.flowId)).not.toContain('Authentication')
    expect(out.template.Resources).not.toHaveProperty('RespondentsTable')
    expect(out.skipped.map((s) => s.id)).toEqual(expect.arrayContaining([IDS.verifyRequest, IDS.authFlow]))
    expect(out.blockers.map((r) => r.id)).toContain('review.auth.backend')
  })

  it('uses a supplied API URL for an existing verification service and builds no backend', () => {
    const j = journey()
    const auth = j.steps.find((s) => s.kind === 'authentication')!
    if (auth.kind === 'authentication') auth.verifiesAgainst = { type: 'http_api' }
    const out = bundle(j, { verifyApiUrl: 'https://api.example.test/verify' })
    expect(out.spec.dataRequests[0].webhook.url).toBe('https://api.example.test/verify')
    expect(out.template.Resources).not.toHaveProperty('VerifyAuthFunction')
    expect(out.spec.flows.map((f) => f.flowId)).toContain('Authentication')
  })

  it('warns when the provisioner source is not supplied', () => {
    const j = journey()
    const out = emitBundle(j, selection(j), { ...options(), provisionerFiles: undefined })
    expect(out.warnings.join(' ')).toContain('provisioner source')
  })

  it('forces required items on even if the consultant selects nothing', () => {
    const out = emitBundle(journey(), [], options())
    expect(out.spec.flows.map((f) => f.flowId)).toContain('Authentication')
  })
})

describe('Amazon Connect contact flow', () => {
  const input = {
    name: 'CQA_ACXD_Call',
    channel: 'voice' as const,
    workspaceId: 'ws-1',
    applicationId: 'app-1',
    aliasId: 'alias-1',
    queueArn: 'arn:aws:connect:us-east-1:111122223333:instance/i/queue/q',
    queueName: 'BasicQueue',
    attributes: ['transferSummary', 'customerIntent', 'stuckPoint'],
  }
  const flow = emitContactFlow(input) as { StartAction: string; Actions: Array<{ Identifier: string; Type: string; Parameters: any; Transitions: any }>; Metadata: any }

  const referenced = (f: typeof flow) =>
    f.Actions.flatMap((a) => [a.Transitions.NextAction, ...(a.Transitions.Errors ?? []).map((e: { NextAction: string }) => e.NextAction), ...(a.Transitions.Conditions ?? []).map((c: { NextAction: string }) => c.NextAction)]).filter(Boolean)

  it('starts at an action that exists and every transition resolves', () => {
    const ids = new Set(flow.Actions.map((a) => a.Identifier))
    expect(ids.has(flow.StartAction)).toBe(true)
    for (const target of referenced(flow)) expect(ids.has(target), target).toBe(true)
  })

  it('configures the Agentic CX block like the real export', () => {
    const real = (realContactFlow as { Actions: Array<{ Type: string; Parameters: any }> }).Actions.find((a) => a.Type === 'ConnectParticipantWithAgenticCX')!
    const mine = flow.Actions.find((a) => a.Type === 'ConnectParticipantWithAgenticCX')!
    expect(Object.keys(mine.Parameters).sort()).toEqual(Object.keys(real.Parameters).sort())
    expect(Object.keys(mine.Parameters.AgentConfiguration).sort()).toEqual(['Alias', 'ApplicationId', 'WorkspaceId'])
    expect(mine.Parameters.SpeechRecognitionConfiguration).toEqual(real.Parameters.SpeechRecognitionConfiguration)
    expect(mine.Transitions.Conditions).toEqual([{ NextAction: expect.any(String), Condition: { Operator: 'Equals', Operands: ['Escalation'] } }])
  })

  it('copies the context variables to contact attributes with the real mapping syntax', () => {
    const attrs = flow.Actions.find((a) => a.Type === 'UpdateContactAttributes')!
    expect(attrs.Parameters.Attributes).toEqual({
      transferSummary: '$.AgenticCX.ContextVariables.transferSummary',
      customerIntent: '$.AgenticCX.ContextVariables.customerIntent',
      stuckPoint: '$.AgenticCX.ContextVariables.stuckPoint',
    })
    expect(flow.Metadata.ActionMetadata[attrs.Identifier].dynamicParams).toEqual(input.attributes)
  })

  it('uses only action types that appear in the real export', () => {
    const realTypes = new Set((realContactFlow as { Actions: Array<{ Type: string }> }).Actions.map((a) => a.Type))
    for (const a of flow.Actions) expect(realTypes.has(a.Type), a.Type).toBe(true)
  })

  it('emits the chat-only analytics block for chat and not for voice, and turns audio filler on for voice', () => {
    expect(flow.Actions.some((a) => a.Type === 'UpdateContactRecordingAndAnalyticsBehavior')).toBe(false)
    expect(flow.Actions.find((a) => a.Type === 'ConnectParticipantWithAgenticCX')!.Parameters.AudioFillerConfiguration).toEqual({ Enabled: true })
    const chat = emitContactFlow({ ...input, channel: 'chat' }) as typeof flow
    expect(chat.Actions.some((a) => a.Type === 'UpdateContactRecordingAndAnalyticsBehavior')).toBe(true)
    expect(chat.StartAction).not.toBe(flow.StartAction)
  })

  it('ends the contact after an error message instead of looping into the block', () => {
    const error = flow.Actions.find((a) => a.Identifier === 'Error')!
    const target = flow.Actions.find((a) => a.Identifier === error.Transitions.NextAction)!
    expect(target.Type).toBe('DisconnectParticipant')
  })

  it('is deterministic and has no unresolved placeholders', () => {
    expect(emitContactFlow(input)).toEqual(emitContactFlow(input))
    expect(JSON.stringify(flow)).not.toMatch(/<[A-Z_]+>|__[A-Z_]+__/)
  })
})

describe('console mode (deployed by hand in the CloudFormation console)', () => {
  const j = journey()
  const c = emitBundle(j, selection(j), options({ mode: 'console' }))
  const managed = emitBundle(j, selection(j), options({ mode: 'managed' }))
  it('uses the same template as managed mode: a secret ARN and the provisioner from S3, no key parameter', () => {
    expect(c.template).toEqual(managed.template)
    expect(JSON.stringify(c.template)).not.toContain('NoEcho')
  })
  it('ships no provisioner folder and a README with console steps and no CLI packaging', () => {
    expect(Object.keys(c.files).some((f) => f.startsWith('provisioner/'))).toBe(false)
    const readme = c.files['README.md']
    expect(readme).toContain('Deploy in the CloudFormation console')
    expect(readme).toContain('AcxdApiKeySecretArn')
    expect(readme).toContain('Explore table items')
    expect(readme).toContain('"S": "<')
    expect(readme).not.toContain('aws cloudformation package')
    expect(readme).not.toContain('deployed from the tool')
  })
  it('validates the bucket parameter so a pasted s3:// path is refused before anything is created', () => {
    const p = c.template.Parameters as Record<string, { AllowedPattern?: string }>
    const ok = new RegExp(`^(?:${p.ProvisionerCodeBucket.AllowedPattern})$`)
    expect(ok.test('journeyforge-code-123456789012')).toBe(true)
    for (const bad of ['s3://bucket', 'arn:aws:s3:::bucket', 'bucket/', 'bucket.', 'my bucket']) expect(ok.test(bad)).toBe(false)
  })
})

describe('managed mode (deployed by the tool)', () => {
  const j = journey()
  const managed = emitBundle(j, selection(j), options({ mode: 'managed' }))
  const r = managed.template.Resources as Record<string, { Type: string; Properties: Record<string, any> }>
  const p = managed.template.Parameters as Record<string, Record<string, unknown>>

  it('takes the ACXD key as a secret ARN in the target account, never as a parameter value', () => {
    expect(Object.keys(p).sort()).toEqual(['AcxdApiKeySecretArn', 'AcxdWorkspaceId', 'ProvisionerCodeBucket', 'ProvisionerCodeKey', 'TableName'])
    expect(p).not.toHaveProperty('AcxdApiKey')
    expect(r).not.toHaveProperty('AcxdApiKeySecret')
    expect(String(p.AcxdApiKeySecretArn.AllowedPattern)).toContain('secretsmanager')
  })

  it('reads the provisioner package from the artifacts bucket instead of a local path', () => {
    expect(r.ProvisionerFunction.Properties.Code).toEqual({ S3Bucket: { Ref: 'ProvisionerCodeBucket' }, S3Key: { Ref: 'ProvisionerCodeKey' } })
  })

  it('lets the provisioner read exactly the supplied secret and the generated shared key', () => {
    const resource = r.ProvisionerRole.Properties.Policies[0].PolicyDocument.Statement[0].Resource
    expect(resource).toEqual([{ Ref: 'AcxdApiKeySecretArn' }, { Ref: 'VerifyKeySecret' }])
    expect(r.AcxdProvision.Properties.ApiKeySecretArn).toEqual({ Ref: 'AcxdApiKeySecretArn' })
  })

  it('ships no provisioner folder and a README that says the tool deploys it', () => {
    expect(Object.keys(managed.files).some((f) => f.startsWith('provisioner/'))).toBe(false)
    expect(managed.files['README.md']).toContain('deployed from the tool')
    expect(managed.files['README.md']).not.toContain('aws cloudformation package')
  })

  it('keeps every created IAM role under one path so a deploy role can be limited to it', () => {
    for (const bundleOut of [managed, bundle()]) {
      const roles = Object.values(bundleOut.template.Resources as Record<string, { Type: string; Properties: Record<string, unknown> }>).filter((x) => x.Type === 'AWS::IAM::Role')
      expect(roles.length).toBe(2)
      for (const role of roles) expect(role.Properties.Path).toBe('/edith/')
    }
  })

  it('leaves the CLI mode unchanged', () => {
    expect(bundle().template.Parameters).toHaveProperty('AcxdApiKey')
    expect(bundle().template.Resources).toHaveProperty('AcxdApiKeySecret')
  })
})

describe('deployer template fixture', () => {
  it('is exactly what the emitter produces in managed mode (regenerate deployer-api/fixtures/managed-template.json if this fails)', () => {
    const j = journey()
    const out = emitBundle(j, selection(j), options({ mode: 'managed' }))
    const fixture = readFileSync(join(__dirname, '../../../deployer-api/fixtures/managed-template.json'), 'utf8')
    expect(out.files['template.json']).toBe(fixture)
  })
})
