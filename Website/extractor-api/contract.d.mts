export const TOOL_NAME: string
export const EXTRACTION_RULES: string[]
export const JOURNEY_JSON_SCHEMA: Record<string, unknown>
export function buildSystemPrompt(): string
export function buildUserText(input: {
  fileName: string
  kind: string
  text?: string
  notes?: string
  feedback?: Array<{ path: string; message: string }>
}): string
export const FIELDS_BY_KIND: string[]
