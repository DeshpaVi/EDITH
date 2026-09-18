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

  // Terminal block, so the file imports cleanly. The Agentic CX block goes immediately
  // before it — see the note in Metadata.
  push('disconnect', 'DisconnectParticipant', {})

  // Chain each action to the next.
  for (let i = 0; i < ids.length - 1; i++) {
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
        'MANUAL STEP REQUIRED: after importing, open this flow in the designer and insert an',
        `Agentic CX block immediately before "disconnect", configured with application`,
        `"${application.name}" and environment "${contactFlow.agenticCxBlock.environment}".`,
        'Wire its escalation, error and timeout pathways back into this flow.',
        '',
        'The block is not emitted here because its Action Type string is not published in the',
        'ACXD documentation, and a guessed value would fail import.',
        ...(contactFlow.hoursOfOperation
          ? ['', 'The source IVR also branched on hours of operation. Re-add a Check hours of',
             'operation block upstream — its branch targets could not be derived automatically.']
          : []),
      ].join('\n'),
    },
    Actions: actions,
  }, null, 2)}\n`
}
