import type { Journey } from '../model'
import type { ValidationIssue } from '../validate'
import type { SourceInput } from '../source'

/**
 * Checks on a journey that is structurally valid but wrong in a way a person would notice, found by comparing a real model's reading of the
 * Census deck with the hand-made journey. Deterministic, so the model is told exactly what to fix (and it never patches the answer itself).
 *
 * Start markers, diagram titles in prompts and edges that disagree with the arrows are fixed deterministically in reconcile.ts instead, because asking
 * the model to repair them made it drift. What is left here needs the model's judgement:
 * - A decision diamond (flowChartDecision) given a spoken kind: a diamond is a branch point whose question is not spoken to the caller.
 * - A shape on a flow slide (one with arrows) that no step or unmapped entry accounts for (CLAUDE.md constraint 3: never silently drop an element).
 */

const SPOKEN_KINDS = ['greeting', 'announcement', 'closing', 'confirmation', 'intent_capture', 'authentication'] as const
export const START_MARKER = /^(incoming call|call (starts?|begins?|arrives?)|start|begin|entry( point)?)\.?$/i
export const TITLE_PREFIX = /^([A-Z][A-Za-z0-9 ]{1,30}):\s+(\S.*)$/s

export const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const clip = (s: string, n = 60) => (norm(s).length > n ? `${norm(s).slice(0, n)}...` : norm(s))

/** Shape numbers a source string refers to, with the slide when it names one. */
export function shapeRefs(source: string): { slide?: number; ids: string[] } {
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

  // 3b. diamonds are decisions
  if (source.kind === 'deck' || source.kind === 'diagram') {
    for (const [index, st] of journey.steps.entries()) {
      if (!(SPOKEN_KINDS as readonly string[]).includes(st.kind)) continue
      const ref = shapeRefs(st.source)
      for (const slide of source.deck.slides) {
        if (ref.slide !== undefined && ref.slide !== slide.index) continue
        const diamond = slide.shapes.find((sh) => ref.ids.includes(sh.id) && /decision/i.test(sh.geometry))
        if (diamond) {
          issues.push({
            path: `$.steps[${index}]`,
            message: `is tied to "${clip(diamond.text, 40)}", a decision diamond in the drawing: a branch point whose question is not spoken to the caller. Use kind "decision" with that question (and put the real spoken prompt, if the source has one, in its own step)`,
          })
          break
        }
      }
    }
  }

  // 4. shapes nobody accounts for (decks and drawings only, and only when the model cites shape numbers)
  if (source.kind === 'deck' || source.kind === 'diagram') {
    const cited = [...journey.steps.map((s) => s.source), ...journey.unmapped.map((u) => u.source)].map(shapeRefs)
    if (cited.some((c) => c.ids.length > 0)) {
      const title = norm(journey.title)
      const narrative = journey.scenarios.map((sc) => norm(`${sc.name} ${sc.description}`)).join(' ')
      for (const slide of source.deck.slides) {
        // A slide with no arrows is not a flow diagram (for example a text box of scenarios): its shapes are not steps to account for.
        if (slide.connectors.length === 0) continue
        for (const shape of slide.shapes) {
          const text = norm(shape.text)
          if (text === '' || shape.textBox || shape.legendMember || text === title || narrative.includes(text)) continue
          const covered = cited.some((c) => c.ids.includes(shape.id) && (c.slide === undefined || c.slide === slide.index))
          if (!covered) {
            issues.push({
              path: '$.steps',
              message: `the shape "${clip(text)}" (slide ${slide.index}, shape ${shape.id}) is not covered by any step or unmapped entry. Add a step for it (with id, kind, label, source and a "next" list of its outgoing edges, [] if it ends the call), or add it to "unmapped" with source "slide ${slide.index}, shape ${shape.id}"`,
            })
          }
        }
      }
    }
  }
  return issues
}
