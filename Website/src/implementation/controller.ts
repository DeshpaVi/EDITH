import { strToU8, zipSync } from 'fflate'
import { buildChecklist, defaultSelection, resolveSelection, summarize } from '../core/checklist'
import type { Checklist, ChecklistItem, ChecklistSummary, Need, RequiresReview, SelectionResult } from '../core/checklist'
import { validateJourney } from '../core/journey'
import type { Journey, ValidationIssue } from '../core/journey'
import { attributeName, emitAgenticContactFlow, emitBundle } from '../core/emit/implementation'
import type { Bundle, BundleOptions, GuardrailContent, GuardrailDefinition } from '../core/emit/implementation'
import { stepsOfKind } from '../core/journey/model'

/**
 * All UI logic for the implementation tool, as pure functions so it can be tested without a browser.
 * The React layer only renders this and calls it. Nothing here stores or asks for an ACXD API key:
 * the key is supplied by the consultant at deploy time, as a CloudFormation parameter.
 */

// ---- loading a journey ---------------------------------------------------------------------------

export type LoadResult = { ok: true; journey: Journey } | { ok: false; issues: ValidationIssue[] }

/** Parses and validates journey JSON from an upload. Problems are reported with paths, never repaired. */
export function parseJourneyText(text: string): LoadResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { ok: false, issues: [{ path: '$', message: `Not valid JSON: ${err instanceof Error ? err.message : 'parse error'}` }] }
  }
  const result = validateJourney(raw)
  return result.ok ? { ok: true, journey: result.journey } : { ok: false, issues: result.issues }
}

// ---- selection ---------------------------------------------------------------------------------------

export interface Session {
  journey: Journey
  checklist: Checklist
  /** What the consultant ticked (before required items and dependencies are added). */
  chosen: string[]
  /** Plain-language messages about the last change. */
  notices: string[]
}

export function startSession(journey: Journey): Session {
  const checklist = buildChecklist(journey)
  return { journey, checklist, chosen: defaultSelection(checklist), notices: [] }
}

export const effectiveSelection = (s: Session): SelectionResult => resolveSelection(s.checklist, s.chosen)

const titleOf = (s: Session, id: string): string => s.checklist.items.find((i) => i.id === id)?.title ?? id

/** Ticks or unticks an item. Required items stay on and dependencies are kept, with a notice saying why. */
export function toggleItem(session: Session, id: string): Session {
  const item = session.checklist.items.find((i) => i.id === id)
  if (!item) return session
  if (item.need === 'required') {
    return { ...session, notices: [`"${item.title}" is required and stays on.`] }
  }
  const before = new Set(effectiveSelection(session).selected)
  const chosen = new Set(session.chosen)
  if (chosen.has(id)) chosen.delete(id)
  else chosen.add(id)
  const next: Session = { ...session, chosen: [...chosen] }
  const after = effectiveSelection(next)
  const afterSet = new Set(after.selected)
  const notices: string[] = []

  if (!chosen.has(id) && afterSet.has(id)) {
    const needers = after.selected
      .map((sid) => session.checklist.items.find((i) => i.id === sid) as ChecklistItem)
      .filter((i) => i.requires.includes(id) && i.id !== id)
      .map((i) => `"${i.title}"`)
    notices.push(`"${item.title}" stays on because ${needers.join(', ')} needs it.`)
  }
  for (const added of after.autoAdded.filter((a) => !before.has(a))) {
    notices.push(`Added "${titleOf(session, added)}" because something you selected needs it.`)
  }
  return { ...next, notices }
}

// ---- checklist view model -------------------------------------------------------------------------------

export interface ItemView {
  item: ChecklistItem
  checked: boolean
  /** Required items cannot be switched off. */
  locked: boolean
  /** Titles of selected items that need this one. */
  neededBy: string[]
}

export interface ChecklistView {
  sections: Array<{ need: Need; heading: string; items: ItemView[] }>
  reviews: RequiresReview[]
  summary: ChecklistSummary
  selectedCount: number
}

const HEADINGS: Record<Need, string> = { required: 'Required', recommended: 'Recommended', optional: 'Optional' }

export function describeChecklist(session: Session): ChecklistView {
  const selected = new Set(effectiveSelection(session).selected)
  const itemsById = new Map(session.checklist.items.map((i) => [i.id, i]))
  const view = (item: ChecklistItem): ItemView => ({
    item,
    checked: selected.has(item.id),
    locked: item.need === 'required',
    neededBy: session.checklist.items.filter((o) => selected.has(o.id) && o.requires.includes(item.id)).map((o) => (itemsById.get(o.id) as ChecklistItem).title),
  })
  const needs: Need[] = ['required', 'recommended', 'optional']
  return {
    sections: needs
      .map((need) => ({ need, heading: HEADINGS[need], items: session.checklist.items.filter((i) => i.need === need).map(view) }))
      .filter((s) => s.items.length > 0),
    reviews: session.checklist.reviews,
    summary: summarize(session.checklist, selected),
    selectedCount: selected.size,
  }
}

// ---- details the consultant supplies -----------------------------------------------------------------

export interface Details {
  applicationName: string
  tableName: string
  /** Attribute names for the identifiers, in the journey's order. The first is the table key. */
  identifierFields: string[]
  knowledgeBaseId: string
  safetyMessage: string
  mainPrompt: string
  /** Guardrail exports pasted or uploaded as JSON text. Empty means "not supplied". */
  guardrails: { safety: string; promptInjection: string; toxicity: string }
}

export function defaultDetails(journey: Journey): Details {
  const auth = stepsOfKind(journey, 'authentication')[0]
  return {
    applicationName: journey.title.slice(0, 100),
    tableName: 'RespondentRecords',
    identifierFields: auth ? auth.identifiers.map(attributeName) : [],
    knowledgeBaseId: '',
    safetyMessage: '',
    mainPrompt: '',
    guardrails: { safety: '', promptInjection: '', toxicity: '' },
  }
}

export type BuildResult = { ok: true; bundle: Bundle; selection: string[] } | { ok: false; errors: string[] }

const blank = (s: string): string | undefined => (s.trim() === '' ? undefined : s)

function parseGuardrail(label: string, text: string, errors: string[]): GuardrailDefinition | undefined {
  if (text.trim() === '') return undefined
  try {
    const v = JSON.parse(text) as unknown
    if (typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string' && Array.isArray((v as { rules?: unknown }).rules)) {
      return v as GuardrailDefinition
    }
    errors.push(`${label} guardrail: expected a guardrail export with a name and rules.`)
  } catch {
    errors.push(`${label} guardrail: not valid JSON.`)
  }
  return undefined
}

/** Checks the form, then emits the bundle for the current selection. Returns every problem at once. */
export function generateBundle(session: Session, details: Details, provisionerFiles: Record<string, string>, mode: 'cli' | 'managed' | 'console' = 'cli'): BuildResult {
  const errors: string[] = []
  const auth = stepsOfKind(session.journey, 'authentication')[0]
  const name = details.applicationName.trim()
  if (name.length < 1 || name.length > 100) errors.push('Application name must be 1 to 100 characters.')

  const selected = new Set(effectiveSelection(session).selected)
  const hasTable = [...selected].some((id) => id.startsWith('dynamodb.table'))
  if (hasTable) {
    if (!/^[A-Za-z0-9_.-]{3,255}$/.test(details.tableName)) errors.push('Table name must be 3 to 255 characters: letters, digits, underscore, dot or hyphen.')
    const fields = details.identifierFields
    if (auth && fields.length !== auth.identifiers.length) errors.push(`Give one attribute name for each identifier (${auth.identifiers.length}).`)
    if (fields.some((f) => !/^[A-Za-z][A-Za-z0-9]*$/.test(f))) errors.push('Attribute names must start with a letter and use letters and digits only.')
    if (new Set(fields).size !== fields.length) errors.push('Attribute names must be different from each other.')
  }

  const guardrails: GuardrailContent = {
    safety: parseGuardrail('Safety', details.guardrails.safety, errors),
    promptInjection: parseGuardrail('Prompt injection', details.guardrails.promptInjection, errors),
    toxicity: parseGuardrail('Toxicity', details.guardrails.toxicity, errors),
  }
  if (errors.length > 0) return { ok: false, errors }

  const options: BundleOptions = {
    applicationName: name,
    tableName: hasTable ? details.tableName : undefined,
    identifierFields: auth ? details.identifierFields : undefined,
    content: {
      knowledgeBaseId: blank(details.knowledgeBaseId)?.trim(),
      safetyMessage: blank(details.safetyMessage),
      mainPrompt: blank(details.mainPrompt),
    },
    guardrails,
    provisionerFiles,
    mode,
  }
  const bundle = emitBundle(session.journey, session.chosen, options)
  return { ok: true, bundle, selection: bundle.selected }
}

// ---- downloads ---------------------------------------------------------------------------------------

/** Zips the bundle files. Fixed timestamps, so the same bundle gives the same zip. */
export function zipFiles(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const path of Object.keys(files).sort()) entries[path] = strToU8(files[path])
  return zipSync(entries, { mtime: new Date('2026-01-01T00:00:00Z') })
}

// ---- Amazon Connect contact flow (needs ids that exist only after the stack is deployed) ------------------------

export interface ContactFlowForm {
  name: string
  channel: 'voice' | 'chat'
  workspaceId: string
  applicationId: string
  aliasId: string
  queueArn: string
  /** Optional: the parts of the queue ARN, used to build it when `queueArn` is empty. The instance id is the one in the Connect instance ARN. */
  queueParts?: QueueParts
  queueName: string
  attributes: string[]
}

export interface QueueParts { region: string; accountId: string; instanceId: string; queueId: string }

/** arn:aws:connect:<region>:<account>:instance/<instance-id>/queue/<queue-id>, or '' while any part is missing. */
export function composeQueueArn(p: QueueParts | undefined): string {
  if (!p) return ''
  const [region, accountId, instanceId, queueId] = [p.region, p.accountId, p.instanceId, p.queueId].map((x) => x.trim())
  return region && accountId && instanceId && queueId ? `arn:aws:connect:${region}:${accountId}:instance/${instanceId}/queue/${queueId}` : ''
}

/** Hand-back attributes: the context variables the escalation path fills (not internal state like isAuthenticated). */
export function handBackAttributes(session: Session): string[] {
  const prefix = 'acxd.contextVariable.'
  return effectiveSelection(session)
    .selected.filter((id) => id.startsWith(prefix))
    .map((id) => id.slice(prefix.length))
    .filter((n) => n !== 'isAuthenticated')
}

export function defaultContactFlowForm(session: Session): ContactFlowForm {
  return {
    name: 'ACXD_Entry',
    channel: session.journey.channels.includes('chat') && !session.journey.channels.includes('voice') ? 'chat' : 'voice',
    workspaceId: '',
    applicationId: '',
    aliasId: '',
    queueArn: '',
    queueParts: { region: '', accountId: '', instanceId: '', queueId: '' },
    queueName: '',
    attributes: handBackAttributes(session),
  }
}

export type ContactFlowResult = { ok: true; json: string } | { ok: false; errors: string[] }

export function generateContactFlow(form: ContactFlowForm): ContactFlowResult {
  const errors: string[] = []
  const need = (value: string, label: string) => {
    if (value.trim() === '') errors.push(`${label} is required.`)
  }
  need(form.name, 'Flow name')
  need(form.workspaceId, 'ACXD workspace id')
  need(form.applicationId, 'ACXD application id (a stack output)')
  need(form.aliasId, 'Deployment alias id (Deploy tab, after deploying)')
  need(form.queueName, 'Queue name')
  const queueArn = form.queueArn.trim() || composeQueueArn(form.queueParts)
  if (!/^arn:aws[a-z-]*:connect:[a-z0-9-]+:\d{12}:instance\/[^/]+\/queue\/[^/]+$/.test(queueArn)) {
    errors.push('Give the queue ARN (arn:aws:connect:<region>:<account>:instance/<instance-id>/queue/<queue-id>), or fill in region, account id, Connect instance id and queue id.')
  }
  if (errors.length > 0) return { ok: false, errors }
  const flow = emitAgenticContactFlow({
    name: form.name.trim(),
    channel: form.channel,
    workspaceId: form.workspaceId.trim(),
    applicationId: form.applicationId.trim(),
    aliasId: form.aliasId.trim(),
    queueArn,
    queueName: form.queueName.trim(),
    attributes: form.attributes,
  })
  return { ok: true, json: `${JSON.stringify(flow, null, 2)}\n` }
}
