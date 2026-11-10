import type { Journey } from '../model'
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

/**
 * Source in, validated journey out. The model's answer is never trusted: it is validated, and if it fails the
 * issues are sent back for ONE corrected answer per attempt (we never patch it ourselves). Then the wording is
 * checked against the source text and the result recorded in the journey.
 */
export async function extractJourney(port: ExtractPort, source: SourceInput, opts: { notes?: string; maxAttempts?: number } = {}): Promise<ExtractOutcome> {
  const max = Math.max(1, opts.maxAttempts ?? 3)
  let feedback: ValidationIssue[] | undefined
  let previous: unknown
  for (let attempt = 1; attempt <= max; attempt++) {
    let raw: unknown
    try {
      raw = await port.extract(toRequestBody(source, opts.notes, feedback, previous))
    } catch (err) {
      return { ok: false, issues: [{ path: '$', message: err instanceof Error ? err.message : 'The extractor failed.' }], attempts: attempt }
    }
    const result = validateJourney(raw)
    if (result.ok) {
      const text = sourceText(source)
      const checks = text === undefined ? null : checkWording(result.journey, text)
      return { ok: true, journey: recordWordingChecks({ ...result.journey, origin: result.journey.origin ?? source.fileName }, checks), attempts: attempt, checks }
    }
    feedback = result.issues
    previous = raw
    if (attempt === max) return { ok: false, issues: result.issues, attempts: attempt }
  }
  return { ok: false, issues: [{ path: '$', message: 'No attempt was made.' }], attempts: 0 }
}
