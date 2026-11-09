import { describe, it, expect } from 'vitest'
import type { AuthenticationStep, Journey } from '../../journey/model'
import { authenticationFlow, escalationFlow, mainFlow, safetyFlow, apologyOf, FLOW_IDS } from './flows'
import { FlowBuilder } from './flowBuilder'
import type { FlowJson, FlowNode } from './flowBuilder'
import { stableId } from './ids'
import census from '../../journey/fixtures/census-cqa.journey.json'
import realAuthentication from './fixtures/flow.Authentication.json'
import realEscalation from './fixtures/flow.Escalation.json'
import realSafety from './fixtures/flow.SafetyEscalation.json'

const journey = () => JSON.parse(JSON.stringify(census)) as unknown as Journey
const authStep = () => journey().steps.find((s) => s.kind === 'authentication') as AuthenticationStep

/**
 * Canonical structure of a flow: node ids, canvas positions and message ids are dropped; nodes are labelled
 * in breadth-first order from the start node. Two flows with the same shape are the same flow.
 */
function shape(flow: { nodes: Record<string, unknown> }) {
  const nodes = flow.nodes as Record<string, FlowNode>
  const start = Object.values(nodes).find((n) => n.type === 'start') as FlowNode
  const label = new Map<string, string>()
  const queue = [start.nodeId]
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (label.has(id)) continue
    label.set(id, `n${label.size}`)
    for (const c of nodes[id].childNodes) if (c.nodeId) queue.push(c.nodeId)
  }
  const out: Record<string, unknown> = {}
  for (const [id, l] of label) {
    const n = nodes[id]
    const { name: _n, stateModifications, generativeText, generativeJourney, ...rest } = n.metadata as Record<string, unknown>
    const g = generativeText as Record<string, unknown> | undefined
    const j = generativeJourney as Record<string, unknown> | undefined
    out[l] = {
      type: n.type,
      messages: n.messages.map((m) => m.body.trim()),
      stateModifications,
      metadata: rest,
      generativeText: g && { modelType: g.modelType, name: g.name },
      generativeJourney: j && { modelType: j.modelType, dataCapture: j.dataCapture, exits: (j.exitConditions as Array<{ name: string }>).map((e) => e.name), tools: (j.tools as unknown[]).length },
      dataRequests: n.dataRequests?.map((d) => (d as { dataRequestId: string; payload: unknown }).dataRequestId),
      children: n.childNodes.map((c) => ({ to: c.nodeId ? label.get(c.nodeId) : null, conditions: c.conditions })),
    }
  }
  return out
}

describe('stableId', () => {
  it('is deterministic, unique per key, and UUID-shaped', () => {
    expect(stableId('Flow', 'a')).toBe(stableId('Flow', 'a'))
    expect(stableId('Flow', 'a')).not.toBe(stableId('Flow', 'b'))
    expect(stableId('Flow', 'a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('FlowBuilder', () => {
  it('rejects a duplicate node key and an edge to an unknown node', () => {
    const b = new FlowBuilder('Demo').node('a', 'start')
    expect(() => b.node('a', 'basic')).toThrow()
    expect(() => b.edge('a', 'missing')).toThrow()
  })
  it('is reproducible', () => {
    const make = () => new FlowBuilder('Demo').node('s', 'start').node('b', 'basic', { messages: ['hi'] }).edge('s', 'b').build()
    expect(make()).toEqual(make())
  })
})

describe('golden: generated flows have the same structure as the real exports', () => {
  it('Escalation', () => {
    const expected = JSON.parse(JSON.stringify(realEscalation).split('customeroutput').join('summaryText'))
    expect(shape(escalationFlow(['en-US']).flow)).toEqual(shape(expected))
  })

  it('SafetyEscalation (wording of the fixed summary is generic in the generator)', () => {
    const expected = JSON.parse(
      JSON.stringify(realSafety).replace('the caller was given 911 and 988 information.', 'the caller was given emergency-services and crisis-line information.'),
    )
    expect(shape(safetyFlow(['en-US']).flow)).toEqual(shape(expected))
    const built = safetyFlow(['en-US']).flow
    const message = Object.values(built.nodes).find((n) => n.type === 'basic')!.messages[0].body
    const real = Object.values(realSafety.nodes).find((n) => n.type === 'basic')!.messages[0].body
    expect(message).toBe(real)
  })

  it('Authentication (differences: system escalation id, retry wording spacing, the data request id, and unused empty payload fields)', () => {
    const expected = JSON.parse(
      JSON.stringify(realAuthentication)
        .split('NLX.Escalation').join('Escalation')
        .split('verifyCensusAuth').join('verifyAuth'),
    ) as { nodes: Record<string, { dataRequests?: Array<{ payload: { value: Record<string, unknown> } }> }> }
    for (const n of Object.values(expected.nodes)) {
      for (const d of n.dataRequests ?? []) d.payload.value = { authValue: d.payload.value.authValue }
    }
    const built = authenticationFlow(authStep(), {
      dataRequestId: 'verifyAuth',
      successFlowId: 'CQAInboundDemo',
      intentName: 'enumeration',
      aiDescription: 'x',
      languageCodes: ['en-US'],
    })
    expect(shape(built.flow)).toEqual(shape(expected as unknown as FlowJson))
  })
})

describe('authentication flow content', () => {
  const built = () => authenticationFlow(authStep(), { dataRequestId: 'verifyAuth', successFlowId: FLOW_IDS.main, intentName: 'enumeration', aiDescription: 'd', languageCodes: ['en-US'] })
  const nodes = () => Object.values(built().flow.nodes)

  it('plays the journey prompt verbatim', () => {
    expect(nodes().find((n) => n.messages.length > 0 && n.type === 'basic' && n.messages[0].body.startsWith('To proceed'))!.messages[0].body).toBe(authStep().text)
  })

  it('bounds attempts with an inclusive loop (N attempts = range 0 to N-1)', () => {
    const loop = nodes().find((n) => n.type === 'loop')!.metadata.loop as { start: number; end: number }
    expect([loop.start, loop.end]).toEqual([0, 2])
  })

  it('captures into ONE sensitive slot and clears it between attempts', () => {
    expect(built().flow.slotTypes).toEqual([{ name: 'authValue', type: 'Freeformtext', examples: [], sensitive: true, aiDescription: '', multiSelect: false }])
    expect(nodes().some((n) => n.metadata.stateModifications.some((m) => m.type === 'slot' && m.modification === 'clear'))).toBe(true)
  })

  it('compares the verified flag to a BOOLEAN true (a text "true" never matches)', () => {
    const split = nodes().find((n) => n.type === 'split')!
    const cond = split.childNodes[0].conditions[0] as { right: { value: unknown } }
    expect(cond.right.value).toBe(true)
  })

  it('names the identifiers in the capture prompt without inventing a data type', () => {
    const j = nodes().find((n) => n.type === 'generative_journey')!.metadata.generativeJourney as { prompt: string }
    expect(j.prompt).toContain('Census ID, home zip code, or last four digits of SSN')
    expect(j.prompt).not.toContain('number')
  })

  it('warns that the retry wording is split into an apology plus the replayed prompt', () => {
    expect(built().warnings.join(' ')).toContain("I'm sorry, I didn't quite get that.")
  })

  it('refuses a retry count below one', () => {
    const a = authStep()
    a.retry.maxAttempts = 0
    expect(() => authenticationFlow(a, { dataRequestId: 'x', successFlowId: 'y', intentName: 'z', aiDescription: '', languageCodes: ['en-US'] })).toThrow()
  })

  it('apologyOf keeps a single sentence whole and trims a longer prompt to its first sentence', () => {
    expect(apologyOf("I'm sorry, I didn't quite get that.")).toBe("I'm sorry, I didn't quite get that.")
    expect(apologyOf("I'm sorry, I didn't quite get that. Can you please repeat it?")).toBe("I'm sorry, I didn't quite get that.")
  })
})

describe('main conversation flow', () => {
  it('plays the greeting verbatim and exits to handoff and to authentication', () => {
    const { flow, warnings } = mainFlow(journey(), { authenticationFlowId: FLOW_IDS.authentication, content: { knowledgeBaseId: 'kb-1' }, languageCodes: ['en-US'] })
    const nodes = Object.values(flow.nodes)
    expect(nodes.find((n) => n.type === 'basic')!.messages[0].body).toBe('Thank you for calling the 2030 Census Questionnaire Assistance Center.')
    const j = nodes.find((n) => n.type === 'generative_journey')!
    const meta = j.metadata.generativeJourney as { exitConditions: Array<{ name: string }>; tools: unknown[] }
    expect(meta.exitConditions.map((e) => e.name)).toEqual(['humanHandoff', 'routeEnumeration'])
    expect(meta.tools).toHaveLength(1)
    const targets = nodes.filter((n) => n.type === 'redirect').map((n) => (n.metadata.redirect as { flowId: string }).flowId)
    expect(targets).toEqual(expect.arrayContaining([FLOW_IDS.escalation, FLOW_IDS.authentication]))
    expect(warnings.some((w) => w.includes('baseline'))).toBe(true)
  })

  it('wires exit i with the system condition index and a timeout/failure fallback', () => {
    const { flow } = mainFlow(journey(), { authenticationFlowId: FLOW_IDS.authentication, content: {}, languageCodes: ['en-US'] })
    const j = Object.values(flow.nodes).find((n) => n.type === 'generative_journey')!
    const idx = j.childNodes.map((c) => JSON.stringify(c.conditions))
    expect(idx.some((c) => c.includes('System.gjConditionIndex') && c.includes('"value":0'))).toBe(true)
    expect(idx.some((c) => c.includes('System.gjConditionIndex') && c.includes('"value":1'))).toBe(true)
    expect(idx.some((c) => c.includes('timeout'))).toBe(true)
    expect(idx.some((c) => c.includes('failure'))).toBe(true)
  })

  it('has no knowledge tool, with a warning, when no knowledge base id is supplied', () => {
    const { flow, warnings } = mainFlow(journey(), { content: {}, languageCodes: ['en-US'] })
    expect((Object.values(flow.nodes).find((n) => n.type === 'generative_journey')!.metadata.generativeJourney as { tools: unknown[] }).tools).toHaveLength(0)
    expect(warnings.some((w) => w.includes('knowledge base'))).toBe(true)
  })

  it('adds no authentication exit when there is no authentication flow', () => {
    const { flow } = mainFlow(journey(), { content: {}, languageCodes: ['en-US'] })
    const meta = Object.values(flow.nodes).find((n) => n.type === 'generative_journey')!.metadata.generativeJourney as { exitConditions: unknown[] }
    expect(meta.exitConditions).toHaveLength(1)
  })
})
