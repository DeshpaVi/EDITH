import type { Journey } from '../model'
import type { ValidationIssue } from '../validate'
import type { SourceInput } from '../source'

/**
 * Checks on a journey that is structurally valid but wrong in a way a person would notice, found by comparing a real model's reading of the
 * Census deck with the hand-made journey. Deterministic, so the model is told exactly what to fix (and it never patches the answer itself).
 *
 * 1. A start marker ("Incoming Call", "Start") given as spoken wording.
 * 2. A diagram title kept inside the spoken wording ("Main Greeting: Thank you...") when the diagram uses that convention throughout.
 * 3. A shape on the slide that no step or unmapped entry accounts for (CLAUDE.md constraint 3: never silently drop an element).
 */

const SPOKEN_KINDS = ['greeting', 'announcement', 'closing', 'confirmation', 'intent_capture', 'authentication'] as const
const START_MARKER = /^(incoming call|call (starts?|begins?|arrives?)|start|begin|entry( point)?)\.?$/i
const TITLE_PREFIX = /^([A-Z][A-Za-z0-9 ]{1,30}):\s+(\S.*)$/s

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const clip = (s: string, n = 60) => (norm(s).length > n ? `${norm(s).slice(0, n)}...` : norm(s))

/** Shape numbers a source string refers to, with the slide when it names one. */
function shapeRefs(source: string): { slide?: number; ids: string[] } {
  const slide = /slide\s+(\d+)/i.exec(source)?.[1]
  const ids: string[] = []
  for (const m of source.matchAll(/shapes?\s+([\d,\s]+(?:(?:and|&)\s+[\d,\s]+)*)/gi)) ids.push(...(m[1].match(/\d+/g) ?? []))
  return { slide: slide === undefined ? undefined : Number(slide), ids }
}

export function semanticIssues(source: SourceInput, journey: Journey): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const spoken = journey.steps
    .map((step, index) => ({ step, index, text: 'text' in step && typeof step.text === 'string' ? step.text : '' }))
    .filter((s) => (SPOKEN_KINDS as readonly string[]).includes(s.step.kind) && s.text.trim() !== '')

  // 1. start markers
  for (const s of spoken) {
    if (START_MARKER.test(norm(s.text))) {
      issues.push({
        path: `$.steps[${s.index}]`,
        message: `"${norm(s.text)}" only marks where the call begins; it is not wording spoken to the caller. Remove this step and start the journey at the first real step.`,
      })
    }
  }

  // 2. diagram titles inside spoken wording, when the whole diagram follows that convention
  const titled = spoken.filter((s) => TITLE_PREFIX.test(s.text))
  if (spoken.length >= 3 && titled.length >= 3 && titled.length / spoken.length >= 0.75) {
    for (const s of titled) {
      const title = TITLE_PREFIX.exec(s.text)?.[1] ?? ''
      issues.push({
        path: `$.steps[${s.index}].text`,
        message: `starts with "${title}:", which is the diagram's title for the shape (most prompts in this diagram follow that convention), not spoken wording. Keep the title in "label" and put only the wording after the colon in "text"`,
      })
    }
  }

  // 3. shapes nobody accounts for (decks and drawings only, and only when the model cites shape numbers)
  if (source.kind === 'deck' || source.kind === 'diagram') {
    const cited = [...journey.steps.map((s) => s.source), ...journey.unmapped.map((u) => u.source)].map(shapeRefs)
    if (cited.some((c) => c.ids.length > 0)) {
      const title = norm(journey.title)
      const narrative = journey.scenarios.map((sc) => norm(`${sc.name} ${sc.description}`)).join(' ')
      for (const slide of source.deck.slides) {
        for (const shape of slide.shapes) {
          const text = norm(shape.text)
          if (text === '' || shape.textBox || shape.legendMember || text === title || narrative.includes(text)) continue
          const covered = cited.some((c) => c.ids.includes(shape.id) && (c.slide === undefined || c.slide === slide.index))
          if (!covered) {
            issues.push({
              path: '$.steps',
              message: `the shape "${clip(text)}" (slide ${slide.index}, shape ${shape.id}) is not covered by any step or unmapped entry. Add a step for it, or add it to "unmapped" with source "slide ${slide.index}, shape ${shape.id}"`,
            })
          }
        }
      }
    }
  }
  return issues
}
