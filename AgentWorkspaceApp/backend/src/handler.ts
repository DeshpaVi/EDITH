/**
 * GET /transcript?contactId=<id>&nextToken=<token>
 *
 * The only server-side component. It exists because Contact Lens real-time is a
 * SigV4-signed AWS API: a browser cannot call it without AWS credentials, and
 * putting AWS credentials in a browser is not a trade-off, it is a breach. So
 * this function holds the execution role, proves the caller is the agent on the
 * contact, and returns a normalised page of segments.
 *
 * Which upstream API it calls depends on the channel, and the split is not
 * cosmetic:
 *
 *   VOICE -> connect-contact-lens:ListRealtimeContactAnalysisSegments
 *   CHAT  -> connect:ListRealtimeContactAnalysisSegmentsV2
 *
 * The V2 API rejects VOICE contacts outright with InvalidRequestException, so
 * both clients are required. The channel comes from DescribeContact, never from
 * the query string.
 */

import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { ConnectClient, ListRealtimeContactAnalysisSegmentsV2Command } from '@aws-sdk/client-connect'
import {
  ConnectContactLensClient,
  ListRealtimeContactAnalysisSegmentsCommand,
} from '@aws-sdk/client-connect-contact-lens'
import { authorizeContactAccess, isAwsError } from './authorize'
import { settings } from './config'
import { fail, ok, type ErrorCode } from './http'
import { normalizeChat, normalizeVoice } from '../../src/transcript/normalize'

const connect = new ConnectClient({ region: settings.region })
const contactLens = new ConnectContactLensClient({ region: settings.region })

const UUID = /^[0-9a-fA-F-]{8,64}$/

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const contactId = event.queryStringParameters?.contactId
  const nextToken = event.queryStringParameters?.nextToken

  if (!contactId || !UUID.test(contactId)) {
    return fail('bad-request', '`contactId` is required and must be a contact identifier.')
  }

  const claims = event.requestContext.authorizer?.jwt?.claims ?? {}

  try {
    const authorization = await authorizeContactAccess(connect, claims, contactId)
    if (!authorization.allowed) return fail(authorization.code, authorization.message)

    const { contact } = authorization
    const channel = contact.Channel

    // Contact Lens keys voice analysis on the contact the call *started* as, so
    // a transferred call is looked up under its initial id. Deriving it here
    // rather than accepting it from the browser is what keeps the ownership
    // check above meaningful.
    const analysisContactId = channel === 'VOICE' ? (contact.InitialContactId ?? contactId) : contactId

    if (channel === 'VOICE') {
      const response = await contactLens.send(
        new ListRealtimeContactAnalysisSegmentsCommand({
          InstanceId: settings.instanceId,
          ContactId: analysisContactId,
          MaxResults: settings.maxResults,
          ...(nextToken ? { NextToken: nextToken } : {}),
        }),
      )
      return ok(normalizeVoice(response))
    }

    if (channel === 'CHAT') {
      const response = await connect.send(
        new ListRealtimeContactAnalysisSegmentsV2Command({
          InstanceId: settings.instanceId,
          ContactId: analysisContactId,
          MaxResults: settings.maxResults,
          OutputType: 'Redacted',
          SegmentTypes: ['Transcript', 'Categories', 'Event', 'PostContactSummary'],
          ...(nextToken ? { NextToken: nextToken } : {}),
        }),
      )
      return ok(normalizeChat(response))
    }

    return fail(
      'unsupported-channel',
      `Contact Lens real-time analysis does not cover ${channel ?? 'this'} contacts. Only voice and chat produce a live transcript.`,
    )
  } catch (cause) {
    return fail(...classify(cause))
  }
}

/**
 * AWS exception names -> the codes the UI renders. The distinction that matters
 * to an agent is "this will never work for this call" (stop polling, explain)
 * versus "not yet" (keep polling quietly), so `not-enabled` and `not-found` are
 * kept apart rather than collapsed into one error.
 */
function classify(cause: unknown): [ErrorCode, string] {
  if (isAwsError(cause, 'AccessDeniedException')) {
    return ['forbidden', 'The transcript service is not permitted to read this contact.']
  }
  if (isAwsError(cause, 'ThrottlingException')) {
    return ['throttled', 'Amazon Connect is rate limiting transcript reads. Retrying more slowly.']
  }
  if (isAwsError(cause, 'ResourceNotFoundException')) {
    return [
      'not-found',
      'No analysis for this contact yet. Contact Lens takes a few seconds to start after the call connects.',
    ]
  }
  if (isAwsError(cause, 'InvalidRequestException')) {
    return [
      'not-enabled',
      'Contact Lens real-time analytics is not enabled for this contact. Turn it on in the ' +
        'flow’s "Set recording and analytics behavior" block — it cannot be switched on mid-call.',
    ]
  }
  if (isAwsError(cause, 'OutputTypeNotFoundException')) {
    return [
      'not-enabled',
      'This contact was analysed with a redaction policy that does not produce the requested output type.',
    ]
  }

  console.error('Unhandled transcript error', cause)
  return ['upstream-error', 'The transcript service failed. The error has been logged.']
}
