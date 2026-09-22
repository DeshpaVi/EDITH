import type { AuthProvider } from './types'

/**
 * Development only. `configErrors()` refuses to pair this with the live
 * transcript API, so it can never be the reason a deployed build talks to the
 * backend unauthenticated.
 */
export const noAuth: AuthProvider = {
  kind: 'none',
  getState: () => 'signed-in',
  getError: () => null,
  getToken: async () => null,
  signIn: async () => {},
  signOut: () => {},
  subscribe: () => () => {},
}
