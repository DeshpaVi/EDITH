import type { AcxdPlan } from '../model'

/**
 * The trimmed Amazon Connect contact flow — the half of the migration that is actually
 * importable, since Connect (unlike ACXD) has a console import path.
 *
 * It carries only what must stay upstream of ACXD: voice, recording, queue, hours. The
 * Agentic CX block itself is NOT emitted: its Action Type string is not published
 * anywhere in the ACXD documentation, and inventing one would produce a file that fails
 * import. It is added in the console instead — the manual cutover step.
 */
export function emitContactFlow(plan: AcxdPlan): string {
  const { contactFlow, application } = plan
  const actions: unknown[] = []
  const ids: string[] = []

  const push = (id: string, type: string, parameters: Record<string, unknown>) => {
    ids.push(id)
    actions.push({ Identifier: id, Type: type, Parameters: parameters, Transitions: {} })
  }

  if (contactFlow.voice?.voiceId) {
    push('set-voice', 'UpdateContactTextToSpeechVoice', {
      Voice: contactFlow.voice.voiceId,
      ...(contactFlow.voice.provider ? { Engine: contactFlow.voice.provider } : {}),
      ...(contactFlow.voice.languageCode ? { LanguageCode: contactFlow.voice.languageCode } : {}),
    })
  }
  if (contactFlow.recordingBehavior) {
    push('set-recording', 'UpdateContactRecordingBehavior', {})
  }
  contactFlow.queueAssignments.forEach((queue, i) => {
    push(`set-queue-${i + 1}`, 'SetWorkingQueue', { QueueId: queue })
  })

  // Targets for the Agentic CX block's documented branches. The Escalation branch is
  // meant to reach a Transfer to queue / Set working queue block, per the block docs.
  const chainEnd = ids.length
  if (contactFlow.queueAssignments.length > 0) {
    push('transfer-to-queue', 'TransferContactToQueue', { QueueId: contactFlow.queueAssignments[0] })
  }
  push('error-prompt', 'MessageParticipant', {
    Text: 'Sorry, something went wrong. Please hold while we connect you.',
    TextToSpeechType: 'text',
  })
  push('disconnect', 'DisconnectParticipant', {})

  // Chain the routing prefix only. Branch targets are wired by the operator when the
  // Agentic CX block is inserted, so they are deliberately left unchained.
  for (let i = 0; i < chainEnd - 1; i++) {
    ;(actions[i] as { Transitions: Record<string, unknown> }).Transitions = { NextAction: ids[i + 1] }
  }

  return `${JSON.stringify({
    Version: '2019-10-30',
    StartAction: ids[0] ?? 'disconnect',
    Metadata: {
      __MIGRATION_NOTE: [
        'Trimmed contact flow generated from an IVR migration. This holds only the routing',
        'that stays upstream of Agentic CX Designer.',
        '',
        `MANUAL STEP REQUIRED: after importing, open this flow and insert an "Agentic CX"`,
        ...(chainEnd > 0
          ? [`block after "${ids[chainEnd - 1]}". Configure it with:`]
          : ['block as the FIRST block, and make it the flow entry point. This flow has no',
             'routing to keep upstream, so StartAction currently points at a branch target',
             'as a placeholder — the Agentic CX block must take its place. Configure it with:']),
        `  Workspace   — your Agentic CX Designer workspace`,
        `  Application — ${application.name}`,
        `  Alias       — ${contactFlow.agenticCxBlock.alias}`,
        '',
        'Then wire its four branches:',
        ...contactFlow.agenticCxBlock.branches.map(
          (b) => `  ${b.name.padEnd(19)} → ${b.target}`,
        ),
        '',
        'The block itself is not emitted because its JSON action type string is not published',
        'in the AWS documentation, and a guessed value would fail import. Everything else it',
        'needs is above.',
        '',
        'The block exposes returned context variables as $.AgenticCX.ContextVariables.<name>',
        'for any blocks you add downstream.',
        ...(contactFlow.hoursOfOperation
          ? ['', 'The source IVR also branched on hours of operation. Re-add a Check hours of',
             'operation block upstream — its branch targets could not be derived automatically.']
          : []),
      ].join('\n'),
    },
    Actions: actions,
  }, null, 2)}\n`
}
