import { configErrors } from './config/runtime'
import { useContact } from './connect/useContact'
import { AttributePanel } from './components/AttributePanel'
import { ContactHeader } from './components/ContactHeader'
import { Notice } from './components/Notice'
import { TranscriptPanel } from './components/TranscriptPanel'

/**
 * Two panes: the attributes the IVR collected (primary) and the live transcript
 * (secondary). They share the contact but not a data path — attributes come
 * over the workspace's postMessage bridge, the transcript comes from a backend
 * proxy — so one failing leaves the other standing.
 */
export function App() {
  const { contact, error, bridgeKind, connecting } = useContact()
  const misconfigured = configErrors()

  return (
    <div className="app">
      <ContactHeader contact={contact} bridgeKind={bridgeKind} />

      {misconfigured.length > 0 ? (
        <Notice tone="bad" title="This build is misconfigured">
          <ul>
            {misconfigured.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {error ? (
        <Notice tone={error.kind === 'not-embedded' ? 'warn' : 'bad'} title="Workspace connection">
          {error.message}
        </Notice>
      ) : null}

      {connecting && !error ? <Notice tone="info">Connecting to the agent workspace…</Notice> : null}

      <div className="app__body">
        <div className="app__panes">
          <AttributePanel contact={contact} />
          <TranscriptPanel contact={contact} />
        </div>
      </div>
    </div>
  )
}
