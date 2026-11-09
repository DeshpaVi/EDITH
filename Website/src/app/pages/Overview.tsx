import { describeChecklist } from '../../implementation/controller'
import { Button, Panel } from '../../implementation/ui'
import { color, heading, muted } from '../../implementation/theme'
import { PAGES, pageInfo } from '../pages'
import { percentDone } from '../progress'
import { hrefFor } from '../route'
import { useWorkspace } from '../workspace'

const STATUS_LABEL = { todo: 'Not started', active: 'Up next', done: 'Done' } as const

function Ring({ percent }: { percent: number }) {
  const r = 62
  const c = 2 * Math.PI * r
  return (
    <div className="ax-ring" role="img" aria-label={`${percent} percent of the pipeline done`}>
      <svg width="150" height="150" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r={r} fill="none" stroke="var(--ax-ring-track)" strokeWidth="12" />
        <circle cx="75" cy="75" r={r} fill="none" stroke="var(--ax-accent)" strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} transform="rotate(-90 75 75)" />
      </svg>
      <div className="ax-ring-label"><span>{percent}%<small>of the pipeline</small></span></div>
    </div>
  )
}

export function Overview() {
  const ws = useWorkspace()
  const percent = percentDone(ws.stages)
  const view = ws.session ? describeChecklist(ws.session) : null
  const next = ws.stages.find((s) => s.status === 'active')
  return (
    <>
      <h1 className="ax-h1">Overview</h1>
      <p className="ax-lead">From customer journey to a reviewed, deployable implementation. Progress below is computed from what you have done in this tab.</p>
      <div className="ax-overview">
        <Panel style={{ textAlign: 'center' }}>
          <Ring percent={percent} />
          {next && <Button onClick={() => { window.location.hash = hrefFor(next.page) }}>Continue: {pageInfo(next.page).label}</Button>}
        </Panel>
        <Panel>
          <h2 style={{ ...heading, fontSize: 18, marginBottom: 6 }}>{ws.session ? ws.session.journey.title : 'No journey loaded'}</h2>
          {view ? (
            <p style={muted}>
              {view.selectedCount} of {view.summary.total} checklist items selected. {view.reviews.filter((r) => r.severity !== 'info').length} need a human decision.
              {ws.isExample ? ' This is the Census CQA example.' : ''}
            </p>
          ) : (
            <p style={muted}>Load a journey to start. The Census CQA example is a quick way to see the whole pipeline.</p>
          )}
          {!ws.session && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Button onClick={() => { window.location.hash = hrefFor('journey') }}>Load a journey</Button>
            </div>
          )}
          <p style={{ ...muted, fontSize: 12, color: color.textFaint, marginTop: 12 }}>Journeys live in this tab only. Reloading the page clears them.</p>
        </Panel>
      </div>
      <div className="ax-stages">
        {ws.stages.map((s, i) => {
          const info = pageInfo(s.page)
          const blocked = info.needsJourney && !ws.session
          return (
            <a key={s.page} className="ax-stage" href={hrefFor(s.page)} aria-disabled={blocked ? true : undefined}>
              <span className="ax-stage-num">STEP {i + 1} · {STATUS_LABEL[s.status].toUpperCase()}</span>
              <strong>{info.label}</strong>
              <span className="ax-stage-note">{info.blurb}</span>
            </a>
          )
        })}
      </div>
      <p style={{ ...muted, marginTop: 20 }}>Also: <a href={hrefFor('migration')} style={{ color: color.accent }}>{PAGES.find((p) => p.id === 'migration')?.label}</a> reads an existing contact flow and Lex export.</p>
    </>
  )
}
