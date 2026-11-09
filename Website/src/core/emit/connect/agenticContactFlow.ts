import { stableId } from '../acxd/ids'

/**
 * Amazon Connect contact flow that hands the conversation to an ACXD application.
 * The Agentic CX block, its Escalation condition and the hand-back attribute mapping follow a real
 * export (skill: verified-exports/connect-contact-flow.AgenticCX.json). Entry stays in Connect;
 * everything conversational is behind the one block.
 *
 * TODO(acxd-schema): the Set voice block JSON is in no export, so it is not emitted: add it in the
 * console. The recording/analytics block in the source export is chat-only, so it is emitted only
 * for chat.
 */
export interface ContactFlowInput {
  name: string
  channel: 'voice' | 'chat'
  workspaceId: string
  applicationId: string
  /** The deployment alias id shown on the Agentic CX block (Deploy tab, after deploying). */
  aliasId: string
  workspaceName?: string
  applicationName?: string
  aliasName?: string
  queueArn: string
  queueName: string
  /** ACXD context variable names copied to contact attributes on escalation. */
  attributes: string[]
  messages?: { timeout?: string; error?: string }
}

type Json = Record<string, unknown>

export const DEFAULT_TIMEOUT_MESSAGE = "I haven't received a response for a little while. If you still need assistance, please let me know."
export const DEFAULT_ERROR_MESSAGE = "I'm sorry, I'm having trouble completing your request right now. Please try again in a moment."

export function emitContactFlow(input: ContactFlowInput): Json {
  const id = (key: string) => stableId('contactFlow', input.name, key)
  const voice = input.channel === 'voice'
  const ids = {
    block: id('block'),
    attrs: id('attributes'),
    queue: id('queue'),
    transfer: id('transfer'),
    disconnectEscalation: id('disconnectEscalation'),
    disconnectEnd: id('disconnectEnd'),
    disconnectError: id('disconnectError'),
    analytics: id('analytics'),
    timeout: 'Timeout',
    error: 'Error',
  }
  const attributeMap = Object.fromEntries(input.attributes.map((a) => [a, `$.AgenticCX.ContextVariables.${a}`]))
  const first = voice ? ids.block : ids.analytics

  const actions: Json[] = []
  if (!voice) {
    actions.push({
      Parameters: {
        ChatBehavior: {
          ChatAnalyticsBehavior: {
            Enabled: 'True',
            AnalyticsLanguage: 'en-US',
            AnalyticsModes: ['ContactLens'],
            ConversationalAnalyticsRedactionConfiguration: { Enabled: 'False' },
            InFlightChatRedactionConfiguration: { Enabled: 'False' },
            SentimentConfiguration: { Enabled: 'True' },
            SummaryConfiguration: { SummaryModes: ['PostContact', 'AutomatedInteraction'] },
          },
        },
      },
      Identifier: ids.analytics,
      Type: 'UpdateContactRecordingAndAnalyticsBehavior',
      Transitions: {
        NextAction: ids.block,
        Errors: ['NoMatchingError', 'ChannelMismatch', 'InFlightRedactionConfigurationFailed'].map((ErrorType) => ({ NextAction: ids.block, ErrorType })),
      },
    })
  }
  actions.push(
    {
      Identifier: ids.block,
      Type: 'ConnectParticipantWithAgenticCX',
      Parameters: {
        AgentConfiguration: { WorkspaceId: input.workspaceId, ApplicationId: input.applicationId, Alias: input.aliasId },
        SpeechRecognitionConfiguration: { SpeechRecognitionEngine: 'AMAZON_AGENTIC_VOICE' },
        AudioFillerConfiguration: { Enabled: voice },
      },
      Transitions: {
        NextAction: ids.error,
        Errors: [
          { NextAction: ids.error, ErrorType: 'NoMatchingError' },
          { NextAction: ids.disconnectEnd, ErrorType: 'NoMatchingCondition' },
          { NextAction: ids.timeout, ErrorType: 'InputTimeLimitExceeded' },
        ],
        Conditions: [{ NextAction: ids.attrs, Condition: { Operator: 'Equals', Operands: ['Escalation'] } }],
      },
    },
    {
      Parameters: { Attributes: attributeMap, TargetContact: 'Current' },
      Identifier: ids.attrs,
      Type: 'UpdateContactAttributes',
      Transitions: { NextAction: ids.queue, Errors: [{ NextAction: ids.block, ErrorType: 'NoMatchingError' }] },
    },
    {
      Parameters: { QueueId: input.queueArn },
      Identifier: ids.queue,
      Type: 'UpdateContactTargetQueue',
      Transitions: { NextAction: ids.transfer, Errors: [{ NextAction: ids.block, ErrorType: 'NoMatchingError' }] },
    },
    {
      Parameters: {},
      Identifier: ids.transfer,
      Type: 'TransferContactToQueue',
      Transitions: {
        NextAction: ids.disconnectEscalation,
        Errors: [
          { NextAction: ids.disconnectEscalation, ErrorType: 'QueueAtCapacity' },
          { NextAction: ids.disconnectEscalation, ErrorType: 'NoMatchingError' },
        ],
      },
    },
    {
      Parameters: { SkipWhenDTMFBufferEnabled: 'false', Text: input.messages?.timeout ?? DEFAULT_TIMEOUT_MESSAGE },
      Identifier: ids.timeout,
      Type: 'MessageParticipant',
      Transitions: { NextAction: ids.block, Errors: [{ NextAction: ids.disconnectError, ErrorType: 'NoMatchingError' }] },
    },
    {
      // An error message ends the contact: looping back into the block could repeat forever.
      Parameters: { SkipWhenDTMFBufferEnabled: 'false', Text: input.messages?.error ?? DEFAULT_ERROR_MESSAGE },
      Identifier: ids.error,
      Type: 'MessageParticipant',
      Transitions: { NextAction: ids.disconnectError, Errors: [{ NextAction: ids.disconnectError, ErrorType: 'NoMatchingError' }] },
    },
    { Parameters: {}, Identifier: ids.disconnectEscalation, Type: 'DisconnectParticipant', Transitions: {} },
    { Parameters: {}, Identifier: ids.disconnectEnd, Type: 'DisconnectParticipant', Transitions: {} },
    { Parameters: {}, Identifier: ids.disconnectError, Type: 'DisconnectParticipant', Transitions: {} },
  )

  const at = (x: number, y: number) => ({ position: { x, y } })
  const actionMetadata: Record<string, Json> = {
    [ids.block]: {
      ...at(450, 100),
      isFriendlyName: false,
      parameters: {
        AgentConfiguration: {
          WorkspaceId: { displayName: input.workspaceName ?? input.workspaceId, useDropdown: 'true' },
          ApplicationId: { displayName: input.applicationName ?? input.applicationId },
          Alias: { displayName: input.aliasName ?? input.aliasId },
        },
      },
    },
    [ids.attrs]: {
      ...at(740, 160),
      parameters: { Attributes: Object.fromEntries(input.attributes.map((a) => [a, { useDynamic: true }])) },
      dynamicParams: input.attributes,
    },
    [ids.queue]: { ...at(995, 160), parameters: { QueueId: { displayName: input.queueName } }, queue: { text: input.queueName } },
    [ids.transfer]: at(1264, 160),
    [ids.disconnectEscalation]: at(1528, 170),
    [ids.disconnectEnd]: at(764, 450),
    [ids.disconnectError]: at(764, 660),
    [ids.timeout]: { ...at(440, 425), isFriendlyName: true },
    [ids.error]: { ...at(445, 630), isFriendlyName: true },
  }
  if (!voice) actionMetadata[ids.analytics] = at(190, 100)

  return {
    Version: '2019-10-30',
    StartAction: first,
    Metadata: {
      entryPointPosition: { x: 40, y: 40 },
      ActionMetadata: actionMetadata,
      Annotations: [],
      name: input.name,
      description: '',
      type: 'contactFlow',
      status: 'PUBLISHED',
      hash: {},
    },
    Actions: actions,
  }
}
