import type { IvrModel } from '../model'
import { parseContactFlow } from './connect'
import { parseLexExport } from './lex'
import { correlate } from './correlate'

export { parseContactFlow } from './connect'
export { parseLexExport } from './lex'
export { correlate } from './correlate'
export type { ConnectParseResult } from './connect'
export type { LexParseResult } from './lex'

export interface ParseInput {
  /** Parsed contact flow JSON export. */
  contactFlow: unknown
  /** The export's file name. Names the migrated ACXD application, so it is worth passing. */
  contactFlowName?: string
  /**
   * Parsed Lex exports. A V1 export is one flat object; a V2 export is a path → JSON map
   * produced by unzipping. Unzipping is I/O and belongs to the caller.
   */
  lexExports?: Array<{ name: string; content: unknown }>
  /** Injected so the parser stays a pure function of its inputs. */
  importedAt?: string
}

/**
 * The parse layer's single entry point: source exports → canonical IvrModel.
 *
 * Pure — no I/O, no LLM, no network — so the same input always produces the same model.
 * That reproducibility is what makes the output trustworthy for a contact-center cutover.
 */
export function parseIvr({ contactFlow, contactFlowName, lexExports = [], importedAt }: ParseInput): IvrModel {
  const flow = parseContactFlow(contactFlow, contactFlowName)
  const lex = lexExports.map((e) => parseLexExport(e.content, e.name))
  return correlate(flow, lex, importedAt ?? new Date(0).toISOString())
}
