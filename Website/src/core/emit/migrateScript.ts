import type { AcxdPlan, PlannedFlow, PlannedNode } from '../model'

const lit = (v: unknown): string => JSON.stringify(v)

/** Indent every line of a JSON blob so the generated file reads like handwritten code. */
function block(value: unknown, indent: number): string {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : ' '.repeat(indent) + line))
    .join('\n')
}

/**
 * AcxdPlan → a runnable `migrate.ts`.
 *
 * Resources are emitted in dependency order — slot types → secrets → data requests →
 * guardrails → flows → application → build → deploy — so no reference precedes its
 * definition. ACXD has no import path; this script *is* the delivery mechanism.
 *
 * Two hard constraints show up directly in the output: the API key is read from the
 * environment and never written into the file, and nothing is created until the operator
 * confirms at the prompt.
 */
export function emitMigrateScript(plan: AcxdPlan): string {
  const commands = [
    'AgenticCXDesignerClient',
    ...(plan.slotTypes.length ? ['CreateSlotTypeCommand'] : []),
    ...(plan.dataRequests.length ? ['CreateDataRequestCommand'] : []),
    ...(plan.guardrails.length ? ['CreateGuardrailCommand'] : []),
    ...(plan.contextVariables.length ? ['CreateContextVariableCommand'] : []),
    'CreateFlowCommand',
    'CreateApplicationCommand',
    'CreateApplicationBuildCommand',
    'GetApplicationBuildCommand',
    'CreateApplicationDeploymentCommand',
  ]

  return [
    header(plan),
    `import {\n${commands.map((c) => `  ${c},`).join('\n')}\n} from 'amazon-connect-acxd-sdk'`,
    `import { createInterface } from 'node:readline/promises'`,
    '',
    preamble(),
    '',
    confirmGate(plan),
    '',
    'async function main() {',
    '  await confirm()',
    '',
    ...sections(plan),
    '}',
    '',
    'main().catch((err) => {',
    '  console.error(`\\nFailed: ${err?.type ?? err?.name ?? "Error"} — ${err?.message ?? err}`)',
    '  console.error("Resources created before this point still exist. Re-running will conflict on those (ConflictException); delete them or switch to the Update* commands.")',
    '  process.exit(1)',
    '})',
    '',
  ].join('\n')
}

function header(plan: AcxdPlan): string {
  const gaps = [...new Set(plan.schemaGaps.map((g) => g.marker))]
  const blockers = plan.risks.filter((r) => r.severity === 'blocker')
  return [
    '/**',
    ' * ACXD migration script — GENERATED. Review before running.',
    ' *',
    ` * Application: ${plan.application.name}`,
    ` * Creates: ${plan.slotTypes.length} slot type(s), ${plan.dataRequests.length} data request(s), ` +
      `${plan.guardrails.length} guardrail(s), ${plan.contextVariables.length} context variable(s), ${plan.flows.length} flow(s).`,
    ' *',
    ...(blockers.length
      ? [' * UNRESOLVED BLOCKERS — these were flagged during design and are not fixed here:',
         ...blockers.map((r) => ` *   - ${r.title}`), ' *']
      : []),
    ...(gaps.length
      ? [' * This script contains TODO(acxd-schema) markers where AWS does not publish the',
         ' * required shape. Each one must be confirmed against a real workspace before the',
         ' * build will succeed:', ...gaps.map((g) => ` *   - ${g}`), ' *']
      : []),
    ' * Usage:',
    ' *   export ACXD_API_KEY="acxd_live_..."',
    ' *   export ACXD_WORKSPACE_ID="..."',
    ' *   npx tsx migrate.ts            # prompts before writing anything',
    ' *   npx tsx migrate.ts --yes      # skip the prompt (CI)',
    ' */',
  ].join('\n')
}

function preamble(): string {
  return [
    '// The key is read from the environment and never written into this file. It grants',
    '// broad workspace access — treat it like any other secret.',
    'const apiKey = process.env.ACXD_API_KEY',
    'const workspaceId = process.env.ACXD_WORKSPACE_ID',
    '',
    'if (!apiKey || !workspaceId) {',
    '  console.error("Set ACXD_API_KEY and ACXD_WORKSPACE_ID before running.")',
    '  process.exit(1)',
    '}',
    '',
    'const client = new AgenticCXDesignerClient({ apiKey, workspaceId })',
    'const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))',
  ].join('\n')
}

/** The human review gate, carried into the generated artifact itself. */
function confirmGate(plan: AcxdPlan): string {
  const total =
    plan.slotTypes.length + plan.dataRequests.length + plan.guardrails.length +
    plan.contextVariables.length + plan.flows.length + 1
  return [
    'async function confirm() {',
    '  if (process.argv.includes("--yes")) return',
    `  console.log("About to create ${total} resource(s) in workspace " + workspaceId + " and deploy to ${plan.contactFlow.agenticCxBlock.environment.toLowerCase()}.")`,
    '  const rl = createInterface({ input: process.stdin, output: process.stdout })',
    '  const answer = await rl.question("Type \'yes\' to continue: ")',
    '  rl.close()',
    '  if (answer.trim().toLowerCase() !== "yes") {',
    '    console.log("Aborted. Nothing was created.")',
    '    process.exit(0)',
    '  }',
    '}',
  ].join('\n')
}

function sections(plan: AcxdPlan): string[] {
  const out: string[] = []
  const step = (n: number, title: string) => out.push(`  // ${n}. ${title}`)
  let n = 1

  if (plan.slotTypes.length) {
    step(n++, 'Slot types — flows reference these, so they come first.')
    for (const t of plan.slotTypes) {
      out.push(`  await client.send(new CreateSlotTypeCommand(${block({
        slotTypeId: t.slotTypeId,
        values: t.values,
        mainLanguageCode: t.mainLanguageCode,
        languageCodes: t.languageCodes,
        description: t.description,
      }, 4)}))`)
    }
    out.push('')
  }

  if (plan.contextVariables.length) {
    step(n++, 'Context variables — cross-flow state, replacing IVR session attributes.')
    for (const v of plan.contextVariables) {
      out.push(`  // from: ${v.origin}`)
      out.push(`  await client.send(new CreateContextVariableCommand(${block({
        name: v.name, schema: v.schema,
      }, 4)}))`)
    }
    out.push('')
  }

  if (plan.dataRequests.length) {
    step(n++, 'Data requests — webhooks replacing the IVR Lambda dips.')
    for (const d of plan.dataRequests) {
      out.push(`  // TODO(migration): source Lambda was ${d.sourceSystem}`)
      out.push(`  //   ACXD calls webhooks over HTTPS and cannot invoke a Lambda ARN directly.`)
      out.push(`  //   Put the function behind a Function URL or API Gateway, then replace the`)
      out.push(`  //   inline-static stub below with { implementation: "external", method: "POST", url: "<https-url>" }.`)
      out.push(`  await client.send(new CreateDataRequestCommand(${block({
        dataRequestId: d.dataRequestId,
        type: d.type,
        description: d.description,
        sensitive: d.sensitive,
        // Stubbed so the application builds and runs before any backend is wired.
        webhook: { implementation: 'inline-static', code: '{}' },
      }, 4)}))`)
    }
    out.push('')
  }

  if (plan.guardrails.length) {
    step(n++, 'Guardrails — replacing what the IVR enforced structurally.')
    for (const g of plan.guardrails) {
      out.push(`  await client.send(new CreateGuardrailCommand(${block({
        name: g.name, trigger: g.trigger, description: g.description, active: g.active, rules: g.rules,
      }, 4)}))`)
    }
    out.push('')
  }

  step(n++, 'Flows.')
  for (const f of plan.flows) out.push(...flowSection(f, plan))

  step(n++, 'Application.')
  out.push(`  const app = await client.send(new CreateApplicationCommand(${block({
    name: plan.application.name,
    description: plan.application.description,
    flows: plan.flows.map((f) => ({ flowId: f.flowId })),
    settings: plan.application.settings,
  }, 4)}))`)
  out.push('')

  step(n++, 'Build, then poll until it stops being PENDING.')
  out.push('  const build = await client.send(new CreateApplicationBuildCommand({ applicationIdentifier: app.applicationId }))')
  out.push('  let status = "PENDING"')
  out.push('  for (let i = 0; i < 60 && status === "PENDING"; i++) {')
  out.push('    await sleep(5000)')
  out.push('    const polled = await client.send(new GetApplicationBuildCommand({')
  out.push('      applicationIdentifier: app.applicationId, buildIdentifier: build.buildId,')
  out.push('    }))')
  out.push('    status = polled.status')
  out.push('  }')
  out.push('  if (status !== "BUILT") throw new Error(`Build finished as ${status}, not BUILT — check validation errors in Admin Hub.`)')
  out.push('')

  step(n, 'Deploy.')
  out.push('  await client.send(new CreateApplicationDeploymentCommand({')
  out.push('    applicationIdentifier: app.applicationId,')
  out.push('    buildIdentifier: build.buildId,')
  out.push(`    environment: ${lit(plan.contactFlow.agenticCxBlock.environment.toLowerCase())},`)
  out.push(`    languageCodes: ${lit(plan.application.settings.languageCodes)},`)
  out.push('  }))')
  out.push('')
  out.push(`  console.log("Done. Application " + app.applicationId + " deployed.")`)
  out.push('  console.log("Remaining manual step: import contact-flow.json in the Connect console and add the Agentic CX block.")')
  return out
}

function flowSection(f: PlannedFlow, plan: AcxdPlan): string[] {
  const gapNodes = new Set(plan.schemaGaps.flatMap((g) => g.nodeIds))
  const nodes: Record<string, PlannedNode> = {}
  for (const [id, node] of Object.entries(f.nodes)) {
    const { sourceNodeId: _s, compliance: _c, ...rest } = node
    nodes[id] = rest as PlannedNode
  }
  const notes = Object.values(f.nodes)
    .filter((n) => gapNodes.has(n.nodeId))
    .map((n) => `  // TODO(acxd-schema): node ${n.nodeId} (${n.type}) needs metadata/conditions this file cannot supply.`)

  return [
    ...notes,
    `  await client.send(new CreateFlowCommand(${block({
      flowId: f.flowId,
      description: f.description,
      mainLanguageCode: f.mainLanguageCode,
      languageCodes: f.languageCodes,
      slotTypes: f.slotTypes,
      contextVariables: f.contextVariables,
      nodes,
    }, 4)}))`,
    '',
  ]
}

export { lit }
