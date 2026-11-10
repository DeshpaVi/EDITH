import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACCEPTED_FILES, readAndExtract, validateExtractionForm } from './extraction'
import census from '../core/journey/fixtures/census-cqa.journey.json'

const deck = () => ({ fileName: 'flow.pptx', bytes: new Uint8Array(readFileSync(join(__dirname, '../core/journey/fixtures/census-cqa-call-flow.pptx'))) })
const form = { url: 'https://extractor.example.test/', token: 'tok', notes: '' }
const answering = (status: number, body: unknown) => (async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response) as unknown as typeof fetch

describe('extraction form', () => {
  it('accepts https and a local http server only', () => {
    expect(validateExtractionForm(form)).toEqual([])
    expect(validateExtractionForm({ ...form, url: 'http://localhost:5173/x' })).toEqual([])
    expect(validateExtractionForm({ ...form, url: 'http://extractor.example.test' })).toHaveLength(1)
    expect(validateExtractionForm({ ...form, url: '' })).toHaveLength(1)
  })
  it('needs a token', () => {
    expect(validateExtractionForm({ ...form, token: ' ' })).toEqual(['Enter the extractor access token.'])
  })
  it('accepts the file types the reader supports', () => {
    for (const ext of ['.pptx', '.docx', '.pdf', '.png', '.txt', '.json']) expect(ACCEPTED_FILES).toContain(ext)
  })
})

describe('readAndExtract', () => {
  it('reads a deck through the extractor and summarises what happened', async () => {
    const r = await readAndExtract(deck(), form, answering(200, { journey: census }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.journey.steps).toHaveLength(11)
    expect(r.summary[0]).toContain('Read 11 steps')
    expect(r.summary.join(' ')).toContain('shapes and arrows')
    expect(r.summary.join(' ')).toMatch(/Wording check: \d+ exact, \d+ differ only in typographic characters, 2 not found/)
  })

  it('loads a journey JSON directly, without the extractor or a token', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(census))
    const r = await readAndExtract({ fileName: 'j.json', bytes }, { url: '', token: '', notes: '' })
    expect(r.ok && r.summary[0]).toContain('no extraction was needed')
  })

  it('asks for the URL and token before extracting a deck', async () => {
    const r = await readAndExtract(deck(), { url: '', token: '', notes: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toHaveLength(2)
  })

  it('explains an unreadable file', async () => {
    const r = await readAndExtract({ fileName: 'a.vsdx', bytes: new Uint8Array([1]) }, form)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('Visio')
  })

  it('shows the backend error', async () => {
    const r = await readAndExtract(deck(), form, answering(401, { error: 'Unauthorized.' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('Unauthorized.')
  })

  it('lists the problems when the model never produces a valid journey', async () => {
    const r = await readAndExtract(deck(), form, answering(200, { journey: { title: 'x' } }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]).toContain('4 attempts')
      expect(r.errors.some((e) => e.includes('$.steps'))).toBe(true)
    }
  })

  it('treats a JSON file that is not a journey as source text for the extractor', async () => {
    const bytes = new TextEncoder().encode('{"hello": "world"}')
    const r = await readAndExtract({ fileName: 'notes.json', bytes }, form, answering(200, { journey: census }))
    expect(r.ok).toBe(true)
  })
})
