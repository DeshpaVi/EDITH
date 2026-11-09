/**
 * Deterministic UUID-shaped ids. The same seed always gives the same id, so regenerating a flow
 * produces identical JSON (reproducible output, and stable node ids for idempotent updates).
 * Not cryptographic and not meant to be: they only need to be unique within a flow.
 */
export function stableId(...parts: string[]): string {
  const input = parts.join('\u0000')
  const hash = (seed: number): string => {
    let x = seed >>> 0
    for (let i = 0; i < input.length; i++) {
      x ^= input.charCodeAt(i)
      x = Math.imul(x, 16777619) >>> 0
    }
    return x.toString(16).padStart(8, '0')
  }
  const hex = hash(2166136261) + hash(0x9e3779b9) + hash(0x85ebca6b) + hash(0xc2b2ae35)
  // Shape it as a v4 UUID (version nibble 4, variant 8..b) so it looks like the ids the console writes.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[parseInt(hex[16], 16) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
