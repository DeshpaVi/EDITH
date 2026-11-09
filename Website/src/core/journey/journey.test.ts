import { describe, it, expect } from 'vitest'
import { validateJourney, ingestJourney, StaticExtractor } from './index'
import type { AuthenticationStep, Journey } from './index'
import census from './fixtures/census-cqa.journey.json'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe('journey validation', () => {
  it('accepts the Census CQA journey', () => {
    const r = validateJourney(census)
    expect(r.ok).toBe(true)
  })

  it('keeps client wording verbatim', () => {
    const j = census as unknown as Journey
    const greeting = j.steps.find((s) => s.id === 'greeting')
    const auth = j.steps.find((s) => s.id === 'auth') as AuthenticationStep
    expect(greeting && 'text' in greeting && greeting.text).toBe('Thank you for calling the 2030 Census Questionnaire Assistance Center.')
    expect(auth.text).toBe(
      'To proceed, we need to verify your identity, can you please provide your Census ID and either your home zip code or the last four digits of your SSN?',
    )
  })

  it('reports every problem with a path, not just the first', () => {
    const bad = clone(census) as Record<string, unknown>
    delete bad.title
    ;(bad.steps as Array<Record<string, unknown>>)[0].next = [{ to: 'nowhere' }]
    ;(bad.steps as Array<Record<string, unknown>>)[1].kind = 'teleport'
    const r = validateJourney(bad)
    expect(r.ok).toBe(false)
    const paths = r.issues.map((i) => i.path)
    expect(paths).toContain('$.title')
    expect(paths).toContain('$.steps[0].next[0].to')
    expect(paths).toContain('$.steps[1].kind')
  })

  it('rejects duplicate step ids', () => {
    const bad = clone(census) as { steps: Array<{ id: string }> }
    bad.steps[1].id = bad.steps[0].id
    const r = validateJourney(bad)
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.message.includes('duplicate step id'))).toBe(true)
  })

  it('requires spoken steps to carry text', () => {
    const bad = clone(census) as { steps: Array<{ id: string; text?: string }> }
    bad.steps.find((s) => s.id === 'closing')!.text = ''
    expect(validateJourney(bad).ok).toBe(false)
  })

  it('rejects non-objects', () => {
    expect(validateJourney(null).ok).toBe(false)
    expect(validateJourney('journey').ok).toBe(false)
  })
})

describe('ingestJourney', () => {
  const input = { fileName: 'census.pptx', mimeType: 'application/octet-stream' }

  it('returns the journey for a valid extraction', async () => {
    const r = await ingestJourney(new StaticExtractor(census), input)
    expect(r.ok).toBe(true)
  })

  it('reports an invalid extraction instead of repairing it', async () => {
    const r = await ingestJourney(new StaticExtractor({ title: 'x' }), input)
    expect(r.ok).toBe(false)
  })

  it('reports an extractor that throws', async () => {
    const r = await ingestJourney({ extract: async () => { throw new Error('model unavailable') } }, input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0].message).toContain('model unavailable')
  })
})
