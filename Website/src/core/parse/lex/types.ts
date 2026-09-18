/**
 * Amazon Lex export shapes.
 *
 * TODO(source-schema): written from Lex documentation, not from a confirmed export.
 * Two formats exist in the wild and both are supported:
 *
 *   V2 — a ZIP. Unzipped by the caller into a path → parsed-JSON map:
 *        Manifest.json
 *        <Bot>/Bot.json
 *        <Bot>/BotLocales/<locale>/BotLocale.json
 *        <Bot>/BotLocales/<locale>/Intents/<Name>/Intent.json
 *        <Bot>/BotLocales/<locale>/Intents/<Name>/Slots/<Name>/Slot.json
 *        <Bot>/BotLocales/<locale>/SlotTypes/<Name>/SlotType.json
 *
 *   V1 — a single flat JSON with `resource.intents[]` and `resource.slotTypes[]`.
 *
 * Unzipping is I/O and stays in the UI layer; this parser is pure.
 */

/** Path → parsed JSON, as produced by unzipping a Lex V2 export. */
export type LexV2Files = Record<string, unknown>

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

export function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * Lex V2 buries prompt text several levels deep and the wrapper differs per message
 * type (plain text, SSML, custom payload). Pull the first usable string.
 */
export function firstMessage(spec: unknown): string | undefined {
  if (!isRecord(spec)) return undefined
  for (const group of arr(spec.messageGroupsList ?? spec.messageGroups)) {
    if (!isRecord(group)) continue
    const msg = isRecord(group.message) ? group.message : undefined
    if (!msg) continue
    const plain = isRecord(msg.plainTextMessage) ? text(msg.plainTextMessage.value) : undefined
    const ssml = isRecord(msg.ssmlMessage) ? text(msg.ssmlMessage.value) : undefined
    const found = plain ?? ssml ?? text(msg.content) ?? text(msg.value)
    if (found) return found
  }
  // V1 shape: { messages: [{ content }] }
  for (const m of arr(spec.messages)) {
    if (isRecord(m)) {
      const found = text(m.content) ?? text(m.value)
      if (found) return found
    }
  }
  return undefined
}

/** `AMAZON.*` slot types are Lex built-ins; ACXD's equivalents are unpublished. */
export function isBuiltInSlotType(name: string): boolean {
  return name.startsWith('AMAZON.')
}
