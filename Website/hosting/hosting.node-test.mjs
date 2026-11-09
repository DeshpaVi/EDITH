import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { makeHandler, sessionCookieValue, claimsOf } from './auth-lambda/index.mjs'
import { buildCognitoTemplate } from './build-cognito-template.mjs'

const KEY = 'k'.repeat(40)
const CFG = { region: 'us-east-1', userPoolId: 'us-east-1_ABC', clientId: 'client123', domain: 'demo.auth.us-east-1.amazoncognito.com', siteUrl: 'https://d111.cloudfront.net' }
const NOW = 1_800_000_000_000
const SUB = '11111111-2222-3333-4444-555555555555'

const idToken = (over = {}) => {
  const p = { iss: `https://cognito-idp.${CFG.region}.amazonaws.com/${CFG.userPoolId}`, aud: CFG.clientId, token_use: 'id', exp: NOW / 1000 + 3600, sub: SUB, ...over }
  return `h.${Buffer.from(JSON.stringify(p)).toString('base64url')}.s`
}
function make({ fetchImpl } = {}) {
  const calls = []
  const deps = {
    now: () => NOW, sessionKey: KEY, sessionHours: '8',
    readConfig: async () => JSON.stringify(CFG),
    fetch: async (url, init) => { calls.push({ url, init }); return fetchImpl ? fetchImpl(url, init) : { ok: true, json: async () => ({ id_token: idToken() }) } },
  }
  return { handler: makeHandler(deps), calls }
}
const ev = (rawPath, { query, cookies } = {}) => ({ rawPath, queryStringParameters: query, cookies })

test('login redirects to the Cognito Hosted UI with PKCE and sets a short-lived state cookie', async () => {
  const { handler } = make()
  const res = await handler(ev('/auth/login'))
  assert.equal(res.statusCode, 302)
  const url = new URL(res.headers.location)
  assert.equal(url.origin + url.pathname, `https://${CFG.domain}/oauth2/authorize`)
  assert.equal(url.searchParams.get('client_id'), CFG.clientId)
  assert.equal(url.searchParams.get('redirect_uri'), `${CFG.siteUrl}/auth/callback`)
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  const [state, verifier] = res.cookies[0].split(';')[0].split('=')[1].split('.')
  assert.equal(url.searchParams.get('state'), state)
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'))
  assert.match(res.cookies[0], /HttpOnly; Secure; SameSite=Lax; Max-Age=600/)
})

test('callback exchanges the code with the verifier and issues a signed session cookie', async () => {
  const { handler, calls } = make()
  const res = await handler(ev('/auth/callback', { query: { code: 'abc', state: 'st' }, cookies: ['jf_oauth=st.ver'] }))
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.location, '/')
  const body = new URLSearchParams(calls[0].init.body)
  assert.equal(body.get('code_verifier'), 'ver')
  assert.equal(body.get('grant_type'), 'authorization_code')
  assert.equal(calls[0].url, `https://${CFG.domain}/oauth2/token`)
  const session = res.cookies.find((c) => c.startsWith('jf_session=')).split(';')[0].slice('jf_session='.length)
  const exp = NOW / 1000 + 8 * 3600
  assert.equal(session, sessionCookieValue(KEY, SUB, exp))
  assert.ok(res.cookies.some((c) => c.startsWith('jf_oauth=;') && /Max-Age=0/.test(c)))
  assert.ok(!JSON.stringify(res).includes('id_token'))
})

test('callback refuses a wrong or missing state, a missing cookie and an error from Cognito', async () => {
  const { handler, calls } = make()
  for (const e of [
    ev('/auth/callback', { query: { code: 'abc', state: 'other' }, cookies: ['jf_oauth=st.ver'] }),
    ev('/auth/callback', { query: { code: 'abc', state: 'st' } }),
    ev('/auth/callback', { query: { error: 'access_denied', state: 'st' }, cookies: ['jf_oauth=st.ver'] }),
    ev('/auth/callback', { query: { state: 'st' }, cookies: ['jf_oauth=st.ver'] }),
  ]) assert.equal((await handler(e)).statusCode, 400)
  assert.equal(calls.length, 0)
})

test('callback fails closed when the token exchange or the token is wrong', async () => {
  const bad = make({ fetchImpl: async () => ({ ok: false }) })
  assert.equal((await bad.handler(ev('/auth/callback', { query: { code: 'c', state: 's' }, cookies: ['jf_oauth=s.v'] }))).statusCode, 502)
  for (const over of [{ aud: 'someone-else' }, { iss: 'https://evil' }, { token_use: 'access' }, { exp: 1 }, { sub: 'not valid!' }]) {
    const h = make({ fetchImpl: async () => ({ ok: true, json: async () => ({ id_token: idToken(over) }) }) })
    const res = await h.handler(ev('/auth/callback', { query: { code: 'c', state: 's' }, cookies: ['jf_oauth=s.v'] }))
    assert.equal(res.statusCode, 502, JSON.stringify(over))
    assert.equal(res.cookies, undefined)
  }
  assert.throws(() => claimsOf('garbage', CFG, 1))
})

test('logout clears the session and signs out of Cognito; the signed-out page and unknown paths work', async () => {
  const { handler } = make()
  const out = await handler(ev('/auth/logout'))
  assert.match(out.cookies[0], /^jf_session=; .*Max-Age=0/)
  const url = new URL(out.headers.location)
  assert.equal(url.pathname, '/logout')
  assert.equal(url.searchParams.get('logout_uri'), `${CFG.siteUrl}/auth/signed-out`)
  assert.equal((await handler(ev('/auth/signed-out'))).statusCode, 200)
  assert.equal((await handler(ev('/auth/other'))).statusCode, 404)
})

// ---- the CloudFront Function, run with the real Node crypto (same createHmac API) ---------------------------------
function loadCheck(key) {
  const code = readFileSync(new URL('./session-check.js', import.meta.url), 'utf8')
  return new Function('require', `var KEY = ${JSON.stringify(key)};\n${code}\nreturn handler`)((m) => (m === 'crypto' ? { createHmac } : (() => { throw new Error(m) })()))
}
const reqWith = (value) => ({ request: { uri: '/', cookies: value === undefined ? {} : { jf_session: { value } } } })

test('the session check lets a valid cookie through and redirects everything else to /auth/login', () => {
  const real = Date.now
  Date.now = () => NOW
  try {
    const check = loadCheck(KEY)
    const good = sessionCookieValue(KEY, SUB, NOW / 1000 + 60)
    assert.deepEqual(check(reqWith(good)), reqWith(good).request)
    const denied = [
      undefined, '', 'x', good + 'x', sessionCookieValue('z'.repeat(40), SUB, NOW / 1000 + 60), sessionCookieValue(KEY, SUB, NOW / 1000 - 1),
      sessionCookieValue(KEY, SUB, NOW / 1000 + 60).replace(SUB, 'someone-else'), `${NOW / 1000 + 60}.${SUB}`,
    ]
    for (const v of denied) {
      const r = check(reqWith(v))
      assert.equal(r.statusCode, 302, String(v))
      assert.equal(r.headers.location.value, '/auth/login')
    }
  } finally { Date.now = real }
})

// ---- the template -----------------------------------------------------------------------------------------------
const template = buildCognitoTemplate()

test('the committed template matches the generator', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('./site-cognito.template.json', import.meta.url), 'utf8')), template)
})

function deps(node, self, out = new Set()) {
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (typeof n !== 'object' || n === null) return
    if (typeof n.Ref === 'string') out.add(n.Ref)
    if (n['Fn::GetAtt']) out.add(String(n['Fn::GetAtt'][0]))
    if (n['Fn::Sub']) for (const m of String(Array.isArray(n['Fn::Sub']) ? n['Fn::Sub'][0] : n['Fn::Sub']).matchAll(/\$\{([A-Za-z0-9]+)[.}]/g)) out.add(m[1])
    Object.values(n).forEach(walk)
  }
  walk(node)
  out.delete(self)
  return [...out].filter((r) => r in template.Resources)
}

test('every reference resolves and there is no circular dependency', () => {
  const known = new Set([...Object.keys(template.Resources), ...Object.keys(template.Parameters), 'AWS::StackName', 'AWS::Region', 'AWS::AccountId', 'AWS::Partition'])
  const text = JSON.stringify(template)
  for (const m of text.matchAll(/"Ref":"([^"]+)"/g)) assert.ok(known.has(m[1]), `unknown Ref ${m[1]}`)
  for (const m of text.matchAll(/"Fn::GetAtt":\["([^"]+)"/g)) assert.ok(known.has(m[1]), `unknown GetAtt ${m[1]}`)
  const graph = Object.fromEntries(Object.entries(template.Resources).map(([k, v]) => [k, deps(v, k)]))
  const state = {}
  const visit = (k, path) => {
    assert.notEqual(state[k], 1, `cycle: ${[...path, k].join(' -> ')}`)
    if (state[k] === 2) return
    state[k] = 1
    graph[k].forEach((d) => visit(d, [...path, k]))
    state[k] = 2
  }
  Object.keys(graph).forEach((k) => visit(k, []))
})

test('the site is private, sign-in is admin-created only, the callback is HTTPS, and the key is only a NoEcho parameter', () => {
  const r = template.Resources
  assert.equal(r.SiteBucket.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy, true)
  assert.equal(r.UserPool.Properties.AdminCreateUserConfig.AllowAdminCreateUserOnly, true)
  assert.equal(r.UserPoolClient.Properties.GenerateSecret, false)
  assert.deepEqual(r.UserPoolClient.Properties.AllowedOAuthFlows, ['code'])
  assert.match(JSON.stringify(r.UserPoolClient.Properties.CallbackURLs), /^\[\{"Fn::Sub":"https:\/\//)
  assert.equal(template.Parameters.SessionKey.NoEcho, true)
  const cb = r.SiteDistribution.Properties.DistributionConfig
  assert.equal(cb.DefaultCacheBehavior.FunctionAssociations[0].EventType, 'viewer-request')
  assert.equal(cb.CacheBehaviors[0].PathPattern, '/auth/*')
  assert.equal(cb.CacheBehaviors[0].FunctionAssociations, undefined) // the sign-in endpoints must be reachable without a session
  assert.ok(JSON.stringify(template).indexOf('acxd_live_') < 0)
})
