export type PageId = 'overview' | 'journey' | 'checklist' | 'bundle' | 'deploy' | 'connect' | 'migration'

export interface PageInfo {
  id: PageId
  label: string
  group: 'Workspace' | 'Pipeline' | 'Tools'
  /** Pipeline position, shown as "1 · Journey". */
  step?: number
  blurb: string
  /** Needs a loaded journey. */
  needsJourney: boolean
}

export const PAGES: readonly PageInfo[] = [
  { id: 'overview', label: 'Overview', group: 'Workspace', blurb: 'Progress through the pipeline for the current journey.', needsJourney: false },
  { id: 'journey', label: 'Journey', group: 'Pipeline', step: 1, blurb: 'Upload a diagram, deck or document, or load a structured journey.', needsJourney: false },
  { id: 'checklist', label: 'Checklist', group: 'Pipeline', step: 2, blurb: 'Choose what to build and resolve what needs a decision.', needsJourney: true },
  { id: 'bundle', label: 'Bundle', group: 'Pipeline', step: 3, blurb: 'Fill in the details and generate the CloudFormation bundle.', needsJourney: true },
  { id: 'deploy', label: 'Deploy', group: 'Pipeline', step: 4, blurb: 'Preview a change set and deploy into a target account.', needsJourney: true },
  { id: 'connect', label: 'Connect flow', group: 'Pipeline', step: 5, blurb: 'Generate the Amazon Connect contact flow for the deployed application.', needsJourney: true },
  { id: 'migration', label: 'Connect and Lex import', group: 'Tools', blurb: 'Read an existing contact flow and Lex bot export.', needsJourney: false },
]

export const pageInfo = (id: PageId): PageInfo => PAGES.find((p) => p.id === id) as PageInfo
