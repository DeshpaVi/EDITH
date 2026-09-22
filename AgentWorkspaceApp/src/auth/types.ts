export type AuthState = 'signed-out' | 'signing-in' | 'signed-in' | 'error'

export interface AuthProvider {
  readonly kind: 'cognito' | 'none'
  /** The current state. Read through `subscribe` for changes. */
  getState(): AuthState
  /** The last error, when `getState() === 'error'`. */
  getError(): string | null
  /**
   * A valid bearer token, or `null`. Never opens a window — safe to call from
   * a polling loop. Renews silently from the refresh token when one is held.
   */
  getToken(): Promise<string | null>
  /**
   * Interactive sign-in. **Must be called from a user gesture** (a click);
   * browsers block a popup opened from a timer, and an OIDC redirect inside the
   * workspace iframe is blocked by the identity provider's own frame policy.
   */
  signIn(): Promise<void>
  signOut(): void
  subscribe(listener: () => void): () => void
}
