// Pure helpers around CloudFormation: build requests, summarise responses. No SDK here.

import { MANAGED_TAG } from './policy.mjs'

export function buildCreateChangeSetInput({ stackName, changeSetName, type, templateBody, templateUrl, parameters, stackRoleArn, tags = {} }) {
  const input = {
    StackName: stackName,
    ChangeSetName: changeSetName,
    ChangeSetType: type,
    ...(templateUrl ? { TemplateURL: templateUrl } : { TemplateBody: templateBody }),
    Parameters: Object.entries(parameters).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
    // CAPABILITY_IAM only: the template creates roles but never names them (no CAPABILITY_NAMED_IAM).
    Capabilities: ['CAPABILITY_IAM'],
    Tags: [{ Key: MANAGED_TAG, Value: 'true' }, ...Object.entries(tags).map(([Key, Value]) => ({ Key, Value }))],
  }
  if (stackRoleArn) input.RoleARN = stackRoleArn
  return input
}

export const isManaged = (stack) => (stack?.Tags ?? []).some((t) => t.Key === MANAGED_TAG && t.Value === 'true')

/** Plain description of a change set for the consultant to review. */
export function summarizeChangeSet(desc) {
  const changes = (desc.Changes ?? [])
    .map((c) => c.ResourceChange)
    .filter(Boolean)
    .map((c) => ({ action: c.Action, logicalId: c.LogicalResourceId, type: c.ResourceType, replacement: c.Replacement === 'True' || c.Replacement === 'Conditional' }))
  const count = (a) => changes.filter((c) => c.action === a).length
  return {
    status: desc.Status,
    statusReason: desc.StatusReason ?? '',
    changes,
    counts: { add: count('Add'), modify: count('Modify'), remove: count('Remove') },
  }
}

export const isNoChanges = (desc) => desc.Status === 'FAILED' && /didn't contain changes|No updates are to be performed/i.test(desc.StatusReason ?? '')

/** Polls DescribeChangeSet until it leaves the in-progress states. */
export async function waitForChangeSet(describe, { attempts = 40, delayMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; i < attempts; i++) {
    const desc = await describe()
    if (desc.Status === 'CREATE_COMPLETE' || desc.Status === 'FAILED') return desc
    await sleep(delayMs)
  }
  throw Object.assign(new Error('The change set took too long to prepare.'), { status: 504 })
}

const TERMINAL_OK = new Set(['CREATE_COMPLETE', 'UPDATE_COMPLETE'])
const TERMINAL_BAD = new Set(['CREATE_FAILED', 'ROLLBACK_COMPLETE', 'ROLLBACK_FAILED', 'UPDATE_FAILED', 'UPDATE_ROLLBACK_COMPLETE', 'UPDATE_ROLLBACK_FAILED', 'DELETE_FAILED'])

/** Maps a stack status to one of: working, done, failed, deleted. */
export function phaseOf(status) {
  if (status === 'DELETE_COMPLETE') return 'deleted'
  if (TERMINAL_OK.has(status)) return 'done'
  if (TERMINAL_BAD.has(status)) return 'failed'
  return 'working'
}

export function summarizeStack(stack, events = []) {
  const failures = events
    .filter((e) => /_FAILED$/.test(e.ResourceStatus ?? '') && e.ResourceStatusReason)
    .map((e) => ({ logicalId: e.LogicalResourceId, status: e.ResourceStatus, reason: String(e.ResourceStatusReason).slice(0, 500) }))
  const outputs = Object.fromEntries((stack.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]))
  return {
    status: stack.StackStatus,
    phase: phaseOf(stack.StackStatus),
    reason: stack.StackStatusReason ?? '',
    outputs,
    failures,
    recent: events.slice(0, 15).map((e) => ({ logicalId: e.LogicalResourceId, status: e.ResourceStatus, time: e.Timestamp })),
  }
}
