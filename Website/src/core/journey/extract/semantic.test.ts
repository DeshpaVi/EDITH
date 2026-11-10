import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readSource } from '../source'
import type { SourceInput } from '../source'
import type { Journey } from '../model'
import { extractJourney, semanticIssues } from './index'
import type { ExtractPort, ExtractRequestBody } from './index'
import handMade from '../fixtures/census-cqa.journey.json'
import nova from '../fixtures/census-cqa.extracted-nova.journey.json'
import nova2 from '../fixtures/census-cqa.extracted-nova-v2.journey.json'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const deck = (): SourceInput => readSource({ fileName: 'census.pptx', bytes: new Uint8Array(readFileSync(join(__dirname, '../fixtures/census-cqa-call-flow.pptx'))) })
const novaJourney = () => clone(nova) as unknown as Journey

describe('checks on a valid but wrong reading (the real Nova Pro reading of the Census deck)', () => {
  const issues = semanticIssues(deck(), novaJourney())
  const at = (path: string) => issues.filter((i) => i.path === path)

  it('catches the start marker given as the greeting', () => {
    const i = novaJourney().steps.findIndex((s) => s.label === 'Incoming Call')
    expect(at(`$.steps[${i}]`)[0].message).toContain('only marks where the call begins')
  })

  it('catches diagram titles kept inside the spoken wording, because the diagram uses that convention throughout', () => {
    const titled = issues.filter((i) => i.path.endsWith('.text'))
    expect(titled.length).toBeGreaterThanOrEqual(5)
    expect(titled.map((i) => i.message).join(' ')).toMatch(/"Main Greeting:"/)
    expect(titled.map((i) => i.message).join(' ')).toMatch(/"Auth Failure:"/)
  })

  it('catches shapes that no step or unmapped entry accounts for', () => {
    const missing = at('$.steps').map((i) => i.message).join('\n')
    expect(missing).toContain('Set es_US')
    expect(missing).toContain('enumeration')
    expect(missing).not.toContain('Legend') // the legend and its samples are not part of the flow
  })
})

describe('no false alarms', () => {
  it('finds nothing wrong with the hand-made journey (it cites shapes by name, so coverage is skipped)', () => {
    expect(semanticIssues(deck(), clone(handMade) as unknown as Journey)).toEqual([])
  })

  it('does not treat a legitimate "Note:" disclosure as a diagram title when the diagram does not use that convention', () => {
    const j = clone(handMade) as unknown as Journey
    const g = j.steps.find((s) => s.kind === 'greeting')
    if (g && g.kind === 'greeting') g.text = 'Note: this call may be recorded.'
    expect(semanticIssues(deck(), j).filter((i) => i.path.endsWith('.text'))).toEqual([])
  })

  it('skips the shape check for sources without shapes', () => {
    const text: SourceInput = { kind: 'text', fileName: 'a.txt', text: 'x' }
    expect(semanticIssues(text, clone(handMade) as unknown as Journey)).toEqual([])
  })
})

describe('the pipeline repairs what the checks find', () => {
  function port(...answers: unknown[]): ExtractPort & { requests: ExtractRequestBody[] } {
    const requests: ExtractRequestBody[] = []
    return { requests, async extract(body) { requests.push(body); return answers.length > 1 ? answers.shift() : answers[0] } }
  }

  it('sends the findings back with the previous answer, then accepts the corrected journey', async () => {
    const p = port(novaJourney(), clone(handMade))
    const r = await extractJourney(p, deck())
    expect(r.ok && r.attempts).toBe(2)
    expect(p.requests[1].feedback?.some((f) => f.message.includes('only marks where the call begins'))).toBe(true)
    expect(p.requests[1].previous).toBeTruthy()
  })

  it('on the last attempt keeps the journey and records the findings as review entries instead of failing', async () => {
    const r = await extractJourney(port(novaJourney()), deck(), { maxAttempts: 1 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const reader = r.journey.unmapped.filter((u) => u.source === 'reader check')
    expect(reader.length).toBeGreaterThan(3)
    expect(reader[0].description).toMatch(/^Reader check:/)
  })
})

describe('terminal steps without a next list', () => {
  const port = (answer: unknown): ExtractPort => ({ async extract() { return answer } })
  const withoutNext = (kind: string) => {
    const j = clone(handMade) as unknown as Journey & { steps: Array<Record<string, unknown>> }
    const step = j.steps.find((s) => s.kind === kind) as unknown as Record<string, unknown>
    delete step.next
    return { journey: j, id: String(step.id) }
  }

  it('treats a missing next on an end or escalation step as empty, and records it as an assumption', async () => {
    for (const kind of ['end', 'escalation']) {
      const { journey, id } = withoutNext(kind)
      const r = await extractJourney(port(journey), deck())
      expect(r.ok && r.attempts, kind).toBe(1)
      if (!r.ok) continue
      expect(r.journey.assumptions.some((a) => a.statement.includes(`Step "${id}" (${kind}) had no "next" list`))).toBe(true)
    }
  })

  it('does not hide a missing next on any other kind: it could be a dropped edge', async () => {
    const { journey } = withoutNext('confirmation')
    const r = await extractJourney(port(journey), deck(), { maxAttempts: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.message === 'must be an array of edges')).toBe(true)
  })
})

describe('a repair that breaks the structure does not lose a valid reading', () => {
  it('returns the earlier valid reading, with the open findings as review entries', async () => {
    const broken = { ...novaJourney(), steps: [{ id: 'x', kind: 'greeting' }] }
    let n = 0
    const p: ExtractPort = { async extract() { n++; return n === 1 ? novaJourney() : broken } }
    const r = await extractJourney(p, deck())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.journey.steps.length).toBe(novaJourney().steps.length)
    expect(r.journey.unmapped.some((u) => u.source === 'reader check')).toBe(true)
  })

  it('still fails when no reading was ever valid', async () => {
    const p: ExtractPort = { async extract() { return { title: 'x' } } }
    const r = await extractJourney(p, deck(), { maxAttempts: 2 })
    expect(r.ok).toBe(false)
  })
})

describe('slides that are not flow diagrams', () => {
  it('does not ask for a step or an unmapped entry for the scenarios text box on slide 2', () => {
    const missing = semanticIssues(deck(), novaJourney()).filter((i) => i.path === '$.steps').map((i) => i.message).join('\n')
    expect(missing).not.toContain('Proposed Scenarios')
    expect(missing).toContain('Set es_US') // the flow slide is still checked
  })
})

describe('the second real reading (v12 pipeline, with Notes): what is still wrong is found', () => {
  const issues = semanticIssues(deck(), clone(nova2) as unknown as Journey)
  const msgs = issues.map((i) => i.message).join('\n')

  it('finds the arrow the model invented and the two arrows it left out, naming the shapes', () => {
    expect(msgs).toMatch(/no arrow from "Detect Spanish speaker\?" to "Intent Failure/)
    expect(msgs).toMatch(/arrow from "Detect Spanish speaker\?" to "Set es_US".*nearest one/)
    expect(msgs).toMatch(/arrow from "Perform self-service \(e\.g\., FAQ\)" to "Anything Else/)
  })

  it('finds the start marker that was given the greeting\'s words, by its label', () => {
    expect(issues.some((i) => i.path === '$.steps[0]' && i.message.includes('only marks where the call begins'))).toBe(true)
  })

  it('does not flag the arrows the model got right, the removed titles, or the covered shapes', () => {
    expect(msgs).not.toContain('Main Greeting:')
    expect(issues.filter((i) => i.path === '$.steps').length).toBe(0)
    expect(msgs).not.toMatch(/no arrow from "Main Greeting/)
    expect(msgs).not.toMatch(/no arrow from "Utterance recognized/)
  })

  it('leaves the hand-made journey alone (it cites shapes by name, so the arrow check is skipped)', () => {
    expect(semanticIssues(deck(), clone(handMade) as unknown as Journey)).toEqual([])
  })
})
