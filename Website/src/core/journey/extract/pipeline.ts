import type { Journey } from '../model'
import { START_MARKER, semanticIssues } from './semantic'
import { validateJourney } from '../validate'
import type { ValidationIssue } from '../validate'
import { sourceText } from '../source'
import type { SourceInput } from '../source'
import { checkWording, recordWordingChecks } from './verbatim'
import type { WordingCheck } from './verbatim'

/** What the browser sends to the extractor backend. */
export interface ExtractRequestBody {
  fileName: string
  kind: SourceInput['kind']
  text?: string
  attachment?: { mimeType: string; base64: string }
  notes?: string
  feedback?: Array<{ path: string; message: string }>
  /** The model's previous (invalid) answer, so a repair edits it instead of starting over. */
  previous?: unknown
}

/** The port to whatever answers an extraction request (the backend in production, a fake in tests). */
export interface ExtractPort {
  extract(body: ExtractRequestBody): Promise<unknown>
  /** The backend's version from its last answer, when it reports one. */
  version?: string
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

export function toRequestBody(source: SourceInput, notes?: string, feedback?: ValidationIssue[], previous?: unknown): ExtractRequestBody {
  const body: ExtractRequestBody = { fileName: source.fileName, kind: source.kind }
  if (source.kind === 'pdf') body.attachment = { mimeType: 'application/pdf', base64: toBase64(source.bytes) }
  else if (source.kind === 'image') body.attachment = { mimeType: source.mimeType, base64: toBase64(source.bytes) }
  else body.text = source.text
  if (notes && notes.trim() !== '') body.notes = notes.trim()
  if (feedback && feedback.length > 0) {
    body.feedback = feedback.slice(0, 40).map((f) => ({ path: f.path, message: f.message }))
    if (previous !== undefined && previous !== null) body.previous = previous
  }
  return body
}

export type ExtractOutcome =
  | { ok: true; journey: Journey; attempts: number; checks: WordingCheck[] | null }
  | { ok: false; issues: ValidationIssue[]; attempts: number }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The one repair made without asking the model: an `end` or `escalation` step is terminal by definition, so a missing (or null) `next` list means
 * the same as an empty one. Models leave it off however often they are told. It is recorded in `assumptions`, never silent. A missing `next` on
 * any other kind is NOT changed: it could be a dropped edge, so it stays a validation error.
 */
export function normalizeTerminalNext(raw: unknown): unknown {
  if (!isObj(raw) || !Array.isArray(raw.steps)) return raw
  const notes: string[] = []
  let changed = false
  const steps = raw.steps.map((step) => {
    if (!isObj(step)) return step
    let out = step
    if ((step.kind === 'end' || step.kind === 'escalation') && !Array.isArray(step.next)) {
      notes.push(`Step "${String(step.id)}" (${String(step.kind)}) had no "next" list; it ends the journey, so it was treated as having no outgoing steps.`)
      out = { ...out, next: [] }
      changed = true
    }
    // An empty edge label means "no label": drop it (no information is lost).
    if (Array.isArray(out.next) && out.next.some((e) => isObj(e) && e.label === '')) {
      out = { ...out, next: out.next.map((e) => (isObj(e) && e.label === '' ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'label')) : e)) }
      changed = true
    }
    return out
  })
  // A start marker ("Incoming Call") that the model kept as an unclassified step has no wording and nothing leads into it: drop it.
  const targets = new Set(steps.flatMap((st) => (isObj(st) && Array.isArray(st.next) ? st.next.map((e) => (isObj(e) ? String(e.to) : '')) : [])))
  const kept = steps.filter((st) => {
    if (isObj(st) && st.kind === 'unknown' && START_MARKER.test(String(st.raw ?? st.label ?? '').replace(/\s+/g, ' ').trim()) && !targets.has(String(st.id))) {
      notes.push(`The start marker "${String(st.raw ?? st.label)}" is not a step: it only shows where the call begins, so it was left out.`)
      changed = true
      return false
    }
    return true
  })
  if (!changed) return raw
  const assumptions = Array.isArray(raw.assumptions) ? raw.assumptions : []
  return { ...raw, steps: kept, assumptions: [...assumptions, ...notes.map((statement) => ({ statement }))] }
}

/**
 * Source in, validated journey out. The model's answer is never trusted: it is validated, and if it fails the
 * issues are sent back for ONE corrected answer per attempt (we never patch it ourselves, except the information-free cases in normalizeTerminalNext above). Then the wording is
 * checked against the source text and the result recorded in the journey.
 */
export async function extractJourney(port: ExtractPort, source: SourceInput, opts: { notes?: string; maxAttempts?: number } = {}): Promise<ExtractOutcome> {
  const max = Math.max(1, opts.maxAttempts ?? 4)
  let feedback: ValidationIssue[] | undefined
  let previous: unknown
  // The best valid reading so far (fewest findings). A repair that breaks the structure must not lose it.
  let best: { journey: Journey; semantic: ValidationIssue[] } | undefined
  const accept = (journey: Journey, semantic: ValidationIssue[], attempts: number): ExtractOutcome => {
    const text = sourceText(source)
    const checks = text === undefined ? null : checkWording(journey, text)
    const base: Journey = semantic.length > 0
      ? { ...journey, unmapped: [...journey.unmapped, ...semantic.map((i) => ({ description: `Reader check: ${i.message}`, source: 'reader check' }))] }
      : journey
    return { ok: true, journey: recordWordingChecks({ ...base, origin: base.origin ?? source.fileName }, checks), attempts, checks }
  }
  for (let attempt = 1; attempt <= max; attempt++) {
    let raw: unknown
    try {
      raw = await port.extract(toRequestBody(source, opts.notes, feedback, previous))
    } catch (err) {
      if (best) return accept(best.journey, best.semantic, attempt)
      return { ok: false, issues: [{ path: '$', message: err instanceof Error ? err.message : 'The extractor failed.' }], attempts: attempt }
    }
    const result = validateJourney(normalizeTerminalNext(raw))
    if (result.ok) {
      // Valid but wrong in ways a person would notice (start marker as wording, titles in prompts, dropped shapes): ask for a repair.
      // When attempts run out, keep the journey and record what is left as review entries, so nothing is hidden and the read is not lost.
      const semantic = semanticIssues(source, result.journey)
      if (semantic.length === 0) return accept(result.journey, [], attempt)
      if (!best || semantic.length <= best.semantic.length) best = { journey: result.journey, semantic }
      if (attempt === max) return accept(best.journey, best.semantic, attempt)
      feedback = semantic
      previous = raw
      continue
    }
    feedback = result.issues
    previous = raw
    if (attempt === max) return best ? accept(best.journey, best.semantic, attempt) : { ok: false, issues: result.issues, attempts: attempt }
  }
  return { ok: false, issues: [{ path: '$', message: 'No attempt was made.' }], attempts: 0 }
}
