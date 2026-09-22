/**
 * Sign-in against an Amazon Cognito user pool, authorization-code + PKCE, in a
 * popup window.
 *
 * Why a popup rather than a redirect: this app runs inside the agent workspace's
 * iframe. A top-level redirect would navigate the agent away from their live
 * call, and an in-iframe redirect is refused by every identity provider worth
 * using (Cognito's Hosted UI, and any SAML IdP behind it, send
 * `X-Frame-Options: DENY`). A popup is the only flow that keeps the call on
 * screen and still lets the IdP render its own login page.
 *
 * Why the tokens live in memory only: this app's origin is shared with nothing
 * else, but an agent workstation is not a trusted device, and an access token
 * that outlives the tab is a token that can be lifted from storage later. The
 * cost is one sign-in click per app load, which is called out in
 * docs/LIMITATIONS.md.
 *
 * The client is PUBLIC — no client secret is present here or anywhere in the
 * bundle, and the Cognito app client must be created without one.
 */

import { config } from '../config/runtime'
import type { AuthProvider, AuthState } from './types'

interface Tokens {
  idToken: string
  refreshToken?: string
  /** Epoch milliseconds. */
  expiresAt: number
}

/** Renew this long before expiry, so a poll never races the clock. */
const RENEW_SKEW_MS = 60_000
const POPUP_TIMEOUT_MS = 180_000

let tokens: Tokens | null = null
let state: AuthState = 'signed-out'
let error: string | null = null
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

function setState(next: AuthState, message: string | null = null) {
  state = next
  error = message
  for (const listener of listeners) listener()
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

function tokenEndpoint(): string {
  return `https://${config.cognito.domain}/oauth2/token`
}

async function exchange(body: Record<string, string>): Promise<Tokens> {
  const response = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Cognito token endpoint returned ${response.status}. ${detail.slice(0, 200)}`)
  }
  const json = (await response.json()) as {
    id_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!json.id_token) throw new Error('Cognito returned no id_token.')
  return {
    idToken: json.id_token,
    // The API Gateway JWT authorizer is configured with this app client as its
    // audience, and the Lambda reads the agent's identity from the token's
    // claims — both of which need the ID token, not the access token.
    ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  }
}

function openPopup(url: string): Window | null {
  const width = 480
  const height = 640
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2)
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2)
  return window.open(
    url,
    'acw-handoff-signin',
    `width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`,
  )
}

interface CallbackMessage {
  type: 'acw-handoff-auth'
  code?: string
  state?: string
  error?: string
}

function awaitCallback(expectedState: string, popup: Window): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      clearInterval(closedPoll)
      clearTimeout(timeout)
    }

    const onMessage = (event: MessageEvent) => {
      // The callback page is served from this app's own origin; anything else
      // is another page on the agent's machine and is ignored outright.
      if (event.origin !== window.location.origin) return
      const data = event.data as CallbackMessage | undefined
      if (!data || data.type !== 'acw-handoff-auth') return
      cleanup()
      popup.close()
      if (data.error) return reject(new Error(data.error))
      if (data.state !== expectedState) return reject(new Error('Sign-in state did not match. Try again.'))
      if (!data.code) return reject(new Error('Sign-in returned no authorization code.'))
      resolve(data.code)
    }

    const closedPoll = setInterval(() => {
      if (popup.closed) {
        cleanup()
        reject(new Error('The sign-in window was closed before sign-in finished.'))
      }
    }, 500)

    const timeout = setTimeout(() => {
      cleanup()
      popup.close()
      reject(new Error('Sign-in timed out.'))
    }, POPUP_TIMEOUT_MS)

    window.addEventListener('message', onMessage)
  })
}

async function interactiveSignIn(): Promise<void> {
  const verifier = randomString(48)
  const challenge = await challengeFor(verifier)
  const oauthState = randomString(16)

  const url = new URL(`https://${config.cognito.domain}/oauth2/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.cognito.clientId)
  url.searchParams.set('redirect_uri', config.cognito.redirectUri)
  url.searchParams.set('scope', config.cognito.scopes)
  url.searchParams.set('state', oauthState)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')

  const popup = openPopup(url.toString())
  if (!popup) {
    throw new Error('The browser blocked the sign-in window. Allow pop-ups for this page and try again.')
  }

  const code = await awaitCallback(oauthState, popup)
  tokens = await exchange({
    grant_type: 'authorization_code',
    client_id: config.cognito.clientId,
    code,
    redirect_uri: config.cognito.redirectUri,
    code_verifier: verifier,
  })
}

async function renew(): Promise<boolean> {
  const refreshToken = tokens?.refreshToken
  if (!refreshToken) return false
  try {
    const renewed = await exchange({
      grant_type: 'refresh_token',
      client_id: config.cognito.clientId,
      refresh_token: refreshToken,
    })
    // A refresh response omits the refresh token; keep the one we hold.
    tokens = { ...renewed, refreshToken }
    return true
  } catch {
    tokens = null
    return false
  }
}

export const cognitoAuth: AuthProvider = {
  kind: 'cognito',

  getState: () => state,
  getError: () => error,

  async getToken() {
    if (!tokens) return null
    if (tokens.expiresAt - RENEW_SKEW_MS > Date.now()) return tokens.idToken
    const renewed = await renew()
    if (!renewed) {
      setState('signed-out')
      return null
    }
    return tokens?.idToken ?? null
  },

  async signIn() {
    if (inFlight) return inFlight
    setState('signing-in')
    inFlight = interactiveSignIn()
      .then(() => setState('signed-in'))
      .catch((cause: unknown) => {
        tokens = null
        setState('error', cause instanceof Error ? cause.message : 'Sign-in failed.')
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  },

  signOut() {
    tokens = null
    setState('signed-out')
  },

  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
