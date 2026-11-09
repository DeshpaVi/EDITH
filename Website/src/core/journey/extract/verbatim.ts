import type { Journey, JourneyStep } from '../model'

/**
 * Wording check (CLAUDE.md constraint 4): every spoken prompt the model returned is compared with the source
 * text. A model can drift while "copying"; this catches it deterministically, without another model call.
 *
 * exact:       found in the source (whitespace differences ignored).
 * typographic: found only after treating curly and straight quotes, dashes, ellipses and non-breaking spaces as
 *              the same. The words match; the characters do not, so it is reported.
 * missing:     not found. Reported as something to compare by eye.
 */
export type WordingResult = 'exact' | 'typographic' | 'missing'

export interface WordingCheck {
  stepId: string
  stepLabel: string
  field: string
  text: string
  result: WordingResult
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

export function normalizeTypography(s: string): string {
  return s
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
}

/** Every spoken string in the journey with the step and field it came from. */
export function spokenWording(journey: Journey): Array<{ step: JourneyStep; field: string; text: string }> {
  const out: Array<{ step: JourneyStep; field: string; text: string }> = []
  const add = (step: JourneyStep, field: string, text: string | undefined) => {
    if (text && text.trim() !== '') out.push({ step, field, text })
  }
  for (const step of journey.steps) {
    switch (step.kind) {
      case 'greeting':
      case 'announcement':
      case 'closing':
      case 'confirmation':
        add(step, 'text', step.text)
        break
      case 'intent_capture':
        add(step, 'text', step.text)
        add(step, 'retry.reprompt', step.retry.reprompt)
        break
      case 'authentication':
        add(step, 'text', step.text)
        add(step, 'failurePrompt', step.failurePrompt)
        add(step, 'retry.reprompt', step.retry.reprompt)
        break
      default:
        break
    }
  }
  return out
}

export function checkWording(journey: Journey, sourceText: string): WordingCheck[] {
  const exact = squash(sourceText)
  const loose = normalizeTypography(exact)
  return spokenWording(journey).map(({ step, field, text }) => {
    const t = squash(text)
    const result: WordingResult = exact.includes(t) ? 'exact' : loose.includes(normalizeTypography(t)) ? 'typographic' : 'missing'
    return { stepId: step.id, stepLabel: step.label, field, text, result }
  })
}

const quote = (s: string): string => `"${s.length > 140 ? `${s.slice(0, 139)}…` : s}"`

/**
 * Returns a copy of the journey with what the check found recorded where the checklist will show it:
 * missing wording becomes an unmapped item (a warning); typographic differences and unverifiable wording
 * become assumptions (information). Nothing is rewritten.
 */
export function recordWordingChecks(journey: Journey, checks: WordingCheck[] | null): Journey {
  const copy: Journey = { ...journey, assumptions: [...journey.assumptions], unmapped: [...journey.unmapped] }
  if (checks === null) {
    copy.assumptions.push({ statement: 'Wording was read from an image or PDF, so it could not be checked against source text. Compare every prompt with the source by eye.', source: 'extractor' })
    return copy
  }
  for (const c of checks) {
    if (c.result === 'missing') {
      copy.unmapped.push({ description: `The wording of "${c.stepLabel}" (${c.field}) was not found in the source: ${quote(c.text)}. Compare it with the source before using it.`, source: 'wording check' })
    } else if (c.result === 'typographic') {
      copy.assumptions.push({ statement: `The wording of "${c.stepLabel}" (${c.field}) matches the source except for typographic characters (quotes, dashes): ${quote(c.text)}.`, source: 'wording check' })
    }
  }
  return copy
}
