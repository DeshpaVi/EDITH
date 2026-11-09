// Confirmation tokens: the server-side review gate (CLAUDE.md constraint 5). A token is issued only with a
// change-set preview, binds that exact change set, stack and target, expires, and is required to execute it.
// So nothing can be executed that was not first planned, whatever a client sends.

import { createHmac, timingSafeEqual } from 'node:crypto'

const b64 = (buf) => Buffer.from(buf).toString('base64url')

export function signConfirm(key, claims, now = Date.now(), ttlMs = 15 * 60 * 1000) {
  const payload = b64(JSON.stringify({ ...claims, exp: now + ttlMs }))
  const sig = b64(createHmac('sha256', key).update(payload).digest())
  return `${payload}.${sig}`
}

/** `expected` holds the values the request names; they must equal what was signed. */
export function verifyConfirm(key, token, expected, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'Missing confirmation. Preview the changes first.' }
  const [payload, sig] = token.split('.')
  const want = createHmac('sha256', key).update(payload).digest()
  let given
  try {
    given = Buffer.from(sig, 'base64url')
  } catch {
    return { ok: false, reason: 'The confirmation is not valid.' }
  }
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, reason: 'The confirmation is not valid.' }
  let claims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'The confirmation is not valid.' }
  }
  if (typeof claims.exp !== 'number' || claims.exp < now) return { ok: false, reason: 'The confirmation expired. Preview the changes again.' }
  for (const [k, v] of Object.entries(expected)) if (claims[k] !== v) return { ok: false, reason: 'The confirmation is for a different change. Preview the changes again.' }
  return { ok: true, claims }
}
