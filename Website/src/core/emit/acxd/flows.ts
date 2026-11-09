import type { AuthenticationStep, Journey } from '../../journey/model'
import { stepsOfKind } from '../../journey/model'
import { FlowBuilder, clearSlot, exitIndex, setContext, status, variableIs } from './flowBuilder'
import type { FlowJson } from './flowBuilder'

/** Fixed flow ids. Alphanumeric, 3 to 64 characters (ACXD flowId rule). */
export const FLOW_IDS = {
  main: 'MainConversation',
  authentication: 'Authentication',
  escalation: 'Escalation',
  safety: 'SafetyEscalation',
} as const

export const AUTH_SLOT = 'authValue'

export interface BuiltFlow {
  flow: FlowJson
  warnings: string[]
}

/** Customer-owned wording the emitter must not invent. Supplied by the caller, or defaulted and warned about. */
export interface FlowContent {
  /** The main Journey prompt (persona, tone, scope). */
  mainPrompt?: string
  /** Knowledge base the main Journey answers from. */
  knowledgeBaseId?: string
  /** Fixed text spoken before a safety escalation. */
  safetyMessage?: string
  /** Prompt for the generated hand-over summary. */
  summaryPrompt?: string
}

const orList = (items: string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`)
const lowerFirst = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s)
const pascal = (s: string): string => s.replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_m, _sep, c: string) => c.toUpperCase())

export const DEFAULT_SUMMARY_PROMPT =
  'Summarise this phone conversation for the agent taking the call in 2-3 short sentences. Include what the caller wanted and, if they were verifying their identity, whether verification succeeded. Do not include any identifiers such as ID numbers, zip codes or SSN digits. Conversation: {System.transcript:NLX.System}'

/** Pattern P2: a generated summary, then Escalate. A failed summary never blocks the transfer. */
export function escalationFlow(languageCodes: string[], content: FlowContent = {}): BuiltFlow {
  const prompt = content.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT
  const b = new FlowBuilder(FLOW_IDS.escalation, { description: 'Hands the caller to a live agent with a generated summary.', languageCodes })
  b.node('start', 'start')
    .node('summary', 'generative_text', {
      metadata: { generativeText: { modelType: 'amazon-nova-2-lite', name: 'summaryText', prompt, maxTokens: 4000, temperature: 0.5 } },
    })
    .node('escalate', 'escalate', { stateModifications: [setContext('transferSummary', '{summaryText:NLX.Local}')] })
    .edge('start', 'summary')
    .edge('summary', 'escalate', status('success'))
    .edge('summary', 'escalate', status('timeout'))
    .edge('summary', 'escalate', status('failure'))
    .edge('escalate', null, status('continuation'))
  return { flow: b.build(), warnings: content.summaryPrompt ? [] : ['Escalation summary uses the generic default prompt; review it with the customer.'] }
}

export const DEFAULT_SAFETY_MESSAGE =
  "I'm concerned about what you've shared.\nIf you or someone else may be in immediate danger, call 911 right away.\nIf you are thinking about harming yourself or need emotional support, call or text 988, the Suicide & Crisis Lifeline, for immediate assistance.\nI'm going to connect you with a Census representative for additional assistance."

/** Pattern P3: fixed wording, then Escalate with a FIXED summary (no model on a safety path). */
export function safetyFlow(languageCodes: string[], content: FlowContent = {}): BuiltFlow {
  const message = content.safetyMessage ?? DEFAULT_SAFETY_MESSAGE
  const b = new FlowBuilder(FLOW_IDS.safety, { description: 'Safety statements: fixed emergency-resources message, then a live agent.', languageCodes })
  b.node('start', 'start')
    .node('notice', 'basic', { messages: [message] })
    .node('escalate', 'escalate', {
      stateModifications: [
        setContext('transferSummary', 'Safety escalation: the caller expressed a threat of harm or a safety concern. Handle with care; the caller was given emergency-services and crisis-line information.'),
        setContext('customerIntent', 'safety'),
      ],
    })
    .edge('start', 'notice')
    .edge('notice', 'escalate')
    .edge('escalate', null, status('continuation'))
  return {
    flow: b.build(),
    warnings: content.safetyMessage
      ? []
      : ['Safety message is the US Census default (911/988). Replace it with the customer\'s own emergency wording, especially outside the US.'],
  }
}

/** First sentence of a failure prompt, used as the short apology before the prompt replays. */
export function apologyOf(reprompt: string): string {
  const match = reprompt.match(/^.*?[.!?](?=\s|$)/)
  return match && match[0].length < reprompt.trim().length ? match[0] : reprompt
}

export interface AuthenticationOptions {
  dataRequestId: string
  /** Where a successful caller goes next. */
  successFlowId: string
  /** The intent recorded as customerIntent when authentication fails. */
  intentName: string
  aiDescription: string
  languageCodes: string[]
}

/**
 * Pattern P4: authentication gate for "any one of N identifiers".
 * Loop (range 0..N-1) -> verbatim prompt -> Generative Journey data capture (ONE slot) ->
 * data request -> split on verified. Failure clears the slot and loops; exhaustion, request
 * failure or timeout go to the escalation flow with stuckPoint and customerIntent set.
 */
export function authenticationFlow(auth: AuthenticationStep, opts: AuthenticationOptions): BuiltFlow {
  if (auth.retry.maxAttempts < 1) throw new Error('Authentication retry maxAttempts must be at least 1')
  const last = auth.retry.maxAttempts - 1
  const apology = apologyOf(auth.retry.reprompt ?? auth.failurePrompt ?? "I'm sorry, I didn't quite get that.")
  const slot = AUTH_SLOT

  const b = new FlowBuilder(FLOW_IDS.authentication, {
    description: "Verifies the caller's identity.",
    aiDescription: opts.aiDescription,
    languageCodes: opts.languageCodes,
    slotTypes: [{ name: slot, type: 'Freeformtext', examples: [], sensitive: true, aiDescription: '', multiSelect: false }],
  })
  b.node('start', 'start')
    .node('loop', 'loop', {
      metadata: {
        loop: {
          type: 'range',
          start: 0,
          startOperand: { type: 'constant', value: 0 },
          end: last,
          endOperand: { type: 'constant', value: last },
          name: 'rangeIndex',
        },
      },
    })
    .node('prompt', 'basic', { messages: [auth.text] })
    .node('capture', 'generative_journey', {
      metadata: {
        generativeJourney: {
          prompt:
            `The caller has just been asked for their ${orList(auth.identifiers)}. Do not greet them and do not repeat the question. Wait for their answer.\n\n` +
            `Capture whichever one value the caller gives into ${slot}. One value is enough; do not ask for the others. Do not repeat the value back to the caller. ` +
            'If the caller gives something that does not look like one of these, ask them once to try again.',
          exitConditions: [],
          tools: [],
          maxTokens: 8192,
          maxSteps: 10,
          temperature: 0.7,
          enableZeroTurnMode: false,
          promptVersion: 'latest',
          incomprehensionEdgeEnabled: false,
          modelType: 'anthropic.claude-haiku-4-5',
          dataCapture: { data: [{ required: true, type: 'slot', name: slot }], exitEnabled: true },
        },
      },
    })
    .node('lookup', 'data_request', {
      metadata: { async: false, inProgressEnabled: true, inProgressTimeout: 0 },
      dataRequests: [
        {
          type: 'custom',
          dataRequestId: opts.dataRequestId,
          name: opts.dataRequestId,
          payload: { type: 'recursive', value: { [slot]: { type: 'constant', value: `{${slot}:Freeformtext}` } } },
          urlParams: {},
          headers: {},
          alwaysRetrigger: false,
        },
      ],
    })
    .node('check', 'split', { metadata: { split: { modelType: 'amazon-nova-2-lite' } } })
    .node('granted', 'redirect', {
      stateModifications: [setContext('isAuthenticated', true)],
      metadata: { redirect: { flowId: opts.successFlowId, type: 'flow' } },
    })
    .node('retry', 'basic', { messages: [apology], stateModifications: [clearSlot(slot)] })
    .node('handoff', 'redirect', {
      stateModifications: [setContext('stuckPoint', 'authentication'), setContext('customerIntent', opts.intentName)],
      metadata: { redirect: { flowId: FLOW_IDS.escalation, type: 'flow' } },
    })
    .edge('start', 'loop')
    .edge('loop', 'prompt')
    .edge('loop', 'handoff', status('continuation'))
    .edge('prompt', 'capture')
    .edge('capture', 'lookup', status('data_captured'))
    .edge('capture', 'handoff', status('timeout'))
    .edge('capture', 'handoff', status('failure'))
    .edge('lookup', null, status('in_progress'))
    .edge('lookup', 'check', status('success'))
    .edge('lookup', 'handoff', status('timeout'))
    .edge('lookup', 'handoff', status('failure'))
    .edge('check', 'granted', variableIs(`${opts.dataRequestId}.verified`, true))
    .edge('check', 'retry')
    .edge('granted', null, status('continuation'))
    .edge('retry', 'loop')
    .edge('handoff', null, status('continuation'))

  const warnings: string[] = []
  if (auth.retry.reprompt && apology !== auth.retry.reprompt) {
    warnings.push(
      `Authentication retry: the flow plays "${apology}" and then replays the original prompt. The journey's single failure message ("${auth.retry.reprompt}") is not played as one piece.`,
    )
  }
  return { flow: b.build(), warnings }
}

export interface MainFlowOptions {
  /** Intents that need authentication are routed to this flow; omit when there is no authentication flow. */
  authenticationFlowId?: string
  content: FlowContent
  languageCodes: string[]
}

/**
 * The entry conversation: verbatim greeting, then a Generative Journey that answers from knowledge and
 * exits to other flows. Each exit is a named condition wired to a Redirect (a Journey holds the whole
 * conversation, so this is the only way to reach another flow from it).
 */
export function mainFlow(journey: Journey, opts: MainFlowOptions): BuiltFlow {
  const warnings: string[] = []
  const greeting = stepsOfKind(journey, 'greeting')[0]
  const intents = stepsOfKind(journey, 'intent_capture').flatMap((s) => s.intents)
  const routed = opts.authenticationFlowId ? intents.filter((i) => i.requiresAuth && i.handledBy === 'self_service') : []

  const prompt =
    opts.content.mainPrompt ??
    `You are the virtual assistant for ${journey.title}. Answer the caller's questions briefly and in plain language using the knowledge available to you. Never invent policies, procedures or deadlines. If you cannot answer, offer a representative.`
  if (!opts.content.mainPrompt) warnings.push("Main conversation prompt is a neutral baseline; supply the customer's own persona and rules.")

  const exits = [
    {
      name: 'humanHandoff',
      prompt:
        'the caller has explicitly asked to speak to a person or a specialist; or is frustrated after you have genuinely tried. Do NOT exit here because a tool returned an error or timed out. Only exit when the CALLER has signaled they want one.',
    },
    ...routed.map((i) => ({
      name: `route${pascal(i.name)}`,
      prompt: `the caller wants to ${lowerFirst(i.description ?? i.name)}. Exit here immediately, without answering and without offering a transfer. Do NOT exit for general questions.`,
    })),
  ]

  const tools = opts.content.knowledgeBaseId ? [{ type: 'knowledgeBase', knowledgeBaseId: opts.content.knowledgeBaseId, prompt: '', scopeTags: [] }] : []
  if (!opts.content.knowledgeBaseId) warnings.push('No knowledge base id supplied: the main Journey has no knowledge tool. Create the knowledge base and supply its id.')

  const b = new FlowBuilder(FLOW_IDS.main, {
    description: `Entry conversation for ${journey.title}.`,
    aiDescription: `Primary entry point for ${journey.title}. Answer general questions and route the caller to the flow that fits their request.`,
    languageCodes: opts.languageCodes,
  })
  b.node('start', 'start')
  if (greeting) b.node('greeting', 'basic', { messages: [greeting.text] })
  else warnings.push('The journey has no greeting step; the main flow starts straight in the conversation.')
  b.node('converse', 'generative_journey', {
    metadata: {
      generativeJourney: {
        prompt,
        exitConditions: exits,
        tools,
        maxTokens: 8192,
        maxSteps: 10,
        temperature: 0.4,
        enableZeroTurnMode: false,
        promptVersion: 'latest',
        incomprehensionEdgeEnabled: false,
        modelType: 'anthropic.claude-sonnet-5',
      },
    },
  })
    .node('handoff', 'redirect', { metadata: { redirect: { flowId: FLOW_IDS.escalation, type: 'flow' } } })
    .edge('start', greeting ? 'greeting' : 'converse')
  if (greeting) b.edge('greeting', 'converse')
  b.edge('converse', 'handoff', exitIndex(0))
  routed.forEach((i, n) => {
    const key = `route${pascal(i.name)}`
    b.node(key, 'redirect', { metadata: { redirect: { flowId: opts.authenticationFlowId as string, type: 'flow' } } })
      .edge('converse', key, exitIndex(n + 1))
      .edge(key, null, status('continuation'))
  })
  b.edge('converse', 'handoff', status('timeout')).edge('converse', 'handoff', status('failure')).edge('handoff', null, status('continuation'))
  return { flow: b.build(), warnings }
}
