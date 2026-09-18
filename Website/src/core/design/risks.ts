import type { IvrModel, Risk, Recommendation, AttachedSlot, PlannedGuardrail } from '../model'

/**
 * Migration risks and beyond-parity recommendations — both rule-based and deterministic.
 *
 * The LLM's job in the design layer is naming, synonyms, and suggestions. None of these
 * need it: every item below is derivable from the model with plain conditionals, which
 * means they are reproducible and testable. That matters more here than phrasing does.
 */
export function assessRisks(
  model: IvrModel,
  attachedSlots: AttachedSlot[],
  guardrails: PlannedGuardrail[],
): Risk[] {
  const risks: Risk[] = []
  const nodes = Object.values(model.nodes)

  const menus = nodes.filter((n) => n.kind === 'menu')
  if (menus.length > 0) {
    risks.push({
      id: 'dtmf-to-nlu-confidence',
      severity: 'warn',
      title: 'Deterministic DTMF becomes probabilistic NLU',
      detail: `${menus.length} DTMF menu(s) become user_choice nodes. A keypad has zero ambiguity; speech recognition does not. Options that were unmistakable as "press 3" may need a confirmation turn once callers say them aloud.`,
      nodeIds: menus.map((n) => n.id),
    })
  }

  const lookups = nodes.filter((n) => n.kind === 'lookup')
  if (lookups.length > 0) {
    risks.push({
      id: 'data-request-latency',
      severity: 'warn',
      title: 'Data requests may be slower than the original dips',
      detail: `${lookups.length} Lambda dip(s) become Data Request webhooks. A call that used to run inside the telecom switch now crosses the network — decide whether each needs a wait node or hold message.`,
      nodeIds: lookups.map((n) => n.id),
    })
  }

  const sensitive = nodes.filter((n) => n.kind === 'capture' && n.sensitive)
  const hasMasking = guardrails.some((g) => g.trigger === 'output' && g.rules.some((r) => r.enforcement.action === 'mask'))
  if (sensitive.length > 0 && !hasMasking) {
    risks.push({
      id: 'sensitive-capture-unmasked',
      severity: 'blocker',
      title: 'Sensitive capture without output masking',
      detail: 'A sensitive slot is captured but nothing masks it on the way out. The legacy IVR relied on network segmentation ACXD does not inherit; a later node echoing the value back would leak it into transcripts and logs.',
      nodeIds: sensitive.map((n) => n.id),
    })
  }

  const compliance = nodes.filter((n) => n.kind === 'prompt' && n.compliance)
  if (compliance.length > 0) {
    risks.push({
      id: 'compliance-wording',
      severity: 'warn',
      title: 'Regulated wording must survive byte-for-byte',
      detail: `${compliance.length} prompt(s) carry recording or consent language. They are copied verbatim and marked read-only. Any rewording is a legal review item, not a copy edit.`,
      nodeIds: compliance.map((n) => n.id),
    })
  }

  const unknowns = model.coverage.flow.unknown
  if (unknowns.length > 0) {
    risks.push({
      id: 'unmapped-blocks',
      severity: 'blocker',
      title: `${unknowns.length} source block(s) have no ACXD mapping`,
      detail: `Preserved as note nodes so they stay visible, but they carry no runtime behavior: ${unknowns.map((u) => u.sourceType).join(', ')}. Each must be migrated by hand.`,
      nodeIds: unknowns.map((u) => u.id),
    })
  }

  if (model.coverage.nlu.dangling.length > 0) {
    risks.push({
      id: 'dangling-intents',
      severity: 'blocker',
      title: 'Flow branches on intents the bot does not define',
      detail: `${model.coverage.nlu.dangling.join(', ')} — either the bot export is stale or these branches are dead. The migrated flow will have unreachable paths until this is resolved.`,
      nodeIds: [],
    })
  }

  const untyped = attachedSlots.filter((s) => s.type === 'TODO_CONFIRM_BUILTIN')
  if (untyped.length > 0) {
    risks.push({
      id: 'unresolved-slot-types',
      severity: 'warn',
      title: 'Some slots have no confirmed type',
      detail: `${untyped.length} slot(s) need a type ACXD has not published a built-in catalog for. Define custom slot types or confirm the built-in names before building.`,
      nodeIds: [],
    })
  }

  if (!model.nlu && Object.values(model.nodes).some((n) => n.kind === 'intent')) {
    risks.push({
      id: 'missing-bot-export',
      severity: 'blocker',
      title: 'Conversational content is missing',
      detail: 'The flow hands off to a Lex bot whose export was not supplied, so the plan carries intent names with no utterances, slot prompts, or synonyms behind them.',
      nodeIds: [],
    })
  }

  return risks
}

export function recommend(model: IvrModel): Recommendation[] {
  const out: Recommendation[] = []
  const nodes = Object.values(model.nodes)
  const menus = nodes.filter((n) => n.kind === 'menu')

  if (menus.length >= 2) {
    out.push({
      id: 'collapse-menu-tree',
      title: `Collapse ${menus.length} menu levels into one intent_capture`,
      detail: 'A nested DTMF tree exists because a keypad can only offer ten options at a time. NLU has no such limit — callers can state their goal once instead of navigating levels. This is a deliberate upgrade past parity, not a like-for-like mapping.',
      nodeIds: menus.map((n) => n.id),
    })
  }

  const longPrompts = nodes.filter((n) => n.kind === 'prompt' && !n.compliance && n.text.length > 180)
  if (longPrompts.length > 0) {
    out.push({
      id: 'knowledge-base-candidates',
      title: 'Move long static prompts into a knowledge base',
      detail: 'Lengthy non-regulated readouts (hours, policy, addresses) are the content that changes most often. In a knowledge_base node, content owners update it without a flow redeploy.',
      nodeIds: longPrompts.map((n) => n.id),
    })
  }

  if (model.containment.globalCommands.some((g) => g.intent === 'agent')) {
    out.push({
      id: 'escalation-guardrail',
      title: 'Serve "agent" from a guardrail rather than a menu option',
      detail: 'The legacy IVR could only offer "0 for an agent" where a menu existed. As an input guardrail it works from any turn in the conversation.',
      nodeIds: [],
    })
  }

  out.push({
    id: 'frustration-flow',
    title: 'Add sentiment-based escalation (defaultFlows.frustration)',
    detail: 'A capability no DTMF IVR had: escalate when a caller is audibly frustrated, before they ask. Nothing in the source maps to it — worth considering on its own merits.',
    nodeIds: [],
  })

  const voicePrompts = nodes.filter((n) => n.kind === 'prompt' && n.text.length > 240)
  if (voicePrompts.length > 0) {
    out.push({
      id: 'shorten-voice-prompts',
      title: 'Shorten prompts that were written for the page, not the ear',
      detail: 'These read fine on screen but run long over a call. Splitting them across turns usually improves containment — but check none are compliance-locked first.',
      nodeIds: voicePrompts.map((n) => n.id),
    })
  }

  return out
}
