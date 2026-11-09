import { strFromU8, unzipSync } from 'fflate'
import type { XmlNode } from './xml'
import { child, find, findAll, parseXml } from './xml'
import { attachLabels, dist, guessTarget, site } from './deck'
import type { Deck, DeckConnector, DeckShape, DeckSlide, Point } from './deck'

export { describeDeck } from './deck'
export type { Deck, DeckConnector, DeckLabel, DeckShape, DeckSlide, Point } from './deck'

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
      c.guessedTarget = guessTarget(shapes, from, free)
    }
    return c
  })

  // Branch labels: short, free-standing text boxes that no arrow is attached to.
  const labels = attachLabels(shapes, connectors, (sh, attached) => sh.textBox && !attached.has(sh.id))

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
