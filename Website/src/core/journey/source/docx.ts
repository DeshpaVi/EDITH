import { strFromU8, unzipSync } from 'fflate'
import { findAll, parseXml } from './xml'

/** Plain text of a .docx (paragraphs in document order, table cells included), one paragraph per line. */
export function readDocx(bytes: Uint8Array): string {
  const part = unzipSync(bytes)['word/document.xml']
  if (!part) throw new Error('This file has no document body (is it a .docx?)')
  const tree = parseXml(strFromU8(part))
  const lines: string[] = []
  for (const p of findAll(tree, 'w:p')) {
    let line = ''
    const walk = (n: { tag: string; text: string; children: unknown[] }): void => {
      if (n.tag === 'w:t') line += n.text
      else if (n.tag === 'w:tab') line += '\t'
      else if (n.tag === 'w:br') line += '\n'
      for (const c of n.children as Array<{ tag: string; text: string; children: unknown[] }>) walk(c)
    }
    walk(p)
    if (line.trim() !== '') lines.push(line)
  }
  return lines.join('\n')
}
