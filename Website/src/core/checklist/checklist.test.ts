import { describe, it, expect } from 'vitest'
import type { Journey } from '../journey'
import { buildChecklist, defaultSelection, resolveSelection, summarize, renderChecklist, IDS, contextVariableFor } from './index'
import census from '../journey/fixtures/census-cqa.journey.json'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const journey = (): Journey => clone(census) as unknown as Journey
const idsOf = (j: Journey) => buildChecklist(j).items.map((i) => i.id)

describe('checklist for the Census CQA journey', () => {
  const checklist = buildChecklist(journey())
  const ids = checklist.items.map((i) => i.id)
  const get = (id: string) => checklist.items.find((i) => i.id === id)!

  it('asks for the AWS and ACXD building blocks the demo needed', () => {
    for (const id of [
      IDS.provisioner, IDS.apiKeySecret, IDS.application, IDS.contactFlow, IDS.contactAttributes,
      IDS.mainFlow, IDS.authFlow, IDS.escalationFlow, IDS.verifyRequest,
      IDS.table, IDS.verifyLambda, IDS.verifyRole, IDS.knowledgeBase, IDS.languages,
      IDS.ctx('isAuthenticated'), IDS.ctx('transferSummary'), IDS.ctx('customerIntent'), IDS.ctx('stuckPoint'),
    ]) {
      expect(ids, id).toContain(id)
    }
  })

  it('recommends the baseline guardrails but does not require them', () => {
    for (const id of [IDS.guardrailSafety, IDS.guardrailInjection, IDS.guardrailToxicity, IDS.safetyFlow]) {
      expect(get(id).need).toBe('recommended')
      expect(get(id).selected).toBe(true)
    }
  })

  it('explains each journey-derived item with the steps that triggered it', () => {
    expect(get(IDS.authFlow).sources).toEqual(['auth'])
    expect(get(IDS.escalationFlow).sources).toEqual(expect.arrayContaining(['agent', 'intent', 'auth']))
    expect(get(IDS.table).reason).toMatch(/index/i)
  })

  it('states the retry and single-slot design in the authentication notes', () => {
    const notes = get(IDS.authFlow).notes.join(' ')
    expect(notes).toContain('Loop range 0 to 2')
    expect(notes).toContain('ONE slot')
  })

  it('collects the hand-over context from the journey', () => {
    expect(get(IDS.contactAttributes).notes.join(' ')).toContain('transferSummary')
    expect(get(IDS.contactAttributes).notes.join(' ')).toContain('stuckPoint')
  })

  it('surfaces what it cannot do as reviews, worst first', () => {
    const titles = checklist.reviews.map((r) => r.title)
    expect(titles).toContain('Language detection and switching in ACXD is unverified')
    expect(checklist.reviews.some((r) => r.detail.includes('French'))).toBe(true)
    expect(checklist.reviews[0].severity).toBe('blocker')
    const order = checklist.reviews.map((r) => r.severity)
    expect(order).toEqual([...order].sort((a, b) => ['blocker', 'warn', 'info'].indexOf(a) - ['blocker', 'warn', 'info'].indexOf(b)))
  })

  it('records the owner decisions as assumptions to confirm', () => {
    expect(checklist.reviews.filter((r) => r.id.startsWith('review.assumption.')).length).toBe(5)
  })

  it('never reports the demo as fully emittable while a blocker or unconfirmed item remains', () => {
    const s = summarize(checklist)
    expect(s.fullyEmittable).toBe(false)
    expect(s.bySchemaStatus.unconfirmed).toBeGreaterThan(0)
    expect(s.reviews.blocker).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    expect(buildChecklist(journey())).toEqual(buildChecklist(journey()))
  })

  it('has no dangling requirements', () => {
    for (const i of checklist.items) for (const dep of i.requires) expect(ids, `${i.id} -> ${dep}`).toContain(dep)
  })
})

describe('checklist for sparse model answers (found when a read journey would not open)', () => {
  const noDangling = (j: Journey) => {
    const c = buildChecklist(j) // must not throw
    const ids = new Set(c.items.map((i) => i.id))
    for (const i of c.items) for (const r of i.requires) expect(ids.has(r), `${i.id} requires ${r}`).toBe(true)
    return c
  }

  it('builds when every escalation lists no hand-over context, and still creates the baseline variables', () => {
    const j = journey()
    for (const st of j.steps) if (st.kind === 'escalation') st.context = []
    const c = noDangling(j)
    const ids = c.items.map((i) => i.id)
    expect(ids).toContain(IDS.ctx('transferSummary'))
    expect(ids).toContain(IDS.ctx('customerIntent'))
  })

  it('still creates the escalation flow and its variables when the diagram has authentication but no escalation step', () => {
    const j = journey()
    j.steps = j.steps.filter((st) => st.kind !== 'escalation')
    for (const st of j.steps) st.next = st.next.filter((e) => j.steps.some((o) => o.id === e.to))
    const ids = noDangling(j).items.map((i) => i.id)
    for (const id of [IDS.escalationFlow, IDS.ctx('transferSummary'), IDS.ctx('customerIntent'), IDS.ctx('stuckPoint')]) expect(ids).toContain(id)
  })

  it('builds when the journey has no escalation and no authentication, because the safety flow still needs the hand-back variables', () => {
    const j = journey()
    j.steps = j.steps.filter((st) => st.kind !== 'escalation' && st.kind !== 'authentication')
    for (const st of j.steps) {
      st.next = st.next.filter((e) => j.steps.some((o) => o.id === e.to))
      if (st.kind === 'intent_capture') st.retry.onExhausted = 'end'
    }
    const ids = noDangling(j).items.map((i) => i.id)
    expect(ids).toContain(IDS.ctx('customerIntent'))
    expect(ids).toContain(IDS.ctx('transferSummary'))
    expect(ids).not.toContain(IDS.escalationFlow)
  })
})

describe('checklist for other journeys', () => {
  it('builds no authentication items when the journey has no authentication', () => {
    const j = journey()
    j.steps = j.steps.filter((s) => s.kind !== 'authentication' && s.kind !== 'decision' && s.id !== 'enumeration')
    j.steps.forEach((s) => (s.next = s.next.filter((e) => j.steps.some((t) => t.id === e.to))))
    const ids = idsOf(j)
    expect(ids).not.toContain(IDS.authFlow)
    expect(ids).not.toContain(IDS.table)
    expect(ids).toContain(IDS.escalationFlow)
  })

  it('blocks when the verification backend is unknown and generates no backend', () => {
    const j = journey()
    const auth = j.steps.find((s) => s.kind === 'authentication')!
    if (auth.kind === 'authentication') auth.verifiesAgainst = { type: 'unknown' }
    const c = buildChecklist(j)
    expect(c.reviews.some((r) => r.id === 'review.auth.backend' && r.severity === 'blocker')).toBe(true)
    expect(c.items.map((i) => i.id)).not.toContain(IDS.table)
  })

  it('asks for an API URL when verification uses an existing API', () => {
    const j = journey()
    const auth = j.steps.find((s) => s.kind === 'authentication')!
    if (auth.kind === 'authentication') auth.verifiesAgainst = { type: 'http_api' }
    const c = buildChecklist(j)
    expect(c.items.find((i) => i.id === IDS.verifyRequest)!.params.map((p) => p.key)).toContain('VerifyApiUrl')
    expect(c.items.map((i) => i.id)).not.toContain(IDS.verifyLambda)
  })

  it('turns an unclassified step into a review instead of dropping it', () => {
    const j = journey()
    j.steps.push({ id: 'mystery', kind: 'unknown', label: 'Press-4 survey', raw: 'Press 4 for a survey?', next: [], source: 'slide 3' })
    j.steps[0].next.push({ to: 'mystery' })
    expect(buildChecklist(j).reviews.some((r) => r.id === 'review.unknown.mystery')).toBe(true)
  })

  it('flags a step nothing leads to', () => {
    const j = journey()
    j.steps.push({ id: 'island', kind: 'announcement', label: 'Island', text: 'Hello?', next: [], source: 'slide 4' })
    expect(buildChecklist(j).reviews.some((r) => r.id === 'review.orphan.island')).toBe(true)
  })

  it('flags regulated wording without altering it', () => {
    const j = journey()
    const greeting = j.steps.find((s) => s.kind === 'greeting')!
    if (greeting.kind === 'greeting') greeting.compliance = true
    const c = buildChecklist(j)
    expect(c.reviews.some((r) => r.id === 'review.compliance')).toBe(true)
    expect(greeting.kind === 'greeting' && greeting.text).toBe('Thank you for calling the 2030 Census Questionnaire Assistance Center.')
  })

  it('creates a variable and a review for custom hand-over context', () => {
    const j = journey()
    const agent = j.steps.find((s) => s.kind === 'escalation')!
    if (agent.kind === 'escalation') agent.context.push('preferred contact time')
    const c = buildChecklist(j)
    expect(c.items.map((i) => i.id)).toContain(IDS.ctx('preferredContactTime'))
    expect(c.reviews.some((r) => r.id === 'review.context.preferredContactTime')).toBe(true)
  })

  it('blocks non-knowledge self-service steps', () => {
    const j = journey()
    const faq = j.steps.find((s) => s.id === 'faq')!
    if (faq.kind === 'self_service') faq.content = 'api'
    expect(buildChecklist(j).reviews.some((r) => r.id === 'review.selfService.faq' && r.severity === 'blocker')).toBe(true)
  })

  it('adds no language item for a single-language journey', () => {
    const j = journey()
    j.languages = ['en-US']
    j.steps = j.steps.filter((s) => s.kind !== 'language_detection')
    j.steps.forEach((s) => (s.next = s.next.filter((e) => j.steps.some((t) => t.id === e.to))))
    j.steps.find((s) => s.id === 'intent')!.next.push({ to: 'auth_required' })
    expect(idsOf(j)).not.toContain(IDS.languages)
  })
})

describe('selection', () => {
  const c = buildChecklist(clone(census) as unknown as Journey)

  it('starts from required and recommended items', () => {
    const start = defaultSelection(c)
    expect(start).toContain(IDS.authFlow)
    expect(start).toContain(IDS.guardrailSafety)
  })

  it('keeps required items on even if the consultant deselects them', () => {
    const r = resolveSelection(c, [])
    expect(r.selected).toContain(IDS.authFlow)
    expect(r.forcedRequired).toContain(IDS.authFlow)
  })

  it('lets the consultant drop recommended guardrails', () => {
    const chosen = defaultSelection(c).filter((id) => id !== IDS.guardrailToxicity)
    expect(resolveSelection(c, chosen).selected).not.toContain(IDS.guardrailToxicity)
  })

  it('pulls in dependencies of an optional choice and reports what it added', () => {
    const r = resolveSelection(c, [IDS.guardrailSafety])
    expect(r.selected).toContain(IDS.safetyFlow)
    expect(r.autoAdded).toContain(IDS.safetyFlow)
  })

  it('treats dependencies that are already required as required, not auto-added', () => {
    const r = resolveSelection(c, [IDS.verifyLambda])
    expect(r.selected).toEqual(expect.arrayContaining([IDS.table, IDS.verifyRole]))
    expect(r.autoAdded).not.toContain(IDS.table)
  })

  it('selecting the safety guardrail pulls in its flow', () => {
    expect(resolveSelection(c, [IDS.guardrailSafety]).selected).toContain(IDS.safetyFlow)
  })

  it('ignores unknown ids and reports them', () => {
    const r = resolveSelection(c, ['nope'])
    expect(r.unknown).toEqual(['nope'])
    expect(r.selected).not.toContain('nope')
  })

  it('summarises a selection', () => {
    const s = summarize(c, resolveSelection(c, defaultSelection(c)).selected)
    expect(s.total).toBeGreaterThan(10)
  })
})

describe('context variable mapping', () => {
  it.each([
    ['conversation summary', 'transferSummary', true],
    ['caller intent', 'customerIntent', true],
    ['point at which the caller got stuck', 'stuckPoint', true],
    ['preferred contact time', 'preferredContactTime', false],
  ])('%s -> %s', (label, name, known) => {
    expect(contextVariableFor(label)).toEqual({ name, known })
  })
})

describe('report', () => {
  const c = buildChecklist(clone(census) as unknown as Journey)
  const md = renderChecklist('Census CQA', c)

  it('lists required items, recommendations and the decisions needed', () => {
    expect(md).toContain('## Required')
    expect(md).toContain('## Recommended')
    expect(md).toContain('## Needs a human decision')
    expect(md).toContain('BLOCKER: Language detection and switching in ACXD is unverified')
  })

  it('marks secrets as NoEcho and never prints an API key', () => {
    expect(md).toContain('ACXD API key (acxd_live_...) (secret, NoEcho)')
    expect(md).not.toMatch(/acxd_live_[A-Za-z0-9]/)
  })

  it('reflects a custom selection', () => {
    const only = renderChecklist('Census CQA', c, [IDS.authFlow])
    expect(only).toContain('[x] **Authentication flow**')
    expect(only).toContain('[ ] **Main conversation flow**')
  })
})
