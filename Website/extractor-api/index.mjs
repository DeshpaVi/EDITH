// Journey extractor backend: a thin Lambda in front of Amazon Bedrock. The browser never holds model
// access; it sends the source (text or an attachment) and receives structured journey JSON. The prompt and
// schema are fixed here (contract.mjs), so the endpoint cannot be used as a general model proxy.
//
// Auth: a bearer token from the ACCESS_TOKEN environment variable. The function refuses to run without one.
// Content is never logged; only sizes, status and timing.

import { timingSafeEqual } from 'node:crypto'
import { ExtractError, buildConverseInput, journeyFromResponse, parseRequest } from './converse.mjs'

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

function tokenMatches(header, expected) {
  const given = Buffer.from(String(header ?? '').replace(/^Bearer\s+/i, ''))
  const want = Buffer.from(expected)
  return given.length === want.length && timingSafeEqual(given, want)
}

function mapModelError(err, kind) {
  const name = err?.name ?? err?.__type ?? ''
  const message = String(err?.message ?? '')
  if (name.includes('Validation') && (kind === 'image' || kind === 'pdf') && /image|document|content ?block|modalit|support/i.test(message)) {
    return new ExtractError(502, 'This model cannot read images or PDFs. Upload a deck, document or text file instead, or use a model that accepts images.')
  }
  if (name.includes('Throttling')) return new ExtractError(429, 'The model is busy. Try again in a moment.')
  // AWS's own message names the role, the action and the resource (no source content), which is what tells the cause apart.
  if (name.includes('AccessDenied')) return new ExtractError(502, `The model could not be used: ${message.slice(0, 400) || 'check Bedrock model access and the ModelId.'}`)
  if (name.includes('Validation')) return new ExtractError(502, `The model rejected the request: ${String(err.message ?? '').slice(0, 300)}`)
  if (name.includes('ModelTimeout') || name.includes('Timeout')) return new ExtractError(504, 'The model took too long. Try a smaller source.')
  return new ExtractError(502, 'The model request failed.')
}

export function makeHandler(deps) {
  return async function handler(event) {
    const started = Date.now()
    const env = deps.env
    try {
      if ((event.requestContext?.http?.method ?? 'POST') !== 'POST') return json(405, { error: 'Use POST.' })
      if (!env.ACCESS_TOKEN) return json(500, { error: 'The extractor is not configured (no access token set).' })
      if (!tokenMatches((event.headers ?? {}).authorization, env.ACCESS_TOKEN)) return json(401, { error: 'Unauthorized.' })
      if (!env.MODEL_ID) return json(500, { error: 'The extractor is not configured (no model id set).' })

      let body
      try {
        const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '')
        body = JSON.parse(raw)
      } catch {
        return json(400, { error: 'The request body is not valid JSON.' })
      }
      const request = parseRequest(body)
      let maxTokens = Number(env.MAX_TOKENS) || undefined
      // Tool modes, most structured first. A validation error about tools moves to the next mode (once per mode).
      const modes = ['tool', 'auto', 'none']
      let mode = Math.max(0, modes.indexOf(env.TOOL_CHOICE))
      let tokensLowered = false
      let temperature = env.TEMPERATURE === 'off' ? null : 0
      let response
      for (;;) {
        try {
          response = await deps.converse(buildConverseInput({ modelId: env.MODEL_ID, request, maxTokens, toolChoice: modes[mode], temperature }))
          break
        } catch (err) {
          const validation = String(err?.name ?? err?.__type ?? '').includes('Validation')
          const message = String(err?.message ?? '')
          // Some models reject the temperature field (e.g. GPT-5.5): send the request again without it.
          if (validation && temperature !== null && /temperature/i.test(message)) {
            temperature = null
            continue
          }
          // A model with a smaller output limit than requested (e.g. Nova Pro): use the limit the error names, else a conservative 5,000.
          if (validation && /max(imum)?[ _]?(output[ _])?tokens|maxTokens/i.test(message) && !tokensLowered) {
            const named = Number(/(?:limit|maximum|max)[^0-9]{0,40}(\d{3,6})/i.exec(message)?.[1])
            maxTokens = Math.min(named > 0 ? named : 5000, 16000)
            tokensLowered = true
            continue
          }
          const aboutTools = validation && /tool/i.test(message)
          if (aboutTools && mode < modes.length - 1) {
            mode++
            continue
          }
          console.log(JSON.stringify({ modelError: String(err?.name ?? err?.__type ?? 'Error'), message: String(err?.message ?? '').slice(0, 400) }))
          throw mapModelError(err, request.kind)
        }
      }
      const journey = journeyFromResponse(response)
      // DEBUG_SHAPE=1: log which fields each step has and which are empty (names only, never values), to see what a model leaves out.
      if (env.DEBUG_SHAPE === '1') {
        const shape = (Array.isArray(journey.steps) ? journey.steps : []).map((st) => ({ kind: st?.kind, has: Object.keys(st ?? {}), empty: Object.entries(st ?? {}).filter(([, v]) => v === '' || (Array.isArray(v) && v.length === 0)).map(([k]) => k) }))
        console.log(JSON.stringify({ shape }))
      }
      console.log(JSON.stringify({ kind: request.kind, status: 200, ms: Date.now() - started, usage: response.usage }))
      return json(200, { journey, usage: response.usage ?? null })
    } catch (err) {
      const status = err instanceof ExtractError ? err.status : 500
      console.log(JSON.stringify({ status, ms: Date.now() - started, error: err instanceof ExtractError ? err.message : 'unexpected' }))
      return json(status, { error: err instanceof ExtractError ? err.message : 'Unexpected error.' })
    }
  }
}

/** Real dependencies, loaded lazily so tests never need the AWS SDK. The Node.js runtime bundles it. */
let client
const defaultDeps = {
  env: process.env,
  async converse(input) {
    const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime')
    client ??= new BedrockRuntimeClient({})
    return client.send(new ConverseCommand(input))
  },
}

export const handler = makeHandler(defaultDeps)
