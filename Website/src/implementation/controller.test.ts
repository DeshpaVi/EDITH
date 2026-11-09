import { describe, it, expect } from 'vitest'
import { IDS } from '../core/checklist'
import {
  parseJourneyText, startSession, toggleItem, effectiveSelection, describeChecklist, defaultDetails,
  generateBundle, zipFiles, handBackAttributes, defaultContactFlowForm, generateContactFlow, composeQueueArn,
} from './controller'
import type { Session } from './controller'
import census from '../core/journey/fixtures/census-cqa.journey.json'
import safety from '../core/emit/acxd/fixtures/guardrail.Safety.json'

const text = () => JSON.stringify(census)
const session = (): Session => {
  const r = parseJourneyText(text())
  if (!r.ok) throw new Error('fixture invalid')
  return startSession(r.journey)
}
const provisioner = { 'index.mjs': '// p', 'package.json': '{}' }

describe('loading a journey', () => {
  it('accepts the Census journey', () => {
    expect(parseJourneyText(text()).ok).toBe(true)
  })
  it('reports invalid JSON in plain words', () => {
    const r = parseJourneyText('{oops')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0].message).toContain('Not valid JSON')
  })
  it('reports validation problems with their paths', () => {
    const r = parseJourneyText('{"title":"x"}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.map((i) => i.path)).toContain('$.steps')
  })
})

describe('selection', () => {
  it('starts from the required and recommended items', () => {
    const s = session()
    expect(effectiveSelection(s).selected).toContain(IDS.authFlow)
    expect(effectiveSelection(s).selected).toContain(IDS.guardrailToxicity)
  })

  it('lets the consultant switch a recommended item off and on', () => {
    let s = toggleItem(session(), IDS.guardrailToxicity)
    expect(effectiveSelection(s).selected).not.toContain(IDS.guardrailToxicity)
    s = toggleItem(s, IDS.guardrailToxicity)
    expect(effectiveSelection(s).selected).toContain(IDS.guardrailToxicity)
  })

  it('refuses to switch a required item off and says so', () => {
    const s = toggleItem(session(), IDS.authFlow)
    expect(effectiveSelection(s).selected).toContain(IDS.authFlow)
    expect(s.notices[0]).toContain('is required and stays on')
  })

  it('keeps a recommended item that a selected item needs, with an explanation', () => {
    const s = toggleItem(session(), IDS.safetyFlow)
    expect(effectiveSelection(s).selected).toContain(IDS.safetyFlow)
    expect(s.notices.join(' ')).toContain('needs it')
  })

  it('switching the dependent off first frees the dependency', () => {
    let s = toggleItem(session(), IDS.guardrailSafety)
    s = toggleItem(s, IDS.safetyFlow)
    expect(effectiveSelection(s).selected).not.toContain(IDS.safetyFlow)
  })

  it('pulls a dependency back in when its dependent is switched on', () => {
    let s = toggleItem(session(), IDS.guardrailSafety)
    s = toggleItem(s, IDS.safetyFlow)
    s = toggleItem(s, IDS.guardrailSafety)
    expect(effectiveSelection(s).selected).toContain(IDS.safetyFlow)
    expect(s.notices.join(' ')).toContain('Added')
  })

  it('ignores an unknown id', () => {
    const s = session()
    expect(toggleItem(s, 'nope')).toBe(s)
  })
})

describe('checklist view', () => {
  const v = describeChecklist(session())
  it('groups items by need and locks the required ones', () => {
    expect(v.sections.map((s) => s.need)).toEqual(['required', 'recommended'])
    expect(v.sections[0].items.every((i) => i.locked && i.checked)).toBe(true)
    expect(v.sections[1].items.every((i) => !i.locked)).toBe(true)
  })
  it('lists who needs each item', () => {
    const table = v.sections[0].items.find((i) => i.item.id === IDS.table)!
    expect(table.neededBy.length).toBeGreaterThan(0)
  })
  it('puts the worst reviews first and reports the summary', () => {
    expect(v.reviews[0].severity).toBe('blocker')
    expect(v.summary.fullyEmittable).toBe(false)
    expect(v.selectedCount).toBe(v.summary.total)
  })
})

describe('generating the bundle', () => {
  const details = () => ({ ...defaultDetails(session().journey), tableName: 'CensusIds', identifierFields: ['censusId', 'zipCode', 'ssnLastFour'], knowledgeBaseId: 'kb-1' })

  it('defaults the details from the journey', () => {
    const d = defaultDetails(session().journey)
    expect(d.identifierFields).toEqual(['censusId', 'homeZipCode', 'lastFourDigitsOfSsn'])
    expect(d.applicationName).toBe('2030 Census Questionnaire Assistance (CQA) demo')
  })

  it('produces the bundle files for a valid form', () => {
    const r = generateBundle(session(), details(), provisioner)
    expect(r.ok).toBe(true)
    if (r.ok) expect(Object.keys(r.bundle.files)).toContain('template.json')
  })

  it('returns every form problem at once', () => {
    const r = generateBundle(session(), { ...details(), applicationName: '', tableName: 'x', identifierFields: ['a', 'a'] }, provisioner)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3)
  })

  it('rejects a table name with spaces', () => {
    const r = generateBundle(session(), { ...details(), tableName: 'my table' }, provisioner)
    expect(r.ok).toBe(false)
  })

  it('accepts pasted guardrail exports and rejects ones that are not guardrails', () => {
    const ok = generateBundle(session(), { ...details(), guardrails: { safety: JSON.stringify(safety), promptInjection: '', toxicity: '' } }, provisioner)
    expect(ok.ok && ok.bundle.spec.guardrails.map((g) => g.name)).toEqual(['Safety'])
    const bad = generateBundle(session(), { ...details(), guardrails: { safety: '{"x":1}', promptInjection: '{oops', toxicity: '' } }, provisioner)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.length).toBe(2)
  })

  it('skips guardrails with no wording and says so instead of inventing it', () => {
    const r = generateBundle(session(), details(), provisioner)
    expect(r.ok && r.bundle.skipped.map((s) => s.id)).toEqual(expect.arrayContaining([IDS.guardrailSafety]))
  })

  it('respects the consultant\'s selection', () => {
    let s = toggleItem(session(), IDS.guardrailToxicity)
    s = toggleItem(s, IDS.guardrailInjection)
    const r = generateBundle(s, { ...details(), guardrails: { safety: JSON.stringify(safety), promptInjection: '', toxicity: '' } }, provisioner)
    expect(r.ok && r.bundle.skipped.map((x) => x.id)).not.toContain(IDS.guardrailToxicity)
  })
})

describe('generating the deployable (managed) bundle', () => {
  const details = () => ({ ...defaultDetails(session().journey), tableName: 'CensusIds', identifierFields: ['censusId', 'zipCode', 'ssnLastFour'], knowledgeBaseId: 'kb-1' })
  it('takes a secret ARN instead of the API key and ships no provisioner folder', () => {
    const r = generateBundle(session(), details(), {}, 'managed')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.bundle.template.Parameters)).toContain('AcxdApiKeySecretArn')
    expect(Object.keys(r.bundle.template.Parameters)).not.toContain('AcxdApiKey')
    expect(Object.keys(r.bundle.files).some((f) => f.startsWith('provisioner/'))).toBe(false)
  })
})

describe('zip download', () => {
  const files = { 'template.json': '{}', 'README.md': '# hi', 'provisioner/index.mjs': '// x' }
  it('is deterministic and contains every file', () => {
    const a = zipFiles(files)
    expect(zipFiles(files)).toEqual(a)
    const text = new TextDecoder('latin1').decode(a)
    for (const name of Object.keys(files)) expect(text).toContain(name)
  })
})

describe('contact flow form', () => {
  const filled = () => ({
    ...defaultContactFlowForm(session()),
    workspaceId: 'ws',
    applicationId: 'app',
    aliasId: 'alias',
    queueName: 'BasicQueue',
    queueArn: 'arn:aws:connect:us-east-1:111122223333:instance/abc/queue/def',
  })

  it('defaults to the hand-back attributes and the journey channel', () => {
    const f = defaultContactFlowForm(session())
    expect(f.attributes.sort()).toEqual(['customerIntent', 'stuckPoint', 'transferSummary'])
    expect(f.channel).toBe('voice')
    expect(handBackAttributes(session())).not.toContain('isAuthenticated')
  })

  it('asks for the ids that only exist after deployment', () => {
    const r = generateContactFlow(defaultContactFlowForm(session()))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('application id')
  })

  it('rejects a queue ARN that is not a Connect queue', () => {
    const r = generateContactFlow({ ...filled(), queueArn: 'arn:aws:s3:::bucket' })
    expect(r.ok).toBe(false)
  })

  it('builds the queue ARN from region, account, instance id and queue id when no ARN is pasted', () => {
    const parts = { region: 'us-east-1', accountId: '111122223333', instanceId: 'abc', queueId: 'def' }
    expect(composeQueueArn(parts)).toBe('arn:aws:connect:us-east-1:111122223333:instance/abc/queue/def')
    expect(composeQueueArn({ ...parts, queueId: ' ' })).toBe('')
    expect(composeQueueArn(undefined)).toBe('')
    const r = generateContactFlow({ ...filled(), queueArn: '', queueParts: parts })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.json).toContain('instance/abc/queue/def')
    const missing = generateContactFlow({ ...filled(), queueArn: '', queueParts: { ...parts, instanceId: '' } })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.errors.join(' ')).toContain('instance id')
  })

  it('produces importable flow JSON', () => {
    const r = generateContactFlow(filled())
    expect(r.ok).toBe(true)
    if (r.ok) {
      const flow = JSON.parse(r.json)
      expect(flow.Version).toBe('2019-10-30')
      expect(JSON.stringify(flow)).toContain('"WorkspaceId":"ws"')
    }
  })
})
