/**
 * Proves that the agent behind the JWT is the agent on the contact.
 *
 * Without this, the API is "any signed-in employee can read any live call's
 * transcript by guessing a contact id" — which is a worse posture than the
 * agent workspace itself offers, since the workspace only ever hands an app the
 * contacts that agent is actually handling.
 *
 * The check is two hops, because the JWT knows an email address and Amazon
 * Connect knows a user id:
 *
 *   JWT claim ──SearchUsers──▶ Connect user id ──DescribeContact──▶ AgentInfo.Id
 *
 * The first hop is cached: a Connect username maps to a user id for as long as
 * the user exists, and re-resolving it on every poll would triple the API calls
 * for no benefit.
 */

import {
  ConnectClient,
  DescribeContactCommand,
  SearchUsersCommand,
  type Contact,
} from '@aws-sdk/client-connect'
import { settings } from './config'

const USER_CACHE_TTL_MS = 10 * 60 * 1000
const userIdCache = new Map<string, { userId: string; expiresAt: number }>()

export type Authorization =
  | { allowed: true; contact: Contact }
  | { allowed: false; code: 'forbidden' | 'not-found' | 'unauthorized'; message: string }

export async function authorizeContactAccess(
  client: ConnectClient,
  claims: Readonly<Record<string, unknown>>,
  contactId: string,
): Promise<Authorization> {
  let contact: Contact
  try {
    const described = await client.send(
      new DescribeContactCommand({ InstanceId: settings.instanceId, ContactId: contactId }),
    )
    if (!described.Contact) {
      return { allowed: false, code: 'not-found', message: 'No such contact on this instance.' }
    }
    contact = described.Contact
  } catch (cause) {
    if (isAwsError(cause, 'ResourceNotFoundException')) {
      return { allowed: false, code: 'not-found', message: 'No such contact on this instance.' }
    }
    throw cause
  }

  if (!settings.enforceOwnership) return { allowed: true, contact }

  const username = claimString(claims, settings.usernameClaim)
  if (!username) {
    return {
      allowed: false,
      code: 'unauthorized',
      message: `The access token carries no "${settings.usernameClaim}" claim, so the agent cannot be identified.`,
    }
  }

  const userId = await resolveConnectUserId(client, username)
  if (!userId) {
    return {
      allowed: false,
      code: 'forbidden',
      message: `No Amazon Connect user matches "${username}" on this instance.`,
    }
  }

  // A contact still ringing has no AgentInfo yet. Denying is correct: there is
  // nothing to transcribe until it connects, and the next poll will succeed.
  if (contact.AgentInfo?.Id !== userId) {
    return {
      allowed: false,
      code: 'forbidden',
      message: 'This contact is not assigned to you.',
    }
  }

  return { allowed: true, contact }
}

async function resolveConnectUserId(client: ConnectClient, username: string): Promise<string | null> {
  const cached = userIdCache.get(username)
  if (cached && cached.expiresAt > Date.now()) return cached.userId

  const found = await client.send(
    new SearchUsersCommand({
      InstanceId: settings.instanceId,
      MaxResults: 2,
      SearchCriteria: {
        StringCondition: { FieldName: 'Username', Value: username, ComparisonType: 'EXACT' },
      },
    }),
  )

  // Exactly one match, or none. Two matches on an exact username condition
  // would mean the assumption behind this lookup is wrong, and guessing which
  // one is the agent is not a decision to make silently.
  const users = found.Users ?? []
  const first = users[0]
  if (users.length !== 1 || !first?.Id) return null

  userIdCache.set(username, { userId: first.Id, expiresAt: Date.now() + USER_CACHE_TTL_MS })
  return first.Id
}

function claimString(claims: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = claims[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function isAwsError(cause: unknown, name: string): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { name?: string }).name === name
}
