import { useState } from 'react'
import { DeployStep } from '../deploy/DeployStep'
import { BundleStep, ChecklistStep, ContactFlowStep, JourneyStep } from '../implementation/steps'
import { Panel } from '../implementation/ui'
import { muted } from '../implementation/theme'
import { MigrationPage } from './pages/MigrationPage'
import { Overview } from './pages/Overview'
import { PAGES, pageInfo } from './pages'
import type { PageId } from './pages'
import { hrefFor } from './route'
import { useWorkspace } from './workspace'

const go = (page: PageId) => { window.location.hash = hrefFor(page) }

function Heading({ page }: { page: PageId }) {
  const info = pageInfo(page)
  return (
    <>
      <h1 className="ax-h1">{info.step ? `${info.step} · ${info.label}` : info.label}</h1>
      <p className="ax-lead">{info.blurb}</p>
    </>
  )
}

function NeedJourney() {
  return (
    <Panel>
      <p style={muted}>Load a journey first. <a href={hrefFor('journey')} style={{ color: 'var(--ax-accent)' }}>Go to Journey</a></p>
    </Panel>
  )
}

function PageBody({ id }: { id: PageId }) {
  const ws = useWorkspace()
  if (id === 'overview') return <Overview />
  if (id === 'migration') return <MigrationPage />
  const { session, details } = ws
  if (id === 'journey') {
    return (
      <>
        <Heading page={id} />
        <JourneyStep
          issues={ws.issues}
          onLoad={(text, example) => { if (ws.openText(text, example)) go('checklist') }}
          onExtracted={(journey, summary) => { ws.openJourney(journey, false, summary); go('checklist') }}
        />
      </>
    )
  }
  if (!session || !details) return <><Heading page={id} /><NeedJourney /></>
  return (
    <>
      <Heading page={id} />
      {id === 'checklist' && <ChecklistStep session={session} readSummary={ws.readSummary} onChange={ws.changeSession} onNext={() => { ws.confirmChecklist(); go('bundle') }} />}
      {id === 'bundle' && <BundleStep session={session} details={details} onDetails={ws.setDetails} result={ws.result} onResult={ws.setResult} isExample={ws.isExample} />}
      {id === 'deploy' && <DeployStep session={session} details={details} onDeployed={(p) => { ws.setPrefill(p); go('connect') }} />}
      {id === 'connect' && <ContactFlowStep key={`${ws.journeyKey}-${ws.prefill?.applicationId ?? ''}`} session={session} prefill={ws.prefill} onGenerated={ws.markContactFlow} />}
    </>
  )
}

/**
 * Pages stay mounted once visited (hidden, not removed), so a half-filled form, a chosen file or a deploy in
 * progress survives moving around the workspace. Pages that hold per-journey state are re-keyed when a new journey opens.
 */
export function Pages({ page }: { page: PageId }) {
  const ws = useWorkspace()
  const [seen, setSeen] = useState<ReadonlySet<PageId>>(() => new Set([page]))
  if (!seen.has(page)) setSeen(new Set([...seen, page]))
  return (
    <>
      {PAGES.filter((p) => seen.has(p.id) || p.id === page).map((p) => (
        <section key={`${p.id}-${p.id === 'overview' || p.id === 'migration' ? '' : ws.journeyKey}`} className="ax-page" hidden={p.id !== page} aria-label={p.label}>
          <PageBody id={p.id} />
        </section>
      ))}
    </>
  )
}
