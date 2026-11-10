// Pure helpers: validate a request, build the Amazon Bedrock Converse input, read the answer.
// No AWS SDK here, so it is testable without credentials.

import { JOURNEY_JSON_SCHEMA, TOOL_NAME, buildSystemPrompt, buildUserText } from './contract.mjs'

export const LIMITS = { maxTextChars: 400_000, maxBase64Chars: 4_500_000, maxNotesChars: 8_000, maxFeedback: 40 }

const TEXT_KINDS = ['deck', 'diagram', 'document', 'text']
const BINARY_KINDS = ['image', 'pdf']
const IMAGE_FORMATS = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/gif': 'gif', 'image/webp': 'webp' }

export class ExtractError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Validates the browser's request body. Throws ExtractError(400 or 413) with a message safe to show. */
export function parseRequest(body) {
  if (!isObj(body)) throw new ExtractError(400, 'The request body must be a JSON object.')
  const { fileName, kind, text, attachment, notes, feedback } = body
  if (typeof fileName !== 'string' || fileName.trim() === '' || fileName.length > 200) throw new ExtractError(400, 'fileName is required (up to 200 characters).')
  if (![...TEXT_KINDS, ...BINARY_KINDS].includes(kind)) throw new ExtractError(400, `kind must be one of: ${[...TEXT_KINDS, ...BINARY_KINDS].join(', ')}.`)
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > LIMITS.maxNotesChars)) throw new ExtractError(400, `notes must be text up to ${LIMITS.maxNotesChars} characters.`)

  if (TEXT_KINDS.includes(kind)) {
    if (typeof text !== 'string' || text.trim() === '') throw new ExtractError(400, `A ${kind} needs its text.`)
    if (text.length > LIMITS.maxTextChars) throw new ExtractError(413, 'The source text is too large for one request.')
  } else {
    if (!isObj(attachment) || typeof attachment.base64 !== 'string' || typeof attachment.mimeType !== 'string') throw new ExtractError(400, `A ${kind} needs an attachment with mimeType and base64.`)
    if (attachment.base64.length > LIMITS.maxBase64Chars) throw new ExtractError(413, 'The attachment is too large for one request.')
    const ok = kind === 'pdf' ? attachment.mimeType === 'application/pdf' : attachment.mimeType in IMAGE_FORMATS
    if (!ok) throw new ExtractError(400, kind === 'pdf' ? 'A pdf must have mimeType application/pdf.' : `An image must be one of: ${Object.keys(IMAGE_FORMATS).join(', ')}.`)
  }

  let cleanFeedback
  if (feedback !== undefined) {
    if (!Array.isArray(feedback) || feedback.length > LIMITS.maxFeedback || feedback.some((f) => !isObj(f) || typeof f.path !== 'string' || typeof f.message !== 'string')) {
      throw new ExtractError(400, 'feedback must be a list of { path, message } (at most 40).')
    }
    cleanFeedback = feedback.map((f) => ({ path: f.path.slice(0, 200), message: f.message.slice(0, 400) }))
  }
  return { fileName: fileName.trim(), kind, text, attachment, notes, feedback: cleanFeedback }
}

/** Bedrock document names allow only letters, digits, single spaces, hyphens, parentheses and brackets. */
export function documentName(fileName) {
  const base = fileName.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9\-()[\] ]+/g, '-').replace(/ {2,}/g, ' ').replace(/^[-\s]+|[-\s]+$/g, '')
  return /[A-Za-z0-9]/.test(base) ? base.slice(0, 60) : 'journey'
}

/**
 * The Converse request. `toolChoice`:
 * - 'tool' (default): a forced tool call, so the answer is structured JSON (Claude, Nova).
 * - 'auto': the tool is offered and the prompt asks for it, for models that refuse a forced call.
 * - 'none': no tool at all; the prompt carries the schema and asks for one JSON object, for models without tool use (e.g. gpt-oss, whose
 *   Bedrock page does not document tools). The answer is validated downstream in every mode. Temperature 0 for repeatability, or `temperature: null` to omit it for models that reject the field (e.g. GPT-5.5).
 */
export function buildConverseInput({ modelId, request, maxTokens = 16000, toolChoice = 'tool', temperature = 0 }) {
  const content = []
  if (request.kind === 'pdf') {
    content.push({ document: { format: 'pdf', name: documentName(request.fileName), source: { bytes: Buffer.from(request.attachment.base64, 'base64') } } })
  } else if (request.kind === 'image') {
    content.push({ image: { format: IMAGE_FORMATS[request.attachment.mimeType], source: { bytes: Buffer.from(request.attachment.base64, 'base64') } } })
  }
  content.push({ text: buildUserText({ fileName: request.fileName, kind: request.kind, text: request.text, notes: request.notes, feedback: request.feedback }) })
  const system =
    toolChoice === 'tool'
      ? buildSystemPrompt()
      : toolChoice === 'auto'
        ? `${buildSystemPrompt()}\n\nCall the tool ${TOOL_NAME} exactly once with the complete journey. Do not answer in plain text.`
        : `${buildSystemPrompt()}\n\nReply with exactly one JSON object and nothing else, with no code fence, that matches this JSON Schema:\n${JSON.stringify(JOURNEY_JSON_SCHEMA)}`
  const input = { modelId, system: [{ text: system }], messages: [{ role: 'user', content }], inferenceConfig: { maxTokens, ...(temperature === null ? {} : { temperature }) } }
  if (toolChoice !== 'none') {
    input.toolConfig = {
      tools: [{ toolSpec: { name: TOOL_NAME, description: 'Submit the structured customer journey read from the source.', inputSchema: { json: JOURNEY_JSON_SCHEMA } } }],
      ...(toolChoice === 'tool' ? { toolChoice: { tool: { name: TOOL_NAME } } } : {}),
    }
  }
  return input
}

/** Reads the journey out of a Converse response, or throws ExtractError(502) with a safe message. */
export function journeyFromResponse(response) {
  if (response?.stopReason === 'max_tokens') throw new ExtractError(502, 'The journey was too large for one answer (output limit reached). Try a smaller source or split it.')
  const blocks = response?.output?.message?.content ?? []
  const use = blocks.find((b) => b?.toolUse?.name === TOOL_NAME)?.toolUse
  if (use && isObj(use.input)) return use.input
  // Some models answer in text even when given a tool: accept a JSON object in the text (the caller validates it like any other answer).
  const fromText = jsonFromText(blocks.filter((b) => typeof b?.text === 'string').map((b) => b.text).join('\n'))
  if (fromText) return fromText
  throw new ExtractError(502, 'The model did not return a journey.')
}

/** The first JSON object in a model's text, with or without a code fence; null if there is none. */
export function jsonFromText(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(candidate.slice(start, end + 1))
    return isObj(value) ? value : null
  } catch {
    return null
  }
}
