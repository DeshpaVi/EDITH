/**
 * The polling loop behind the transcript panel.
 *
 * Contact Lens real-time has no push API a browser can subscribe to — the
 * segment stream lands in Kinesis, server-side. Polling is therefore not a
 * shortcut here, it is the supported shape, and the loop's job is to poll
 * politely: one request in flight at a time, a fresh interval only after the
 * last response, exponential backoff on throttling, and a hard stop on errors
 * that will not resolve by asking again.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { config } from '../config/runtime'
import { selectAuth } from '../auth'
import type { ContactSnapshot } from '../connect'
import { createApiTranscriptClient, type TranscriptClient } from './client'
import { createMockTranscriptClient } from './mockClient'
import { emptyTranscript, mergePage, type TranscriptState } from './merge'
import type { AnalysisStatus, TranscriptError } from './types'

const MAX_BACKOFF_MS = 30_000

/** Errors that will not fix themselves — stop polling and tell the agent why. */
const TERMINAL: ReadonlySet<TranscriptError['code']> = new Set([
  'not-enabled',
  'unsupported-channel',
  'forbidden',
  'bad-request',
])

export interface TranscriptView {
  state: TranscriptState
  status: AnalysisStatus
  error: TranscriptError | null
  /** True while the first page is still outstanding. */
  loading: boolean
  /** True when polling has stopped and will not resume without an action. */
  stopped: boolean
  /** Retry after a terminal error or a sign-in. */
  retry(): void
}

export const auth = selectAuth()

function createClient(): TranscriptClient {
  return config.transcriptSource === 'mock'
    ? createMockTranscriptClient()
    : createApiTranscriptClient(auth)
}

export function useTranscript(contact: ContactSnapshot | null): TranscriptView {
  const [state, setState] = useState<TranscriptState>(emptyTranscript)
  const [status, setStatus] = useState<AnalysisStatus>('UNKNOWN')
  const [error, setError] = useState<TranscriptError | null>(null)
  const [loading, setLoading] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const clientRef = useRef<TranscriptClient | null>(null)
  if (clientRef.current === null) clientRef.current = createClient()

  // The *current* contact, always. Contact Lens keys voice analysis on the
  // initial contact of a transferred call, but resolving that is the backend's
  // job: it is also what proves this agent is on this contact.
  const contactId = contact?.contactId ?? null

  const retry = useCallback(() => {
    setError(null)
    setStopped(false)
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!contactId || stopped) return

    const client = clientRef.current
    if (!client) return

    // A new contact is a new transcript. Reset rather than letting the previous
    // call's turns bleed into the next one.
    setState(emptyTranscript)
    setStatus('UNKNOWN')
    setLoading(true)

    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    let backoffMs = config.transcriptPollMs
    let nextToken: string | undefined
    let merged: TranscriptState = emptyTranscript

    const tick = async () => {
      if (cancelled) return

      const request: Parameters<TranscriptClient['fetchPage']>[0] = {
        contactId,
        signal: controller.signal,
      }
      if (nextToken) request.nextToken = nextToken

      const result = await client.fetchPage(request)
      if (cancelled) return
      setLoading(false)

      if (result.ok) {
        backoffMs = config.transcriptPollMs
        setError(null)
        nextToken = result.page.nextToken
        merged = mergePage(merged, result.page.items)
        setState(merged)
        setStatus(result.page.status)
        if (result.page.status === 'COMPLETED' || result.page.status === 'FAILED') {
          // Analysis is finished; the segment list will not grow again.
          setStopped(true)
          return
        }
      } else {
        setError(result.error)
        if (TERMINAL.has(result.error.code)) {
          setStopped(true)
          return
        }
        // `unauthorized` and `not-found` are both worth retrying — the first
        // clears when the agent signs in, the second when Contact Lens finishes
        // starting analysis a few seconds into the call.
        backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2)
      }

      timer = setTimeout(() => void tick(), backoffMs)
    }

    void tick()

    return () => {
      cancelled = true
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [contactId, stopped, attempt])

  return { state, status, error, loading, stopped, retry }
}
