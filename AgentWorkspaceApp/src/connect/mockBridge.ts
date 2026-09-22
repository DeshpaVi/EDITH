/**
 * A fixture contact, for developing outside the agent workspace.
 *
 * The fixture is deliberately imperfect: one manifest-declared required
 * attribute is absent and two attributes are present that the manifest does not
 * declare. Those are the two cases the panel most needs to handle well, and a
 * tidy fixture would hide both.
 */

import type { BridgeEvents, BridgeHandle, ContactSnapshot, WorkspaceBridge } from './types'

const FIXTURE_ATTRIBUTES: Record<string, string> = {
  customerId: 'CUS-4417829',
  accountNumber: '400211987654',
  callerName: 'A. Random',
  callbackNumber: '+442071234567',
  authStatus: 'partial',
  verificationAttempts: '2',
  dateOfBirth: '1984-03-11',

  callerIntent: 'DisputeCharge',
  intentConfidence: '0.82',
  lastMenuSelection: '2',
  selfServiceOutcome: 'abandoned',
  // `escalationReason` is declared required in the manifest and deliberately
  // absent here — the panel must show the gap rather than skip the row.

  crmCaseId: 'CASE-99120',
  orderId: 'SO-55231',
  paymentAmount: '134.50',
  paymentCurrency: 'GBP',
  cardLast4: '4471',
  dueDate: '2026-10-01',
  recordingDisclosure:
    'This call may be recorded and monitored for training and quality assurance purposes.',

  ivrDurationSeconds: '186',
  transferReason: 'AgentRequested',
  queueName: 'Billing-Tier1',
  acxdApplication: 'acme-billing',
  acxdConversationId: 'conv-8f21c0',
  botSessionId: 'sess-31ab99',
  repeatCaller: 'true',

  // Not declared in the manifest. These must appear under "Unmapped".
  experimentCohort: 'ivr-acxd-pilot-b',
  lastIvrNodeId: 'node_payment_confirm',
}

export const mockBridge: WorkspaceBridge = {
  kind: 'mock',

  connect(events: BridgeEvents): Promise<BridgeHandle> {
    let closed = false
    let attempt = 0

    const snapshot = (): ContactSnapshot => ({
      contactId: '11111111-2222-3333-4444-555555555555',
      channel: 'voice',
      subtype: 'connect:Telephony',
      queueName: 'Billing-Tier1',
      instanceOrigin: 'https://example.my.connect.aws',
      region: 'eu-west-2',
      attributes: {
        ...FIXTURE_ATTRIBUTES,
        // Proves the refresh loop is live: a flow writing an attribute mid-call
        // should appear without the agent reloading the app.
        ivrDurationSeconds: String(186 + attempt * 5),
      },
      readAt: new Date().toISOString(),
    })

    // Deferred so callers see the same "contact arrives after connect()" timing
    // the real workspace produces.
    setTimeout(() => {
      if (!closed) events.onContactChange(snapshot())
    }, 300)

    return Promise.resolve({
      refresh: async () => {
        attempt += 1
        if (!closed) events.onContactChange(snapshot())
      },
      close: () => {
        closed = true
      },
    })
  },
}
