import type {
  IvrModel, AcxdPlan, PlannedApplication, PlannedFlow, PlannedGuardrail,
  PlannedContextVariable, PlannedNode, SchemaGap, TrimmedContactFlow,
} from '../model'
import { buildFlow } from './nodes'
import { assessRisks, recommend } from './risks'
import { flowId, description, stableUuid } from './ids'

export { buildFlow } from './nodes'
export { assessRisks, recommend } from './risks'
export * from './ids'

const DEFAULT_LANGUAGE = 'en-US'
const ESCALATION_FLOW_ID = 'EscalationFlow'

/**
 * IvrModel → AcxdPlan. The design layer.
 *
 * Deterministic end to end: the same model always produces the same plan. The LLM's three
 * jobs in this layer (naming, synonym generation, beyond-parity suggestions) are not wired
 * in — naming is derived from the source, synonyms are lifted from the Lex export where a
 * human already authored them, and recommendations are rule-based. That is what makes the
 * plan fixture-testable, and it is why the POC needs no provider key.
 */
export function designPlan(model: IvrModel): AcxdPlan {
  const mainLanguage = model.languages[0] ?? DEFAULT_LANGUAGE
  const languages = model.languages.length > 0 ? model.languages : [DEFAULT_LANGUAGE]
  const appName = flowId(model.sources[0]?.name ?? 'MigratedIvr', 'MigratedIvr')

  const built = buildFlow(model, languages, mainLanguage)
  const gaps: SchemaGap[] = [...built.gaps]

  const guardrails = buildGuardrails(model)
  const needsEscalationFlow =
    Object.values(model.nodes).some((n) => n.kind === 'transfer' && n.target.type === 'queue') ||
    model.containment.globalCommands.some((g) => g.intent === 'agent')

  const flows: PlannedFlow[] = [{
    flowId: flowId(appName, 'MainFlow'),
    description: description(`Migrated from Amazon Connect contact flow "${model.sources[0]?.name ?? 'unknown'}"`),
    mainLanguageCode: mainLanguage,
    languageCodes: languages,
    slotTypes: dedupeBy(built.attachedSlots, (s) => s.name),
    contextVariables: dedupeBy(built.contextVariables, (v) => v.name).map((v) => ({
      name: v.name,
      type: 'text' as const,
    })),
    nodes: built.nodes,
  }]

  if (needsEscalationFlow) flows.push(escalationFlow(mainLanguage, languages))

  const application = buildApplication(model, appName, languages, mainLanguage, guardrails, needsEscalationFlow, gaps)

  const contactFlow: TrimmedContactFlow = {
    queueAssignments: model.routing.queueAssignments,
    hoursOfOperation: model.routing.hoursOfOperation !== undefined,
    recordingBehavior: model.routing.recordingBehavior !== undefined,
    voice: model.routing.voice,
    agenticCxBlock: { applicationName: appName, environment: 'Development' },
  }

  return {
    application,
    flows,
    slotTypes: dedupeBy(built.slotTypes, (t) => t.slotTypeId),
    dataRequests: dedupeBy(built.dataRequests, (d) => d.dataRequestId),
    guardrails,
    contextVariables: dedupeBy(built.contextVariables, (v) => v.name),
    contactFlow,
    risks: assessRisks(model, built.attachedSlots, guardrails),
    recommendations: recommend(model),
    schemaGaps: dedupeBy(gaps, (g) => `${g.marker}|${g.nodeIds.join(',')}`),
  }
}

/**
 * Guardrails replace what the legacy IVR did structurally: network segmentation for PCI,
 * and a "0 for an agent" option wired into every menu individually.
 */
function buildGuardrails(model: IvrModel): PlannedGuardrail[] {
  const out: PlannedGuardrail[] = []
  const sensitive = Object.values(model.nodes).filter((n) => n.kind === 'capture' && n.sensitive)

  if (sensitive.length > 0) {
    out.push({
      guardrailId: 'sensitiveValueMasking',
      name: 'Sensitive Value Masking',
      description: 'Prevents captured card/account digits leaking into responses, transcripts, or logs.',
      trigger: 'output',
      active: true,
      rules: [{
        name: 'Long digit sequence',
        detection: { method: 'regex', pattern: '\\b(?:\\d[ -]*?){13,19}\\b' },
        enforcement: { action: 'mask', behavior: { maskText: '[REDACTED]' } },
        active: true,
      }],
    })
  }

  if (model.containment.globalCommands.some((g) => g.intent === 'agent')) {
    out.push({
      guardrailId: 'agentEscalationKeyword',
      name: 'Agent Escalation Keyword',
      description: 'Routes to escalation from any turn, replacing the per-menu "0 for an agent" option.',
      trigger: 'input',
      active: true,
      rules: [{
        name: 'Agent request',
        detection: { method: 'keyword', keywords: ['agent', 'representative', 'human', 'operator'] },
        enforcement: { action: 'route', behavior: { flowId: ESCALATION_FLOW_ID } },
        active: true,
      }],
    })
  }

  return out
}

function buildApplication(
  model: IvrModel,
  appName: string,
  languages: string[],
  mainLanguage: string,
  guardrails: PlannedGuardrail[],
  hasEscalationFlow: boolean,
  gaps: SchemaGap[],
): PlannedApplication {
  const defaultFlows: PlannedApplication['settings']['defaultFlows'] = {}

  if (hasEscalationFlow) {
    defaultFlows.escalation = { flowId: ESCALATION_FLOW_ID }
    // The playbook's containment recipe: the last invalid attempt falls through to escalation.
    if (model.containment.onExhausted) defaultFlows.fallback = { flowId: ESCALATION_FLOW_ID }
  } else if (model.containment.onExhausted) {
    gaps.push({
      marker: 'defaultFlows.fallback target',
      what: `The IVR sent exhausted retries to "${model.containment.onExhausted}", but no escalation flow was derived.`,
      needed: 'Decide which flow should handle exhausted retries.',
      nodeIds: [model.containment.onExhausted],
    })
  }

  if (model.containment.globalCommands.some((g) => g.intent === 'repeat')) {
    defaultFlows.repeat = { flowId: flowId(appName, 'MainFlow') }
  }

  return {
    name: appName,
    description: description(`Migrated IVR — ${model.sources.map((s) => s.name).join(' + ')}`),
    settings: {
      languageCode: mainLanguage,
      languageCodes: languages,
      languageSettings: languages.map((languageCode) => ({
        languageCode,
        useNativeLanguage: true,
        ...(languageCode === mainLanguage && model.routing.voice?.voiceId
          ? { voice: model.routing.voice.voiceId }
          : {}),
      })),
      defaultFlows,
      // The direct analog of the IVR's "max invalid entries" setting — set deliberately,
      // never left at the platform default.
      thresholds: { incomprehensionCount: model.containment.maxInvalidAttempts ?? 2 },
      conversationTTL: 5,
      repeatOnIncomprehension: model.containment.repeatOnInvalid ?? false,
      guardrails: guardrails.map((g) => ({ guardrailId: g.guardrailId })),
    },
  }
}

function escalationFlow(mainLanguage: string, languages: string[]): PlannedFlow {
  const start = stableUuid('node:__escalation_start__')
  const escalate = stableUuid('node:__escalation_escalate__')
  const end = stableUuid('node:__escalation_end__')
  const nodes: Record<string, PlannedNode> = {
    [start]: { nodeId: start, type: 'start', childNodes: [{ nodeId: escalate }] },
    [escalate]: { nodeId: escalate, type: 'escalate', childNodes: [{ nodeId: end }] },
    [end]: { nodeId: end, type: 'end' },
  }
  return {
    flowId: ESCALATION_FLOW_ID,
    description: 'Hands the caller to a human. Target of the escalation guardrail and exhausted retries.',
    mainLanguageCode: mainLanguage,
    languageCodes: languages,
    slotTypes: [],
    contextVariables: [],
    nodes,
  }
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>()
  for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item)
  return [...seen.values()]
}

export type { PlannedContextVariable }
