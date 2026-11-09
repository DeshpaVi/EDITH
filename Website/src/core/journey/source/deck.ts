/**
 * Reads a PowerPoint deck as a flow graph. Shapes are nodes; connectors that name a start and an end shape
 * are edges. This is deterministic: a model only INTERPRETS the graph afterwards, it does not have to guess
 * the arrows from pixels. Branch labels ("Y", "N", "fallback 3x") are separate text boxes, so they are
 * attached to the nearest arrow by position; that part is a heuristic and is reported as one.
 */

export interface DeckShape {
  id: string
  name: string
  /** Paragraphs joined with a newline. */
  text: string
  geometry: string
  /** Fill colour key: a hex colour, or a theme colour such as "accent2" (with any tint, e.g. "accent5+lumMod:60000"). */
  color: string
  textBox: boolean
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export interface DeckConnector {
  id: string
  fromId?: string
  toId?: string
  x: number
  y: number
  w: number
  h: number
  /** Where the arrow leaves its source shape (from the connection site), when the source is known. */
  start?: Point
  /** Where it arrives, when the target is attached. */
  end?: Point
  /** For an arrow whose target is not attached: the shape nearest its free end. A heuristic. */
  guessedTarget?: { shapeId: string; distance: number }
  /** Text written on the arrow itself (Visio connectors can carry a label). */
  label?: string
}

export interface DeckLabel {
  shapeId: string
  text: string
  /** The two arrows that leave nearest to the label, closest first, with distance in EMU. A heuristic. */
  nearest: Array<{ connectorId: string; fromId?: string; distance: number }>
}

export interface DeckSlide {
  index: number
  /** The page name, when the file has one (Visio pages are named). */
  title?: string
  shapes: DeckShape[]
  connectors: DeckConnector[]
  labels: DeckLabel[]
  /** Fill colour key -> the legend entry that uses it, when the slide has a "Legend" shape. */
  legend: Record<string, string>
}

export interface Deck {
  slides: DeckSlide[]
}


export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/** PowerPoint connection sites of the common presets: 0 top, 1 left, 2 bottom, 3 right (counter-clockwise from top). */
export function site(s: DeckShape, idx: string | undefined): Point {
  switch (idx) {
    case '0': return { x: s.x + s.w / 2, y: s.y }
    case '1': return { x: s.x, y: s.y + s.h / 2 }
    case '2': return { x: s.x + s.w / 2, y: s.y + s.h }
    case '3': return { x: s.x + s.w, y: s.y + s.h / 2 }
    default: return { x: s.x + s.w / 2, y: s.y + s.h / 2 }
  }
}

/** Distance from a point to a rectangle (0 inside it). */
export function distanceToShape(p: Point, r: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w))
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h))
  return Math.hypot(dx, dy)
}


const clip = (s: string, n = 140): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const one = (s: string): string => s.replace(/\s*\n\s*/g, ' / ')

/**
 * Plain-text description of the deck for a language model: shapes with their legend meaning, arrows between
 * them, branch labels, and anything the file leaves ambiguous. Full text of every shape is included (the
 * model must copy wording verbatim), so nothing is clipped except in the arrow summary lines.
 */
export function describeDeck(deck: Deck): string {
  const out: string[] = []
  for (const slide of deck.slides) {
    const byId = new Map(slide.shapes.map((s) => [s.id, s]))
    const nameOf = (id: string | undefined): string => {
      if (!id) return '(nothing)'
      const s = byId.get(id)
      return s ? `[${id}] ${clip(one(s.text) || s.name)}` : `[${id}]`
    }
    out.push(`=== SLIDE ${slide.index}${slide.title ? `: ${slide.title}` : ''} ===`)
    const legendKeys = Object.keys(slide.legend)
    if (legendKeys.length > 0) {
      out.push('Legend (shape colour = meaning):')
      for (const [k, v] of Object.entries(slide.legend)) out.push(`  ${k} = ${v}${v.includes(' OR ') ? '   (ambiguous: same colour key)' : ''}`)
    }
    out.push('Shapes (id, kind, colour, text):')
    for (const s of slide.shapes) {
      if (s.text.trim() === '') continue
      const meaning = slide.legend[s.color] ? `, meaning: ${slide.legend[s.color]}` : ''
      out.push(`  [${s.id}] ${s.geometry}${s.textBox ? ' textbox' : ''}, colour ${s.color}${meaning}`)
      out.push(...s.text.split('\n').map((line) => `      ${line}`))
    }
    if (slide.connectors.length > 0) {
      out.push('Arrows (from --> to):')
      for (const c of slide.connectors) {
        let dangling = ''
        if (!c.fromId || !c.toId) {
          const g = c.guessedTarget
          dangling = g
            ? `   (END NOT ATTACHED: its free end lies nearest to ${nameOf(g.shapeId)}, distance ${g.distance}; HEURISTIC, confirm)`
            : '   (END NOT ATTACHED: the arrow does not name its target)'
        }
        const label = c.label ? `   [label on the arrow: "${c.label.replace(/\s+/g, ' ').trim()}"]` : ''
        out.push(`  ${nameOf(c.fromId)}  -->  ${nameOf(c.toId)}   {arrow ${c.id}}${label}${dangling}`)
      }
    }
    if (slide.labels.length > 0) {
      out.push('Branch labels (free text boxes, matched to the arrow that leaves nearest to them; this match is a HEURISTIC):')
      for (const l of slide.labels) {
        const near = l.nearest.map((n) => `arrow ${n.connectorId} leaving ${nameOf(n.fromId)} (distance ${n.distance})`).join('; ')
        out.push(`  "${l.text}" nearest: ${near}`)
      }
    }
    out.push('')
  }
  return out.join('\n')
}


/** The shape nearest an arrow's free end, ignoring the shape it leaves, containers around it and free-standing labels. */
export function guessTarget(shapes: DeckShape[], from: DeckShape, free: Point): { shapeId: string; distance: number } | undefined {
  const origin = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  return shapes
    .filter((sh) => sh.id !== from.id && sh.text.trim() !== '' && !sh.textBox && distanceToShape(origin, sh) > 0)
    .map((sh) => ({ shapeId: sh.id, distance: Math.round(distanceToShape(free, sh)) }))
    .sort((a, b) => a.distance - b.distance)[0]
}

/** Matches short free-standing text (Y, N, "fallback: 3x") to the arrows that leave nearest to it. A heuristic. */
export function attachLabels(shapes: DeckShape[], connectors: DeckConnector[], isCandidate: (s: DeckShape, attached: Set<string>) => boolean): DeckLabel[] {
  const attached = new Set(connectors.flatMap((c) => [c.fromId, c.toId]).filter((x): x is string => Boolean(x)))
  return shapes
    .filter((sh) => sh.text.trim() !== '' && sh.text.length <= 16 && isCandidate(sh, attached))
    .map((sh) => {
      const centre = { x: sh.x + sh.w / 2, y: sh.y + sh.h / 2 }
      return {
        shapeId: sh.id,
        text: sh.text.replace(/\s+/g, ' ').trim(),
        nearest: connectors
          .filter((c) => c.start)
          .map((c) => ({ connectorId: c.id, fromId: c.fromId, distance: Math.round(dist(centre, c.start as Point)) }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 2),
      }
    })
}
