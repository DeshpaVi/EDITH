/**
 * The secondary pane: the live Contact Lens transcript.
 *
 * Secondary in layout, not in care. The two things that make a live transcript
 * usable rather than annoying are handled here explicitly:
 *
 *  - Auto-scroll follows the newest turn only while the agent is already at the
 *    bottom. Yanking the view down while someone is reading back an earlier
 *    sentence is the fastest way to get a panel ignored.
 *  - Redacted spans are marked where Contact Lens removed them, rather than
 *    silently closing the gap, so an agent can see that something was said and
 *    was withheld.
 *
 * The turn list is a polite live region, not an assertive one: a screen-reader
 * user has to be able to finish hearing one turn before the next interrupts it.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { config } from '../config/runtime'
import type { ContactSnapshot } from '../connect'
import { itemTimeLabel } from '../transcript/merge'
import type { CharacterRange, TranscriptItem, TranscriptTurn } from '../transcript/types'
import { auth, useTranscript } from '../transcript/useTranscript'
import { Notice } from './Notice'

const ROLE_LABEL: Record<TranscriptTurn['role'], string> = {
  AGENT: 'Agent',
  CUSTOMER: 'Customer',
  SYSTEM: 'System',
  CUSTOM_BOT: 'Bot',
  SUPERVISOR: 'Supervisor',
  UNKNOWN: 'Unknown',
}

export function TranscriptPanel({ contact }: { contact: ContactSnapshot | null }) {
  const { state, status, error, loading, stopped, retry } = useTranscript(contact)
  const [authState, setAuthState] = useState(auth.getState())
  const bodyRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)

  useEffect(() => auth.subscribe(() => setAuthState(auth.getState())), [])

  // Record the scroll position *before* React paints the new turns, so the
  // decision to follow is made against where the agent was, not where the new
  // content has already pushed them.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body || !atBottomRef.current) return
    body.scrollTop = body.scrollHeight
  }, [state.ordered])

  const onScroll = () => {
    const body = bodyRef.current
    if (!body) return
    atBottomRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 48
  }

  const needsSignIn = authState !== 'signed-in' && config.transcriptSource === 'api'

  return (
    <section className="card" aria-label="Real-time transcript">
      <div className="card__head">
        <h2 className="card__title">Live transcript</h2>
        <span className="card__count">
          {state.ordered.filter((item) => item.kind === 'turn').length}
        </span>
        <span className="card__spacer" />
        {status === 'IN_PROGRESS' && !stopped ? (
          <span className="badge" data-tone="good">Live</span>
        ) : stopped ? (
          <span className="badge" data-tone="neutral">Stopped</span>
        ) : null}
      </div>

      <div className="card__body" ref={bodyRef} onScroll={onScroll}>
        {needsSignIn ? (
          <Notice
            tone="info"
            title="Sign in to load the transcript"
            action={
              <button type="button" onClick={() => void auth.signIn()}>
                Sign in
              </button>
            }
          >
            {authState === 'error'
              ? auth.getError()
              : 'Transcript segments come from a service that authenticates each agent separately.'}
          </Notice>
        ) : null}

        {error ? (
          <Notice
            tone={error.code === 'not-enabled' ? 'warn' : 'bad'}
            title={errorTitle(error.code)}
            action={
              stopped ? (
                <button type="button" onClick={retry}>
                  Retry
                </button>
              ) : undefined
            }
          >
            {error.message}
          </Notice>
        ) : null}

        {!contact ? (
          <p className="empty">No contact connected.</p>
        ) : state.ordered.length === 0 ? (
          <p className="empty">
            {loading
              ? 'Connecting to Contact Lens…'
              : 'No transcript yet. Real-time analysis takes a few seconds to start once the call connects.'}
          </p>
        ) : (
          <div className="turns" aria-live="polite" aria-relevant="additions">
            {state.ordered.map((item) => (
              <TranscriptItemView key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function TranscriptItemView({ item }: { item: TranscriptItem }) {
  const time = itemTimeLabel(item)

  if (item.kind === 'turn') {
    return (
      <div className="turn" data-role={item.role}>
        <span className="turn__time">{time}</span>
        <div className="turn__bubble">
          <div className="turn__who">{item.displayName ?? ROLE_LABEL[item.role]}</div>
          <div className="turn__text">
            <RedactedText content={item.content} redactions={item.redactions} />
          </div>
          {item.categories && item.categories.length > 0 ? (
            <div className="turn__tags">
              {item.categories.map((category) => (
                <span className="turn__tag" key={category}>
                  {category}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (item.kind === 'event') {
    return (
      <div className="turn turn--event">
        <span className="turn__time">{time}</span>
        <div className="turn__bubble">{humanizeEvent(item.eventType)}</div>
      </div>
    )
  }

  if (item.kind === 'summary') {
    return (
      <Notice tone={item.status === 'COMPLETED' ? 'info' : 'warn'} title="Post-contact summary">
        {item.content ?? `Summary unavailable (${item.failureCode ?? 'no reason given'}).`}
      </Notice>
    )
  }

  // An analysis segment type this app does not model. Shown rather than
  // dropped — an agent seeing "something arrived" beats a silent gap.
  return (
    <div className="turn turn--event">
      <span className="turn__time" />
      <div className="turn__bubble">Unsupported segment type: {item.segmentType}</div>
    </div>
  )
}

/**
 * Contact Lens applies redaction to the content before it leaves AWS; the
 * character ranges say where. Marking the span keeps the sentence readable as a
 * sentence while making the removal visible.
 */
function RedactedText({
  content,
  redactions,
}: {
  content: string
  redactions?: CharacterRange[]
}) {
  if (!redactions || redactions.length === 0) return <>{content}</>

  const ordered = [...redactions].sort((a, b) => a.begin - b.begin)
  const parts: Array<{ text: string; redacted: boolean }> = []
  let cursor = 0
  for (const range of ordered) {
    const begin = Math.max(cursor, Math.min(range.begin, content.length))
    const end = Math.max(begin, Math.min(range.end, content.length))
    if (begin > cursor) parts.push({ text: content.slice(cursor, begin), redacted: false })
    if (end > begin) parts.push({ text: content.slice(begin, end), redacted: true })
    cursor = end
  }
  if (cursor < content.length) parts.push({ text: content.slice(cursor), redacted: false })

  return (
    <>
      {parts.map((part, index) =>
        part.redacted ? (
          <span className="turn__redaction" key={index} title="Redacted by Contact Lens">
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  )
}

function humanizeEvent(eventType: string): string {
  switch (eventType) {
    case 'PARTICIPANT_JOINED':
      return 'Participant joined'
    case 'PARTICIPANT_LEFT':
      return 'Participant left'
    case 'CHAT_ENDED':
      return 'Chat ended'
    case 'TRANSFER_SUCCEEDED':
      return 'Transfer succeeded'
    case 'TRANSFER_FAILED':
      return 'Transfer failed'
    default:
      return eventType.replace(/_/g, ' ').toLowerCase()
  }
}

function errorTitle(code: string): string {
  switch (code) {
    case 'not-enabled':
      return 'Contact Lens real-time analytics is not on for this contact'
    case 'unsupported-channel':
      return 'This channel has no real-time transcript'
    case 'forbidden':
      return 'Not permitted to read this contact'
    case 'unauthorized':
      return 'Sign-in required'
    case 'throttled':
      return 'Rate limited — retrying'
    case 'not-found':
      return 'Analysis has not started yet'
    default:
      return 'Transcript unavailable'
  }
}
