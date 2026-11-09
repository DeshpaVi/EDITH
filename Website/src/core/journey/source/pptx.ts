import { strFromU8, unzipSync } from 'fflate'
import type { XmlNode } from './xml'
import { child, find, findAll, parseXml } from './xml'

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
}

export interface DeckLabel {
  shapeId: string
  text: string
  /** The two arrows that leave nearest to the label, closest first, with distance in EMU. A heuristic. */
  nearest: Array<{ connectorId: string; fromId?: string; distance: number }>
}

export interface DeckSlide {
  index: number
  shapes: DeckShape[]
  connectors: DeckConnector[]
  labels: DeckLabel[]
  /** Fill colour key -> the legend entry that uses it, when the slide has a "Legend" shape. */
  legend: Record<string, string>
}

export interface Deck {
  slides: DeckSlide[]
}

const num = (v: string | undefined): number => (v === undefined ? 0 : Number(v) || 0)

/** Text of a shape: paragraphs (a:p) of runs (a:t), joined with newlines; empty paragraphs are dropped. */
function shapeText(sp: XmlNode): string {
  const body = child(sp, 'p:txBody')
  if (!body) return ''
  return body.children
    .filter((c) => c.tag === 'a:p')
    .map((p) => findAll(p, 'a:t').map((t) => t.text).join(''))
    .filter((t) => t.trim() !== '')
    .join('\n')
}

function colorKey(sp: XmlNode): string {
  const pick = (holder: XmlNode | undefined): string | null => {
    if (!holder) return null
    const rgb = child(holder, 'a:srgbClr')
    if (rgb) return `#${rgb.attrs.val}`
    const scheme = child(holder, 'a:schemeClr')
    if (!scheme) return null
    const tint = scheme.children.filter((c) => c.tag.startsWith('a:lum') || c.tag === 'a:tint' || c.tag === 'a:shade').map((c) => `${c.tag.slice(2)}:${c.attrs.val}`)
    return [scheme.attrs.val, ...tint].join('+')
  }
  const spPr = child(sp, 'p:spPr')
  const explicit = pick(child(spPr ?? sp, 'a:solidFill'))
  if (explicit) return explicit
  return pick(find(child(sp, 'p:style') ?? sp, 'a:fillRef')) ?? 'none'
}

function geometry(node: XmlNode): { x: number; y: number; w: number; h: number } {
  const xfrm = find(node, 'a:xfrm')
  const off = xfrm && child(xfrm, 'a:off')
  const ext = xfrm && child(xfrm, 'a:ext')
  return { x: num(off?.attrs.x), y: num(off?.attrs.y), w: num(ext?.attrs.cx), h: num(ext?.attrs.cy) }
}

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/** PowerPoint connection sites of the common presets: 0 top, 1 left, 2 bottom, 3 right (counter-clockwise from top). */
function site(s: DeckShape, idx: string | undefined): Point {
  switch (idx) {
    case '0': return { x: s.x + s.w / 2, y: s.y }
    case '1': return { x: s.x, y: s.y + s.h / 2 }
    case '2': return { x: s.x + s.w / 2, y: s.y + s.h }
    case '3': return { x: s.x + s.w, y: s.y + s.h / 2 }
    default: return { x: s.x + s.w / 2, y: s.y + s.h / 2 }
  }
}

/** Distance from a point to a rectangle (0 inside it). */
function distanceToShape(p: Point, r: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w))
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h))
  return Math.hypot(dx, dy)
}

function readSlide(xml: string, index: number): DeckSlide {
  const tree = parseXml(xml)
  const shapes: DeckShape[] = findAll(tree, 'p:sp').map((sp) => {
    const nv = find(sp, 'p:cNvPr')
    const cSp = find(sp, 'p:cNvSpPr')
    const geom = find(sp, 'a:prstGeom')
    return {
      id: nv?.attrs.id ?? '',
      name: nv?.attrs.name ?? '',
      text: shapeText(sp),
      geometry: geom?.attrs.prst ?? 'rect',
      color: colorKey(sp),
      textBox: cSp?.attrs.txBox === '1',
      ...geometry(sp),
    }
  })
  const byId = new Map(shapes.map((sh) => [sh.id, sh]))
  const connectors: DeckConnector[] = findAll(tree, 'p:cxnSp').map((cx) => {
    const st = find(cx, 'a:stCxn')
    const en = find(cx, 'a:endCxn')
    const box = geometry(cx)
    const from = st ? byId.get(st.attrs.id) : undefined
    const to = en ? byId.get(en.attrs.id) : undefined
    const c: DeckConnector = { id: find(cx, 'p:cNvPr')?.attrs.id ?? '', fromId: st?.attrs.id, toId: en?.attrs.id, ...box }
    if (from) c.start = site(from, st?.attrs.idx)
    if (to) c.end = site(to, en?.attrs.idx)
    if (from && !to) {
      // The free end is the corner of the arrow's box farthest from where it starts.
      const corners: Point[] = [
        { x: box.x, y: box.y }, { x: box.x + box.w, y: box.y }, { x: box.x, y: box.y + box.h }, { x: box.x + box.w, y: box.y + box.h },
      ]
      const origin = c.start as Point
      const free = corners.reduce((far, p) => (dist(p, origin) > dist(far, origin) ? p : far))
      const candidates = shapes
        .filter((sh) => sh.id !== from.id && sh.text.trim() !== '' && !sh.textBox && distanceToShape(site(from, undefined), sh) > 0)
        .map((sh) => ({ shapeId: sh.id, distance: Math.round(distanceToShape(free, sh)) }))
        .sort((a, b) => a.distance - b.distance)
      if (candidates[0]) c.guessedTarget = candidates[0]
    }
    return c
  })

  // Branch labels: short, free-standing text boxes that no arrow is attached to.
  const attached = new Set(connectors.flatMap((c) => [c.fromId, c.toId]).filter(Boolean))
  const labels: DeckLabel[] = shapes
    .filter((sh) => sh.textBox && sh.text.trim() !== '' && sh.text.length <= 16 && !attached.has(sh.id))
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

  // Legend: the shapes sitting inside the shape titled "Legend", keyed by their colour.
  const legendShape = shapes.find((s) => s.text.trim().toLowerCase() === 'legend')
  const legend: Record<string, string> = {}
  if (legendShape) {
    for (const s of shapes) {
      if (s === legendShape || s.text.trim() === '') continue
      const inside = s.x >= legendShape.x && s.y >= legendShape.y && s.x + s.w <= legendShape.x + legendShape.w && s.y + s.h <= legendShape.y + legendShape.h
      if (!inside) continue
      const entry = s.text.replace(/\s+/g, ' ').trim()
      // Two entries can share a colour key when they differ only by a tint this reader does not see.
      legend[s.color] = s.color in legend && !legend[s.color].split(' OR ').includes(entry) ? `${legend[s.color]} OR ${entry}` : (legend[s.color] ?? entry)
    }
  }
  return { index, shapes, connectors, labels, legend }
}

/** Reads every slide of a .pptx (a zip of XML parts), in slide order. */
export function readPptx(bytes: Uint8Array): Deck {
  const files = unzipSync(bytes)
  const slides = Object.keys(files)
    .map((path) => ({ path, n: /^ppt\/slides\/slide(\d+)\.xml$/.exec(path)?.[1] }))
    .filter((f): f is { path: string; n: string } => f.n !== undefined)
    .sort((a, b) => Number(a.n) - Number(b.n))
  if (slides.length === 0) throw new Error('This file has no slides (is it a .pptx?)')
  return { slides: slides.map((s) => readSlide(strFromU8(files[s.path]), Number(s.n))) }
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
    out.push(`=== SLIDE ${slide.index} ===`)
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
        out.push(`  ${nameOf(c.fromId)}  -->  ${nameOf(c.toId)}   {arrow ${c.id}}${dangling}`)
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
