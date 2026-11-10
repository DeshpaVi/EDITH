import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { parseXml } from './xml'
import { readPptx, describeDeck } from './pptx'
import { MAX_SOURCE_BYTES, SourceError, readSource, sourceText } from './index'

const deckBytes = () => new Uint8Array(readFileSync(join(__dirname, '../fixtures/census-cqa-call-flow.pptx')))

describe('xml reader', () => {
  it('reads nested elements, attributes, entities, CDATA and self-closing tags', () => {
    const n = parseXml('<?xml version="1.0"?><!-- c --><a x="1" y=\'2\'><b/><c>Tom &amp; Jerry &#8217;<![CDATA[<raw>]]></c></a>')
    expect(n.tag).toBe('a')
    expect(n.attrs).toEqual({ x: '1', y: '2' })
    expect(n.children.map((c) => c.tag)).toEqual(['b', 'c'])
    expect(n.children[1].text).toBe('Tom & Jerry ’<raw>')
  })
})

describe('reading the Census call-flow deck', () => {
  const deck = readPptx(deckBytes())
  const slide = deck.slides[0]
  const shape = (id: string) => slide.shapes.find((s) => s.id === id)!

  it('finds both slides, in order', () => {
    expect(deck.slides.map((s) => s.index)).toEqual([1, 2])
  })

  it('reads shape text with its paragraphs', () => {
    expect(shape('25').text).toBe('Main Greeting: Thank you for calling the 2030 Census Questionnaire Assistance Center.')
    expect(shape('48').text.replace(/\s+/g, ' ').trim()).toBe('Detect Spanish speaker?')
  })

  it('reads every arrow with its start and end shape', () => {
    expect(slide.connectors).toHaveLength(22)
    const edge = (from: string, to: string) => slide.connectors.some((c) => c.fromId === from && c.toId === to)
    expect(edge('4', '25')).toBe(true) // Incoming Call -> Main Greeting
    expect(edge('25', '54')).toBe(true) // Main Greeting -> How can I help you?
    expect(edge('81', '245')).toBe(true) // Anything Else -> Closing
    expect(edge('245', '239')).toBe(true) // Closing -> Disconnect
  })

  it('gives the decision "Authentication required?" its two branches', () => {
    const out = slide.connectors.filter((c) => c.fromId === '67').map((c) => c.toId).sort()
    expect(out).toEqual(['202', '69']) // FAQ self-service, Authentication
  })

  it('reports arrows with no attached target and guesses where they point', () => {
    const dangling = slide.connectors.filter((c) => !c.toId)
    expect(dangling.map((c) => c.id).sort()).toEqual(['212', '41'])
    expect(slide.connectors.find((c) => c.id === '41')!.guessedTarget?.shapeId).toBe('49') // Set es_US
    expect(slide.connectors.find((c) => c.id === '212')!.guessedTarget?.shapeId).toBe('81') // Anything Else
  })

  it('attaches the Y and N branch labels to the arrows that leave the decisions', () => {
    const nearest = (labelId: string) => slide.labels.find((l) => l.shapeId === labelId)!.nearest[0]
    expect(nearest('148')).toMatchObject({ connectorId: '144', fromId: '67' }) // Y -> Authentication
    expect(nearest('209')).toMatchObject({ connectorId: '138', fromId: '67' }) // N -> FAQ
    expect(nearest('253')).toMatchObject({ connectorId: '215', fromId: '81' }) // Y -> loop back
    expect(nearest('251')).toMatchObject({ connectorId: '240', fromId: '81' }) // N -> Closing
  })

  it('maps shape colours to the legend and flags the one it cannot tell apart', () => {
    expect(slide.legend.accent2).toBe('Lambda')
    expect(slide.legend.accent4).toBe('Separate Flow')
    expect(slide.legend.accent5).toContain(' OR ') // Announcements and Prompts / Input share a colour key
  })

  it('describes the deck for a model: shapes, arrows, labels and the unattached arrows', () => {
    const text = describeDeck(deck)
    expect(text).toContain('=== SLIDE 1 ===')
    expect(text).toContain('[4] Incoming Call  -->  [25] Main Greeting')
    expect(text).toContain('END NOT ATTACHED')
    expect(text).toContain('HEURISTIC')
    expect(text).toContain('Alternate Path 4: Customer calls, speaks French')
  })

  it('leaves the Legend and its sample shapes out of the shape list, so a model cannot turn them into steps', () => {
    const text = describeDeck(deck)
    const shapes = text.slice(text.indexOf('Shapes ('), text.indexOf('Arrows'))
    expect(text).toContain('Legend (shape colour = meaning):') // the colour meanings are still given
    expect(shapes).not.toMatch(/\[19\] /) // the Legend box
    for (const sample of ['Settings', 'Announcements', 'Lambda', 'Separate Flow', 'Prompts / Input']) expect(shapes).not.toMatch(new RegExp(`\\n {6}${sample}\\n`))
    expect(shapes).toContain('Main Greeting') // real steps stay
    expect(shapes).toContain('Set en_US') // so do settings steps that are part of the flow
  })

  it('keeps the full wording of every shape in the description (nothing a model must copy is clipped)', () => {
    const text = describeDeck(deck)
    expect(text).toContain('To proceed, we need to verify your identity, can you please provide your Census ID and either your home zip code or the last four digits of your SSN?')
  })

  it('rejects a file that is not a deck', () => {
    expect(() => readPptx(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/no slides/)
  })
})

describe('readSource', () => {
  const bytes = (s: string) => strToU8(s)
  const docx = (body: string) =>
    zipSync({ 'word/document.xml': strToU8(`<w:document><w:body>${body}</w:body></w:document>`) })

  it('reads a deck into text plus its graph', () => {
    const s = readSource({ fileName: 'flow.PPTX', bytes: deckBytes() })
    expect(s.kind).toBe('deck')
    expect(s.kind === 'deck' && s.deck.slides).toHaveLength(2)
  })

  it('reads a docx paragraph by paragraph, tables included', () => {
    const s = readSource({
      fileName: 'a.docx',
      bytes: docx('<w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>'),
    })
    expect(s).toMatchObject({ kind: 'document', text: 'Hello\nCell' })
  })

  it('reads text files and keeps images and PDFs as bytes', () => {
    expect(readSource({ fileName: 'n.md', bytes: bytes('# Flow') })).toMatchObject({ kind: 'text', text: '# Flow' })
    expect(readSource({ fileName: 'd.png', bytes: bytes('PNG') })).toMatchObject({ kind: 'image', mimeType: 'image/png' })
    expect(readSource({ fileName: 'd.JPG', bytes: bytes('JPG') })).toMatchObject({ kind: 'image', mimeType: 'image/jpeg' })
    expect(readSource({ fileName: 'd.pdf', bytes: bytes('%PDF') }).kind).toBe('pdf')
  })

  it('explains what to do with files it cannot read', () => {
    const msg = (name: string, b = bytes('x')) => {
      try {
        readSource({ fileName: name, bytes: b })
      } catch (e) {
        expect(e).toBeInstanceOf(SourceError)
        return (e as Error).message
      }
      return ''
    }
    expect(msg('a.ppt')).toContain('.pptx')
    expect(msg('a.vsd')).toContain('.vsdx')
    expect(msg('a.vsdx', bytes('not a zip at all'))).toContain('Could not read this Visio drawing')
    expect(msg('a.exe')).toContain('not supported')
    expect(msg('a.txt', new Uint8Array())).toContain('empty')
    expect(msg('a.txt', new Uint8Array(MAX_SOURCE_BYTES + 1))).toContain('MB')
    expect(msg('a.pptx', bytes('not a zip at all'))).toContain('Could not read this deck')
  })

  it('offers text for the wording check only when the source has text', () => {
    expect(sourceText(readSource({ fileName: 'f.pptx', bytes: deckBytes() }))).toContain('Closing: Thank you for calling, goodbye.')
    expect(sourceText(readSource({ fileName: 'a.png', bytes: bytes('P') }))).toBeUndefined()
    expect(sourceText(readSource({ fileName: 'a.pdf', bytes: bytes('P') }))).toBeUndefined()
  })
})
