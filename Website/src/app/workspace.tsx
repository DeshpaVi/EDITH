import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Journey, ValidationIssue } from '../core/journey'
import { defaultDetails, parseJourneyText, startSession } from '../implementation/controller'
import type { BuildResult, Details, Session } from '../implementation/controller'
import { pipelineStages } from './progress'
import type { Stage } from './progress'

export interface Prefill { workspaceId: string; applicationId: string }

export interface Workspace {
  session: Session | null
  details: Details | null
  issues: ValidationIssue[]
  isExample: boolean
  result: BuildResult | null
  readSummary: string[]
  prefill: Prefill | null
  /** Changes whenever a new journey is opened, so pages holding their own form state start fresh. */
  journeyKey: number
  stages: Stage[]
  openJourney: (journey: Journey, example: boolean, summary?: string[]) => boolean
  openText: (text: string, example: boolean) => boolean
  changeSession: (s: Session) => void
  setDetails: (d: Details) => void
  setResult: (r: BuildResult) => void
  setPrefill: (p: Prefill) => void
  confirmChecklist: () => void
  markContactFlow: () => void
}

const Ctx = createContext<Workspace | null>(null)

/** Everything the pipeline pages share. Held in memory only: a reload starts clean, and nothing is stored or sent. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [details, setDetailsState] = useState<Details | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [isExample, setIsExample] = useState(false)
  const [result, setResultState] = useState<BuildResult | null>(null)
  const [readSummary, setReadSummary] = useState<string[]>([])
  const [prefill, setPrefillState] = useState<Prefill | null>(null)
  const [journeyKey, setJourneyKey] = useState(0)
  const [checklistConfirmed, setChecklistConfirmed] = useState(false)
  const [contactFlowBuilt, setContactFlowBuilt] = useState(false)

  const openJourney = useCallback((journey: Journey, example: boolean, summary: string[] = []) => {
    setIssues([])
    setIsExample(example)
    setReadSummary(summary)
    setSession(startSession(journey))
    setDetailsState(defaultDetails(journey))
    setResultState(null)
    setPrefillState(null)
    setChecklistConfirmed(false)
    setContactFlowBuilt(false)
    setJourneyKey((k) => k + 1)
    return true
  }, [])

  const openText = useCallback(
    (text: string, example: boolean) => {
      const loaded = parseJourneyText(text)
      if (!loaded.ok) {
        setIssues(loaded.issues)
        return false
      }
      return openJourney(loaded.journey, example)
    },
    [openJourney],
  )

  const value = useMemo<Workspace>(
    () => ({
      session, details, issues, isExample, result, readSummary, prefill, journeyKey,
      stages: pipelineStages({ hasJourney: session !== null, checklistConfirmed, bundleBuilt: result?.ok === true, deployed: prefill !== null, contactFlowBuilt }),
      openJourney,
      openText,
      changeSession: (s) => { setSession(s); setResultState(null) },
      setDetails: (d) => { setDetailsState(d); setResultState(null) },
      setResult: setResultState,
      setPrefill: setPrefillState,
      confirmChecklist: () => setChecklistConfirmed(true),
      markContactFlow: () => setContactFlowBuilt(true),
    }),
    [session, details, issues, isExample, result, readSummary, prefill, journeyKey, checklistConfirmed, contactFlowBuilt, openJourney, openText],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWorkspace(): Workspace {
  const w = useContext(Ctx)
  if (!w) throw new Error('useWorkspace outside WorkspaceProvider')
  return w
}
