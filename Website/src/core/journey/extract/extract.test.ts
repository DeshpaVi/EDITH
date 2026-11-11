import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JOURNEY_JSON_SCHEMA, EXTRACTION_RULES } from '../../../../extractor-api/contract.mjs'
import { STEP_KINDS } from '../validate'
import { readSource } from '../source'
import type { SourceInput } from '../source'
import { checkWording, createHttpPort, extractJourney, normalizeTypography, recordWordingChecks, spokenWording, toBase64, toRequestBody } from './index'
import type { ExtractPort, ExtractRequestBody } from './index'
import type { Journey } from '../model'
import census from '../fixtures/census-cqa.journey.json'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const journey = () => clone(census) as unknown as Journey
const deck = (): SourceInput => readSource({ fileName: 'census.pptx', bytes: new Uint8Array(readFileSync(join(__dirname, '../fixtures/census-cqa-call-flow.pptx'))) })

/** A port that answers from a queue and records every request. */
function fakePort(...answers: unknown[]): ExtractPort & { requests: ExtractRequestBody[] } {
  const requests: ExtractRequestBody[] = []
  return {
    requests,
    async extract(body) {
      requests.push(body)
      const next = answers.length > 1 ? answers.shift() : answers[0]
      if (next instanceof Error) throw next
      return next
    },
  }
}

describe('the shared contract matches the validator', () => {
  const schema = JOURNEY_JSON_SCHEMA as any
  it('offers exactly the step kinds the validator accepts', () => {
    expect(schema.properties.steps.items.properties.kind.enum).toEqual([...STEP_KINDS])
  })
  it('allows every field the Census journey uses, so the schema never forbids valid output', () => {
    const allowed = new Set(Object.keys(schema.properties.steps.items.properties))
    for (const step of journey().steps) for (const key of Object.keys(step)) expect(allowed.has(key), key).toBe(true)
    for (const key of Object.keys(census)) expect(Object.keys(schema.properties).includes(key), key).toBe(true)
  })
  it('requires what the validator requires at the top level', () => {
    expect(schema.required).toEqual(expect.arrayContaining(['title', 'channels', 'languages', 'steps', 'scenarios', 'assumptions', 'unmapped']))
  })
  it('states the verbatim rule', () => {
    expect(EXTRACTION_RULES.some((r: string) => r.includes('VERBATIM'))).toBe(true)
  })
})

describe('wording check', () => {
  it('tells exact, typographic and missing apart', () => {
    const source = 'Intro. I’m sorry, I didn’t quite get that.  Thank you for calling, goodbye.'
    const j = journey()
    const checks = checkWording(j, source)
    const by = (id: string, field: string) => checks.find((c) => c.stepId === id && c.field === field)?.result
    expect(by('closing', 'text')).toBe('exact')
    expect(by('intent', 'retry.reprompt')).toBe('typographic')
    expect(by('greeting', 'text')).toBe('missing')
  })

  it('normalises quotes, dashes and non-breaking spaces', () => {
    expect(normalizeTypography('It’s “ok” – yes no…')).toBe('It\'s "ok" - yes no...')
  })

  it('covers every spoken field of the journey', () => {
    const fields = spokenWording(journey()).map((w) => `${w.step.id}:${w.field}`)
    expect(fields).toEqual(expect.arrayContaining(['greeting:text', 'intent:text', 'intent:retry.reprompt', 'auth:text', 'auth:failurePrompt', 'auth:retry.reprompt', 'anything_else:text', 'closing:text']))
  })

  it('records findings without rewriting any wording', () => {
    const j = journey()
    const out = recordWordingChecks(j, checkWording(j, 'nothing matches'))
    expect(out.unmapped.length).toBeGreaterThan(j.unmapped.length)
    expect(out.steps).toEqual(j.steps)
    expect(j.unmapped).toHaveLength(1) // the input journey is not mutated
  })

  it('says so when wording cannot be checked (image or PDF)', () => {
    expect((() => { const a = recordWordingChecks(journey(), null).assumptions; return a[a.length - 1].statement })()).toContain('could not be checked')
  })
})

describe('request body', () => {
  it('sends a deck as text, an image as base64, and trims notes', () => {
    const d = toRequestBody(deck(), '  any one id works  ')
    expect(d.kind).toBe('deck')
    expect(d.text).toContain('=== SLIDE 1 ===')
    expect(d.notes).toBe('any one id works')
    const img = toRequestBody({ kind: 'image', fileName: 'a.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) })
    expect(img.attachment).toEqual({ mimeType: 'image/png', base64: 'AQID' })
    expect(img.text).toBeUndefined()
    expect(toRequestBody({ kind: 'pdf', fileName: 'a.pdf', bytes: new Uint8Array([1]) }).attachment?.mimeType).toBe('application/pdf')
  })

  it('base64 handles inputs larger than one chunk', () => {
    const big = new Uint8Array(70_000).fill(65)
    expect(toBase64(big).length).toBe(Math.ceil(70_000 / 3) * 4)
  })

  it('caps feedback at 40 issues', () => {
    const issues = Array.from({ length: 60 }, (_, i) => ({ path: `$.x${i}`, message: 'bad' }))
    expect(toRequestBody(deck(), undefined, issues).feedback).toHaveLength(40)
  })
})

describe('extractJourney', () => {
  it('returns a validated journey and checks its wording against the deck', async () => {
    const port = fakePort(census)
    const r = await extractJourney(port, deck())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.attempts).toBe(1)
    expect(r.journey.origin).toBe('Census_CQA_Demo_Call_Flow_.pptx')
    const missing = (r.checks ?? []).filter((c) => c.result === 'missing').map((c) => `${c.stepId}:${c.field}`)
    expect(missing.sort()).toEqual(['auth:failurePrompt', 'auth:retry.reprompt']) // the owner-approved corrected wording
    expect((r.checks ?? []).filter((c) => c.result === 'typographic').length).toBeGreaterThan(0)
    expect(r.journey.unmapped.some((u) => u.source === 'wording check')).toBe(true)
  })

  it('asks the model to correct an invalid answer, passing the problems back, then succeeds', async () => {
    const bad = { ...clone(census), title: undefined }
    const port = fakePort(bad, census)
    const r = await extractJourney(port, deck())
    expect(r.ok && r.attempts).toBe(2)
    expect(port.requests[0].feedback).toBeUndefined()
    expect(port.requests[1].feedback?.map((f) => f.path)).toContain('$.title')
    expect(port.requests[0].previous).toBeUndefined()
    expect(port.requests[1].previous).toEqual(bad) // the repair edits the previous answer instead of starting over
  })

  it('gives up after the attempt limit and reports the last problems', async () => {
    const port = fakePort({ title: 'x' })
    const r = await extractJourney(port, deck(), { maxAttempts: 2 })
    expect(r.ok).toBe(false)
    expect(r.attempts).toBe(2)
    expect(port.requests).toHaveLength(2)
  })

  it('turns an extractor failure into a message, without retrying', async () => {
    const port = fakePort(new Error('The extractor took too long.'))
    const r = await extractJourney(port, deck())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0].message).toContain('took too long')
    expect(port.requests).toHaveLength(1)
  })

  it('marks wording from an image as unverifiable', async () => {
    const r = await extractJourney(fakePort(census), { kind: 'image', fileName: 'd.png', mimeType: 'image/png', bytes: new Uint8Array([1]) })
    expect(r.ok && r.checks).toBeNull()
    expect(r.ok && r.journey.assumptions[r.journey.assumptions.length - 1].statement).toContain('image or PDF')
  })

  it('forwards the consultant notes', async () => {
    const port = fakePort(census)
    await extractJourney(port, deck(), { notes: 'records are in DynamoDB' })
    expect(port.requests[0].notes).toBe('records are in DynamoDB')
  })
})

describe('http port', () => {
  const reply = (status: number, body: unknown) => (async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response) as unknown as typeof fetch
  const body: ExtractRequestBody = { fileName: 'a.txt', kind: 'text', text: 'x' }

  it('posts the body with the bearer token and returns the journey', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return { ok: true, status: 200, json: async () => ({ journey: { title: 'T' } }) } as unknown as Response
    }) as unknown as typeof fetch
    const out = await createHttpPort({ url: 'https://x.test/', token: 'tok', fetchImpl }).extract(body)
    expect(out).toEqual({ title: 'T' })
    expect(seen!.url).toBe('https://x.test/')
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer tok')
    expect(JSON.parse(seen!.init.body as string)).toEqual(body)
  })

  it('shows the backend\'s error message', async () => {
    await expect(createHttpPort({ url: 'u', token: 't', fetchImpl: reply(401, { error: 'Unauthorized.' }) }).extract(body)).rejects.toThrow('Unauthorized.')
  })

  it('falls back to the status when the error has no message', async () => {
    await expect(createHttpPort({ url: 'u', token: 't', fetchImpl: reply(500, null) }).extract(body)).rejects.toThrow('500')
  })

  it('explains a network failure and a timeout', async () => {
    const down = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    await expect(createHttpPort({ url: 'u', token: 't', fetchImpl: down }).extract(body)).rejects.toThrow('Could not reach')
    const slow = (async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) }) as unknown as typeof fetch
    await expect(createHttpPort({ url: 'u', token: 't', fetchImpl: slow }).extract(body)).rejects.toThrow('too long')
  })

  it('rejects a reply with no journey', async () => {
    await expect(createHttpPort({ url: 'u', token: 't', fetchImpl: reply(200, {}) }).extract(body)).rejects.toThrow('no journey')
  })
})

describe('reconcile on the fifth real reading', () => {
  it('drops the deck title, tidies branch labels, flags an unreachable step and empty intents', async () => {
    const reading = JSON.parse(readFileSync(join(__dirname, '../fixtures/census-cqa.extracted-nova-v5.journey.json'), 'utf8'))
    const r = await extractJourney(fakePort(reading), deck())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.journey.steps.some((s) => s.id === '264')).toBe(false)
    expect(r.journey.assumptions.some((a) => a.statement.includes('Demo Proof-of-Concept Call Flow') && a.statement.includes('title or caption'))).toBe(true)
    expect(r.journey.unmapped.some((u) => /^(Y|N)$/.test(u.description) || /^fallback/.test(u.description))).toBe(false)
    expect(r.journey.unmapped.some((u) => u.description.startsWith('Nothing leads to'))).toBe(true)
    expect(r.journey.unmapped.some((u) => u.description.includes('lists no intents'))).toBe(true)
  })
})
