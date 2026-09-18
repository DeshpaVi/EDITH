import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { parseIvr } from '../parse'
import { designPlan } from '../design'
import { emitArtifacts } from './index'

import simpleMenu from '../fixtures/contact-flows/simple-menu.json'
import lexBacked from '../fixtures/contact-flows/lex-backed.json'
import acmeV2 from '../fixtures/lex-bots/acme-v2.json'

const AT = '2026-01-01T00:00:00.000Z'
const build = (flow: unknown, bot?: unknown, name = 'acme-billing-ivr') =>
  emitArtifacts(designPlan(parseIvr({
    contactFlow: flow,
    contactFlowName: name,
    lexExports: bot ? [{ name: 'acme-v2', content: bot }] : [],
    importedAt: AT,
  })))

/** Parse with the real TypeScript compiler — the only honest check of "valid TypeScript". */
function syntaxErrors(source: string): string[] {
  const sf = ts.createSourceFile('migrate.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  // parseDiagnostics is internal but is the only way to see syntactic errors pre-program.
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []
  return diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
}

describe('migrate.ts is runnable TypeScript', () => {
  const { migrateTs } = build(simpleMenu, acmeV2)

  it('parses with zero syntax errors', () => {
    expect(syntaxErrors(migrateTs)).toEqual([])
  })

  it('also parses for a Lex-backed flow', () => {
    expect(syntaxErrors(build(lexBacked, acmeV2).migrateTs)).toEqual([])
  })

  it('imports every command it uses', () => {
    const imported = migrateTs.slice(migrateTs.indexOf('import {'), migrateTs.indexOf("} from 'amazon-connect-acxd-sdk'"))
    for (const cmd of migrateTs.match(/new (\w+Command)\(/g) ?? []) {
      expect(imported).toContain(cmd.replace('new ', '').replace('(', ''))
    }
  })
})

describe('dependency order — no reference precedes its definition', () => {
  const { migrateTs } = build(simpleMenu, acmeV2)
  const at = (needle: string) => migrateTs.indexOf(needle)

  it('creates slot types before the flows that attach them', () => {
    expect(at('CreateSlotTypeCommand')).toBeLessThan(at('CreateFlowCommand'))
  })

  it('creates data requests and guardrails before the application references them', () => {
    expect(at('CreateDataRequestCommand')).toBeLessThan(at('CreateApplicationCommand'))
    expect(at('CreateGuardrailCommand')).toBeLessThan(at('CreateApplicationCommand'))
  })

  it('builds after creating, and deploys after building', () => {
    expect(at('CreateApplicationCommand')).toBeLessThan(at('CreateApplicationBuildCommand'))
    expect(at('CreateApplicationBuildCommand')).toBeLessThan(at('CreateApplicationDeploymentCommand'))
  })

  it('waits for the build to leave PENDING before deploying', () => {
    expect(migrateTs).toContain('GetApplicationBuildCommand')
    expect(migrateTs).toMatch(/status !== "BUILT"/)
  })
})

describe('the two hard constraints show up in the artifact', () => {
  const { migrateTs } = build(simpleMenu, acmeV2)

  it('never writes an API key into the file', () => {
    expect(migrateTs).not.toMatch(/acxd_live_[A-Za-z0-9]/)
    expect(migrateTs).toContain('process.env.ACXD_API_KEY')
    expect(migrateTs).toContain('process.env.ACXD_WORKSPACE_ID')
  })

  it('refuses to create anything without an explicit confirmation', () => {
    expect(migrateTs).toContain('async function confirm()')
    expect(migrateTs).toMatch(/Type 'yes' to continue/)
    expect(migrateTs.indexOf('await confirm()')).toBeLessThan(migrateTs.indexOf('CreateSlotTypeCommand('))
  })
})

describe('gaps stay visible instead of being guessed', () => {
  const { migrateTs } = build(simpleMenu, acmeV2)

  it('marks undocumented shapes rather than inventing them', () => {
    expect(migrateTs).toContain('TODO(acxd-schema)')
    expect(migrateTs).toContain('user_choice ↔ slot type binding')
  })

  it('stubs data requests and says exactly what to replace them with', () => {
    expect(migrateTs).toContain('inline-static')
    expect(migrateTs).toContain('cannot invoke a Lambda ARN directly')
    expect(migrateTs).toContain('function:CheckOutage')
  })

  it('names unresolved blockers in the header', () => {
    const { migrateTs: withBlocker } = build(lexBacked)
    expect(withBlocker).toContain('UNRESOLVED BLOCKERS')
    expect(withBlocker).toContain('Conversational content is missing')
  })
})

describe('compliance text survives byte-for-byte', () => {
  it('reproduces the disclosure exactly as the source wrote it', () => {
    const original = 'Thank you for calling Acme Utilities. This call may be recorded for quality and training purposes.'
    expect(build(simpleMenu).migrateTs).toContain(JSON.stringify(original).slice(1, -1))
  })
})

describe('contact-flow.json', () => {
  const { contactFlowJson } = build(simpleMenu, acmeV2)
  const flow = JSON.parse(contactFlowJson)

  it('is valid Connect flow JSON with a reachable start', () => {
    expect(flow.Version).toBe('2019-10-30')
    const ids = flow.Actions.map((a: { Identifier: string }) => a.Identifier)
    expect(ids).toContain(flow.StartAction)
  })

  it('carries only the routing that stays upstream of ACXD', () => {
    const types = flow.Actions.map((a: { Type: string }) => a.Type)
    expect(types).toContain('UpdateContactTextToSpeechVoice')
    expect(types).toContain('SetWorkingQueue')
    expect(types).not.toContain('GetParticipantInput')
    expect(types).not.toContain('StoreUserInput')
  })

  it('chains every action to the next so the flow is connected', () => {
    const actions = flow.Actions as Array<{ Identifier: string; Transitions: { NextAction?: string } }>
    for (let i = 0; i < actions.length - 1; i++) {
      expect(actions[i].Transitions.NextAction).toBe(actions[i + 1].Identifier)
    }
    expect(actions.at(-1)!.Transitions.NextAction).toBeUndefined()
  })

  it('does not invent the Agentic CX block, and says why', () => {
    const types = flow.Actions.map((a: { Type: string }) => a.Type)
    expect(types.some((t: string) => /agentic/i.test(t))).toBe(false)
    expect(flow.Metadata.__MIGRATION_NOTE).toContain('MANUAL STEP REQUIRED')
    // The application is named after the uploaded export, not a generic placeholder.
    expect(flow.Metadata.__MIGRATION_NOTE).toContain('AcmeBillingIvr')
  })
})

describe('determinism', () => {
  it('emits byte-identical artifacts across runs', () => {
    const a = build(lexBacked, acmeV2)
    const b = build(lexBacked, acmeV2)
    expect(a.migrateTs).toBe(b.migrateTs)
    expect(a.contactFlowJson).toBe(b.contactFlowJson)
  })
})
