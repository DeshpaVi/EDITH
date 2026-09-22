/**
 * The real agent workspace binding, built on the Amazon Connect SDK
 * (`@amazon-connect/app` + `@amazon-connect/contact`).
 *
 * The workspace hosts this app in an iframe and talks to it over postMessage;
 * the SDK is the typed wrapper over that channel. Three facts drive the shape
 * of this file:
 *
 *  1. `AmazonConnectApp.init` installs a single global message handler, so it
 *     must be called exactly once per page load.
 *  2. The app may be launched with a contact already in scope (the agent
 *     clicked the app while on a call) or with none (`scope.type === 'idle'`),
 *     so both the initial scope *and* the lifecycle events matter.
 *  3. If the page is opened outside the workspace, `onCreate` simply never
 *     fires. That has to become a readable message, not a spinner forever.
 */

import { AmazonConnectApp } from '@amazon-connect/app'
import type { AppContext } from '@amazon-connect/app'
import { ContactClient } from '@amazon-connect/contact'
import type { ContactChannelType } from '@amazon-connect/contact'
import type {
  BridgeEvents,
  BridgeHandle,
  Channel,
  ConnectOptions,
  ContactSnapshot,
  WorkspaceBridge,
} from './types'

/** How long to wait for the workspace to say hello before declaring we are not embedded. */
const HANDSHAKE_TIMEOUT_MS = 8000

function toChannel(type: ContactChannelType['type'] | string | undefined): Channel {
  switch (type) {
    case 'voice':
    case 'chat':
    case 'task':
    case 'email':
    case 'queue_callback':
      return type
    default:
      return 'unknown'
  }
}

/**
 * Reads the contact's attributes, preferring the wildcard and degrading to an
 * explicit key list. The degraded read cannot populate the Unmapped section —
 * it only returns what was asked for — but a named-key panel beats an error.
 */
async function readAttributes(
  client: ContactClient,
  contactId: string,
  fallbackKeys: readonly string[] | undefined,
): Promise<Record<string, string>> {
  try {
    return await client.getAttributes(contactId, '*')
  } catch (wildcardError) {
    if (!fallbackKeys || fallbackKeys.length === 0) throw wildcardError
    return await client.getAttributes(contactId, [...fallbackKeys])
  }
}

let initialized = false

export const workspaceBridge: WorkspaceBridge = {
  kind: 'workspace',

  connect(events: BridgeEvents, options: ConnectOptions = {}): Promise<BridgeHandle> {
    if (initialized) {
      return Promise.reject(
        new Error('workspaceBridge.connect() called twice — AmazonConnectApp.init is once-per-page.'),
      )
    }
    initialized = true

    return new Promise<BridgeHandle>((resolve) => {
      let closed = false
      let currentContactId: string | null = null
      let handshake: ReturnType<typeof setTimeout> | undefined

      const readSnapshot = async (
        client: ContactClient,
        contactId: string,
      ): Promise<ContactSnapshot> => {
        // `'*'` asks for every attribute the contact carries, which is what
        // lets the Unmapped section surface attributes nobody declared. Not
        // every workspace host implements the wildcard, and one that does not
        // rejects the call outright — so fall back to asking for the declared
        // keys by name rather than losing the panel entirely.
        const attributes = await readAttributes(client, contactId, options.fallbackAttributeKeys)

        // Each of these is best-effort: a contact in an odd state can reject any
        // one of them, and none of them is worth losing the attributes over.
        const [channelType, contact, instance, initialContactId] = await Promise.all([
          client.getChannelType(contactId).catch(() => undefined),
          client.getContact(contactId).catch(() => undefined),
          client.getInstanceDetails(contactId).catch(() => undefined),
          client.getInitialContactId(contactId).catch(() => undefined),
        ])

        const snapshot: ContactSnapshot = {
          contactId,
          channel: toChannel(channelType?.type ?? contact?.type),
          attributes,
          readAt: new Date().toISOString(),
        }
        if (initialContactId && initialContactId !== contactId) {
          snapshot.initialContactId = initialContactId
        }
        const subtype = channelType?.subtype ?? contact?.subtype
        if (subtype) snapshot.subtype = subtype
        if (contact?.queue?.name) snapshot.queueName = contact.queue.name
        if (instance?.origin) snapshot.instanceOrigin = instance.origin
        if (instance?.region) snapshot.region = instance.region
        return snapshot
      }

      const publish = async (client: ContactClient, contactId: string) => {
        if (closed) return
        try {
          events.onContactChange(await readSnapshot(client, contactId))
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : String(cause)
          events.onError({
            kind: 'sdk-call-failed',
            message:
              `Could not read contact ${contactId} from the workspace. This is usually the ` +
              `third-party application missing the contact-details read permission — check the ` +
              `app's permissions in the Amazon Connect console, then sign out and back in. ` +
              `The workspace said: ${detail}`,
            cause,
          })
        }
      }

      const { provider } = AmazonConnectApp.init({
        onCreate: async (event: { context: AppContext }) => {
          clearTimeout(handshake)
          const client = new ContactClient(provider)

          client.onConnected(async ({ contactId }) => {
            currentContactId = contactId
            await publish(client, contactId)
          })
          client.onStartingAcw(async ({ contactId }) => {
            // Attributes set by after-contact logic land here; the agent is
            // still working the contact, so keep showing it.
            await publish(client, contactId)
          })
          client.onCleared(async ({ contactId }) => {
            if (contactId !== currentContactId) return
            currentContactId = null
            events.onContactChange(null)
          })

          // The app can be opened mid-call, in which case no lifecycle event is
          // coming — the contact is already in the launch scope.
          const scope = event.context.scope ?? event.context.contactScope
          if (scope?.type === 'contact') {
            currentContactId = scope.contactId
            await publish(client, scope.contactId)
          } else {
            events.onContactChange(null)
          }

          resolve({
            refresh: async () => {
              if (currentContactId) await publish(client, currentContactId)
            },
            close: () => {
              closed = true
            },
          })
        },

        onDestroy: async () => {
          closed = true
          currentContactId = null
          events.onContactChange(null)
        },
      })

      handshake = setTimeout(() => {
        events.onError({
          kind: 'not-embedded',
          message:
            'No response from the Amazon Connect agent workspace. This page only works when it is ' +
            'loaded as a third-party application inside the workspace. For local development, set ' +
            'VITE_BRIDGE=mock.',
        })
        resolve({ refresh: async () => {}, close: () => { closed = true } })
      }, HANDSHAKE_TIMEOUT_MS)
    })
  },
}
