/**
 * The contract between the agent workspace and the rest of this app.
 *
 * Everything above this interface — panels, formatting, polling — is written
 * against `ContactSnapshot` and never against the Amazon Connect SDK. That is
 * what lets the whole app run outside the workspace against fixtures, and what
 * keeps an SDK upgrade to one file.
 */

export type Channel = 'voice' | 'chat' | 'task' | 'email' | 'queue_callback' | 'unknown'

export interface ContactSnapshot {
  contactId: string
  /**
   * Set when the contact was transferred. Attributes and Contact Lens analysis
   * are keyed on the *initial* contact for voice transfers, so this is the id
   * the transcript lookup should prefer when it exists.
   */
  initialContactId?: string
  channel: Channel
  subtype?: string
  queueName?: string
  /** Connect instance origin, e.g. `https://acme.my.connect.aws`. Display only. */
  instanceOrigin?: string
  region?: string
  /** Every attribute the contact carries. Never filtered by the manifest. */
  attributes: Record<string, string>
  /** ISO timestamp of the read that produced this snapshot. */
  readAt: string
}

export type BridgeErrorKind =
  /** The page is not running inside the Amazon Connect agent workspace. */
  | 'not-embedded'
  /** The workspace answered, but a call into it failed. */
  | 'sdk-call-failed'
  /** The app has no permission for something it asked for. */
  | 'forbidden'

export interface BridgeError {
  kind: BridgeErrorKind
  message: string
  cause?: unknown
}

export interface BridgeEvents {
  /** Called with the live contact, or `null` when no contact is in scope. */
  onContactChange(snapshot: ContactSnapshot | null): void
  onError(error: BridgeError): void
}

export interface BridgeHandle {
  /**
   * Re-read the live contact. Flows can write attributes at any point in the
   * call — an Agentic CX block that finishes a data dip mid-conversation is the
   * common case — so a single read at connect time goes stale.
   */
  refresh(): Promise<void>
  close(): void
}

export interface WorkspaceBridge {
  readonly kind: 'workspace' | 'mock'
  connect(events: BridgeEvents): Promise<BridgeHandle>
}
