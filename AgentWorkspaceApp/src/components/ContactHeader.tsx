import type { ContactSnapshot } from '../connect'
import { formatDuration } from '../attributes/format'

const CHANNEL_LABEL: Record<ContactSnapshot['channel'], string> = {
  voice: 'Voice',
  chat: 'Chat',
  task: 'Task',
  email: 'Email',
  queue_callback: 'Callback',
  unknown: 'Contact',
}

export function ContactHeader({
  contact,
  bridgeKind,
}: {
  contact: ContactSnapshot | null
  bridgeKind: 'workspace' | 'mock'
}) {
  const ivrSeconds = contact ? Number(contact.attributes.ivrDurationSeconds) : NaN

  return (
    <header className="header">
      <h1 className="header__title">Contact handoff</h1>
      {contact ? (
        <>
          <span className="header__meta">
            {CHANNEL_LABEL[contact.channel]}
            {contact.queueName ? ` · ${contact.queueName}` : ''}
            {Number.isFinite(ivrSeconds) ? ` · ${formatDuration(ivrSeconds)} in IVR` : ''}
          </span>
          <span className="header__spacer" />
          <span className="header__id" title={`Contact ID ${contact.contactId}`}>
            {contact.contactId.slice(0, 8)}
            {contact.initialContactId ? ' · transferred' : ''}
          </span>
        </>
      ) : (
        <span className="header__meta">No contact in scope</span>
      )}
      {bridgeKind === 'mock' ? (
        <span className="badge" data-tone="warn" title="VITE_BRIDGE=mock — this is fixture data.">
          Fixture data
        </span>
      ) : null}
    </header>
  )
}
