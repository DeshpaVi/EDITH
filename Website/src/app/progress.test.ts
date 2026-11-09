import { describe, expect, it } from 'vitest'
import { percentDone, pipelineStages } from './progress'

const none = { hasJourney: false, checklistConfirmed: false, bundleBuilt: false, deployed: false, contactFlowBuilt: false }

describe('pipelineStages', () => {
  it('starts with the journey as the only active stage', () => {
    const s = pipelineStages(none)
    expect(s.map((x) => x.status)).toEqual(['active', 'todo', 'todo', 'todo', 'todo'])
    expect(percentDone(s)).toBe(0)
  })
  it('moves the active stage to the first unfinished one', () => {
    const s = pipelineStages({ ...none, hasJourney: true, checklistConfirmed: true })
    expect(s.map((x) => x.status)).toEqual(['done', 'done', 'active', 'todo', 'todo'])
    expect(percentDone(s)).toBe(40)
  })
  it('does not skip a stage: a later step done does not make an earlier one active-less', () => {
    const s = pipelineStages({ ...none, hasJourney: true, bundleBuilt: true })
    expect(s.map((x) => x.status)).toEqual(['done', 'active', 'done', 'todo', 'todo'])
  })
  it('reaches 100 percent only when everything is done', () => {
    const s = pipelineStages({ hasJourney: true, checklistConfirmed: true, bundleBuilt: true, deployed: true, contactFlowBuilt: true })
    expect(percentDone(s)).toBe(100)
    expect(s.every((x) => x.status === 'done')).toBe(true)
  })
})
