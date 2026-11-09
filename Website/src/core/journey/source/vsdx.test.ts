import { describe, it, expect } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { readVsdx } from './vsdx'
import { describeDeck } from './deck'
import { SourceError, readSource, sourceText } from './index'

const cell = (n: string, v: string | number) => `<Cell N="${n}" V="${v}"/>`
const box = (pinX: number, pinY: number, w: number, h: number, extra = '') => [cell('PinX', pinX), cell('PinY', pinY), cell('Width', w), cell('Height', h), cell('LocPinX', w / 2), cell('LocPinY', h / 2), extra].join('')
const shape = (id: number, name: string, master: number | null, geometry: string, text = '') =>
  `<Shape ID="${id}" Type="Shape" NameU="${name}"${master ? ` Master="${master}"` : ''}>${geometry}${text ? `<Text>${text}</Text>` : ''}</Shape>`
const connector = (id: number, bx: number, by: number, ex: number, ey: number, text = '', arrows = { begin: 0, end: 4 }) =>
  `<Shape ID="${id}" Type="Shape" NameU="Dynamic connector.${id}">${[cell('BeginX', bx), cell('BeginY', by), cell('EndX', ex), cell('EndY', ey), cell('BeginArrow', arrows.begin), cell('EndArrow', arrows.end)].join('')}${text ? `<Text>${text}</Text>` : ''}</Shape>`
const connect = (from: number, cellName: 'BeginX' | 'EndX', to: number) => `<Connect FromSheet="${from}" FromCell="${cellName}" FromPart="${cellName === 'BeginX' ? 9 : 12}" ToSheet="${to}" ToCell="PinX" ToPart="3"/>`

/** A small flowchart: Start -> Greeting -> Authenticated? -yes-> Welcome back -> End, -no-> Try again -> back. */
function drawing(extraShapes = '', extraConnects = '') {
  const shapes = [
    shape(1, 'Terminator.1', 1, box(2, 7, 1.5, 0.5), '<cp IX="0"/>Start'),
    shape(2, 'Process.2', 2, box(2, 5.5, 2, 1), '<cp IX="0"/>Greeting:<pp IX="0"/><cp IX="1"/>Hello caller'),
    shape(3, 'Decision.3', 3, box(2, 4, 2, 1), '<cp IX="0"/>Authenticated?'),
    shape(4, 'Process.4', 2, box(5.5, 4, 2, 1, cell('FillForegnd', '#00b050')), '<cp IX="0"/>Welcome back'),
    shape(5, 'Process.5', 2, box(2, 2, 2, 1), '<cp IX="0"/>Try again'),
    shape(6, 'Terminator.6', 1, box(5.5, 2.5, 1.5, 0.5), '<cp IX="0"/>End'),
    shape(7, 'Text.7', null, box(3.4, 4.1, 0.4, 0.3), '<cp IX="0"/>Y'),
    connector(10, 2, 6.75, 2, 6.0),
    connector(11, 2, 5.0, 2, 4.5),
    connector(12, 3.0, 4.0, 4.5, 4.0, '<cp IX="0"/>Yes'),
    connector(13, 2, 3.5, 2, 2.5, '<cp IX="0"/>No'),
    connector(14, 2, 2.5, 2, 3.5), // Try again -> Authenticated? (loops back)
    connector(15, 5.5, 2.75, 5.5, 3.5, '', { begin: 13, end: 0 }), // drawn End -> Welcome back, arrowhead at the begin end
    connector(16, 3.0, 2.0, 4.6, 2.0), // leaves Try again, free end near Welcome back? (not glued)
    extraShapes,
  ].join('')
  const connects = [
    connect(10, 'BeginX', 1), connect(10, 'EndX', 2),
    connect(11, 'BeginX', 2), connect(11, 'EndX', 3),
    connect(12, 'BeginX', 3), connect(12, 'EndX', 4),
    connect(13, 'BeginX', 3), connect(13, 'EndX', 5),
    connect(14, 'BeginX', 5), connect(14, 'EndX', 3),
    connect(15, 'BeginX', 6), connect(15, 'EndX', 4),
    connect(16, 'BeginX', 5),
    extraConnects,
  ].join('')
  return `<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Shapes>${shapes}</Shapes><Connects>${connects}</Connects></PageContents>`
}

function vsdx(pageXml = drawing(), opts: { pages?: boolean; background?: boolean } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'visio/masters/masters.xml': strToU8('<Masters><Master ID="1" NameU="Terminator"/><Master ID="2" NameU="Process"/><Master ID="3" NameU="Decision"/></Masters>'),
    'visio/pages/page1.xml': strToU8(pageXml),
    'visio/pages/page2.xml': strToU8('<PageContents><Shapes>' + shape(1, 'Process.1', 2, box(1, 1, 1, 1), 'Second page') + '</Shapes></PageContents>'),
  }
  if (opts.pages !== false) {
    files['visio/pages/pages.xml'] = strToU8(
      `<Pages xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<Page ID="0" Name="Login flow" NameU="Login flow"><PageSheet>${cell('PageHeight', 8)}</PageSheet><Rel r:id="rId1"/></Page>` +
        (opts.background ? `<Page ID="1" Name="Background" Background="1"><Rel r:id="rId9"/></Page>` : '') +
        `<Page ID="2" Name="Second" NameU="Second"><PageSheet>${cell('PageHeight', 8)}</PageSheet><Rel r:id="rId2"/></Page></Pages>`,
    )
    files['visio/pages/_rels/pages.xml.rels'] = strToU8(
      '<Relationships><Relationship Id="rId1" Target="page1.xml"/><Relationship Id="rId2" Target="page2.xml"/><Relationship Id="rId9" Target="page9.xml"/></Relationships>',
    )
  }
  return zipSync(files)
}

describe('reading a Visio drawing', () => {
  const deck = readVsdx(vsdx())
  const page = deck.slides[0]
  const shape = (id: string) => page.shapes.find((s) => s.id === id)!
  const arrow = (id: string) => page.connectors.find((c) => c.id === id)!

  it('reads pages in order, with their names', () => {
    expect(deck.slides.map((s) => [s.index, s.title])).toEqual([[1, 'Login flow'], [2, 'Second']])
  })

  it('keeps connectors out of the shape list and reads shape text with paragraph breaks', () => {
    expect(page.shapes.map((s) => s.id).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(shape('2').text).toBe('Greeting:\nHello caller')
  })

  it('uses Visio\'s own shape types as hints, and explicit fill colours', () => {
    expect(shape('3').geometry).toBe('Decision')
    expect(shape('1').geometry).toBe('Terminator')
    expect(shape('4').color).toBe('#00B050')
    expect(shape('2').color).toBe('none')
  })

  it('converts Visio\'s upward y axis to a top-down one', () => {
    // Start: pin y 7, height 0.5 -> bottom 6.75 -> top = 8 - 7.25 = 0.75 inches
    expect(shape('1').y).toBe(Math.round(0.75 * 914400))
    expect(shape('1').x).toBe(Math.round((2 - 0.75) * 914400))
  })

  it('reads edges from the glue records', () => {
    const edge = (id: string) => [arrow(id).fromId, arrow(id).toId]
    expect(edge('10')).toEqual(['1', '2'])
    expect(edge('12')).toEqual(['3', '4'])
    expect(edge('14')).toEqual(['5', '3'])
  })

  it('takes branch labels from the connector itself', () => {
    expect(arrow('12').label).toBe('Yes')
    expect(arrow('13').label).toBe('No')
    expect(arrow('10').label).toBeUndefined()
  })

  it('reverses an arrow whose arrowhead is at the begin end', () => {
    expect([arrow('15').fromId, arrow('15').toId]).toEqual(['4', '6'])
  })

  it('reports an arrow glued at one end only and guesses where it points', () => {
    expect(arrow('16').toId).toBeUndefined()
    expect(arrow('16').guessedTarget?.shapeId).toBe('6') // its free end is at (4.6, 2.0), nearest the End shape
  })

  it('matches a free-standing Y to the arrow that leaves nearest to it', () => {
    expect(shape('7').textBox).toBe(true)
    expect(page.labels.find((l) => l.shapeId === '7')?.nearest[0].connectorId).toBe('12')
  })

  it('describes the drawing for a model', () => {
    const text = describeDeck(deck)
    expect(text).toContain('=== SLIDE 1: Login flow ===')
    expect(text).toContain('Decision')
    expect(text).toContain('[3] Authenticated?  -->  [4] Welcome back')
    expect(text).toContain('[label on the arrow: "Yes"]')
    expect(text).toContain('END NOT ATTACHED')
  })
})

describe('Visio structure', () => {
  it('flattens grouped shapes, positioning children from the group origin', () => {
    const group = `<Shape ID="20" Type="Group" NameU="Sheet.20">${box(8, 6, 3, 2)}<Shapes>${shape(21, 'Process.21', 2, box(1, 1, 1, 1), '<cp IX="0"/>In a group')}</Shapes></Shape>`
    const page = readVsdx(vsdx(drawing(group))).slides[0]
    const inner = page.shapes.find((s) => s.id === '21')!
    expect(inner.text).toBe('In a group')
    // group lower-left = (8-1.5, 6-1) = (6.5, 5); child lower-left = group origin + (1-0.5, 1-0.5) = (7, 5.5); top = 8-(5.5+1) = 1.5
    expect(inner.x).toBe(Math.round(7 * 914400))
    expect(inner.y).toBe(Math.round(1.5 * 914400))
    expect(page.shapes.some((s) => s.id === '20')).toBe(false) // the group container itself is not a step
  })

  it('skips background pages', () => {
    expect(readVsdx(vsdx(drawing(), { background: true })).slides.map((s) => s.title)).toEqual(['Login flow', 'Second'])
  })

  it('finds pages without pages.xml', () => {
    const deck = readVsdx(vsdx(drawing(), { pages: false }))
    expect(deck.slides).toHaveLength(2)
  })

  it('rejects a file that is not a Visio drawing', () => {
    expect(() => readVsdx(zipSync({ 'x.txt': strToU8('x') }))).toThrow(/no pages/)
  })
})

describe('Visio uploads', () => {
  it('is read as a diagram, with text for the wording check', () => {
    const s = readSource({ fileName: 'Flow.VSDX', bytes: vsdx() })
    expect(s.kind).toBe('diagram')
    expect(sourceText(s)).toContain('Greeting:')
  })

  it('explains what to do with a legacy .vsd file or a broken drawing', () => {
    expect(() => readSource({ fileName: 'a.vsd', bytes: new Uint8Array([1]) })).toThrow(/\.vsdx/)
    expect(() => readSource({ fileName: 'a.vsdx', bytes: new Uint8Array([1, 2, 3]) })).toThrow(SourceError)
  })
})
