import type { ExtractPort, ExtractRequestBody } from './pipeline'

export interface HttpPortOptions {
  url: string
  /** Bearer token for the backend. The consultant types it in; it is not stored by the app. */
  token: string
  fetchImpl?: typeof fetch
  /** Milliseconds to wait for the model. Reading a large deck can take a while. */
  timeoutMs?: number
}

/** Talks to the extractor backend. Every failure becomes a plain message the consultant can act on. */
export function createHttpPort(opts: HttpPortOptions): ExtractPort {
  const doFetch = opts.fetchImpl ?? fetch
  return {
    async extract(body: ExtractRequestBody): Promise<unknown> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 300_000)
      let res: Response
      try {
        res = await doFetch(opts.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw new Error('The extractor took too long. Try a smaller source.')
        throw new Error('Could not reach the extractor. Check the URL, your network and that the site is an allowed origin.')
      } finally {
        clearTimeout(timer)
      }
      let payload: { journey?: unknown; error?: string } | null = null
      try {
        payload = (await res.json()) as { journey?: unknown; error?: string }
      } catch {
        payload = null
      }
      if (!res.ok) throw new Error(payload?.error ?? `The extractor returned an error (${res.status}).`)
      if (!payload || payload.journey === undefined) throw new Error('The extractor returned no journey.')
      return payload.journey
    },
  }
}
