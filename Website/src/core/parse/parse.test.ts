import { describe, it, expect } from 'vitest'
import { parseIvr, parseLexExport } from './index'
import type { CaptureNode, IntentNode, LookupNode, MenuNode, PromptNode } from '../model'

import simpleMenu from '../fixtures/contact-flows/simple-menu.json'
import unhandled from '../fixtures/contact-flows/unhandled-action.json'
import lexBacked from '../fixtures/contact-flows/lex-backed.json'
import malformed from '../fixtures/contact-flows/malformed.json'
import realExport from '../fixtures/contact-flows/real-console-export.json'
import acmeV2 from '../fixtures/lex-bots/acme-v2.json'
import acmeV1 from '../fixtures/lex-bots/acme-v1.json'

const AT = '2026-01-01T00:00:00.000Z'
const withBot = () => parseIvr({
  contactFlow: lexBacked,
  lexExports: [{ name: 'acme-v2', content: acmeV2 }],
  importedAt: AT,
})

describe('contact flow parsing', () => {
  const model = parseIvr({ contactFlow: simpleMenu, importedAt: AT })

  it('flags regulated wording so it cannot be paraphrased downstream', () => {
    const greeting = model.nodes.greeting as PromptNode
    expect(greeting.kind).toBe('prompt')
    expect(greeting.compliance).toBe(true)
    expect(greeting.text).toContain('recorded for quality and training purposes')
  })

  it('lifts single-exit routing out of the graph and rewires past it', () => {
    expect(model.nodes['set-voice']).toBeUndefined()
    expect(model.nodes['set-queue']).toBeUndefined()
    // greeting → set-voice → set-queue → main-menu collapses to greeting → main-menu
    expect((model.nodes.greeting as PromptNode).next).toBe('main-menu')
    expect(model.routing.queueAssignments).toContain(
      'arn:aws:connect:us-east-1:111122223333:instance/abc/queue/general',
    )
  })

  it('keeps the first voice block as the main voice, not the last', () => {
    expect(model.routing.voice?.voiceId).toBe('Joanna')
    expect(model.routing.voice?.languageCode).toBe('en-US')
  })

  it('recovers option labels from the prompt wording', () => {
    const menu = model.nodes['main-menu'] as MenuNode
    expect(menu.options.map((o) => [o.key, o.label])).toEqual([
      ['1', 'billing'],
      ['2', 'report an outage'],
      ['0', 'agent'],
    ])
  })

  it('collapses a language option into languages instead of migrating it as a menu option', () => {
    const menu = model.nodes['main-menu'] as MenuNode
    expect(menu.options.find((o) => o.key === '3')).toBeUndefined()
    expect(model.languages).toEqual(['en-US', 'es-US'])
    expect(model.coverage.requiresReview.some((r) => /only switches language/.test(r.reason))).toBe(true)
  })

  it('extracts the retry rule as containment rather than reproducing the loop', () => {
    expect(model.containment.maxInvalidAttempts).toBe(3)
    expect(model.containment.repeatOnInvalid).toBe(true)
    expect(model.containment.onExhausted).toBe('agent-transfer')
    expect(model.containment.globalCommands).toContainEqual({ key: '0', intent: 'agent', target: 'agent-transfer' })
  })

  it('forces sensitive on an encrypted capture and demands a masking guardrail', () => {
    const capture = model.nodes['billing-prompt'] as CaptureNode
    expect(capture.sensitive).toBe(true)
    expect(capture.validation?.maxLength).toBe(16)
    expect(model.coverage.requiresReview.some((r) => r.nodeId === 'billing-prompt' && /masking guardrail/.test(r.reason))).toBe(true)
  })

  it('carries the Lambda error path through as the lookup onError', () => {
    const dip = model.nodes['outage-dip'] as LookupNode
    expect(dip.system).toContain('function:CheckOutage')
    expect(dip.requestVars).toEqual(['postalCode'])
    expect(dip.onError).toBe('agent-transfer')
  })

  it('reports full flow coverage when every action type is handled', () => {
    expect(model.coverage.flow.totalActions).toBe(10)
    expect(model.coverage.flow.unknown).toEqual([])
    expect(model.coverage.flow.mapped).toBe(10)
  })
})

describe('honesty about what it cannot read', () => {
  it('preserves an unhandled action verbatim instead of dropping it', () => {
    const model = parseIvr({ contactFlow: unhandled, importedAt: AT })
    const node = model.nodes.mystery
    expect(node.kind).toBe('unknown')
    expect(model.coverage.flow.unknown).toEqual([{ id: 'mystery', sourceType: 'CreateCallbackContact' }])
    expect(model.coverage.flow.mapped).toBe(2)
    if (node.kind === 'unknown') {
      expect(node.raw).toMatchObject({ Parameters: { SomeNewField: { nested: true } } })
    }
  })

  it('does not throw on malformed input', () => {
    expect(() => parseIvr({ contactFlow: malformed, importedAt: AT })).not.toThrow()
    const model = parseIvr({ contactFlow: malformed, importedAt: AT })
    expect(model.coverage.requiresReview[0].severity).toBe('blocker')
    expect(Object.keys(model.nodes)).toEqual([])
  })

  it('does not throw on junk', () => {
    for (const junk of [null, undefined, 42, 'hello', [], { Actions: 'nope' }]) {
      expect(() => parseIvr({ contactFlow: junk, importedAt: AT })).not.toThrow()
    }
  })
})

describe('the Lex join', () => {
  it('resolves the bot and counts only intents both files agree on', () => {
    const model = withBot()
    const node = model.nodes['ask-intent'] as IntentNode
    expect(node.kind).toBe('intent')
    expect(node.resolved).toBe(true)
    expect(model.coverage.nlu.totalIntents).toBe(5)
    expect(model.coverage.nlu.resolved).toBe(3)
  })

  it('surfaces a branch the bot does not define', () => {
    expect(withBot().coverage.nlu.dangling).toEqual(['ReportMovedHouse'])
  })

  it('surfaces intents the flow never reaches, ignoring the fallback', () => {
    expect(withBot().coverage.nlu.orphaned).toEqual(['ReportOutage'])
  })

  it('says exactly why it assumed a bot, not just that it did', () => {
    expect(withBot().coverage.requiresReview.some((r) => /only bot uploaded/.test(r.reason) && /confirm this is the right bot/i.test(r.reason))).toBe(true)
  })

  it('blocks when the flow calls a bot that was not uploaded', () => {
    const model = parseIvr({ contactFlow: lexBacked, importedAt: AT })
    const node = model.nodes['ask-intent'] as IntentNode
    expect(node.resolved).toBe(false)
    expect(model.coverage.nlu.resolved).toBe(0)
    expect(model.coverage.nlu.dangling).toHaveLength(4)
    const blocker = model.coverage.requiresReview.find((r) => r.severity === 'blocker')
    expect(blocker?.reason).toMatch(/no bot export was uploaded/)
  })

  it('rolls slot retry counts up into application-level containment', () => {
    expect(withBot().containment.maxInvalidAttempts).toBe(3)
  })

  it('normalizes the Lex locale to BCP-47', () => {
    expect(withBot().languages).toContain('en-US')
  })
})

describe('Lex export parsing', () => {
  it('reads V2 intents, utterances, slots and synonyms', () => {
    const { bots } = parseLexExport(acmeV2, 'acme-v2')
    const bot = bots[0]
    expect(bot.name).toBe('AcmeUtilitiesBot')
    expect(bot.confidenceThreshold).toBe(0.55)
    expect(bot.locales).toEqual(['en_US'])

    const payBill = bot.intents.find((i) => i.name === 'PayBill')!
    expect(payBill.utterances).toHaveLength(4)
    expect(payBill.confirmationPrompt).toMatch(/Just to confirm/)
    expect(payBill.closingResponse).toMatch(/payment is complete/)
    expect(payBill.slots.map((s) => s.name)).toEqual(['accountNumber', 'paymentAmount'])

    const account = payBill.slots.find((s) => s.name === 'accountNumber')!
    expect(account.prompt).toBe("What's your account number?")
    expect(account.required).toBe(true)
    expect(account.maxRetries).toBe(3)
    expect(account.sensitive).toBe(true)

    const topic = bot.slotTypes.find((t) => t.name === 'BillingTopic')!
    expect(topic.builtIn).toBe(false)
    expect(topic.values[0].synonyms).toEqual(['bill', 'my bill', 'invoice', 'payment'])
  })

  it('marks built-in slot types as unresolvable rather than guessing an ACXD name', () => {
    const { review } = parseLexExport(acmeV2, 'acme-v2')
    expect(review.some((r) => /AMAZON.Number/.test(r.reason) && /not published/.test(r.reason))).toBe(true)
  })

  it('flags a dialog code hook as needing a human decision', () => {
    const { review } = parseLexExport(acmeV2, 'acme-v2')
    expect(review.some((r) => /CheckBalance/.test(r.nodeId) && /dialog code hook/.test(r.reason))).toBe(true)
  })

  it('reads the V1 flat export format too', () => {
    const { bots } = parseLexExport(acmeV1, 'acme-v1')
    const bot = bots[0]
    expect(bot.name).toBe('AcmeLegacyBot')
    expect(bot.locales).toEqual(['en-US'])
    const payBill = bot.intents[0]
    expect(payBill.name).toBe('PayBill')
    expect(payBill.slots[0].prompt).toBe('What is your account number?')
    expect(payBill.slots[0].sensitive).toBe(true)
    expect(payBill.fulfillmentHook).toContain('function:LegacyPay')
    expect(bot.slotTypes[0].values[0].synonyms).toEqual(['bill', 'invoice'])
  })

  it('reports an unreadable export instead of throwing', () => {
    expect(parseLexExport(null).review[0].severity).toBe('blocker')
    expect(parseLexExport({ nothing: true }).review[0].severity).toBe('blocker')
  })
})

describe('determinism', () => {
  it('produces byte-identical output across runs', () => {
    const a = JSON.stringify(withBot())
    const b = JSON.stringify(withBot())
    expect(a).toBe(b)
  })
})

/**
 * Verified against a genuine Amazon Connect console export. The console's "Export" button
 * produces a different shape from the flow language used by the API and CloudFormation —
 * different envelope, key names, value shapes, and action-type names. Both are real.
 */
describe('real console export (modules format)', () => {
  const model = parseIvr({ contactFlow: realExport, importedAt: AT })

  it('maps every block without falling back to unknown', () => {
    expect(model.coverage.flow.totalActions).toBe(6)
    expect(model.coverage.flow.unknown).toEqual([])
  })

  it('takes the flow name from the export metadata', () => {
    expect(model.sources[0].name).toBe('InboundLexRouter')
  })

  it('reads array-shaped parameters and branch-shaped transitions', () => {
    const prompt = Object.values(model.nodes).find((n): n is PromptNode => n.kind === 'prompt')!
    expect(prompt.text).toBe('Something went wrong.  Please try again later.')
  })

  it('recognises the Lex handoff and the intents it branches on', () => {
    const intent = Object.values(model.nodes).find((n): n is IntentNode => n.kind === 'intent')!
    expect(intent.botRef).toBe('ConnectBot')
    expect(intent.cases.map((c) => c.intent)).toEqual(['WaitOnHold', 'CallBack', 'Emergency'])
  })

  it('still blocks on the missing bot export rather than pretending it is complete', () => {
    expect(model.coverage.nlu.dangling).toEqual(['WaitOnHold', 'CallBack', 'Emergency'])
    expect(model.coverage.requiresReview.some((r) => r.severity === 'blocker')).toBe(true)
  })
})
