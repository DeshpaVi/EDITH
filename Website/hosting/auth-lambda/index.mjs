// Sign-in endpoints behind CloudFront at /auth/*: Cognito Hosted UI with the authorization-code flow and PKCE.
//   GET /auth/login       starts the flow (sets a short-lived cookie with state + PKCE verifier, redirects to Cognito)
//   GET /auth/callback    checks state, swaps the code for tokens, issues the signed session cookie, redirects to /
//   GET /auth/logout      clears the session and signs out of Cognito
//   GET /auth/signed-out  a small "signed out" page
// Cognito ids come from an SSM parameter (so the template has no circular reference); the signing key from the environment.
// Tokens are never stored or logged: only the Cognito user id (sub) goes into the session cookie.

import { createHash, createHmac, randomBytes } from 'node:crypto'

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const cookie = (name, value, { path = '/', maxAge }) => `${name}=${value}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
const redirect = (location, cookies = []) => ({ statusCode: 302, headers: { location, 'cache-control': 'no-store' }, cookies, body: '' })
const page = (status, html) => ({ statusCode: status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: html })

export function sessionCookieValue(key, sub, exp) {
  return `${exp}.${sub}.${createHmac('sha256', key).update(`${exp}.${sub}`).digest('hex')}`
}

/** Reads the claims of an id token received directly from Cognito's token endpoint over TLS, and sanity-checks them. */
export function claimsOf(idToken, cfg, nowSec) {
  const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1] ?? '', 'base64url').toString('utf8'))
  const iss = `https://cognito-idp.${cfg.region}.amazonaws.com/${cfg.userPoolId}`
  if (payload.iss !== iss || payload.aud !== cfg.clientId || payload.token_use !== 'id' || !(payload.exp > nowSec) || typeof payload.sub !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(payload.sub)) {
    throw new Error('The sign-in response was not for this application.')
  }
  return payload
}

export function makeHandler(deps) {
  let cached
  const config = async () => (cached ??= JSON.parse(await deps.readConfig()))

  return async (event) => {
    const path = event.rawPath ?? '/'
    const cfg = await config()
    const site = cfg.siteUrl.replace(/\/$/, '')
    const hosted = `https://${cfg.domain}`
    const redirectUri = `${site}/auth/callback`
    const cookies = Object.fromEntries((event.cookies ?? []).map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]))

    if (path === '/auth/login') {
      const state = randomBytes(16).toString('hex')
      const verifier = b64url(randomBytes(32))
      const q = new URLSearchParams({
        response_type: 'code', client_id: cfg.clientId, redirect_uri: redirectUri, scope: 'openid email', state,
        code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      })
      return redirect(`${hosted}/oauth2/authorize?${q}`, [cookie('jf_oauth', `${state}.${verifier}`, { path: '/auth', maxAge: 600 })])
    }

    if (path === '/auth/callback') {
      const params = event.queryStringParameters ?? {}
      const [state, verifier] = String(cookies.jf_oauth ?? '').split('.')
      const clearOauth = cookie('jf_oauth', '', { path: '/auth', maxAge: 0 })
      if (params.error || !params.code || !state || !verifier || params.state !== state) {
        return page(400, `<p>Sign-in could not be completed. <a href="/auth/login">Try again</a>.</p>`)
      }
      const res = await deps.fetch(`${hosted}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: cfg.clientId, code: params.code, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
      })
      if (!res.ok) return page(502, `<p>Sign-in failed. <a href="/auth/login">Try again</a>.</p>`)
      const tokens = await res.json()
      const now = Math.floor(deps.now() / 1000)
      let claims
      try {
        claims = claimsOf(tokens.id_token, cfg, now)
      } catch {
        return page(502, `<p>Sign-in failed. <a href="/auth/login">Try again</a>.</p>`)
      }
      const maxAge = Math.round(Number(deps.sessionHours) * 3600)
      const session = sessionCookieValue(deps.sessionKey, claims.sub, now + maxAge)
      return redirect('/', [cookie('jf_session', session, { maxAge }), clearOauth])
    }

    if (path === '/auth/logout') {
      const q = new URLSearchParams({ client_id: cfg.clientId, logout_uri: `${site}/auth/signed-out` })
      return redirect(`${hosted}/logout?${q}`, [cookie('jf_session', '', { maxAge: 0 })])
    }

    if (path === '/auth/signed-out') {
      return page(200, `<!doctype html><meta charset="utf-8"><title>Signed out</title><body style="font-family:system-ui;margin:15vh auto;max-width:28rem;text-align:center"><h1>Signed out</h1><p><a href="/auth/login">Sign in again</a></p>`)
    }
    return page(404, '<p>Not found.</p>')
  }
}

const defaultDeps = {
  now: () => Date.now(),
  fetch: (...a) => fetch(...a),
  sessionKey: process.env.SESSION_KEY,
  sessionHours: process.env.SESSION_HOURS ?? '8',
  async readConfig() {
    const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm')
    const out = await new SSMClient({}).send(new GetParameterCommand({ Name: process.env.CONFIG_PARAMETER }))
    return out.Parameter.Value
  },
}

export const handler = makeHandler(defaultDeps)
