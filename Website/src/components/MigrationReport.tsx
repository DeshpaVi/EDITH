import type { AcxdPlan, IvrModel, Risk } from '../core/model'
import { emitArtifacts } from '../core/emit'

function download(filename: string, contents: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const SEV: Record<Risk['severity'], { color: string; label: string }> = {
  blocker: { color: '#ff375f', label: 'Blocker' },
  warn: { color: '#ff9f0a', label: 'Warning' },
  info: { color: '#0a84ff', label: 'Info' },
}

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 16,
  padding: 20,
}

const label: React.CSSProperties = {
  color: 'rgba(245,245,247,0.35)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: 12,
}

function Bar({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100)
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ color: '#f5f5f7', fontSize: 22, fontWeight: 600 }}>{value}<span style={{ color: 'rgba(245,245,247,0.35)', fontSize: 15 }}>/{total}</span></span>
        <span style={{ color, fontSize: 13, fontWeight: 600 }}>{pct}%</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
    </>
  )
}

function Stat({ n, label: text }: { n: number; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: '#f5f5f7', fontSize: 24, fontWeight: 600 }}>{n}</div>
      <div style={{ color: 'rgba(245,245,247,0.4)', fontSize: 11 }}>{text}</div>
    </div>
  )
}

export function MigrationReport({ model, plan }: { model: IvrModel; plan: AcxdPlan }) {
  const { flow, nlu } = model.coverage
  const nodeCount = plan.flows.reduce((n, f) => n + Object.keys(f.nodes).length, 0)
  const blockers = plan.risks.filter((r) => r.severity === 'blocker').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Coverage — two dimensions, never averaged into one number */}
      <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <p style={label}>Flow blocks mapped</p>
          <Bar value={flow.mapped} total={flow.totalActions} color={flow.unknown.length === 0 ? '#30d158' : '#ff9f0a'} />
          {flow.unknown.length > 0 && (
            <p style={{ color: 'rgba(245,245,247,0.45)', fontSize: 12, margin: '10px 0 0' }}>
              Unmapped: {flow.unknown.map((u) => u.sourceType).join(', ')}
            </p>
          )}
        </div>
        <div>
          <p style={label}>Intents resolved</p>
          <Bar value={nlu.resolved} total={nlu.totalIntents} color={nlu.totalIntents > 0 && nlu.resolved === nlu.totalIntents ? '#30d158' : '#ff9f0a'} />
          <p style={{ color: 'rgba(245,245,247,0.45)', fontSize: 12, margin: '10px 0 0' }}>
            {nlu.totalIntents === 0
              ? 'No Lex bot export supplied.'
              : `${nlu.dangling.length} dangling · ${nlu.orphaned.length} never reached`}
          </p>
        </div>
      </div>

      {/* What the plan actually contains */}
      <div style={card}>
        <p style={label}>ACXD resources planned</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(76px,1fr))', gap: 14 }}>
          <Stat n={plan.flows.length} label="Flows" />
          <Stat n={nodeCount} label="Nodes" />
          <Stat n={plan.slotTypes.length} label="Slot types" />
          <Stat n={plan.dataRequests.length} label="Data reqs" />
          <Stat n={plan.guardrails.length} label="Guardrails" />
          <Stat n={plan.contextVariables.length} label="Context vars" />
        </div>
      </div>

      {/* Risks — the honest bit */}
      <div style={card}>
        <p style={label}>
          Needs a human ({plan.risks.length}){blockers > 0 && <span style={{ color: '#ff375f' }}> · {blockers} blocker{blockers > 1 ? 's' : ''}</span>}
        </p>
        {plan.risks.length === 0 ? (
          <p style={{ color: 'rgba(245,245,247,0.45)', fontSize: 13, margin: 0 }}>Nothing flagged.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {plan.risks.map((r) => (
              <div key={r.id} style={{ borderLeft: `2px solid ${SEV[r.severity].color}`, paddingLeft: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ color: SEV[r.severity].color, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{SEV[r.severity].label}</span>
                  <span style={{ color: '#f5f5f7', fontSize: 13.5, fontWeight: 600 }}>{r.title}</span>
                </div>
                <p style={{ color: 'rgba(245,245,247,0.5)', fontSize: 12.5, lineHeight: 1.55, margin: 0 }}>{r.detail}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Undocumented shapes — recorded, never guessed */}
      {plan.schemaGaps.length > 0 && (
        <div style={card}>
          <p style={label}>Unconfirmed ACXD schema ({plan.schemaGaps.length})</p>
          <p style={{ color: 'rgba(245,245,247,0.5)', fontSize: 12.5, lineHeight: 1.55, margin: '0 0 12px' }}>
            AWS does not publish these shapes. The emitter will write a <code style={{ color: '#ff9f0a' }}>TODO(acxd-schema)</code> marker rather than guess — a plausible guess that fails at build time is worse than a visible gap.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[...new Set(plan.schemaGaps.map((g) => g.marker))].map((m) => (
              <span key={m} style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(255,159,10,0.12)', border: '1px solid rgba(255,159,10,0.3)', color: '#ff9f0a', fontSize: 11.5 }}>{m}</span>
            ))}
          </div>
        </div>
      )}

      {/* Beyond parity */}
      {plan.recommendations.length > 0 && (
        <div style={card}>
          <p style={label}>Worth considering ({plan.recommendations.length})</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {plan.recommendations.map((r) => (
              <div key={r.id}>
                <p style={{ color: '#f5f5f7', fontSize: 13.5, fontWeight: 600, margin: '0 0 3px' }}>{r.title}</p>
                <p style={{ color: 'rgba(245,245,247,0.5)', fontSize: 12.5, lineHeight: 1.55, margin: 0 }}>{r.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The deliverable — ACXD has no import path, so this is how the config lands */}
      <div style={{ ...card, borderColor: 'rgba(48,209,88,0.28)', background: 'rgba(48,209,88,0.05)' }}>
        <p style={label}>Download the migration</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            onClick={() => download('migrate.ts', emitArtifacts(plan).migrateTs, 'text/typescript')}
            style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid rgba(48,209,88,0.45)', background: 'rgba(48,209,88,0.14)', color: '#30d158', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
          >↓ migrate.ts</button>
          <button
            onClick={() => download('contact-flow.json', emitArtifacts(plan).contactFlowJson, 'application/json')}
            style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.06)', color: 'rgba(245,245,247,0.85)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
          >↓ contact-flow.json</button>
        </div>
        <p style={{ color: 'rgba(245,245,247,0.5)', fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>
          ACXD has no import path — resources are created by API call, so <strong style={{ color: '#f5f5f7' }}>migrate.ts</strong> is
          the delivery mechanism. Run it yourself with your own key (<code style={{ color: '#30d158' }}>ACXD_API_KEY</code> from
          your environment); it prompts before creating anything. <strong style={{ color: '#f5f5f7' }}>contact-flow.json</strong> imports
          in the Connect console, which does support import.
        </p>
      </div>

      {/* What stays in Connect */}
      <div style={card}>
        <p style={label}>Stays in the contact flow</p>
        <p style={{ color: 'rgba(245,245,247,0.5)', fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>
          {plan.contactFlow.queueAssignments.length} queue assignment(s)
          {plan.contactFlow.hoursOfOperation && ', hours of operation'}
          {plan.contactFlow.recordingBehavior && ', recording behaviour'}
          {plan.contactFlow.voice?.voiceId && `, voice (${plan.contactFlow.voice.voiceId})`}
          {' '}— these stay upstream of the Agentic CX block. The final cutover step is wiring that block
          to application <strong style={{ color: '#f5f5f7' }}>{plan.application.name}</strong> in the Connect console, which is an admin action, not an SDK call.
        </p>
      </div>
    </div>
  )
}
