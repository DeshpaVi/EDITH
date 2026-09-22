import { describe, expect, it } from 'vitest'
import { configWarnings, type RuntimeConfig } from './runtime'

const base: RuntimeConfig = {
  bridge: 'workspace',
  transcriptSource: 'api',
  apiBaseUrl: 'https://example.execute-api.us-east-1.amazonaws.com',
  auth: 'none',
  cognito: { domain: '', clientId: '', scopes: '', redirectUri: '' },
  transcriptPollMs: 3000,
  attributeRefreshMs: 5000,
  showAuthWarning: true,
}

describe('configWarnings', () => {
  it('warns when the live transcript API is running unauthenticated', () => {
    expect(configWarnings(base)).toHaveLength(1)
    expect(configWarnings(base)[0]).toMatch(/unauthenticated/i)
  })

  it('stays silent when the notice is switched off', () => {
    expect(configWarnings({ ...base, showAuthWarning: false })).toEqual([])
  })

  it('has nothing to say when auth is on', () => {
    expect(configWarnings({ ...base, auth: 'cognito' })).toEqual([])
  })
})
