import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readSource } from '../source'
import type { SourceInput } from '../source'
import type { Journey } from '../model'
import { extractJourney, reconcile, semanticIssues } from './index'
import type { ExtractPort, ExtractRequestBody } from './index'
import handMade from '../fixtures/census-cqa.journey.json'
import nova1 from '../fixtures/census-cqa.extracted-nova.journey.json'
import nova2 from '../fixtures/census-cqa.extracted-nova-v2.journey.json'
import nova3 from '../fixtures/census-cqa.extracted-nova-v3.journey.json'
import nova4 from '../fixtures/census-cqa.extracted-nova-v4.journey.json'
import nova5 from '../fixtures/census-cqa.extracted-nova-v5.journey.json'
const nova5Fixture = () => nova5

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const J = (v: unknown) => clone(v) as unknown as Journey
const deck = (): SourceInput => readSource({ fileName: 'census.pptx', bytes: new Uint8Array(readFileSync(join(__dirname, '../fixtures/census-cqa-call-flow.pptx'))) })
const port = (...answers: unknown[]): ExtractPort & { requests: ExtractRequestBody[] } => {
  const requests: ExtractRequestBody[] = []
  return { requests, async extract(body) { requests.push(body); return answers.length > 1 ? answers.shift() : answers[0] } }
}
const edges = (j: Journey) => j.steps.flatMap((s) => s.next.map((e) => `${s.id}>${e.to}`)).sort()

describe('semantic checks that still need the model (real Nova Pro readings of the Census deck)', () => {
  it('finds shapes that no step or unmapped entry accounts for, but not the legend or the scenarios slide', () => {
    const missing = semanticIssues(deck(), J(nova1)).filter((i) => i.path === '$.steps').map((i) => i.message).join('\n')
    expect(missing).toContain('Set es_US')
    expect(missing).toContain('enumeration')
    expect(missing).not.toContain('Legend')
    expect(missing).not.toContain('Proposed Scenarios')
  })

  it('flags a decision diamond that was given a spoken kind, and only that one', () => {
    const j = J(nova3)
    const issues = semanticIssues(deck(), j).filter((x) => /decision diamond/.test(x.message))
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe(`$.steps[${j.steps.findIndex((s) => s.id === '56')}]`)
  })

  it('finds nothing wrong with the hand-made journey, and skips sources without shapes', () => {
    expect(semanticIssues(deck(), J(handMade))).toEqual([])
    expect(semanticIssues({ kind: 'text', fileName: 'a.txt', text: 'x' }, J(handMade))).toEqual([])
  })
})

describe('reconcile: the file settles the graph', () => {
  it('removes the start marker, strips the diagram titles from the wording and records both', () => {
    const r = reconcile(deck(), J(nova1))
    expect(r.journey.steps.some((s) => s.label === 'Incoming Call')).toBe(false)
    const greeting = r.journey.steps.find((s) => s.id === '25')
    expect(greeting && 'text' in greeting && greeting.text).toBe('Thank you for calling the 2030 Census Questionnaire Assistance Center.')
    const auth = r.journey.steps.find((s) => s.id === '69')
    expect(auth && 'retry' in auth && (auth.retry.reprompt ?? '').startsWith('I’m sorry')).toBe(true)
    expect(r.notes.join('\n')).toMatch(/start|Incoming Call/)
    expect(r.notes.join('\n')).toMatch(/titles from the spoken wording.*"Main Greeting:"/)
  })

  it('makes every edge match an arrow in the file: removes the invented one, adds the two missed ones', () => {
    const r = reconcile(deck(), J(nova2))
    const e = edges(r.journey)
    expect(e).not.toContain('48>119') // invented
    expect(e).toContain('48>49') // missed (unglued end)
    expect(e).toContain('202>81') // missed (unglued end)
    expect(r.notes.join('\n')).toMatch(/Removed 1 edge/)
    expect(r.notes.join('\n')).toMatch(/Added 2 edge.*not glued/)
  })

  it('gives the third and fourth readings the same graph as the file, whatever labels or edges the model produced', () => {
    const e3 = edges(reconcile(deck(), J(nova3)).journey)
    const e4 = edges(reconcile(deck(), J(nova4)).journey)
    for (const e of [e3, e4]) {
      expect(e).toContain('48>49')
      expect(e).toContain('202>81')
      expect(e).toContain('172>136') // the arrows the fourth reading left out
      expect(e).toContain('119>136')
    }
  })

  it('takes edge labels from the file, never from the model (the fourth reading used step names as labels)', () => {
    const r = reconcile(deck(), J(nova4))
    for (const s of r.journey.steps) for (const e of s.next) expect(['Y', 'N', 'fallback: 3x', undefined]).toContain(e.label)
  })

  it('leaves the hand-made journey and shapeless sources alone', () => {
    expect(reconcile(deck(), J(handMade)).notes).toEqual([])
    expect(reconcile({ kind: 'text', fileName: 'a.txt', text: 'x' }, J(nova1)).notes).toEqual([])
  })

  it('does not strip a legitimate "Note:" disclosure when the diagram does not use titles', () => {
    const j = J(handMade)
    const g = j.steps.find((s) => s.kind === 'greeting')
    if (g && g.kind === 'greeting') g.text = 'Note: this call may be recorded.'
    const out = reconcile(deck(), j).journey.steps.find((s) => s.kind === 'greeting')
    expect(out && 'text' in out && out.text).toBe('Note: this call may be recorded.')
  })
})

describe('the pipeline', () => {
  it('applies the file\'s corrections to every reading and asks the model only about what needs judgement', async () => {
    const p = port(J(nova1), J(nova2))
    const r = await extractJourney(p, deck(), { maxAttempts: 2 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(p.requests[1].feedback?.every((f) => /decision diamond|not covered/.test(f.message))).toBe(true)
    expect(p.requests[1].previous).toBeTruthy()
    expect(r.journey.assumptions.some((a) => a.statement.startsWith('Left out'))).toBe(true) // the marker step is gone, and the journey says so
  })

  it('never prefers a reading that lost step kinds (the fourth reading lost authentication) just because it has fewer findings', async () => {
    const richer = J(nova2)
    const poorer = J(nova4) // has no authentication step
    const p = port(richer, poorer, poorer)
    const r = await extractJourney(p, deck(), { maxAttempts: 3 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.journey.steps.some((s) => s.kind === 'authentication')).toBe(true)
  })

  it('on the last attempt keeps the best reading and records the findings as review entries', async () => {
    const r = await extractJourney(port(J(nova1)), deck(), { maxAttempts: 1 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.journey.unmapped.some((u) => u.source === 'reader check')).toBe(true)
  })

  it('returns the earlier valid reading when a repair breaks the structure, and still fails when no reading was ever valid', async () => {
    const broken = { ...J(nova1), steps: [{ id: 'x', kind: 'greeting' }] }
    let n = 0
    const p: ExtractPort = { async extract() { n++; return n === 1 ? J(nova1) : broken } }
    const r = await extractJourney(p, deck())
    expect(r.ok && r.journey.steps.length).toBeGreaterThan(10)
    expect((await extractJourney({ async extract() { return { title: 'x' } } }, deck(), { maxAttempts: 2 })).ok).toBe(false)
  })
})

describe('terminal steps, empty labels and start markers kept as unknown', () => {
  const only = (answer: unknown) => extractJourney({ async extract() { return answer } }, deck(), { maxAttempts: 1 })

  it('treats a missing next on an end or escalation step as empty, recorded', async () => {
    for (const kind of ['end', 'escalation']) {
      const j = J(handMade) as unknown as { steps: Array<Record<string, unknown>> }
      const step = j.steps.find((s) => s.kind === kind) as Record<string, unknown>
      delete step.next
      const r = await only(j)
      expect(r.ok, kind).toBe(true)
      if (r.ok) expect(r.journey.assumptions.some((a) => a.statement.includes(`(${kind}) had no "next" list`))).toBe(true)
    }
  })

  it('does not hide a missing next on any other kind', async () => {
    const j = J(handMade) as unknown as { steps: Array<Record<string, unknown>> }
    delete (j.steps.find((s) => s.kind === 'confirmation') as Record<string, unknown>).next
    expect((await only(j)).ok).toBe(false)
  })

  it('drops empty edge labels and a start marker kept as an unclassified step', async () => {
    const r = await only(J(nova3))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.journey.steps.some((s) => s.label === 'Incoming Call')).toBe(false)
    expect(r.journey.steps.every((s) => s.next.every((e) => e.label !== ''))).toBe(true)
  })
})

describe('start markers count as covered', () => {
  it('does not report "Incoming Call" as an unaccounted shape when reconcile removed it', () => {
    const r = reconcile(deck(), J(nova5Fixture()))
    const missing = semanticIssues(deck(), r.journey).filter((i) => i.path === '$.steps').map((i) => i.message).join('\n')
    expect(missing).not.toContain('Incoming Call')
  })
})
