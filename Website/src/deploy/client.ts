/**
 * Client for the deployer API. Every failure becomes a plain message. The bearer token is passed in by the
 * caller and held in memory only. This client never sees AWS credentials or the ACXD API key.
 */

export interface DeployTarget {
  id: string
  label: string
  region: string
}

export interface PlannedChange {
  action: string
  logicalId: string
  type: string
  replacement: boolean
}

export type PlanResult =
  | { status: 'no_changes'; stackName: string }
  | {
      status: 'ready'
      stackName: string
      changeSetId: string
      type: 'CREATE' | 'UPDATE'
      /** Signed by the server; required to execute exactly this change set. */
      token: string
      changes: PlannedChange[]
      counts: { add: number; modify: number; remove: number }
      expiresInMinutes: number
    }

export type StackPhase = 'working' | 'done' | 'failed' | 'deleted' | 'not_found'

export interface StackStatus {
  stackName: string
  phase: StackPhase
  status?: string
  reason?: string
  outputs?: Record<string, string>
  failures?: Array<{ logicalId: string; status: string; reason: string }>
  recent?: Array<{ logicalId: string; status: string; time: string }>
}

export interface PlanRequest {
  targetId: string
  stackName: string
  template: unknown
  parameters: Record<string, string>
}

export interface StackRef {
  targetId: string
  stackName: string
}

export interface DeployerClient {
  targets(): Promise<DeployTarget[]>
  plan(body: PlanRequest): Promise<PlanResult>
  execute(body: StackRef & { changeSetId: string; token: string }): Promise<void>
  status(body: StackRef): Promise<StackStatus>
  cancel(body: StackRef & { changeSetId: string }): Promise<void>
  remove(body: StackRef & { confirmName: string }): Promise<void>
}

export interface ClientOptions {
  url: string
  token: string
  fetchImpl?: typeof fetch
  /** Planning waits for CloudFormation to prepare a change set, so allow a generous time. */
  timeoutMs?: number
}

export function createDeployerClient(opts: ClientOptions): DeployerClient {
  const doFetch = opts.fetchImpl ?? fetch
  const base = opts.url.replace(/\/+$/, '')

  async function request<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000)
    let res: Response
    try {
      res = await doFetch(`${base}/${route}`, {
        method,
        headers: { authorization: `Bearer ${opts.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new Error('The deployer took too long to answer.')
      throw new Error('Could not reach the deployer. Check the URL, your network and that this site is an allowed origin.')
    } finally {
      clearTimeout(timer)
    }
    let payload: unknown = null
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    if (!res.ok) throw new Error((payload as { error?: string } | null)?.error ?? `The deployer returned an error (${res.status}).`)
    return payload as T
  }

  return {
    targets: async () => (await request<{ targets: DeployTarget[] }>('GET', 'targets')).targets,
    plan: (body) => request<PlanResult>('POST', 'plan', body),
    execute: async (body) => void (await request('POST', 'execute', body)),
    status: (body) => request<StackStatus>('POST', 'status', body),
    cancel: async (body) => void (await request('POST', 'cancel', body)),
    remove: async (body) => void (await request('POST', 'delete', body)),
  }
}
