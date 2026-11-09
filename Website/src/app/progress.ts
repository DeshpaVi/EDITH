import type { PageId } from './pages'

export type StageStatus = 'todo' | 'active' | 'done'

export interface ProgressInput {
  hasJourney: boolean
  checklistConfirmed: boolean
  bundleBuilt: boolean
  deployed: boolean
  contactFlowBuilt: boolean
}

export interface Stage {
  page: PageId
  status: StageStatus
}

/** Computed from what the user has actually done, never from a stored percentage. The first unfinished stage is the active one. */
export function pipelineStages(p: ProgressInput): Stage[] {
  const done: [PageId, boolean][] = [
    ['journey', p.hasJourney],
    ['checklist', p.checklistConfirmed],
    ['bundle', p.bundleBuilt],
    ['deploy', p.deployed],
    ['connect', p.contactFlowBuilt],
  ]
  let activeSet = false
  return done.map(([page, isDone]) => {
    if (isDone) return { page, status: 'done' as const }
    if (!activeSet) {
      activeSet = true
      return { page, status: 'active' as const }
    }
    return { page, status: 'todo' as const }
  })
}

export const percentDone = (stages: Stage[]): number => Math.round((stages.filter((s) => s.status === 'done').length / stages.length) * 100)
