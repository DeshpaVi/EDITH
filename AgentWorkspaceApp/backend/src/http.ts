import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { settings } from './config'

export type ErrorCode =
  | 'not-enabled'
  | 'not-found'
  | 'forbidden'
  | 'throttled'
  | 'unsupported-channel'
  | 'unauthorized'
  | 'bad-request'
  | 'upstream-error'

const STATUS: Record<ErrorCode, number> = {
  'bad-request': 400,
  unauthorized: 401,
  forbidden: 403,
  'not-found': 404,
  'not-enabled': 409,
  'unsupported-channel': 415,
  throttled: 429,
  'upstream-error': 502,
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    // Exactly one origin, echoed from configuration rather than from the
    // request. A reflected `Origin` header is not an allow-list.
    'Access-Control-Allow-Origin': settings.allowedOrigin,
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    // Transcript content is per-agent and per-second. Nothing may cache it.
    'Cache-Control': 'no-store',
  }
}

export function ok(body: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode: 200, headers: headers(), body: JSON.stringify(body) }
}

export function fail(code: ErrorCode, message: string): APIGatewayProxyStructuredResultV2 {
  return { statusCode: STATUS[code], headers: headers(), body: JSON.stringify({ code, message }) }
}
