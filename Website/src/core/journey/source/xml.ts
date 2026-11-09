/**
 * A minimal XML reader, enough for Office documents (pptx, docx). No dependencies, so it runs in the browser
 * and in tests alike. Handles elements, attributes, text, entities, CDATA, comments and processing
 * instructions. It does not validate and does not resolve namespaces: tag names keep their prefix ("p:sp").
 */
export interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
  /** Text directly inside this element (concatenated), entities decoded. */
  text: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e] ?? m
  })
}

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { tag: '#document', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) {
      top.text += m[1]
    } else if (m[3] !== undefined) {
      const [, , closing, tag, attrText, selfClosing] = m
      if (closing) {
        if (stack.length > 1) stack.pop()
        continue
      }
      const attrs: Record<string, string> = {}
      const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
      let a: RegExpExecArray | null
      while ((a = attrRe.exec(attrText)) !== null) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '')
      const node: XmlNode = { tag, attrs, children: [], text: '' }
      top.children.push(node)
      if (!selfClosing) stack.push(node)
    } else if (m[6] !== undefined) {
      top.text += decodeEntities(m[6])
    }
  }
  return root.children[0] ?? root
}

/** Depth-first search for the first descendant (or self) matching `tag`. */
export function find(node: XmlNode, tag: string): XmlNode | undefined {
  if (node.tag === tag) return node
  for (const c of node.children) {
    const hit = find(c, tag)
    if (hit) return hit
  }
  return undefined
}

/** All descendants (and self) with the given tag, in document order. */
export function findAll(node: XmlNode, tag: string, out: XmlNode[] = []): XmlNode[] {
  if (node.tag === tag) out.push(node)
  for (const c of node.children) findAll(c, tag, out)
  return out
}

export const child = (node: XmlNode, tag: string): XmlNode | undefined => node.children.find((c) => c.tag === tag)
