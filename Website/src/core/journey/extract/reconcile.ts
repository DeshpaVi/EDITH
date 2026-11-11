import type { Journey } from '../model'
import type { SourceInput } from '../source'
import { START_MARKER, TITLE_PREFIX, norm, shapeRefs } from './semantic'

/**
 * Corrections that the FILE settles exactly, applied without asking the model again (asking drifted: repair rounds re-labelled steps and lost the
 * authentication step). The model keeps the meaning (kinds, wording, fields); the reader keeps the graph (shapes, arrows). Every change is
 * recorded in `assumptions`, so nothing is silent:
 * - a start marker ("Incoming Call") is not a step: removed;
 * - the diagram's titles ("Main Greeting:") are not spoken wording, when most prompts follow that convention: stripped from the wording;
 * - edges follow the arrows in the file: an edge with no arrow is removed, an arrow with no edge is added, and edge labels come from the file's
 *   branch labels (the reader's nearest-arrow match, a heuristic) or are left off.
 * Only for decks and drawings, and only when the steps cite shape numbers.
 */
export interface Reconciled {
  journey: Journey
  notes: string[]
}

const SPOKEN = ['greeting', 'announcement', 'closing', 'confirmation', 'intent_capture', 'authentication']

type Loose = Record<string, any> // the journey is edited generically; validateJourney has already checked its shape

export function reconcile(source: SourceInput, input: Journey): Reconciled {
  const notes: string[] = []
  if (source.kind !== 'deck' && source.kind !== 'diagram') return { journey: input, notes }
  const j = JSON.parse(JSON.stringify(input)) as Loose
  if (!j.steps.some((s: Loose) => shapeRefs(s.source).ids.length > 0)) return { journey: input, notes }

  // 1. start markers
  const markers = j.steps.filter((s: Loose) => START_MARKER.test(norm(s.label ?? '')))
  if (markers.length > 0) {
    const gone = new Set(markers.map((s: Loose) => s.id))
    j.steps = j.steps.filter((s: Loose) => !gone.has(s.id))
    for (const s of j.steps) s.next = s.next.filter((e: Loose) => !gone.has(e.to))
    notes.push(`Left out ${markers.map((s: Loose) => `"${norm(s.label)}"`).join(', ')}: it only shows where the call begins and is not a step.`)
  }

  // 2. diagram titles inside prompts (only when most prompts follow the "Title: wording" convention)
  const spoken = j.steps.filter((s: Loose) => SPOKEN.includes(s.kind) && typeof s.text === 'string' && s.text.trim() !== '')
  const titled = spoken.filter((s: Loose) => TITLE_PREFIX.test(s.text))
  if (spoken.length >= 3 && titled.length >= 3 && titled.length / spoken.length >= 0.75) {
    const titles = new Set<string>()
    const strip = (v: string): string => {
      const m = TITLE_PREFIX.exec(v)
      if (!m) return v
      titles.add(m[1])
      return m[2]
    }
    for (const s of j.steps) {
      if (!SPOKEN.includes(s.kind)) continue
      if (typeof s.text === 'string') s.text = strip(s.text)
      if (typeof s.failurePrompt === 'string') s.failurePrompt = strip(s.failurePrompt)
      if (s.retry && typeof s.retry.reprompt === 'string') s.retry.reprompt = strip(s.retry.reprompt)
    }
    notes.push(`Removed the diagram's titles from the spoken wording (${[...titles].map((t) => `"${t}:"`).join(', ')}): they name the shapes and are not spoken. The words after the colon are unchanged.`)
  }

  // 3. edges follow the arrows in the file
  const stepIndexOf = (slideIndex: number) => {
    const map = new Map<string, number>()
    j.steps.forEach((s: Loose, i: number) => {
      const r = shapeRefs(s.source)
      if (r.slide !== undefined && r.slide !== slideIndex) return
      for (const id of r.ids) if (!map.has(id)) map.set(id, i)
    })
    return map
  }
  const stepName = (i: number) => `"${norm(j.steps[i].label).slice(0, 40)}"`
  const removed: string[] = []
  const added: string[] = []
  for (const slide of source.deck.slides) {
    if (slide.connectors.length === 0) continue
    const stepOf = stepIndexOf(slide.index)
    const labelOf = new Map<string, string>()
    for (const l of slide.labels) if (l.nearest[0]) labelOf.set(l.nearest[0].connectorId, l.text)
    const arrows = new Map<string, { label?: string; guessed: boolean }>()
    for (const c of slide.connectors) {
      const toShape = c.toId ?? c.guessedTarget?.shapeId
      if (!c.fromId || !toShape) continue
      const a = stepOf.get(c.fromId)
      const b = stepOf.get(toShape)
      if (a === undefined || b === undefined || a === b) continue
      const key = `${a}>${b}`
      if (!arrows.has(key)) arrows.set(key, { label: c.label ?? labelOf.get(c.id), guessed: !c.toId })
    }
    const tied = (i: number) => shapeRefs(j.steps[i].source).ids.some((id) => stepOf.get(id) === i)
    j.steps.forEach((s: Loose, a: number) => {
      s.next = s.next.filter((e: Loose) => {
        const b = j.steps.findIndex((o: Loose) => o.id === e.to)
        if (b < 0 || a === b || !tied(a) || !tied(b)) return true
        if (arrows.has(`${a}>${b}`)) return true
        removed.push(`${stepName(a)} to ${stepName(b)}`)
        return false
      })
    })
    for (const [key, arrow] of arrows) {
      const [a, b] = key.split('>').map(Number)
      if (!j.steps[a].next.some((e: Loose) => e.to === j.steps[b].id)) {
        j.steps[a].next.push({ to: j.steps[b].id })
        added.push(`${stepName(a)} to ${stepName(b)}${arrow.guessed ? ' (the arrow\'s end is not glued to the shape; the nearest shape was used, please confirm)' : ''}`)
      }
    }
    // edge labels: the file's branch labels, or none
    j.steps.forEach((s: Loose, a: number) => {
      for (const e of s.next) {
        const b = j.steps.findIndex((o: Loose) => o.id === e.to)
        const arrow = arrows.get(`${a}>${b}`)
        if (!arrow) continue
        if (arrow.label) e.label = arrow.label
        else delete e.label
      }
    })
  }
  // 4. a caption or title that no arrow touches is not a step (the deck's title was read as an "unknown" step once)
  for (const slide of source.deck.slides) {
    if (slide.connectors.length === 0) continue
    const touched = new Set<string>()
    for (const c of slide.connectors) for (const id of [c.fromId, c.toId, c.guessedTarget?.shapeId]) if (id) touched.add(id)
    const loose = j.steps.filter((s: Loose) => {
      const r = shapeRefs(s.source)
      return s.kind === 'unknown' && s.next.length === 0 && r.ids.length > 0 && (r.slide === undefined || r.slide === slide.index) && !r.ids.some((id) => touched.has(id))
        && !j.steps.some((o: Loose) => o.next.some((e: Loose) => e.to === s.id))
    })
    if (loose.length === 0) continue
    const gone = new Set(loose.map((s: Loose) => s.id))
    j.steps = j.steps.filter((s: Loose) => !gone.has(s.id))
    notes.push(`Left out ${loose.map((s: Loose) => `"${norm(s.label ?? s.raw ?? '')}"`).join(', ')}: no arrow touches it, so it is a title or caption and not a step.`)
  }

  // 5. branch labels the reader attached to an arrow are no longer "unmapped"
  const attached = new Set<string>()
  for (const slide of source.deck.slides) {
    const arrowsFrom = new Set(slide.connectors.map((c) => c.id))
    for (const l of slide.labels) if (l.nearest[0] && arrowsFrom.has(l.nearest[0].connectorId)) attached.add(`slide ${slide.index}, shape ${l.shapeId}`)
  }
  const before = j.unmapped.length
  j.unmapped = j.unmapped.filter((u: Loose) => !(attached.has(norm(u.source ?? '')) && ['y', 'n', 'yes', 'no'].includes(norm(u.description ?? '').toLowerCase()) || attached.has(norm(u.source ?? '')) && /^fallback/i.test(norm(u.description ?? ''))))
  if (j.unmapped.length < before) notes.push(`${before - j.unmapped.length} branch label(s) (Y, N, fallback) are now on their arrows, so they were removed from the unmapped list.`)

  // 6. a step nothing leads to is a gap for the owner to settle, never a guess
  j.steps.forEach((s: Loose, i: number) => {
    if (i === 0 || j.steps.some((o: Loose) => o.next.some((e: Loose) => e.to === s.id))) return
    if (!shapeRefs(s.source).ids.length) return
    j.unmapped.push({ description: `Nothing leads to "${norm(s.label ?? '')}": the diagram has no arrow into it, so the call never reaches it. Confirm where it belongs.`, source: s.source })
  })
  for (const s of j.steps) {
    if (s.kind === 'intent_capture' && Array.isArray(s.intents) && s.intents.length === 0) {
      j.unmapped.push({ description: `"${norm(s.label ?? '')}" lists no intents. The deck does not name them; add them in the notes box and read again, or in the checklist.`, source: s.source })
    }
  }
  if (removed.length > 0) notes.push(`Removed ${removed.length} edge(s) the diagram does not have: ${removed.join('; ')}.`)
  if (added.length > 0) notes.push(`Added ${added.length} edge(s) the diagram has but the reading missed: ${added.join('; ')}.`)
  return { journey: j as Journey, notes }
}
