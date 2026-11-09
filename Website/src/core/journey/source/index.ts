import { strFromU8 } from 'fflate'
import { readDocx } from './docx'
import { readPptx, describeDeck } from './pptx'
import type { Deck } from './pptx'

export { readPptx, describeDeck } from './pptx'
export type { Deck, DeckSlide, DeckShape, DeckConnector } from './pptx'
export { readDocx } from './docx'
export { parseXml } from './xml'

/** The largest source the extractor accepts. The backend takes about 3.3 MB of base64, so stay below that. */
export const MAX_SOURCE_BYTES = 3 * 1024 * 1024

export type SourceInput =
  | { kind: 'deck'; fileName: string; text: string; deck: Deck }
  | { kind: 'document' | 'text'; fileName: string; text: string }
  | { kind: 'image'; fileName: string; mimeType: string; bytes: Uint8Array }
  | { kind: 'pdf'; fileName: string; bytes: Uint8Array }

/** A problem with the uploaded file that the consultant can act on. */
export class SourceError extends Error {}

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'json', 'text']

export const SUPPORTED_EXTENSIONS = ['pptx', 'docx', 'pdf', ...Object.keys(IMAGE_TYPES), ...TEXT_EXTENSIONS]

/**
 * Reads an uploaded file into something the extractor understands. Decks become a shape-and-arrow graph
 * (deterministic); documents and text become text; images and PDFs stay binary for a vision model.
 */
export function readSource(file: { fileName: string; bytes: Uint8Array }): SourceInput {
  const { fileName, bytes } = file
  const ext = fileName.includes('.') ? (fileName.split('.').pop() as string).toLowerCase() : ''
  if (bytes.length === 0) throw new SourceError('The file is empty.')
  if (bytes.length > MAX_SOURCE_BYTES) throw new SourceError(`The file is larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB. Export a smaller version (a single slide or a PDF of the diagram).`)

  if (ext === 'pptx') {
    try {
      const deck = readPptx(bytes)
      return { kind: 'deck', fileName, text: describeDeck(deck), deck }
    } catch (err) {
      throw new SourceError(`Could not read this deck: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }
  if (ext === 'docx') {
    try {
      const text = readDocx(bytes)
      if (text.trim() === '') throw new Error('it has no text')
      return { kind: 'document', fileName, text }
    } catch (err) {
      throw new SourceError(`Could not read this document: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }
  if (ext === 'pdf') return { kind: 'pdf', fileName, bytes }
  if (ext in IMAGE_TYPES) return { kind: 'image', fileName, mimeType: IMAGE_TYPES[ext], bytes }
  if (TEXT_EXTENSIONS.includes(ext)) {
    const text = strFromU8(bytes)
    if (text.trim() === '') throw new SourceError('The file has no text.')
    return { kind: 'text', fileName, text }
  }
  if (ext === 'ppt' || ext === 'doc') throw new SourceError(`Old ${ext.toUpperCase()} files are not supported. Save it as .${ext}x and upload that.`)
  if (ext === 'vsdx' || ext === 'vsd') throw new SourceError('Visio files are not read yet. Export the diagram as a PDF or an image.')
  throw new SourceError(`This file type is not supported. Use one of: ${SUPPORTED_EXTENSIONS.join(', ')}.`)
}

/** The text a model's wording can be checked against; none for images and PDFs. */
export function sourceText(source: SourceInput): string | undefined {
  if (source.kind === 'deck') return source.deck.slides.flatMap((s) => s.shapes.map((sh) => sh.text)).join('\n')
  if (source.kind === 'document' || source.kind === 'text') return source.text
  return undefined
}
