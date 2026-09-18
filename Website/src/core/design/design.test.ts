import { describe, it, expect } from 'vitest'
import { parseIvr } from '../parse'
import { designPlan } from './index'
import { stableUuid, slotTypeId, slotName, contextVariableName } from './ids'
import { LEX_BUILT_INS } from './builtInSlots'

import simpleMenu from '../fixtures/contact-flows/simple-menu.json'
import unhandled from '../fixtures/contact-flows/unhandled-action.json'
import lexBacked from '../fixtures/contact-flows/lex-backed.json'
import acmeV2 from '../fixtures/lex-bots/acme-v2.json'
import realExport from '../fixtures/contact-flows/real-console-export.json'
import realBot from '../fixtures/lex-bots/real-lex-v2.json'

const AT = '2026-01-01T00:00:00.000Z'
const plan = (flow: unknown, bot?: unknown) =>
  designPlan(parseIvr({
    contactFlow: flow,
    lexExports: bot ? [{ name: 'acme-v2', content: bot }] : [],
    importedAt: AT,
  }))

const nodesOfType = (p: ReturnType<typeof plan>, type: string) =>
  Object.values(p.flows[0].nodes).filter((n) => n.type === type)

describe('naming obeys ACXD identifier rules', () => {
  it('keeps slot type ids alphabetic and at least 3 chars', () => {
    expect(slotTypeId('main-menu Option')).toBe('MainMenuOption')
    expect(slotTypeId('a')).toMatch(/^[a-zA-Z]{3,100}$/)
    expect(slotTypeId('')).toMatch(/^[a-zA-Z]{3,100}$/)
  })

  it('keeps slot names alphabetic, camelCase, within 30 chars', () => {
    expect(slotName('StoredCustomerInput')).toBe('storedCustomerInput')
    expect(slotName('a_very_long_variable_name_that_exceeds_the_limit')).toMatch(/^[a-zA-Z]{3,30}$/)
  })

  it('snake_cases context variable names', () => {
    expect(contextVariableName('StoredCustomerInput')).toBe('stored_customer_input')
  })

  it('derives UUID-shaped node ids that are stable across runs', () => {
    expect(stableUuid('node:main-menu')).toBe(stableUuid('node:main-menu'))
    expect(stableUuid('node:main-menu')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(stableUuid('node:a')).not.toBe(stableUuid('node:b'))
  })
})

describe('designing a DTMF menu IVR', () => {
  const p = plan(simpleMenu)

  it('gives every flow an explicit start node wired to the IVR entry point', () => {
    const start = nodesOfType(p, 'start')
    expect(start).toHaveLength(1)
    expect(start[0].childNodes?.[0].nodeId).toBe(stableUuid('node:greeting'))
  })

  it('turns the menu into a user_choice backed by a slot type carrying the digits', () => {
    expect(nodesOfType(p, 'user_choice')).toHaveLength(1)
    const type = p.slotTypes.find((t) => t.slotTypeId === 'MainMenuOption')!
    expect(type.values).toEqual([
      { value: 'billing', synonyms: [], choicePayload: '1' },
      { value: 'report an outage', synonyms: [], choicePayload: '2' },
      { value: 'agent', synonyms: [], choicePayload: '0' },
    ])
  })

  it('copies regulated wording verbatim and marks it read-only', () => {
    const basic = nodesOfType(p, 'basic')[0]
    expect(basic.messages?.[0].body).toContain('recorded for quality and training purposes')
    expect(basic.compliance).toBe(true)
  })

  it('maps the pieces to their ACXD counterparts', () => {
    expect(nodesOfType(p, 'user_input')).toHaveLength(1)   // StoreUserInput
    expect(nodesOfType(p, 'data_request')).toHaveLength(1) // InvokeLambdaFunction
    expect(nodesOfType(p, 'escalate')).toHaveLength(1)     // TransferContactToQueue
    expect(nodesOfType(p, 'end')).toHaveLength(1)          // DisconnectParticipant
  })

  it('creates a Data Request named after the Lambda, with the ARN kept for wiring', () => {
    const dr = p.dataRequests[0]
    expect(dr.dataRequestId).toBe('checkOutage')
    expect(dr.sourceSystem).toContain('function:CheckOutage')
  })

  it('replaces IVR structure with guardrails: masking for PCI, keyword for the agent command', () => {
    expect(p.guardrails.map((g) => g.guardrailId)).toEqual(['sensitiveValueMasking', 'agentEscalationKeyword'])
    expect(p.guardrails[0].trigger).toBe('output')
    expect(p.guardrails[1].rules[0].detection.keywords).toContain('representative')
  })

  it('carries the IVR retry rule into application settings rather than flow nodes', () => {
    expect(p.application.settings.thresholds.incomprehensionCount).toBe(3)
    expect(p.application.settings.repeatOnIncomprehension).toBe(true)
    expect(p.application.settings.defaultFlows.escalation).toEqual({ flowId: 'EscalationFlow' })
    expect(p.application.settings.defaultFlows.fallback).toEqual({ flowId: 'EscalationFlow' })
  })

  it('derives an escalation flow for the guardrail and exhausted retries to target', () => {
    const esc = p.flows.find((f) => f.flowId === 'EscalationFlow')!
    expect(Object.values(esc.nodes).map((n) => n.type).sort()).toEqual(['end', 'escalate', 'start'])
  })

  it('carries both languages through with the main voice attached', () => {
    expect(p.application.settings.languageCodes).toEqual(['en-US', 'es-US'])
    expect(p.application.settings.languageSettings[0]).toMatchObject({ languageCode: 'en-US', voice: 'Joanna' })
  })

  it('keeps routing out of ACXD and names the manual console step', () => {
    expect(p.contactFlow.queueAssignments).toHaveLength(1)
    expect(p.contactFlow.voice?.voiceId).toBe('Joanna')
    // Per the Agentic CX block docs: workspace + application + alias, and four branches.
    expect(p.contactFlow.agenticCxBlock.alias).toBe('Development')
    expect(p.contactFlow.agenticCxBlock.branches.map((b) => b.name))
      .toEqual(['Default', 'Error', 'Idle chat timeout', 'Escalation'])
    expect(p.contactFlow.agenticCxBlock.branches.find((b) => b.name === 'Escalation')!.target)
      .toBe('transfer-to-queue')
  })

  it('raises the parity risks a reviewer has to see', () => {
    const ids = p.risks.map((r) => r.id)
    expect(ids).toContain('dtmf-to-nlu-confidence')
    expect(ids).toContain('data-request-latency')
    expect(ids).toContain('compliance-wording')
  })

  it('does not cry wolf about unmasked capture when a masking guardrail exists', () => {
    expect(p.risks.map((r) => r.id)).not.toContain('sensitive-capture-unmasked')
  })

  it('suggests upgrades past parity without applying them', () => {
    const ids = p.recommendations.map((r) => r.id)
    expect(ids).toContain('escalation-guardrail')
    expect(ids).toContain('frustration-flow')
  })
})

describe('refusing to invent undocumented schema', () => {
  const p = plan(simpleMenu)

  it('records every shape the ACXD docs do not publish', () => {
    const markers = p.schemaGaps.map((g) => g.marker)
    expect(markers).toContain('user_choice ↔ slot type binding')
    expect(markers).toContain('built-in slot type name')
    expect(p.schemaGaps.every((g) => g.needed.length > 0)).toBe(true)
  })

  it('leaves an unresolvable slot type visibly unresolved', () => {
    const slot = p.flows[0].slotTypes.find((s) => s.name === 'storedCustomerInput')!
    expect(slot.type).toBe('TODO_CONFIRM_BUILTIN')
    expect(slot.sensitive).toBe(true)
    expect(slot.regex).toBe('^[0-9]{1,16}$')
    expect(p.risks.map((r) => r.id)).toContain('unresolved-slot-types')
  })

  it('flags branch conditions as undocumented when a branch exists', () => {
    const withBranch = plan({
      Version: '2019-10-30',
      StartAction: 'check',
      Actions: [
        { Identifier: 'check', Type: 'CheckAttribute', Parameters: { Attribute: 'tier' },
          Transitions: { NextAction: 'bye', Conditions: [{ NextAction: 'bye', Condition: { Operator: 'Equals', Operands: ['gold'] } }] } },
        { Identifier: 'bye', Type: 'DisconnectParticipant', Parameters: {}, Transitions: {} },
      ],
    })
    expect(withBranch.schemaGaps.map((g) => g.marker)).toContain('childNodes[].conditions')
  })
})

describe('designing a Lex-backed IVR', () => {
  const p = plan(lexBacked, acmeV2)

  it('maps the bot handoff to intent_capture with a branch per intent', () => {
    const capture = nodesOfType(p, 'intent_capture')[0]
    expect(capture.childNodes?.map((c) => c.name)).toEqual(['PayBill', 'CheckBalance', 'SpeakToAgent', 'ReportMovedHouse'])
  })

  it('pulls slot definitions out of the bot, preserving sensitivity', () => {
    const account = p.flows[0].slotTypes.find((s) => s.name === 'accountNumber')!
    expect(account.sensitive).toBe(true)
    expect(account.aiDescription).toBe("What's your account number?")
  })

  it('blocks on intents the flow branches to but the bot never defines', () => {
    const risk = p.risks.find((r) => r.id === 'dangling-intents')!
    expect(risk.severity).toBe('blocker')
    expect(risk.detail).toContain('ReportMovedHouse')
  })

  it('blocks when the bot export is missing entirely', () => {
    const ids = plan(lexBacked).risks.map((r) => r.id)
    expect(ids).toContain('missing-bot-export')
  })

  it('reuses synonyms a human already wrote in Lex instead of generating new ones', () => {
    const type = plan(simpleMenu, acmeV2).slotTypes.find((t) => t.slotTypeId === 'MainMenuOption')!
    expect(type.values.find((v) => v.value === 'billing')!.synonyms)
      .toEqual(['bill', 'my bill', 'invoice', 'payment'])
  })
})

describe('unmigrated blocks stay visible', () => {
  const p = plan(unhandled)

  it('becomes a note node naming the source action type', () => {
    const note = nodesOfType(p, 'note')[0]
    expect(note.messages?.[0].body).toContain('CreateCallbackContact')
    expect(note.messages?.[0].body).toContain('migrated by hand')
  })

  it('raises a blocker rather than quietly reporting success', () => {
    const risk = p.risks.find((r) => r.id === 'unmapped-blocks')!
    expect(risk.severity).toBe('blocker')
  })
})

describe('determinism', () => {
  it('produces byte-identical plans across runs', () => {
    expect(JSON.stringify(plan(lexBacked, acmeV2))).toBe(JSON.stringify(plan(lexBacked, acmeV2)))
  })
})

describe('real export + real bot, end to end', () => {
  const p = plan(realExport, realBot)

  it('carries the bot\'s custom slot types into the plan', () => {
    // Without this the flow attaches slots referencing types nothing ever creates.
    expect(p.slotTypes.map((t) => t.slotTypeId).sort()).toEqual(
      ['Action', 'Appointment', 'Department', 'InteractiveOption', 'OtherOptions'],
    )
    const dept = p.slotTypes.find((t) => t.slotTypeId === 'Department')!
    expect(dept.values).toContainEqual({ value: 'Billing', synonyms: [] })
  })

  it('still reports the bot as the wrong one for this flow', () => {
    // The flow calls ConnectBot; this is InteractiveMessageBotV2. Matching it on
    // "only bot uploaded" is an assumption, and none of the intents line up.
    expect(p.risks.map((r) => r.id)).toContain('dangling-intents')
  })
})

/**
 * ACXD publishes no built-in slot type catalogue, so most Lex built-ins would be dead
 * ends. Enumerable ones become ordinary custom slot types; patterned ones carry a regex
 * on the attached slot. Both are documented ACXD constructs, so the gap shrinks to the
 * handful that genuinely need an answer from AWS.
 */
describe('Lex built-in slot types', () => {
  const botWith = (slotType: string) => ({
    'Bot.json': { name: 'B' },
    'BotLocales/en_US/BotLocale.json': { localeId: 'en_US' },
    'BotLocales/en_US/Intents/PayBill/Intent.json': { name: 'PayBill', sampleUtterances: [{ utterance: 'pay' }] },
    'BotLocales/en_US/Intents/PayBill/Slots/thing/Slot.json': {
      name: 'thing', slotTypeName: slotType,
      valueElicitationSetting: { slotConstraint: 'Required' },
    },
  })
  const planFor = (slotType: string) => plan(lexBacked, botWith(slotType))
  const slotOf = (slotType: string) =>
    planFor(slotType).flows[0].slotTypes.find((s) => s.name === 'thing')!

  it('resolves AMAZON.Confirmation outright as a custom slot type', () => {
    const p = planFor('AMAZON.Confirmation')
    const type = p.slotTypes.find((t) => t.slotTypeId === 'Confirmation')!
    expect(type.values.map((v) => v.value)).toEqual(['Yes', 'No', 'Maybe', "Don't know"])
    expect(slotOf('AMAZON.Confirmation').type).toBe('Confirmation')
    // Fully handled — it raises no gap at all.
    expect(p.schemaGaps.some((g) => g.nodeIds.length && /Confirmation/.test(g.what))).toBe(false)
  })

  it('carries a deterministic regex for patterned built-ins', () => {
    expect(slotOf('AMAZON.PhoneNumber').regex).toBe('^\\+?[0-9]{7,15}$')
    expect(slotOf('AMAZON.Number').regex).toBe('^[0-9]+$')
  })

  it('describes what an unresolved slot captures instead of just naming it unknown', () => {
    const gap = planFor('AMAZON.City').schemaGaps.find((g) => g.marker === 'built-in slot type name')!
    expect(gap.what).toContain('a city name')
    expect(gap.needed).toContain('a city name')
  })

  it('covers every documented built-in', () => {
    // 18 types per docs.aws.amazon.com/lexv2/latest/dg/built-in-slots.html
    expect(Object.keys(LEX_BUILT_INS)).toHaveLength(18)
    for (const [name, m] of Object.entries(LEX_BUILT_INS)) {
      expect(name.startsWith('AMAZON.')).toBe(true)
      expect(m.captures.length).toBeGreaterThan(0)
    }
  })
})
