import type { AuthenticationStep, Journey } from '../../journey/model'
import { stepsOfKind } from '../../journey/model'
import { IDS } from '../../checklist/rules'
import { AUTH_SLOT, FLOW_IDS, authenticationFlow, escalationFlow, mainFlow, safetyFlow } from './flows'
import type { FlowContent } from './flows'
import type { FlowJson } from './flowBuilder'

/** Placeholders the CloudFormation layer swaps for template intrinsics. Never real values. */
export const TOKENS = {
  verifyUrl: '__VERIFY_AUTH_URL__',
  verifyKeySecretArn: '__VERIFY_KEY_SECRET_ARN__',
} as const

export const VERIFY_REQUEST_ID = 'verifyAuth'
export const VERIFY_SECRET_NAME = 'verifyAuthApiKey'

export interface ContextVariablePayload {
  name: string
  schema: { type: 'string' | 'boolean' | 'number' }
  disallowExternalModification?: boolean
}

/**
 * A data request in the shape ACXD exports it (confirmed from a real export, fixtures/dataRequest.verifyAuth.json): a v3 webhook with the URL and
 * headers under `environments.production`, and a secret referenced as `{<name>:NLX.Secret}`. The documentation's `{{secrets.<name>}}` and flat
 * `webhook.url` are not what the console stores; the console flags the documented form with a red icon and the call fails.
 */
export interface DataRequestPayload {
  dataRequestId: string
  type: 'object'
  webhook: {
    version: 'v3'
    sendContext: boolean
    implementation: 'external'
    method: 'POST'
    environments: { production: { url: string; headers: Array<{ key: string; value: string; dynamic: boolean; required: boolean }> } }
  }
  description: string
  sensitive: true
  streamStateModifications: boolean
  requestSchema: unknown
  responseSchema: unknown
  metadata: { path: string; tags: string[] }
}

/** A guardrail exactly as exported from a workspace, minus the empty guardrailId. Wording is customer-owned. */
export type GuardrailDefinition = Record<string, unknown> & { name: string }

export interface GuardrailContent {
  safety?: GuardrailDefinition
  promptInjection?: GuardrailDefinition
  toxicity?: GuardrailDefinition
}

/**
 * A custom slot type that flows attach slots of. The Census workspace's `Freeformtext` has no values (a free-text capture), one language and is not
 * sensitive (the slot attached to it is). Built-in types (`NLX.*`) need nothing. Created before the flows and never deleted: shared by other flows.
 */
export interface SlotTypePayload {
  slotTypeId: string
  values: never[]
  sensitive: boolean
  mainLanguageCode: string
  languageCodes: string[]
}

/**
 * Guardrail rules are labelled with analytics tags, which are workspace-level objects that must exist before the application builds
 * (ACXD's Build reports "Unavailable reference" otherwise). The provisioner creates them first and never deletes them: they are shared
 * labels that other applications may use.
 */
export interface AnalyticsTagPayload {
  name: string
  /** TODO(acxd-schema): the sentiment of a tag the source workspace used is not in the guardrail export; these are all flagged events, so 'negative'. */
  type: 'positive' | 'negative' | 'neutral'
  description: string
}

export interface AcxdSpec {
  /** Values are read from Secrets Manager by the provisioner at deploy time; never stored here. */
  secrets: Array<{ name: string; sourceSecretArn: string }>
  slotTypes: SlotTypePayload[]
  contextVariables: ContextVariablePayload[]
  dataRequests: DataRequestPayload[]
  flows: FlowJson[]
  guardrails: GuardrailDefinition[]
  analyticsTags: AnalyticsTagPayload[]
  application: {
    name: string
    description: string
    flowIds: string[]
    /** Resolved to server-assigned ids by the provisioner. */
    guardrailNames: string[]
    settings: {
      languageCode: string
      languageCodes: string[]
      languageSettings: Array<{ languageCode: string; useNativeLanguage: boolean }>
      defaultFlows: Record<string, { flowId: string }>
      thresholds: { incomprehensionCount: number }
      conversationTTL: number
      repeatOnIncomprehension: boolean
    }
  }
}

export interface SpecOptions {
  applicationName: string
  content?: FlowContent
  guardrails?: GuardrailContent
  /** Existing verification API when the journey does not use DynamoDB. */
  verifyApiUrl?: string
}

export interface Skipped {
  id: string
  reason: string
}

export interface SpecResult {
  spec: AcxdSpec
  warnings: string[]
  skipped: Skipped[]
  /** Steps the SDK cannot do (or is not documented to do), left for the console. */
  consoleSteps: string[]
}

const contextName = (id: string): string | null => (id.startsWith('acxd.contextVariable.') ? id.slice('acxd.contextVariable.'.length) : null)

/**
 * Builds the ACXD side of the implementation from the journey and the consultant's selection. Only
 * confirmed schema is emitted; everything else is returned in `skipped` with the reason, never guessed.
 */
export function buildAcxdSpec(journey: Journey, selected: ReadonlySet<string>, opts: SpecOptions): SpecResult {
  const warnings: string[] = []
  const skipped: Skipped[] = []
  const consoleSteps: string[] = []
  const content = opts.content ?? {}
  const languageCodes = journey.languages
  const auth: AuthenticationStep | undefined = stepsOfKind(journey, 'authentication')[0]
  const has = (id: string) => selected.has(id)

  // --- context variables -------------------------------------------------------------------------
  const contextVariables: ContextVariablePayload[] = [...selected]
    .map(contextName)
    .filter((n): n is string => n !== null)
    .map((name) =>
      name === 'isAuthenticated'
        ? { name, schema: { type: 'boolean' as const }, disallowExternalModification: true }
        : { name, schema: { type: 'string' as const } },
    )

  // --- flows (dependency order: targets of redirects first) ----------------------------------------
  const flows: FlowJson[] = []
  const collect = (built: { flow: FlowJson; warnings: string[] }) => {
    flows.push(built.flow)
    warnings.push(...built.warnings)
  }
  if (has(IDS.escalationFlow)) collect(escalationFlow(languageCodes, content))
  if (has(IDS.safetyFlow)) collect(safetyFlow(languageCodes, content))
  const mainSelected = has(IDS.mainFlow)

  // --- data request for authentication -------------------------------------------------------------
  const dataRequests: DataRequestPayload[] = []
  const secrets: AcxdSpec['secrets'] = []
  let authFlowEmitted = false
  if (auth && has(IDS.authFlow)) {
    let url: string | null = null
    const headers: DataRequestPayload['webhook']['environments']['production']['headers'] = []
    if (auth.verifiesAgainst.type === 'dynamodb') {
      url = TOKENS.verifyUrl
      secrets.push({ name: VERIFY_SECRET_NAME, sourceSecretArn: TOKENS.verifyKeySecretArn })
      headers.push({ key: 'x-api-key', value: `{${VERIFY_SECRET_NAME}:NLX.Secret}`, dynamic: false, required: false })
    } else if (auth.verifiesAgainst.type === 'http_api' || auth.verifiesAgainst.type === 'lambda') {
      url = opts.verifyApiUrl ?? null
      if (!url) skipped.push({ id: IDS.verifyRequest, reason: 'The verification API URL was not supplied.' })
      else warnings.push('The existing verification API is called without an API-key header; add one if it needs it.')
    } else {
      skipped.push({ id: IDS.verifyRequest, reason: 'The verification backend is not specified in the journey.' })
    }
    if (!url) skipped.push({ id: IDS.authFlow, reason: 'The authentication flow needs the verification data request, which could not be generated.' })
    if (url) {
      const schema = (properties: Record<string, unknown>) => ({ type: 'object', properties, isSensitive: false, title: '', description: '' })
      dataRequests.push({
        dataRequestId: VERIFY_REQUEST_ID,
        type: 'object',
        webhook: { version: 'v3', sendContext: true, implementation: 'external', method: 'POST', environments: { production: { url, headers } } },
        description: 'Verifies the value the caller gave against the respondent records.',
        sensitive: true,
        streamStateModifications: false,
        requestSchema: schema({ [AUTH_SLOT]: { type: 'string', isSensitive: true, title: '', description: '' } }),
        responseSchema: schema({ verified: { type: 'boolean', isSensitive: false, title: '', description: '' } }),
        metadata: { path: '', tags: [] },
      })
      if (!mainSelected) {
        skipped.push({ id: IDS.authFlow, reason: 'The authentication flow redirects to the main conversation flow, which is not selected.' })
      } else {
        const intent = stepsOfKind(journey, 'intent_capture').flatMap((s) => s.intents).find((i) => i.requiresAuth)
        const descriptions = stepsOfKind(journey, 'intent_capture')
          .flatMap((s) => s.intents)
          .filter((i) => i.requiresAuth)
          .map((i) => i.description ?? i.name)
        collect(
          authenticationFlow(auth, {
            dataRequestId: VERIFY_REQUEST_ID,
            successFlowId: FLOW_IDS.main,
            intentName: intent?.name ?? 'authenticated request',
            aiDescription: `The caller's request requires verifying their identity: ${descriptions.join('; ') || 'authenticated requests'}.`,
            languageCodes,
          }),
        )
        authFlowEmitted = true
      }
    }
  } else if (auth) {
    skipped.push({ id: IDS.authFlow, reason: 'Not selected.' })
  }

  if (mainSelected) {
    collect(mainFlow(journey, { authenticationFlowId: authFlowEmitted ? FLOW_IDS.authentication : undefined, content, languageCodes }))
  }

  // --- guardrails (wording is customer-owned: supplied, never invented) ---------------------------
  const guardrails: GuardrailDefinition[] = []
  const wanted: Array<[string, GuardrailDefinition | undefined, string]> = [
    [IDS.guardrailSafety, opts.guardrails?.safety, 'safety'],
    [IDS.guardrailInjection, opts.guardrails?.promptInjection, 'prompt injection'],
    [IDS.guardrailToxicity, opts.guardrails?.toxicity, 'toxicity'],
  ]
  for (const [id, definition, label] of wanted) {
    if (!has(id)) continue
    if (!definition) skipped.push({ id, reason: `The ${label} guardrail wording is customer-specific and was not supplied.` })
    else {
      const { guardrailId: _ignored, ...rest } = definition as Record<string, unknown>
      guardrails.push(rest as GuardrailDefinition)
    }
  }

  // --- custom slot types the flows attach (anything that is not a built-in NLX.* type) -------------
  const slotTypes: SlotTypePayload[] = []
  for (const f of flows) {
    for (const attached of f.slotTypes) {
      if (attached.type.startsWith('NLX.') || slotTypes.some((t) => t.slotTypeId === attached.type)) continue
      slotTypes.push({ slotTypeId: attached.type, values: [], sensitive: false, mainLanguageCode: languageCodes[0], languageCodes })
    }
  }

  // --- analytics tags referenced by the guardrail rules --------------------------------------------
  const analyticsTags: AnalyticsTagPayload[] = []
  for (const g of guardrails) {
    for (const rule of Array.isArray(g.rules) ? (g.rules as Array<{ tags?: Array<{ label?: unknown }> }>) : []) {
      for (const tag of rule.tags ?? []) {
        const label = tag.label
        if (typeof label !== 'string' || analyticsTags.some((t) => t.name === label)) continue
        if (!/^[A-Za-z0-9_]{1,36}$/.test(label)) {
          warnings.push(`Guardrail ${g.name} uses the analytics tag "${label}", which ACXD does not allow as a tag name (letters, digits and underscores, up to 36); create it in the console.`)
          continue
        }
        analyticsTags.push({ name: label, type: 'negative', description: `Raised by the ${g.name} guardrail`.slice(0, 64) })
      }
    }
  }

  // --- application --------------------------------------------------------------------------------
  const intentRetry = stepsOfKind(journey, 'intent_capture')[0]?.retry.maxAttempts
  const defaultFlows: Record<string, { flowId: string }> = {}
  if (mainSelected) {
    defaultFlows.welcome = { flowId: FLOW_IDS.main }
    defaultFlows.unknown = { flowId: FLOW_IDS.main }
  }
  if (has(IDS.escalationFlow)) defaultFlows.fallback = { flowId: FLOW_IDS.escalation }
  if (has(IDS.escalationFlow)) {
    consoleSteps.push(
      `Application > Design > Manage default behavior: set **Incomprehension** to the flow ${FLOW_IDS.escalation} (the SDK key for this default is not documented, so the provisioner does not set it).`,
    )
  }
  consoleSteps.push('Application > Deploy: build, fix any validation errors, then deploy to your environment and note the deployment alias.')

  for (const id of selected) {
    if (id === IDS.knowledgeBase && !content.knowledgeBaseId) {
      skipped.push({ id, reason: 'Knowledge base schema is unconfirmed; create it in the console and supply its id (content.knowledgeBaseId).' })
    }
    if (id === IDS.languages) {
      skipped.push({ id, reason: 'Language settings, voices and translations are unconfirmed; configure them in the console.' })
    }
  }

  const spec: AcxdSpec = {
    secrets,
    slotTypes,
    contextVariables,
    dataRequests,
    flows,
    guardrails,
    analyticsTags,
    application: {
      name: opts.applicationName,
      description: `Generated from the journey "${journey.title}".`,
      flowIds: flows.map((f) => f.flowId),
      guardrailNames: guardrails.map((g) => g.name),
      settings: {
        languageCode: languageCodes[0],
        languageCodes,
        languageSettings: languageCodes.map((languageCode) => ({ languageCode, useNativeLanguage: true })),
        defaultFlows,
        thresholds: { incomprehensionCount: intentRetry && intentRetry > 0 ? intentRetry : 2 },
        conversationTTL: 5,
        repeatOnIncomprehension: true,
      },
    },
  }
  return { spec, warnings, skipped, consoleSteps }
}
