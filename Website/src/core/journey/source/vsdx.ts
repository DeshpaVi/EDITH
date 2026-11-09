import { strFromU8, unzipSync } from 'fflate'
import type { XmlNode } from './xml'
import { child, findAll, parseXml } from './xml'
import { attachLabels, guessTarget } from './deck'
import type { Deck, DeckConnector, DeckShape, DeckSlide, Point } from './deck'

/**
 * Reads a Visio drawing (.vsdx, a zip of XML) as the same flow graph the PowerPoint reader produces. Visio is
 * better suited to this than slides: connectors record which shape each end is glued to, a connector can carry its
 * own label, and shapes keep their Visio type (Decision, Process, Terminator).
 *
 * Limits: rotation and scaling of groups are ignored; shapes whose text lives only in a master are read without it;
 * the legacy binary .vsd format is not supported. Verified against hand-built files only: run a real drawing through
 * it before relying on it.
 */

const EMU_PER_INCH = 914400
const inch = (v: string | undefined): number => (v === undefined ? 0 : Number(v) || 0)
const emu = (inches: number): number => Math.round(inches * EMU_PER_INCH)

function cells(shape: XmlNode): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of shape.children) if (c.tag === 'Cell' && c.attrs.N) out[c.attrs.N] = c.attrs.V ?? ''
  return out
}

/** Shape text: runs in order, a new line at each paragraph marker, fields included. */
function shapeText(shape: XmlNode): string {
  const text = child(shape, 'Text')
  if (!text) return ''
  let out = ''
  const walk = (n: XmlNode): void => {
    for (const part of n.content) {
      if (typeof part === 'string') out += part
      else if (part.tag === 'pp') {
        if (out !== '' && !out.endsWith('\n')) out += '\n'
      } else if (part.tag !== 'cp' && part.tag !== 'tp') walk(part)
    }
  }
  walk(text)
  return out
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '')
    .join('\n')
}

interface RawShape {
  id: string
  name: string
  master?: string
  group: boolean
  left: number
  bottom: number
  w: number
  h: number
  cells: Record<string, string>
  text: string
  /** Page-coordinate origin of the group it sits in. */
  origin: Point
}

/** Flattens nested groups. Child coordinates are relative to the group's own origin (its lower-left corner). */
function collect(shapesNode: XmlNode | undefined, origin: Point, out: RawShape[]): void {
  if (!shapesNode) return
  for (const sh of shapesNode.children.filter((c) => c.tag === 'Shape')) {
    const c = cells(sh)
    const w = inch(c.Width)
    const h = inch(c.Height)
    const locX = c.LocPinX !== undefined ? inch(c.LocPinX) : w / 2
    const locY = c.LocPinY !== undefined ? inch(c.LocPinY) : h / 2
    const left = origin.x + inch(c.PinX) - locX
    const bottom = origin.y + inch(c.PinY) - locY
    out.push({ id: sh.attrs.ID ?? '', name: sh.attrs.NameU ?? sh.attrs.Name ?? '', master: sh.attrs.Master, group: sh.attrs.Type === 'Group', left, bottom, w, h, cells: c, text: shapeText(sh), origin })
    collect(child(sh, 'Shapes'), { x: left, y: bottom }, out)
  }
}

const baseName = (name: string): string => name.replace(/\.\d+$/, '').replace(/^Sheet\.\d+$/, '')

function readPage(xml: string, index: number, title: string, pageHeight: number | undefined, masterNames: Map<string, string>): DeckSlide {
  const tree = parseXml(xml)
  const raw: RawShape[] = []
  collect(child(tree, 'Shapes'), { x: 0, y: 0 }, raw)

  // Connection records: which shape each end of a connector is glued to.
  const glue = new Map<string, { begin?: string; end?: string }>()
  for (const c of findAll(tree, 'Connect')) {
    const from = c.attrs.FromSheet
    const to = c.attrs.ToSheet
    if (!from || !to) continue
    const entry = glue.get(from) ?? {}
    if (c.attrs.FromCell === 'BeginX') entry.begin = to
    else if (c.attrs.FromCell === 'EndX') entry.end = to
    glue.set(from, entry)
  }
  const connectorIds = new Set(glue.keys())
  const connected = new Set([...glue.values()].flatMap((g) => [g.begin, g.end]).filter((x): x is string => Boolean(x)))

  const height = pageHeight ?? Math.max(1, ...raw.map((r) => r.bottom + r.h)) + 1
  const top = (bottom: number, h: number): number => height - (bottom + h)

  const shapes: DeckShape[] = raw
    .filter((r) => !connectorIds.has(r.id) && !r.group)
    .map((r) => {
      const geometry = (r.master && masterNames.get(r.master)) || baseName(r.name) || 'shape'
      const fill = r.cells.FillForegnd
      return {
        id: r.id,
        name: r.name,
        text: r.text,
        geometry,
        color: fill && fill.startsWith('#') ? fill.toUpperCase() : 'none',
        textBox: !connected.has(r.id) && r.text.length <= 16 && r.text !== '',
        x: emu(r.left),
        y: emu(top(r.bottom, r.h)),
        w: emu(r.w),
        h: emu(r.h),
      }
    })
  const byId = new Map(shapes.map((s) => [s.id, s]))
  const centre = (s: DeckShape): Point => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 })

  const connectors: DeckConnector[] = raw
    .filter((r) => connectorIds.has(r.id))
    .map((r) => {
      const g = glue.get(r.id) as { begin?: string; end?: string }
      const point = (xCell: string, yCell: string): Point | undefined =>
        r.cells[xCell] !== undefined && r.cells[yCell] !== undefined
          ? { x: emu(r.origin.x + inch(r.cells[xCell])), y: emu(top(r.origin.y + inch(r.cells[yCell]), 0)) }
          : undefined
      let fromId = g.begin
      let toId = g.end
      let start = point('BeginX', 'BeginY') ?? (fromId && byId.get(fromId) ? centre(byId.get(fromId) as DeckShape) : undefined)
      let end = point('EndX', 'EndY') ?? (toId && byId.get(toId) ? centre(byId.get(toId) as DeckShape) : undefined)
      // An arrowhead at the begin end and none at the end means the arrow points the other way.
      const arrow = (cell: string) => Number(r.cells[cell] ?? '0') !== 0
      if (arrow('BeginArrow') && !arrow('EndArrow')) {
        ;[fromId, toId] = [toId, fromId]
        ;[start, end] = [end, start]
      }
      const pts = [start, end].filter((p): p is Point => p !== undefined)
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      const c: DeckConnector = {
        id: r.id,
        fromId,
        toId,
        x: xs.length ? Math.min(...xs) : 0,
        y: ys.length ? Math.min(...ys) : 0,
        w: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
        h: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
      }
      if (start) c.start = start
      if (end && toId) c.end = end
      if (r.text) c.label = r.text
      const from = fromId ? byId.get(fromId) : undefined
      if (from && !toId && end) c.guessedTarget = guessTarget(shapes, from, end)
      return c
    })

  const labels = attachLabels(shapes, connectors, (sh) => sh.textBox)
  return { index, title, shapes, connectors, labels, legend: {} }
}

/** Reads every page of a .vsdx, in page order. Background pages are skipped. */
export function readVsdx(bytes: Uint8Array): Deck {
  const files = unzipSync(bytes)
  const text = (path: string): string | undefined => (files[path] ? strFromU8(files[path]) : undefined)

  const masterNames = new Map<string, string>()
  const masters = text('visio/masters/masters.xml')
  if (masters) for (const m of findAll(parseXml(masters), 'Master')) if (m.attrs.ID) masterNames.set(m.attrs.ID, baseName(m.attrs.NameU ?? m.attrs.Name ?? ''))

  // Page order and names come from pages.xml; each page points at its content file through a relationship.
  const pagesXml = text('visio/pages/pages.xml')
  const rels = new Map<string, string>()
  const relsXml = text('visio/pages/_rels/pages.xml.rels')
  if (relsXml) for (const r of findAll(parseXml(relsXml), 'Relationship')) if (r.attrs.Id && r.attrs.Target) rels.set(r.attrs.Id, r.attrs.Target)

  const pages: Array<{ path: string; title: string; height?: number }> = []
  if (pagesXml) {
    for (const page of findAll(parseXml(pagesXml), 'Page')) {
      if (page.attrs.Background === '1') continue
      const rel = findAll(page, 'Rel')[0]?.attrs['r:id']
      const target = rel ? rels.get(rel) : undefined
      const heightCell = findAll(page, 'Cell').find((c) => c.attrs.N === 'PageHeight')
      if (target) pages.push({ path: `visio/pages/${target.replace(/^\/?(visio\/pages\/)?/, '')}`, title: page.attrs.NameU ?? page.attrs.Name ?? '', height: heightCell ? inch(heightCell.attrs.V) : undefined })
    }
  }
  if (pages.length === 0) {
    for (const path of Object.keys(files).filter((p) => /^visio\/pages\/page\d+\.xml$/.test(p)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]))) {
      pages.push({ path, title: '' })
    }
  }
  if (pages.length === 0) throw new Error('This file has no pages (is it a .vsdx?)')
  return { slides: pages.map((p, i) => readPage(text(p.path) ?? '<PageContents/>', i + 1, p.title, p.height, masterNames)) }
}
