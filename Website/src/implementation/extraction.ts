import { createHttpPort, extractJourney, readSource, SourceError, SUPPORTED_EXTENSIONS } from '../core/journey'
import type { Journey } from '../core/journey'
import { parseJourneyText } from './controller'

/**
 * Reads an uploaded file into a journey: a journey JSON loads directly; a deck, document, PDF, image or text
 * goes through the extractor backend. All the rules live here so the screen only renders the outcome.
 */

export interface ExtractionForm {
  url: string
  /** Bearer token for the backend. Typed by the consultant, kept in memory only. */
  token: string
  notes: string
}

export type ExtractionResult =
  | { ok: true; journey: Journey; summary: string[] }
  | { ok: false; errors: string[] }

export const ACCEPTED_FILES = SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(',')

/** https anywhere, or plain http only for a local development server. */
export function validateExtractionForm(form: ExtractionForm): string[] {
  const errors: string[] = []
  const url = form.url.trim()
  if (!/^https:\/\/\S+$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/.test(url)) {
    errors.push('Extractor URL must start with https:// (or http://localhost for local development).')
  }
  if (form.token.trim() === '') errors.push('Enter the extractor access token.')
  return errors
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export async function readAndExtract(file: { fileName: string; bytes: Uint8Array }, form: ExtractionForm, fetchImpl?: typeof fetch): Promise<ExtractionResult> {
  // A journey that is already structured needs no model.
  if (file.fileName.toLowerCase().endsWith('.json')) {
    const direct = parseJourneyText(new TextDecoder().decode(file.bytes))
    if (direct.ok) return { ok: true, journey: direct.journey, summary: ['Loaded as journey JSON; no extraction was needed.'] }
  }

  const formErrors = validateExtractionForm(form)
  if (formErrors.length > 0) return { ok: false, errors: formErrors }

  let source
  try {
    source = readSource(file)
  } catch (err) {
    return { ok: false, errors: [err instanceof SourceError ? err.message : 'Could not read the file.'] }
  }

  const port = createHttpPort({ url: form.url.trim(), token: form.token.trim(), fetchImpl })
  const outcome = await extractJourney(port, source, { notes: form.notes })
  if (!outcome.ok) {
    return {
      ok: false,
      errors: [
        outcome.attempts > 1 ? `The extractor could not produce a valid journey after ${plural(outcome.attempts, 'attempt')}:` : 'The extractor could not produce a valid journey:',
        ...outcome.issues.slice(0, 8).map((i) => (i.path === '$' ? i.message : `${i.path}: ${i.message}`)),
      ],
    }
  }

  const j = outcome.journey
  const summary = [`Read ${plural(j.steps.length, 'step')}, ${plural(j.scenarios.length, 'scenario')} and ${plural(j.languages.length, 'language')}${outcome.attempts > 1 ? ` (the model corrected its answer ${plural(outcome.attempts - 1, 'time')})` : ''}.`]
  if (source.kind === 'deck') summary.push('The deck was read as shapes and arrows, so the connections come from the file, not from a guess.')
  if (source.kind === 'diagram') summary.push('The drawing was read as shapes and glued connectors, so the connections come from the file, not from a guess.')
  if (outcome.checks === null) {
    summary.push('Wording came from an image or PDF and could not be checked against source text: compare it by eye.')
  } else {
    const missing = outcome.checks.filter((c) => c.result === 'missing').length
    const typographic = outcome.checks.filter((c) => c.result === 'typographic').length
    summary.push(`Wording check: ${outcome.checks.length - missing - typographic} exact, ${typographic} differ only in typographic characters, ${missing} not found in the source.`)
  }
  return { ok: true, journey: j, summary }
}
