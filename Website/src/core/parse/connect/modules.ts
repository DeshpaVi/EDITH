import type { RawAction, RawContactFlow, RawTransitions } from './types'

/**
 * Normalize the Connect **console export** format into the flow-language format.
 *
 * Amazon Connect has two contact flow JSON shapes in the wild, and they are not variants
 * of each other — they differ in envelope, key names, value shapes, and action-type names:
 *
 *   modules   — what the console's "Export" button downloads. `modules[]`, `id`, `type`,
 *               `parameters` as an ARRAY of {name,value}, `branches` as an ARRAY of
 *               {condition, conditionValue, transition}.
 *   Actions   — the Amazon Connect Flow Language, used by the API (`describe-contact-flow`
 *               Content) and CloudFormation. `Actions[]`, `Identifier`, `Type`,
 *               `Parameters` as an OBJECT, `Transitions` as an OBJECT.
 *
 * Normalizing to one shape means the mapping table, containment extraction, and routing
 * lift are written once. Verified against a real console export.
 */

interface RawModule {
  id?: string
  type?: string
  target?: string
  branches?: Array<{ condition?: string; conditionType?: string; conditionValue?: string; transition?: string }>
  parameters?: Array<{ name?: string; value?: unknown; resourceName?: string }>
  metadata?: Record<string, unknown>
}

interface RawModuleFlow {
  modules?: RawModule[]
  start?: string
  version?: string
  type?: string
  metadata?: { name?: string }
}

export function isModuleFormat(input: unknown): boolean {
  return !!input && typeof input === 'object' && Array.isArray((input as RawModuleFlow).modules)
}

/** Console block name → flow-language Action Type. Only confirmed mappings are listed. */
function actionType(mod: RawModule): string {
  const t = mod.type ?? 'unknown'
  const target = mod.target
  switch (t) {
    case 'PlayPrompt': return 'MessageParticipant'
    case 'Disconnect': return 'DisconnectParticipant'
    case 'GetUserInput': return target === 'Lex' ? 'ConnectParticipantWithLexBot' : 'GetParticipantInput'
    case 'Transfer':
      if (target === 'Flow') return 'TransferToFlow'
      if (target === 'Queue') return 'TransferContactToQueue'
      return 'TransferToFlow'
    // Anything else passes through unchanged. An unrecognized name then becomes an
    // UnknownNode and surfaces in coverage, which is the honest outcome — better than a
    // wrong mapping that silently changes behavior.
    default: return t
  }
}

function parameters(mod: RawModule): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of mod.parameters ?? []) {
    if (!p?.name) continue
    // `resourceName` carries the human-readable target when `value` is a blank placeholder
    // (unresolved flow/queue references in an unpublished export).
    out[p.name] = p.value !== '' && p.value !== undefined && p.value !== null ? p.value : p.resourceName ?? p.value
  }
  // The console records the Lex bot as flat params; the flow language nests it.
  if (mod.target === 'Lex' && (out.BotName || out.BotAlias)) {
    out.LexV2Bot = { Name: out.BotName, Alias: out.BotAlias, Region: out.BotRegion }
  }
  return out
}

function transitions(mod: RawModule): RawTransitions {
  const t: RawTransitions = {}
  const conditions: NonNullable<RawTransitions['Conditions']> = []
  const errors: NonNullable<RawTransitions['Errors']> = []

  for (const b of mod.branches ?? []) {
    const next = b?.transition
    if (!next) continue
    switch (b.condition) {
      case 'Success':
        t.NextAction ??= next
        break
      case 'Evaluate':
        conditions.push({
          NextAction: next,
          Condition: { Operator: b.conditionType ?? 'Equals', Operands: [b.conditionValue ?? ''] },
        })
        break
      case 'Error':
      case 'NoMatch':
      case 'Timeout':
        errors.push({ NextAction: next, ErrorType: b.condition })
        break
      default:
        // Named branches on checks/compares behave like conditions.
        conditions.push({
          NextAction: next,
          Condition: { Operator: 'Equals', Operands: [b.conditionValue ?? b.condition ?? ''] },
        })
    }
  }

  if (conditions.length > 0) t.Conditions = conditions
  if (errors.length > 0) t.Errors = errors
  // A block with only error branches still needs a default path for graph continuity.
  t.NextAction ??= errors.length > 0 && conditions.length === 0 ? undefined : t.NextAction
  return t
}

export function normalizeModuleFlow(input: unknown): { flow: RawContactFlow; name?: string } {
  const src = input as RawModuleFlow
  const actions: RawAction[] = (src.modules ?? [])
    .filter((m): m is RawModule => !!m && typeof m === 'object')
    .map((mod) => ({
      Identifier: mod.id,
      Type: actionType(mod),
      Parameters: parameters(mod),
      Transitions: transitions(mod),
    }))

  return {
    flow: { Version: src.version ?? '1', StartAction: src.start, Actions: actions },
    name: src.metadata?.name,
  }
}
