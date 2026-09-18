import { unzipSync, strFromU8 } from 'fflate'
import { parseIvr, type ParseInput } from '../core/parse'
import { designPlan } from '../core/design'
import type { AcxdPlan, IvrModel } from '../core/model'

/**
 * Browser-side adapter: File objects → parsed JSON → IvrModel → AcxdPlan.
 *
 * All the I/O lives here. `parseIvr` and `designPlan` stay pure functions of their inputs,
 * which is what keeps them testable against fixtures — so unzipping and file reading are
 * deliberately on this side of the boundary.
 */

export const MAX_FILE_BYTES = 50 * 1024 * 1024

export type LoadedKind = 'contact-flow' | 'lex-bot' | 'unrecognized'

export interface LoadedFile {
  name: string
  kind: LoadedKind
  content: unknown
  error?: string
}

export interface MigrationResult {
  model: IvrModel
  plan: AcxdPlan
  files: LoadedFile[]
}

/** Lex V2 exports are ZIPs; the parser wants a path → parsed-JSON map. */
function unzipToPathMap(bytes: Uint8Array): Record<string, unknown> {
  const files = unzipSync(bytes)
  const out: Record<string, unknown> = {}
  for (const [path, data] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith('.json') || data.length === 0) continue
    try {
      out[path] = JSON.parse(strFromU8(data))
    } catch {
      // A non-JSON file inside the archive is not fatal — the parser reports what it
      // could not find rather than failing the whole upload.
    }
  }
  return out
}

/** Classify by shape, using the same signals the parsers themselves key on. */
function classify(content: unknown): LoadedKind {
  if (!content || typeof content !== 'object') return 'unrecognized'
  const rec = content as Record<string, unknown>
  if (Array.isArray(rec.Actions)) return 'contact-flow'
  if (rec.resource && typeof rec.resource === 'object') return 'lex-bot'
  if (Object.keys(rec).some((k) => k.includes('/') || k === 'Manifest.json')) return 'lex-bot'
  return 'unrecognized'
}

export async function loadFile(file: File): Promise<LoadedFile> {
  const base: LoadedFile = { name: file.name, kind: 'unrecognized', content: null }

  if (file.size > MAX_FILE_BYTES) {
    return { ...base, error: `${file.name} is larger than the 50 MB limit.` }
  }

  const isZip = file.name.toLowerCase().endsWith('.zip')
  try {
    const content = isZip
      ? unzipToPathMap(new Uint8Array(await file.arrayBuffer()))
      : JSON.parse(await file.text())
    const kind = classify(content)
    return kind === 'unrecognized'
      ? { name: file.name, kind, content, error: `${file.name} is not a Connect contact flow export or a Lex bot export.` }
      : { name: file.name, kind, content }
  } catch (err) {
    return {
      ...base,
      error: isZip
        ? `${file.name} could not be unzipped.`
        : `${file.name} is not valid JSON${err instanceof Error ? ` (${err.message})` : ''}.`,
    }
  }
}

export async function loadFiles(files: File[]): Promise<LoadedFile[]> {
  return Promise.all(files.map(loadFile))
}

/**
 * Run the migration. Returns null until a contact flow is present — the flow is the
 * spine; a bot export on its own has nothing to attach to.
 */
export function runMigration(files: LoadedFile[]): MigrationResult | null {
  const flow = files.find((f) => f.kind === 'contact-flow')
  if (!flow) return null

  const input: ParseInput = {
    contactFlow: flow.content,
    lexExports: files
      .filter((f) => f.kind === 'lex-bot')
      .map((f) => ({ name: f.name, content: f.content })),
    importedAt: new Date().toISOString(),
  }

  const model = parseIvr(input)
  return { model, plan: designPlan(model), files }
}
