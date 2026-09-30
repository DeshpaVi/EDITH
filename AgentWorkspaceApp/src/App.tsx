import { configErrors, configWarnings } from './config/runtime'
import { useContact } from './connect/useContact'
import { AttributePanel } from './components/AttributePanel'
import { ContactHeader } from './components/ContactHeader'
import { Notice } from './components/Notice'
import { FormPanel } from './components/FormPanel'
import { TranscriptPanel } from './components/TranscriptPanel'
import { useTranscript } from './transcript/useTranscript'

/**
 * Two panes: the attributes the IVR collected (primary) and the live transcript
 * (secondary), plus a form that slides in when the conversation calls for one. They share the contact but not a data path — attributes come
 * over the workspace's postMessage bridge, the transcript comes from a backend
 * proxy — so one failing leaves the other standing.
 */
export function App() {
  const { contact, error, bridgeKind, connecting } = useContact()
  // One poll feeds both the transcript pane and the form suggestions.
  const transcript = useTranscript(contact)
  const misconfigured = configErrors()
  const warnings = configWarnings()

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

      {warnings.map((warning) => (
        <Notice tone="warn" title="Unauthenticated transcript access" key={warning}>
          {warning}
        </Notice>
      ))}

      {error ? (
        <Notice tone={error.kind === 'not-embedded' ? 'warn' : 'bad'} title="Workspace connection">
          {error.message}
        </Notice>
      ) : null}

      {connecting && !error ? <Notice tone="info">Connecting to the agent workspace…</Notice> : null}

      <div className="app__body">
        <div className="app__panes">
          <AttributePanel contact={contact} />
          <TranscriptPanel contact={contact} view={transcript} />
        </div>
        <FormPanel key={contact?.contactId ?? 'none'} items={transcript.state.ordered} contact={contact} />
      </div>
    </div>
  )
}
