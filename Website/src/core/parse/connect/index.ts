import type {
  IvrNode, MenuNode, RoutingConfig, ContainmentConfig,
} from '../../model'
import type { ReviewItem } from '../../model'
import {
  type RawAction, type RawContactFlow,
  SINGLE_EXIT_ROUTING,
  isComplianceText, str, bool, num, promptText,
} from './types'
import { extractMenuLabels, looksLikeLanguageOption } from './menuLabels'

export interface ConnectParseResult {
  sourceName: string
  entryNodeId: string
  nodes: Record<string, IvrNode>
  routing: RoutingConfig
  containment: ContainmentConfig
  languages: string[]
  totalActions: number
  unknown: Array<{ id: string; sourceType: string }>
  review: ReviewItem[]
  /** Parse-internal: action id → languageCode, used to collapse language menu options. */
  voiceLanguages: Record<string, string>
}

/**
 * Connect contact flow JSON → IVR nodes. Pure: no I/O, no LLM, no network.
 *
 * Never throws. Malformed input produces an empty model carrying a blocker review item;
 * an unrecognized Action type produces an UnknownNode. Both are visible outcomes, which
 * is the point — a migration tool that silently drops a block is worse than one that
 * says it couldn't read it.
 */
export function parseContactFlow(input: unknown): ConnectParseResult {
  const review: ReviewItem[] = []
  const result: ConnectParseResult = {
    sourceName: 'contact-flow',
    entryNodeId: '',
    nodes: {},
    routing: { queueAssignments: [] },
    containment: { globalCommands: [] },
    languages: [],
    totalActions: 0,
    unknown: [],
    review,
    voiceLanguages: {},
  }

  const flow = asFlow(input)
  if (!flow) {
    review.push({
      nodeId: '(document)',
      reason: 'Not a recognizable Amazon Connect contact flow export: expected an object with an "Actions" array.',
      severity: 'blocker',
    })
    return result
  }

  const actions = (flow.Actions ?? []).filter((a): a is RawAction => !!a && typeof a === 'object')
  result.totalActions = actions.length
  const rawById = new Map<string, RawAction>()
  const typeById = new Map<string, string>()
  for (const a of actions) {
    const id = str(a.Identifier)
    if (!id) {
      review.push({ nodeId: '(unidentified)', reason: `An action of type "${str(a.Type) ?? 'unknown'}" has no Identifier and cannot be wired into the graph.`, severity: 'warn' })
      continue
    }
    rawById.set(id, a)
    typeById.set(id, str(a.Type) ?? 'unknown')
  }

  for (const [id, action] of rawById) {
    const node = mapAction(id, action, result, review)
    if (node) result.nodes[id] = node
  }

  result.entryNodeId = str(flow.StartAction) ?? Object.keys(result.nodes)[0] ?? ''
  if (!str(flow.StartAction)) {
    review.push({ nodeId: result.entryNodeId || '(document)', reason: 'Flow has no StartAction; the first action was assumed to be the entry point.', severity: 'warn' })
  }

  extractContainment(result, rawById, typeById)
  collapseLanguageOptions(result, typeById, review)
  liftRoutingNodes(result, typeById)

  return result
}

function asFlow(input: unknown): RawContactFlow | null {
  if (!input || typeof input !== 'object') return null
  const f = input as RawContactFlow
  return Array.isArray(f.Actions) ? f : null
}

function mapAction(
  id: string,
  action: RawAction,
  result: ConnectParseResult,
  review: ReviewItem[],
): IvrNode | null {
  const type = str(action.Type) ?? 'unknown'
  const p = action.Parameters ?? {}
  const t = action.Transitions ?? {}
  const next = str(t.NextAction)
  const conditions = Array.isArray(t.Conditions) ? t.Conditions : []
  const errors = Array.isArray(t.Errors) ? t.Errors : []

  switch (type) {
    case 'MessageParticipant': {
      const text = promptText(p)
      return { kind: 'prompt', id, text, compliance: isComplianceText(text), next }
    }

    case 'GetParticipantInput': {
      // TODO(source-schema): the Lex binding key varies — LexV2Bot on V2 blocks, LexBot
      // on older ones. Both are read; neither is confirmed against a real export.
      const lexV2 = p.LexV2Bot as Record<string, unknown> | undefined
      const lexV1 = p.LexBot as Record<string, unknown> | undefined
      const botRef =
        str(lexV2?.AliasArn) ?? str(lexV2?.Name) ?? str(lexV1?.Name) ?? str(lexV1?.Alias)

      if (botRef) {
        // Conditions branch on the intent name the bot returned.
        const cases = conditions
          .map((c) => ({ intent: String(c.Condition?.Operands?.[0] ?? ''), next: str(c.NextAction) ?? '' }))
          .filter((c) => c.intent && c.next)
        return { kind: 'intent', id, botRef, cases, resolved: false, next }
      }

      const prompt = promptText(p)
      const labels = extractMenuLabels(prompt)
      const options = conditions
        .map((c) => {
          const key = String(c.Condition?.Operands?.[0] ?? '')
          return { key, label: labels.get(key) ?? `Option ${key}`, next: str(c.NextAction) ?? '' }
        })
        .filter((o) => o.key && o.next)
      return {
        kind: 'menu', id, prompt, options,
        timeoutSeconds: num(p.InputTimeLimitSeconds),
        next,
      }
    }

    case 'StoreUserInput': {
      const sensitive = bool(p.EncryptEntry) || !!str(p.EncryptionKeyId)
      if (sensitive) {
        review.push({ nodeId: id, reason: 'Encrypted capture implies PCI/PII scope. The plan must pair this with a masking guardrail — the legacy IVR likely relied on network segmentation ACXD does not inherit.', severity: 'warn' })
      }
      const maxDigits = num(p.MaxDigits)
      return {
        kind: 'capture', id,
        prompt: promptText(p),
        variable: str(p.DestinationKey) ?? 'StoredCustomerInput',
        validation: maxDigits === undefined ? undefined : { maxLength: maxDigits },
        sensitive,
        next,
      }
    }

    case 'InvokeLambdaFunction': {
      const attrs = p.LambdaInvocationAttributes
      const requestVars = attrs && typeof attrs === 'object' ? Object.keys(attrs as object) : []
      review.push({ nodeId: id, reason: 'Lambda response fields are not declared in the flow export, so the Data Request response shape cannot be derived. Confirm the response contract before the emitter binds Context Variables to it.', severity: 'warn' })
      return {
        kind: 'lookup', id,
        system: str(p.LambdaFunctionARN) ?? str(p.FunctionArn) ?? 'unknown-lambda',
        requestVars,
        responseVars: [],
        next,
        onError: str(errors[0]?.NextAction),
      }
    }

    case 'CheckAttribute':
    case 'Compare': {
      const cases = conditions
        .map((c) => ({ when: String(c.Condition?.Operands?.[0] ?? ''), next: str(c.NextAction) ?? '' }))
        .filter((c) => c.when && c.next)
      return {
        kind: 'branch', id,
        on: str(p.Attribute) ?? str(p.ComparisonValue) ?? 'unknown',
        cases,
        default: next,
      }
    }

    case 'UpdateContactAttributes': {
      const raw = p.Attributes
      const assignments = raw && typeof raw === 'object'
        ? Object.entries(raw as Record<string, unknown>).map(([name, value]) => ({ name, value: String(value) }))
        : []
      return { kind: 'setVar', id, assignments, next }
    }

    case 'TransferContactToQueue':
      return { kind: 'transfer', id, target: { type: 'queue', ref: str(p.QueueId) ?? str(p.QueueArn) ?? 'current-working-queue' } }

    case 'TransferToFlow':
      return { kind: 'transfer', id, target: { type: 'flow', ref: str(p.ContactFlowId) ?? 'unknown-flow' } }

    case 'DisconnectParticipant':
      return { kind: 'end', id }

    case 'Wait':
      return { kind: 'wait', id, seconds: num(p.TimeLimitSeconds), next }

    case 'Loop':
      return { kind: 'loop', id, maxIterations: num(p.LoopCount), next, onComplete: str(conditions[0]?.NextAction) }

    // ── Routing: captured into RoutingConfig, kept upstream of ACXD ──────────────
    case 'SetWorkingQueue': {
      const q = str(p.QueueId) ?? str((p.Queue as Record<string, unknown> | undefined)?.Arn)
      if (q) result.routing.queueAssignments.push(q)
      return { kind: 'setVar', id, assignments: [], next }
    }

    case 'UpdateContactRecordingBehavior':
      result.routing.recordingBehavior = p
      return { kind: 'setVar', id, assignments: [], next }

    case 'UpdateContactTextToSpeechVoice': {
      const lang = str(p.LanguageCode)
      // First voice block wins: it's the main voice. Later ones are language branches.
      result.routing.voice ??= {
        provider: str(p.Engine),
        voiceId: str(p.Voice),
        languageCode: lang,
      }
      if (lang) {
        result.voiceLanguages[id] = lang
        if (!result.languages.includes(lang)) result.languages.push(lang)
      }
      return { kind: 'setVar', id, assignments: [], next }
    }

    case 'CheckHoursOfOperation': {
      result.routing.hoursOfOperation = p
      review.push({ nodeId: id, reason: 'Hours-of-operation branching belongs in the trimmed contact flow, upstream of the Agentic CX block — not inside the ACXD application.', severity: 'info' })
      const cases = conditions
        .map((c) => ({ when: String(c.Condition?.Operands?.[0] ?? 'InHours'), next: str(c.NextAction) ?? '' }))
        .filter((c) => c.next)
      return { kind: 'branch', id, on: 'HoursOfOperation', cases, default: next }
    }

    default: {
      result.unknown.push({ id, sourceType: type })
      review.push({ nodeId: id, reason: `Action type "${type}" is not handled by the parser. Its definition is preserved verbatim and must be migrated by hand.`, severity: 'warn' })
      return { kind: 'unknown', id, sourceType: type, raw: action, next }
    }
  }
}

/**
 * A menu whose error transitions loop back to itself is expressing "N invalid attempts,
 * then give up" structurally. ACXD handles that as application settings, so the rule is
 * extracted here rather than reproduced as flow nodes downstream.
 */
function extractContainment(
  result: ConnectParseResult,
  rawById: Map<string, RawAction>,
  typeById: Map<string, string>,
): void {
  for (const [id, node] of Object.entries(result.nodes)) {
    if (node.kind !== 'menu' && node.kind !== 'intent') continue
    const errors = rawById.get(id)?.Transitions?.Errors ?? []

    for (const e of errors) {
      const target = str(e.NextAction)
      if (!target) continue

      if (target === id) {
        result.containment.repeatOnInvalid = true
        continue
      }
      // Error path into a Loop block: its LoopCount is the max-attempts setting.
      if (typeById.get(target) === 'Loop') {
        const loop = result.nodes[target]
        if (loop?.kind === 'loop' && loop.maxIterations !== undefined) {
          result.containment.maxInvalidAttempts = loop.maxIterations
          result.containment.repeatOnInvalid = true
          if (loop.onComplete) result.containment.onExhausted = loop.onComplete
        }
        continue
      }
      result.containment.onExhausted ??= target
    }

    // Global commands: "0 for an agent", "* to repeat" — application-level in ACXD, not
    // wired into each node.
    if (node.kind === 'menu') {
      for (const opt of node.options) {
        const dest = result.nodes[opt.next]
        if (opt.key === '0' && dest?.kind === 'transfer') {
          result.containment.globalCommands.push({ key: '0', intent: 'agent', target: opt.next })
        } else if (opt.key === '*') {
          result.containment.globalCommands.push({ key: '*', intent: 'repeat', target: opt.next })
        }
      }
    }
  }
}

/**
 * A menu option that only sets a language and re-enters the same menu is not a menu
 * option in ACXD — it's `languageCodes`. Reproducing it structurally is exactly the
 * "1:1 port that under-uses the platform" failure the skill warns about.
 */
function collapseLanguageOptions(
  result: ConnectParseResult,
  typeById: Map<string, string>,
  review: ReviewItem[],
): void {
  for (const node of Object.values(result.nodes)) {
    if (node.kind !== 'menu') continue
    const menu = node as MenuNode
    const kept: MenuNode['options'] = []

    for (const opt of menu.options) {
      const trace = followToMenu(result, typeById, opt.next, menu.id)
      if (trace.returnsToMenu && (trace.setsVoice || looksLikeLanguageOption(opt.label))) {
        if (trace.languageCode && !result.languages.includes(trace.languageCode)) {
          result.languages.push(trace.languageCode)
        }
        review.push({ nodeId: menu.id, reason: `Option "${opt.key}" (${opt.label}) only switches language and re-enters the menu. Collapsed into languageCodes rather than migrated as a menu option.`, severity: 'info' })
        continue
      }
      kept.push(opt)
    }
    menu.options = kept
  }
}

function followToMenu(
  result: ConnectParseResult,
  typeById: Map<string, string>,
  start: string,
  menuId: string,
  maxHops = 4,
): { returnsToMenu: boolean; setsVoice: boolean; languageCode?: string } {
  let cursor: string | undefined = start
  let setsVoice = false
  let languageCode: string | undefined

  for (let hop = 0; hop < maxHops && cursor; hop++) {
    if (cursor === menuId) return { returnsToMenu: true, setsVoice, languageCode }

    const type = typeById.get(cursor)
    if (type === 'UpdateContactTextToSpeechVoice') {
      setsVoice = true
      languageCode ??= result.voiceLanguages[cursor]
    } else if (type !== 'UpdateContactAttributes' && type !== 'SetWorkingQueue') {
      return { returnsToMenu: false, setsVoice, languageCode }
    }

    const node: IvrNode | undefined = result.nodes[cursor]
    cursor = node && 'next' in node ? node.next : undefined
  }
  return { returnsToMenu: false, setsVoice, languageCode }
}

/**
 * Single-exit routing blocks carry no conversation. They're recorded in RoutingConfig,
 * removed from the graph, and every edge pointing at them is forwarded past — which is
 * precisely the "trimmed contact flow" the migration produces.
 */
function liftRoutingNodes(result: ConnectParseResult, typeById: Map<string, string>): void {
  const lifted = new Map<string, string | undefined>()
  for (const [id, type] of typeById) {
    if (SINGLE_EXIT_ROUTING.has(type) && result.nodes[id]) {
      const node = result.nodes[id]
      lifted.set(id, 'next' in node ? node.next : undefined)
    }
  }
  if (lifted.size === 0) return

  // Resolve chains of lifted nodes so an edge never lands on a removed node.
  const resolve = (target: string | undefined, seen = new Set<string>()): string | undefined => {
    let cursor = target
    while (cursor && lifted.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor)
      cursor = lifted.get(cursor)
    }
    return cursor
  }

  for (const id of lifted.keys()) delete result.nodes[id]

  for (const node of Object.values(result.nodes)) {
    if ('next' in node && node.next) node.next = resolve(node.next)
    if (node.kind === 'menu') node.options = node.options.map((o) => ({ ...o, next: resolve(o.next) ?? o.next }))
    if (node.kind === 'intent') node.cases = node.cases.map((c) => ({ ...c, next: resolve(c.next) ?? c.next }))
    if (node.kind === 'branch') {
      node.cases = node.cases.map((c) => ({ ...c, next: resolve(c.next) ?? c.next }))
      node.default = resolve(node.default)
    }
    if (node.kind === 'lookup') node.onError = resolve(node.onError)
    if (node.kind === 'loop') node.onComplete = resolve(node.onComplete)
  }

  result.entryNodeId = resolve(result.entryNodeId) ?? result.entryNodeId
  if (result.containment.onExhausted) result.containment.onExhausted = resolve(result.containment.onExhausted)
  result.containment.globalCommands = result.containment.globalCommands.map((g) => ({ ...g, target: resolve(g.target) }))
}
