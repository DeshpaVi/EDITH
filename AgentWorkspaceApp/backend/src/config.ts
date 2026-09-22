/**
 * Lambda configuration. Everything here comes from the execution environment —
 * nothing is accepted from the caller, and in particular the Connect instance
 * id is fixed at deploy time so a request cannot point the proxy at a different
 * instance.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

export const settings = {
  instanceId: required('CONNECT_INSTANCE_ID'),
  region: process.env.AWS_REGION ?? 'us-east-1',
  /** Exact origin of the hosted app. Used for the CORS header. */
  allowedOrigin: required('ALLOWED_ORIGIN'),
  /**
   * When true, every request is checked against DescribeContact to confirm the
   * caller is the agent on the contact. Turning this off makes any signed-in
   * user able to read any contact's transcript — see docs/LIMITATIONS.md.
   */
  enforceOwnership: (process.env.ENFORCE_CONTACT_OWNERSHIP ?? 'true') !== 'false',
  /**
   * JWT claim holding the value that matches the agent's Amazon Connect
   * username. With a SAML/OIDC-federated Connect instance this is usually
   * `email`; with Connect-managed users it may be `cognito:username`.
   */
  usernameClaim: process.env.USERNAME_CLAIM ?? 'email',
  maxResults: Number(process.env.MAX_RESULTS ?? '100'),
} as const
