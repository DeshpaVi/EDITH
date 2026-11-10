import type { Journey } from '../model'
import type { ValidationIssue } from '../validate'
import type { SourceInput } from '../source'

/**
 * Checks on a journey that is structurally valid but wrong in a way a person would notice, found by comparing a real model's reading of the
 * Census deck with the hand-made journey. Deterministic, so the model is told exactly what to fix (and it never patches the answer itself).
 *
 * 1. A start marker ("Incoming Call", "Start") given as spoken wording.
 * 2. A diagram title kept inside the spoken wording ("Main Greeting: Thank you...") when the diagram uses that convention throughout.
 * 3. An arrow the model invented, or one in the file that it left out (the reader knows the arrows exactly, glued or nearest-shape).
 * 3b. A decision diamond (flowChartDecision) given a spoken kind: a diamond is a branch point whose question is not spoken to the caller.
 * 4. A shape on a flow slide (one with arrows) that no step or unmapped entry accounts for (CLAUDE.md constraint 3: never silently drop an element).
 */

const SPOKEN_KINDS = ['greeting', 'announcement', 'closing', 'confirmation', 'intent_capture', 'authentication'] as const
export const START_MARKER = /^(incoming call|call (starts?|begins?|arrives?)|start|begin|entry( point)?)\.?$/i
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

  // 1. start markers (by wording, or by the step's own label: a marker that was given the greeting's words is still a marker)
  for (const s of spoken) {
    if (START_MARKER.test(norm(s.text)) || START_MARKER.test(norm(s.step.label))) {
      issues.push({
        path: `$.steps[${s.index}]`,
        message: `"${norm(START_MARKER.test(norm(s.text)) ? s.text : s.step.label)}" only marks where the call begins; it is not a step with wording of its own. Remove this step (do not copy another step's wording into it) and start the journey at the first real step.`,
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

  // 3. arrows: compare the model's edges with the arrows the file reader found
  if (source.kind === 'deck' || source.kind === 'diagram') issues.push(...edgeIssues(source, journey))

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

/**
 * Edges versus arrows. A step is tied to the shape(s) its `source` cites. Only when steps cite shape numbers, and only on slides with arrows.
 * - An edge between two steps whose shapes have no arrow between them in the source is invented.
 * - An arrow between the shapes of two different steps that has no matching edge was left out.
 * Arrows whose end is not glued to a shape are the reader's nearest-shape guess; they are reported as such.
 */
function edgeIssues(source: Extract<SourceInput, { deck: unknown }>, journey: Journey): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const shapesOf = journey.steps.map((st) => shapeRefs(st.source))
  if (!shapesOf.some((r) => r.ids.length > 0)) return issues
  for (const slide of source.deck.slides) {
    if (slide.connectors.length === 0) continue
    const byId = new Map(slide.shapes.map((sh) => [sh.id, sh]))
    const name = (id: string) => `"${clip(byId.get(id)?.text ?? id, 40)}"`
    // step index per shape on this slide
    const stepOf = new Map<string, number>()
    shapesOf.forEach((r, i) => {
      if (r.slide !== undefined && r.slide !== slide.index) return
      for (const id of r.ids) if (!stepOf.has(id)) stepOf.set(id, i)
    })
    const arrows: Array<{ from: string; to: string; guessed: boolean }> = []
    for (const c of slide.connectors) {
      const to = c.toId ?? c.guessedTarget?.shapeId
      if (c.fromId && to) arrows.push({ from: c.fromId, to, guessed: !c.toId })
    }
    const arrowBetween = (a: number, b: number) => arrows.some((x) => stepOf.get(x.from) === a && stepOf.get(x.to) === b)

    journey.steps.forEach((st, a) => {
      for (const e of st.next) {
        const b = journey.steps.findIndex((o) => o.id === e.to)
        if (b < 0 || a === b) continue
        const fromShapes = shapesOf[a].ids.filter((id) => stepOf.get(id) === a)
        const toShapes = shapesOf[b].ids.filter((id) => stepOf.get(id) === b)
        if (fromShapes.length === 0 || toShapes.length === 0) continue // not tied to shapes on this slide
        if (!arrowBetween(a, b)) {
          issues.push({
            path: `$.steps[${a}]`,
            message: `has an edge to step "${e.to}", but the source has no arrow from ${name(fromShapes[0])} to ${name(toShapes[0])}. Remove the edge, or point it at the shape the arrow really leads to`,
          })
        }
      }
    })
    const reported = new Set<string>()
    for (const x of arrows) {
      const a = stepOf.get(x.from)
      const b = stepOf.get(x.to)
      if (a === undefined || b === undefined || a === b) continue
      const key = `${a}>${b}`
      if (reported.has(key)) continue
      if (!journey.steps[a].next.some((e) => e.to === journey.steps[b].id)) {
        reported.add(key)
        issues.push({
          path: `$.steps[${a}]`,
          message: `the source has an arrow from ${name(x.from)} to ${name(x.to)}${x.guessed ? ' (its end is not glued to the shape, so the reader chose the nearest one; confirm from meaning)' : ''} but this step has no edge to step "${journey.steps[b].id}". Add the edge`,
        })
      }
    }
  }
  return issues
}
