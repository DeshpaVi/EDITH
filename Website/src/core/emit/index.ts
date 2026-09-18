import type { AcxdPlan } from '../model'
import { emitMigrateScript } from './migrateScript'
import { emitContactFlow } from './contactFlow'

export { emitMigrateScript } from './migrateScript'
export { emitContactFlow } from './contactFlow'

export interface Artifacts {
  /** Ordered Create* calls. ACXD has no import path, so this is the delivery mechanism. */
  migrateTs: string
  /** Importable in the Connect console — the routing that stays upstream of ACXD. */
  contactFlowJson: string
}

/** AcxdPlan → the two downloadable files. Deterministic: no I/O, no LLM. */
export function emitArtifacts(plan: AcxdPlan): Artifacts {
  return {
    migrateTs: emitMigrateScript(plan),
    contactFlowJson: emitContactFlow(plan),
  }
}
