import type { Journey, JourneyStep } from '../journey/model'
import { stepsOfKind } from '../journey/model'
import type {
  ChecklistItem,
  ChecklistParam,
  Need,
  RequiresReview,
  ResourceKind,
  ReviewSeverity,
  SchemaStatus,
} from './model'

/**
 * Deterministic rules: Journey in, checklist items and reviews out. No LLM, no I/O.
 * Each rule is a pure function so it can be tested against a journey fixture.
 *
 * Grounding: the patterns come from the Census CQA build (skill reference
 * `worked-example-census-cqa.md`, patterns P1 to P8). Schema statuses come from
 * `verified-console-and-export-findings.md`.
 */

export const IDS = {
  provisioner: 'platform.provisioner',
  apiKeySecret: 'platform.apiKeySecret',
  application: 'acxd.application',
  contactFlow: 'connect.contactFlow',
  contactAttributes: 'connect.contactAttributes',
  mainFlow: 'acxd.flow.MainConversation',
  authFlow: 'acxd.flow.Authentication',
  escalationFlow: 'acxd.flow.Escalation',
  safetyFlow: 'acxd.flow.SafetyEscalation',
  verifyRequest: 'acxd.dataRequest.verifyAuth',
  table: 'dynamodb.table.respondents',
  verifyLambda: 'lambda.function.verifyAuth',
  verifyRole: 'iam.role.verifyAuth',
  knowledgeBase: 'acxd.knowledgeBase',
  languages: 'acxd.languages',
  guardrailSafety: 'acxd.guardrail.safety',
  guardrailInjection: 'acxd.guardrail.promptInjection',
  guardrailToxicity: 'acxd.guardrail.toxicity',
  ctx: (name: string) => `acxd.contextVariable.${name}`,
} as const

export interface Draft {
  items: ChecklistItem[]
  reviews: RequiresReview[]
}

interface ItemInput {
  id: string
  kind: ResourceKind
  title: string
  reason: string
  need?: Need
  requires?: string[]
  sources?: string[]
  params?: ChecklistParam[]
  schemaStatus: SchemaStatus
  notes?: string[]
}

export function item(i: ItemInput): ChecklistItem {
  const need = i.need ?? 'required'
  return {
    id: i.id,
    kind: i.kind,
    title: i.title,
    reason: i.reason,
    need,
    selected: need !== 'optional',
    requires: i.requires ?? [],
    sources: i.sources ?? [],
    params: i.params ?? [],
    schemaStatus: i.schemaStatus,
    notes: i.notes ?? [],
  }
}

export function review(id: string, severity: ReviewSeverity, title: string, detail: string, sources: string[] = []): RequiresReview {
  return { id, severity, title, detail, sources }
}

const ids = (steps: JourneyStep[]) => steps.map((s) => s.id)
const empty = (): Draft => ({ items: [], reviews: [] })

// ---------------------------------------------------------------------------------------------

/** Always: the AWS-side plumbing every ACXD build needs. */
export function platformRules(journey: Journey): Draft {
  const hasVoice = journey.channels.includes('voice')
  return {
    items: [
      item({
        id: IDS.provisioner,
        kind: 'platform.provisioner',
        title: 'ACXD provisioner (CloudFormation custom resource)',
        reason:
          'ACXD has no import path and no native CloudFormation resource types; its resources are created by ordered SDK calls. A Lambda-backed custom resource performs them, idempotently, and handles stack deletion.',
        requires: [IDS.apiKeySecret],
        schemaStatus: 'partial',
        notes: ['The provisioner is generated code we own; the ACXD calls it makes are limited to confirmed schema (see each item).'],
      }),
      item({
        id: IDS.apiKeySecret,
        kind: 'platform.apiKeySecret',
        title: 'ACXD API key in Secrets Manager',
        reason: 'The provisioner needs an ACXD API key. It is a NoEcho template parameter stored in Secrets Manager; the app never stores or sees it.',
        params: [
          { key: 'AcxdWorkspaceId', label: 'ACXD workspace ID' },
          { key: 'AcxdApiKey', label: 'ACXD API key (acxd_live_...)', secret: true },
        ],
        schemaStatus: 'confirmed',
      }),
      item({
        id: IDS.application,
        kind: 'acxd.application',
        title: 'ACXD application',
        reason: 'The deployable unit that bundles the flows, default behaviours and guardrails.',
        params: [{ key: 'ApplicationName', label: 'Application name', example: 'CQA Demo' }],
        schemaStatus: 'partial',
        notes: [
          'Default behaviours: Welcome and Unknown to the main conversation flow; Fallback (system failure) and Incomprehension (max misses) to the escalation flow.',
          'The application export shape has not been seen; settings follow the SDK docs and are not yet verified against a real export.',
        ],
      }),
      item({
        id: IDS.contactFlow,
        kind: 'connect.contactFlow',
        title: 'Thin Amazon Connect contact flow with the Agentic CX block',
        reason:
          'Entry, call setup and queue transfer stay in Connect; the conversation moves behind one Agentic CX block, and the Escalation exit transfers to a queue.',
        requires: [IDS.application],
        params: [
          { key: 'ConnectInstanceId', label: 'Amazon Connect instance ID' },
          { key: 'DeploymentAlias', label: 'ACXD deployment alias', example: 'Production' },
        ],
        schemaStatus: 'partial',
        notes: [
          'Contact-flow JSON for the Agentic CX block is confirmed from a real export.',
          'TODO(acxd-schema): confirm that the CloudFormation Connect contact-flow resource accepts the Agentic CX block action type.',
          ...(hasVoice ? ['TODO(acxd-schema): the Set voice block JSON is not in any export; add it in the console.'] : []),
        ],
      }),
    ],
    reviews: [],
  }
}

/** Entry conversation: greeting, intent capture and (optionally) FAQ from a knowledge base. */
export function conversationRules(journey: Journey): Draft {
  const out = empty()
  const greetings = stepsOfKind(journey, 'greeting')
  const intents = stepsOfKind(journey, 'intent_capture')
  const selfService = stepsOfKind(journey, 'self_service')
  if (greetings.length === 0 && intents.length === 0 && selfService.length === 0) return out

  const sources = ids([...greetings, ...intents, ...selfService])
  out.items.push(
    item({
      id: IDS.mainFlow,
      kind: 'acxd.flow',
      title: 'Main conversation flow',
      reason:
        'Plays the greeting and handles open conversation (including FAQ answers from knowledge). A Generative Journey with named exit conditions hands the caller to the other flows.',
      requires: [IDS.application],
      sources,
      schemaStatus: 'confirmed',
      notes: [
        'Greeting and prompts are copied verbatim from the journey.',
        'Each exit condition (for example "complete the questionnaire") is wired by a Redirect to the target flow.',
      ],
    }),
  )

  const faq = selfService.filter((s) => s.content === 'knowledge_base')
  if (faq.length > 0) {
    out.items.push(
      item({
        id: IDS.knowledgeBase,
        kind: 'acxd.knowledgeBase',
        title: 'Knowledge base for self-service answers',
        reason: 'Self-service steps answer from knowledge, so the Journey needs a knowledge base tool.',
        requires: [IDS.mainFlow],
        sources: ids(faq),
        params: [{ key: 'KnowledgeContent', label: 'Source content (Q&A JSON/CSV or documents)' }],
        schemaStatus: 'unconfirmed',
        notes: [
          'The knowledge base export shape has not been seen. The flow node that references it (tool type knowledgeBase) is confirmed.',
          'Content must come from the customer; the app cannot invent it.',
        ],
      }),
    )
  }

  for (const s of selfService) {
    if (s.content !== 'knowledge_base') {
      out.reviews.push(
        review(
          `review.selfService.${s.id}`,
          'blocker',
          `Self-service step "${s.name}" is not knowledge-based`,
          `Content source is "${s.content}". An API- or transaction-backed step needs a data request and a design the journey does not describe.`,
          [s.id],
        ),
      )
    } else if (s.mode === 'form') {
      out.reviews.push(
        review(
          `review.form.${s.id}`,
          'warn',
          `"${s.name}" is modelled as a knowledge-grounded conversation`,
          'The journey describes completing a questionnaire but not its questions or where answers are stored. It is built as a conversation grounded in the knowledge base; confirm that is intended.',
          [s.id],
        ),
      )
    }
  }

  // Intent retry maps to the application's Incomprehension threshold.
  for (const s of intents) {
    if (s.retry.maxAttempts > 0 && s.retry.onExhausted === 'escalate') {
      out.items.find((i) => i.id === IDS.mainFlow)?.notes.push(
        `Intent recognition: after ${s.retry.maxAttempts} misses the application default Incomprehension routes to the escalation flow (spoken: "${s.retry.reprompt ?? ''}").`,
      )
    }
  }
  return out
}

/** Authentication step: flow, data request, backing store and variables. */
export function authenticationRules(journey: Journey): Draft {
  const out = empty()
  const auths = stepsOfKind(journey, 'authentication')
  if (auths.length === 0) return out
  const auth = auths[0]
  const src = ids(auths)

  if (auths.length > 1) {
    out.reviews.push(
      review('review.auth.multiple', 'warn', 'More than one authentication step', 'Only the first is modelled; confirm whether the others are the same check.', src),
    )
  }

  out.items.push(
    item({
      id: IDS.authFlow,
      kind: 'acxd.flow',
      title: 'Authentication flow',
      reason: `The caller is verified before the intents that require it (${auth.identifiers.join(', ')}; ${auth.match === 'any' ? 'any one is enough' : 'all must match'}).`,
      requires: [IDS.verifyRequest, IDS.ctx('isAuthenticated'), IDS.escalationFlow, IDS.mainFlow, IDS.ctx('stuckPoint'), IDS.ctx('customerIntent')],
      sources: src,
      schemaStatus: 'confirmed',
      notes: [
        `Prompt text is verbatim. A retry Loop caps attempts at ${auth.retry.maxAttempts} (Loop range 0 to ${Math.max(auth.retry.maxAttempts - 1, 0)}, end value is inclusive); the slot is cleared between attempts.`,
        'The identifiers are captured into ONE slot (authValue) by a Generative Journey with data capture, because a single choice node cannot hold several slots of the same type; the backend checks the value against every identifier.',
        'On success: isAuthenticated is set and the caller is redirected to the main conversation flow. On exhaustion, data-request failure or timeout: stuckPoint and customerIntent are set and the caller is redirected to the escalation flow.',
      ],
    }),
    item({
      id: IDS.ctx('isAuthenticated'),
      kind: 'acxd.contextVariable',
      title: 'Context variable isAuthenticated',
      reason: 'Remembers that the caller has authenticated so later requests skip the check.',
      sources: src,
      schemaStatus: 'confirmed',
      notes: ['Boolean; external modification disallowed so only flows can set it.'],
    }),
    item({
      id: IDS.verifyRequest,
      kind: 'acxd.dataRequest',
      title: 'Data request verifyAuth (External, POST)',
      reason: 'Calls the verification backend with the caller-supplied value and receives { verified: boolean }.',
      requires: [IDS.apiKeySecret],
      sources: src,
      schemaStatus: 'confirmed',
      notes: ['Request field authValue is sensitive; delete unused fields from the request model because every field is sent.'],
    }),
  )

  switch (auth.verifiesAgainst.type) {
    case 'dynamodb':
      out.items.push(
        item({
          id: IDS.table,
          kind: 'dynamodb.table',
          title: 'DynamoDB table of respondent records',
          reason: 'Holds the records the caller is verified against, with an index per identifier that is not the key.',
          sources: src,
          params: [{ key: 'TableName', label: 'Table name', example: 'CensusIds' }],
          schemaStatus: 'confirmed',
          notes: [
            `Partition key = ${auth.identifiers[0]}; one global secondary index (keys only) for each other identifier.`,
            'Demo records are seeded by the consultant, not by the app.',
          ],
        }),
        item({
          id: IDS.verifyLambda,
          kind: 'lambda.function',
          title: 'Verification Lambda with a Function URL',
          reason: 'Receives the data request, checks the value against the table and returns { verified }. Protected by an x-api-key header held in the ACXD secret.',
          requires: [IDS.table, IDS.verifyRole, IDS.apiKeySecret],
          sources: src,
          schemaStatus: 'confirmed',
          notes: ['Function URL with auth type NONE; the shared header is the guard (demo-grade).'],
        }),
        item({
          id: IDS.verifyRole,
          kind: 'iam.role',
          title: 'IAM role for the verification Lambda',
          reason: 'GetItem on the table and Query on its indexes, plus basic logging.',
          requires: [IDS.table],
          sources: src,
          schemaStatus: 'confirmed',
        }),
      )
      out.items.find((i) => i.id === IDS.verifyRequest)?.requires.push(IDS.verifyLambda)
      break
    case 'http_api':
      out.items.find((i) => i.id === IDS.verifyRequest)?.params.push({ key: 'VerifyApiUrl', label: 'Verification API URL' })
      break
    case 'lambda':
      out.items.find((i) => i.id === IDS.verifyRequest)?.params.push({ key: 'VerifyFunctionUrl', label: 'Existing Lambda Function URL' })
      break
    default:
      out.reviews.push(
        review(
          'review.auth.backend',
          'blocker',
          'Authentication backend is not specified',
          'The journey does not say what the caller is verified against. Choose DynamoDB, an API or an existing Lambda before the data request can be generated.',
          src,
        ),
      )
  }
  return out
}

const CONTEXT_PATTERNS: Array<{ test: RegExp; name: string; label: string }> = [
  { test: /summar/i, name: 'transferSummary', label: 'conversation summary' },
  { test: /intent/i, name: 'customerIntent', label: 'caller intent' },
  { test: /stuck|point|where/i, name: 'stuckPoint', label: 'where the caller got stuck' },
]

const camel = (text: string) =>
  text
    .replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase())

/** Maps one context string to a context variable name; unknown strings get a derived name. */
export function contextVariableFor(label: string): { name: string; known: boolean } {
  const hit = CONTEXT_PATTERNS.find((p) => p.test.test(label))
  return hit ? { name: hit.name, known: true } : { name: camel(label) || 'context', known: false }
}

/** Escalation: flow, hand-back variables and contact attributes. */
/**
 * Steps that lead to a live agent: explicit escalations, intent retry limits that escalate, and every authentication step (the authentication
 * flow always redirects to the escalation flow when its attempts run out, whatever the diagram says).
 */
function escalationSources(journey: Journey) {
  const escalations = stepsOfKind(journey, 'escalation')
  const retried = [
    ...stepsOfKind(journey, 'intent_capture').filter((s) => s.retry.maxAttempts > 0 && s.retry.onExhausted === 'escalate'),
    ...stepsOfKind(journey, 'authentication'),
  ]
  return { escalations, retried }
}

/** The hand-back variables every escalation (including the baseline safety flow) needs, whatever the journey's own list says. */
const BASELINE_CONTEXT = [
  { name: 'transferSummary', label: 'conversation summary' },
  { name: 'customerIntent', label: 'caller intent' },
] as const

/** With an escalation flow, the authentication flow also sets where the caller got stuck. */
const ESCALATION_CONTEXT = [...BASELINE_CONTEXT, { name: 'stuckPoint', label: 'point at which the caller got stuck' }] as const

export function escalationRules(journey: Journey): Draft {
  const out = empty()
  const { escalations, retried } = escalationSources(journey)
  if (escalations.length === 0 && retried.length === 0) return out

  const src = ids([...escalations, ...retried])
  const context = new Map<string, { known: boolean; label: string }>()
  for (const e of escalations) {
    for (const label of e.context) {
      const v = contextVariableFor(label)
      context.set(v.name, { known: v.known, label })
    }
  }
  // Agents always benefit from a summary and the caller's intent, even if the journey did not ask for them (and the safety flow needs both).
  for (const b of ESCALATION_CONTEXT) if (!context.has(b.name)) context.set(b.name, { known: true, label: b.label })

  const queue = escalations.find((e) => e.queue)?.queue
  out.items.push(
    item({
      id: IDS.escalationFlow,
      kind: 'acxd.flow',
      title: 'Escalation flow',
      reason: 'Hands the caller to a live agent with context: a generated summary, then an Escalate node that returns control to Connect.',
      requires: [IDS.application, ...[...context.keys()].map(IDS.ctx)],
      sources: src,
      schemaStatus: 'confirmed',
      notes: [
        'Generative text summarises the transcript without identifiers; its Success, Timeout and Failure all continue to Escalate so a failed summary never blocks the transfer.',
        'Wired as the application default for Fallback and Incomprehension.',
      ],
    }),
    item({
      id: IDS.contactAttributes,
      kind: 'connect.contactAttributes',
      title: 'Hand-back contact attributes',
      reason: 'Copies the context variables to contact attributes so the agent sees them.',
      requires: [IDS.contactFlow],
      sources: src,
      params: queue ? [] : [{ key: 'EscalationQueue', label: 'Connect queue for escalations', example: 'BasicQueue' }],
      schemaStatus: 'confirmed',
      notes: [`Attributes: ${[...context.keys()].join(', ')} (mapped from $.AgenticCX.ContextVariables.<name>).`],
    }),
  )
  for (const [name, c] of context) {
    out.items.push(
      item({
        id: IDS.ctx(name),
        kind: 'acxd.contextVariable',
        title: `Context variable ${name}`,
        reason: `Carries "${c.label}" to the agent.`,
        sources: src,
        schemaStatus: 'confirmed',
      }),
    )
    if (!c.known) {
      out.reviews.push(
        review(
          `review.context.${name}`,
          'warn',
          `Custom hand-over item "${c.label}"`,
          `A variable "${name}" is created, but how its value is produced (set by a flow, or generated) is not described in the journey.`,
          src,
        ),
      )
    }
  }
  return out
}

/** Baseline guardrails are not in the diagram; they are recommended for any caller-facing agent. */
export function guardrailRules(journey: Journey): Draft {
  const reason = 'Not in the journey. Recommended baseline from the Census build.'
  // The safety flow needs the hand-back variables. When the journey has no escalation, nothing else creates them.
  const { escalations, retried } = escalationSources(journey)
  const baselineContext =
    escalations.length === 0 && retried.length === 0
      ? BASELINE_CONTEXT.map((b) =>
          item({
            id: IDS.ctx(b.name),
            kind: 'acxd.contextVariable',
            title: `Context variable ${b.name}`,
            reason: `Carries "${b.label}" to the agent; the safety escalation flow uses it.`,
            need: 'recommended',
            sources: [],
            schemaStatus: 'confirmed',
          }),
        )
      : []
  return {
    items: [
      ...baselineContext,
      item({
        id: IDS.guardrailSafety,
        kind: 'acxd.guardrail',
        title: 'Guardrail: safety statements',
        reason: `${reason} Routes statements about self-harm or threats to a safety flow with fixed wording.`,
        need: 'recommended',
        requires: [IDS.safetyFlow],
        schemaStatus: 'confirmed',
      }),
      item({
        id: IDS.safetyFlow,
        kind: 'acxd.flow',
        title: 'Safety escalation flow',
        reason: 'Fixed emergency-resources message, then Escalate with a fixed (not generated) summary.',
        need: 'recommended',
        requires: [IDS.application, IDS.ctx('transferSummary'), IDS.ctx('customerIntent')],
        schemaStatus: 'confirmed',
        notes: ['The emergency wording is customer-owned; the app uses the Census text only as a starting point and flags it for review.'],
      }),
      item({
        id: IDS.guardrailInjection,
        kind: 'acxd.guardrail',
        title: 'Guardrail: prompt injection',
        reason: `${reason} Replaces manipulation attempts with a fixed redirect message.`,
        need: 'recommended',
        schemaStatus: 'confirmed',
      }),
      item({
        id: IDS.guardrailToxicity,
        kind: 'acxd.guardrail',
        title: 'Guardrail: toxicity (flag only)',
        reason: `${reason} Flags targeted abuse without blocking ordinary frustration.`,
        need: 'recommended',
        schemaStatus: 'confirmed',
      }),
    ],
    reviews: [],
  }
}

/** Languages beyond the first, and language detection. */
export function languageRules(journey: Journey): Draft {
  const out = empty()
  const detection = stepsOfKind(journey, 'language_detection')
  if (journey.languages.length > 1 || detection.length > 0) {
    out.items.push(
      item({
        id: IDS.languages,
        kind: 'acxd.languages',
        title: `Languages: ${journey.languages.join(', ')}`,
        reason: 'The journey must serve more than one language: application languages, a voice per language and translations.',
        requires: [IDS.application],
        sources: ids(detection),
        schemaStatus: 'unconfirmed',
        notes: [
          'TODO(acxd-schema): per-language voices and translations are not verified against a real export.',
          'Prompts that are client wording need a person-reviewed translation, not machine output.',
        ],
      }),
    )
  }
  for (const d of detection) {
    out.reviews.push(
      review(
        `review.language.${d.id}`,
        'blocker',
        'Language detection and switching in ACXD is unverified',
        `The journey detects the caller's language (${d.languages.join(', ')}${d.method ? `; via ${d.method}` : ''}). How ACXD detects and switches language in an ACXD-only design has not been verified.`,
        [d.id],
      ),
    )
  }
  return out
}

/** Compliance wording, unknown steps, unmapped items and orphan steps (constraint 3 and 4). */
export function reviewRules(journey: Journey): Draft {
  const out = empty()

  const regulated = journey.steps.filter((s) => 'compliance' in s && s.compliance === true)
  if (regulated.length > 0) {
    out.reviews.push(
      review(
        'review.compliance',
        'info',
        'Regulated wording is copied verbatim',
        'These prompts are marked as compliance text and are never reworded. Confirm legal sign-off on them.',
        ids(regulated),
      ),
    )
  }

  for (const s of stepsOfKind(journey, 'unknown')) {
    out.reviews.push(review(`review.unknown.${s.id}`, 'warn', `Unclassified step "${s.label}"`, `The source step could not be classified: ${s.raw}`, [s.id]))
  }
  journey.unmapped.forEach((u, i) => {
    out.reviews.push(review(`review.unmapped.${i}`, 'warn', 'Part of the source journey is not modelled', u.description, []))
  })
  journey.assumptions.forEach((a, i) => {
    out.reviews.push(review(`review.assumption.${i}`, 'info', 'Assumption to confirm', a.statement, []))
  })

  // Reachability from the first step: an unreachable step is surfaced, never silently dropped.
  const first = journey.steps[0]
  if (first) {
    const byId = new Map(journey.steps.map((s) => [s.id, s]))
    const seen = new Set<string>()
    const stack = [first.id]
    while (stack.length > 0) {
      const id = stack.pop() as string
      if (seen.has(id)) continue
      seen.add(id)
      for (const e of byId.get(id)?.next ?? []) stack.push(e.to)
    }
    for (const s of journey.steps) {
      if (!seen.has(s.id)) {
        out.reviews.push(
          review(`review.orphan.${s.id}`, 'warn', `Step "${s.label}" is never reached`, 'No path from the first step leads here. Confirm whether it is dead or a missing connection.', [s.id]),
        )
      }
    }
  }
  return out
}

export const RULES: Array<(journey: Journey) => Draft> = [
  platformRules,
  conversationRules,
  authenticationRules,
  escalationRules,
  languageRules,
  guardrailRules,
  reviewRules,
]
