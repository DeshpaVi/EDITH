import type { Journey } from './model'
import { validateJourney, type ValidationIssue } from './validate'

/**
 * What the app is given. A journey can arrive in any form; the extractor decides how to read it.
 * `bytes` is the raw upload (image, slide deck, text, export); `text` is an optional pre-extracted form.
 */
export interface JourneyInput {
  fileName: string
  mimeType: string
  bytes?: Uint8Array
  text?: string
  /** Optional consultant notes that resolve ambiguity (for example "any one identifier is enough"). */
  notes?: string
}

/**
 * The port to whatever understands a journey. In production it is an LLM behind a backend
 * (CLAUDE.md constraint 6: no model keys in the browser). It must return untrusted JSON that
 * matches the Journey model; it is validated here, never trusted.
 */
export interface JourneyExtractor {
  extract(input: JourneyInput): Promise<unknown>
}

export type IngestResult =
  | { ok: true; journey: Journey; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] }

/** Runs an extractor and validates its output. A malformed answer is reported, never repaired by guessing. */
export async function ingestJourney(extractor: JourneyExtractor, input: JourneyInput): Promise<IngestResult> {
  let raw: unknown
  try {
    raw = await extractor.extract(input)
  } catch (err) {
    return { ok: false, issues: [{ path: '$', message: `extractor failed: ${err instanceof Error ? err.message : String(err)}` }] }
  }
  const result = validateJourney(raw)
  return result.ok ? { ok: true, journey: result.journey, warnings: [] } : { ok: false, issues: result.issues }
}

/** Returns a fixed journey. Used for fixtures, tests and demos; also the contract the real extractor must meet. */
export class StaticExtractor implements JourneyExtractor {
  constructor(private readonly journey: unknown) {}
  async extract(): Promise<unknown> {
    return this.journey
  }
}

/**
 * The instruction an LLM extractor must follow. Kept here, next to the model it fills, so the
 * rules and the schema cannot drift apart.
 */
export const EXTRACTION_RULES = [
  'Output a single JSON object matching the Journey model. No prose.',
  'Copy every prompt, greeting, announcement and closing VERBATIM from the source, typos included. Never paraphrase or correct wording.',
  'Mark regulated wording (recording disclosures, consent, legal text) with compliance: true.',
  'Give each step a unique id and a "next" list of edges; label branches with the source labels (for example "Y", "N", "fallback 3x").',
  'Record where each step came from in "source".',
  'If a step or branch cannot be classified, emit an "unknown" step or add it to "unmapped". Never guess and never drop it.',
  'Anything you inferred rather than read goes into "assumptions".',
  'Do not invent backends, queues or data: use type "unknown" when the source does not say.',
] as const
