/**
 * How the browser gets transcript segments.
 *
 * The browser cannot call Contact Lens directly: the real-time analysis APIs
 * are SigV4-signed AWS APIs, and signing them in the page would mean shipping
 * AWS credentials to every agent's laptop. So the only path is a backend that
 * holds an execution role, authenticates the agent, checks that the agent is
 * actually on the contact they are asking about, and proxies the call. This
 * module is the client half of that.
 */

import { config } from '../config/runtime'
import type { AuthProvider } from '../auth'
import type { TranscriptError, TranscriptPage } from './types'

/**
 * Only the contact the agent is currently on is sent. The backend resolves the
 * channel and — for a transferred voice call — the initial contact id that
 * Contact Lens keys analysis on. Letting the browser nominate either would let
 * a signed-in agent ask for a contact they are not on.
 */
export interface TranscriptRequest {
  contactId: string
  nextToken?: string
  signal?: AbortSignal
}

export type TranscriptResult =
  | { ok: true; page: TranscriptPage }
  | { ok: false; error: TranscriptError }

export interface TranscriptClient {
  readonly kind: 'api' | 'mock'
  fetchPage(request: TranscriptRequest): Promise<TranscriptResult>
}

const STATUS_TO_CODE: Record<number, TranscriptError['code']> = {
  400: 'bad-request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not-found',
  409: 'not-enabled',
  415: 'unsupported-channel',
  429: 'throttled',
}

export function createApiTranscriptClient(auth: AuthProvider): TranscriptClient {
  return {
    kind: 'api',

    async fetchPage({ contactId, nextToken, signal }) {
      const token = await auth.getToken()
      if (config.auth === 'cognito' && !token) {
        return {
          ok: false,
          error: { code: 'unauthorized', message: 'Sign in to load the live transcript.' },
        }
      }

      const url = new URL(`${config.apiBaseUrl}/transcript`)
      url.searchParams.set('contactId', contactId)
      if (nextToken) url.searchParams.set('nextToken', nextToken)

      let response: Response
      try {
        const init: RequestInit = {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
        if (signal) init.signal = signal
        response = await fetch(url.toString(), init)
      } catch (cause) {
        return {
          ok: false,
          error: {
            code: 'upstream-error',
            message: cause instanceof DOMException && cause.name === 'AbortError'
              ? 'Request cancelled.'
              : 'Could not reach the transcript service.',
          },
        }
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        return {
          ok: false,
          error: {
            code: STATUS_TO_CODE[response.status] ?? 'upstream-error',
            message: body?.message ?? `Transcript service returned ${response.status}.`,
          },
        }
      }

      return { ok: true, page: (await response.json()) as TranscriptPage }
    },
  }
}
