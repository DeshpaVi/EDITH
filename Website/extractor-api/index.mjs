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

function mapModelError(err) {
  const name = err?.name ?? err?.__type ?? ''
  if (name.includes('Throttling')) return new ExtractError(429, 'The model is busy. Try again in a moment.')
  if (name.includes('AccessDenied')) return new ExtractError(502, 'The model could not be used: check Bedrock model access and the ModelId.')
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
      const input = buildConverseInput({ modelId: env.MODEL_ID, request, maxTokens: Number(env.MAX_TOKENS) || undefined })

      let response
      try {
        response = await deps.converse(input)
      } catch (err) {
        throw mapModelError(err)
      }
      const journey = journeyFromResponse(response)
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
