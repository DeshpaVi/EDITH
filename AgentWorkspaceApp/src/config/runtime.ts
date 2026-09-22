/**
 * Runtime configuration, read once from the build-time environment.
 *
 * Everything here is public by construction — Vite inlines `import.meta.env`
 * into the bundle, and the bundle is served to an agent's browser. No secret
 * may be routed through this module. The backend holds the only credentials
 * in the system (its Lambda execution role); the browser holds a short-lived
 * OIDC access token and nothing else.
 */

export type BridgeMode = 'workspace' | 'mock'
export type TranscriptSource = 'api' | 'mock'
export type AuthMode = 'cognito' | 'none'

export interface RuntimeConfig {
  bridge: BridgeMode
  transcriptSource: TranscriptSource
  apiBaseUrl: string
  auth: AuthMode
  cognito: {
    domain: string
    clientId: string
    scopes: string
    redirectUri: string
  }
  transcriptPollMs: number
  attributeRefreshMs: number
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function num(value: unknown, fallback: number, min: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, parsed)
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

const env = import.meta.env as Record<string, string | undefined>

export const config: RuntimeConfig = {
  bridge: oneOf(env.VITE_BRIDGE, ['workspace', 'mock'] as const, 'workspace'),
  transcriptSource: oneOf(env.VITE_TRANSCRIPT_SOURCE, ['api', 'mock'] as const, 'api'),
  apiBaseUrl: str(env.VITE_API_BASE_URL, '').replace(/\/+$/, ''),
  auth: oneOf(env.VITE_AUTH_MODE, ['cognito', 'none'] as const, 'cognito'),
  cognito: {
    domain: str(env.VITE_COGNITO_DOMAIN, '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    clientId: str(env.VITE_COGNITO_CLIENT_ID, ''),
    scopes: str(env.VITE_COGNITO_SCOPES, 'openid email profile'),
    redirectUri: typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/auth/callback.html`,
  },
  transcriptPollMs: num(env.VITE_TRANSCRIPT_POLL_MS, 3000, 1000),
  attributeRefreshMs: num(env.VITE_ATTRIBUTE_REFRESH_MS, 5000, 1000),
}

/**
 * Misconfigurations that would otherwise surface as a blank panel mid-call.
 * Surfaced in the UI rather than thrown, so an agent sees *why* a panel is
 * empty instead of an empty panel.
 */
export function configErrors(c: RuntimeConfig = config): string[] {
  const errors: string[] = []
  if (c.transcriptSource === 'api' && !c.apiBaseUrl) {
    errors.push('VITE_API_BASE_URL is unset but the transcript source is `api`.')
  }
  if (c.auth === 'cognito' && (!c.cognito.domain || !c.cognito.clientId)) {
    errors.push('VITE_AUTH_MODE=cognito requires VITE_COGNITO_DOMAIN and VITE_COGNITO_CLIENT_ID.')
  }
  return errors
}

/**
 * Configurations that work but should not go unnoticed.
 *
 * Running the live transcript API with `VITE_AUTH_MODE=none` is a deliberate
 * demo shortcut, not a mistake — so it does not block the build. It does mean
 * the backend is answering unauthenticated requests and cannot check that the
 * caller is the agent on the contact, which is worth having on screen rather
 * than only in a deployment note somebody read once.
 */
export function configWarnings(c: RuntimeConfig = config): string[] {
  const warnings: string[] = []
  if (c.transcriptSource === 'api' && c.auth === 'none') {
    warnings.push(
      'Transcripts are being read through an unauthenticated endpoint. Anyone with a contact ID ' +
        'can read that call. Demo configuration only — set VITE_AUTH_MODE=cognito and redeploy the ' +
        'backend with AuthMode=cognito before this carries real conversations.',
    )
  }
  return warnings
}
