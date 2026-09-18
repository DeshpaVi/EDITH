import { useState } from 'react'

// ─── Icons ────────────────────────────────────────────────────────────────────

const I = {
  Phone: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  ),
  Flow: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" />
      <path d="M9 6h3a3 3 0 013 3v3" /><path d="M18 15V9" />
    </svg>
  ),
  Check: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Arrow: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  ),
  User: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
  Bot: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M12 11V7" /><circle cx="12" cy="5" r="2" />
      <circle cx="8" cy="16" r="1" fill="currentColor" /><circle cx="16" cy="16" r="1" fill="currentColor" /><path d="M8 19h8" />
    </svg>
  ),
  Agent: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
    </svg>
  ),
  Database: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  Analytics: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  Lambda: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3l6 18M6 3h3l9 18" />
    </svg>
  ),
  Menu: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  Close: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Migrate: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3l14 9-14 9V3z" />
    </svg>
  ),
  Sparkle: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />
    </svg>
  ),
  Upload: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M5 20h14" />
    </svg>
  ),
  Puzzle: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  ),
  CxDesigner: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <circle cx="8.5" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <path d="M9 13s1 1.5 3 1.5 3-1.5 3-1.5" />
    </svg>
  ),
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

function Nav() {
  const [open, setOpen] = useState(false)
  const links = ['Solutions', 'IVR Migration', 'Journeys', 'Integrations', 'Pricing', 'Docs']

  return (
    <nav className="nav-blur" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50, background: 'rgba(0,0,0,0.72)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #0071e3 0%, #34aadc 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            <I.Flow />
          </div>
          <span style={{ color: '#fff', fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em' }}>FlowPath</span>
          <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 4, background: 'rgba(0,113,227,0.25)', color: '#2997ff', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>CX Designer</span>
        </div>

        <div className="hidden md:flex" style={{ gap: 32 }}>
          {links.map(l => <a key={l} href="#" className="nav-link">{l}</a>)}
        </div>

        <div className="hidden md:flex" style={{ gap: 12, alignItems: 'center' }}>
          <a href="#" className="nav-link">Sign in</a>
          <a href="#" className="btn-apple btn-apple-primary" style={{ padding: '8px 18px', fontSize: 14 }}>Get started</a>
        </div>

        <button className="md:hidden" style={{ color: '#fff', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setOpen(v => !v)}>
          {open ? <I.Close /> : <I.Menu />}
        </button>
      </div>
      {open && (
        <div style={{ background: 'rgba(10,10,10,0.97)', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[...links, 'Sign in'].map(l => <a key={l} href="#" style={{ color: 'rgba(255,255,255,0.75)', fontSize: 16, textDecoration: 'none' }}>{l}</a>)}
          <a href="#" className="btn-apple btn-apple-primary" style={{ alignSelf: 'flex-start' }}>Get started</a>
        </div>
      )}
    </nav>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section style={{ background: '#0a0a0a', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', paddingTop: 80 }}>
      <div style={{ position: 'absolute', top: '25%', left: '50%', transform: 'translateX(-50%)', width: 700, height: 420, background: 'radial-gradient(ellipse, rgba(0,113,227,0.16) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: '30%', left: '20%', width: 300, height: 300, background: 'radial-gradient(ellipse, rgba(94,92,230,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 220, background: 'linear-gradient(0deg, #f5f5f7 0%, transparent 100%)', pointerEvents: 'none' }} />

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px', textAlign: 'center', position: 'relative', zIndex: 10 }}>
        {/* Dual badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 32, flexWrap: 'wrap' }}>
          <div className="chip" style={{ background: 'rgba(0,113,227,0.15)', color: '#2997ff' }}>
            <I.Flow /> Customer Journey → Contact Flow
          </div>
          <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>+</div>
          <div className="chip" style={{ background: 'rgba(255,55,95,0.15)', color: '#ff6b8a' }}>
            <I.Migrate /> Legacy IVR → CX Designer
          </div>
        </div>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(40px, 6.5vw, 84px)', fontWeight: 400, lineHeight: 1.04, letterSpacing: '-0.03em', color: '#f5f5f7', marginBottom: 24 }}>
          The modern platform for<br />
          <span className="gradient-text">Amazon Connect CX.</span>
        </h1>

        <p style={{ fontSize: 'clamp(17px, 2vw, 21px)', color: 'rgba(245,245,247,0.55)', fontWeight: 300, lineHeight: 1.65, maxWidth: 580, margin: '0 auto 20px' }}>
          Map customer journeys into contact flows. Migrate legacy IVRs to the new Amazon Connect <strong style={{ color: 'rgba(245,245,247,0.75)', fontWeight: 500 }}>CX Designer</strong> — automatically, safely, and at scale.
        </p>

        <p style={{ fontSize: 14, color: 'rgba(245,245,247,0.3)', marginBottom: 44, letterSpacing: '0.01em' }}>
          Built for the CX Designer era · Migrate legacy IVR to Amazon Connect
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <a href="#ivr-migration" className="btn-apple btn-apple-primary" style={{ fontSize: 17, padding: '14px 30px' }}>
            Migrate your IVR <I.Arrow />
          </a>
          <a href="#journey" className="btn-apple btn-apple-light" style={{ fontSize: 17, padding: '14px 30px' }}>
            Map a journey
          </a>
        </div>

        <div style={{ marginTop: 72 }}>
          <HeroVisual />
        </div>
      </div>
    </section>
  )
}

function HeroVisual() {
  const left = [
    { label: 'Legacy IVR System', color: '#86868b' },
    { label: 'Traditional Call Flow', color: '#86868b' },
    { label: 'DTMF Menu Tree', color: '#86868b' },
    { label: 'VoiceXML Script', color: '#86868b' },
  ]
  const right = [
    { label: 'CX Designer Flow', color: '#0071e3' },
    { label: 'Lex V2 Bot', color: '#5e5ce6' },
    { label: 'Lambda Hooks', color: '#ff9f0a' },
    { label: 'Contact Lens', color: '#30d158' },
  ]

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, flexWrap: 'wrap', rowGap: 20 }}>
      {/* Legacy IVR side */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
        {left.map((item, i) => (
          <div key={i} style={{ padding: '8px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(245,245,247,0.45)', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
            {item.label}
          </div>
        ))}
      </div>

      {/* Center converter */}
      <div style={{ position: 'relative', width: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, margin: '0 12px' }}>
        <div style={{ width: 1, height: 36, background: 'linear-gradient(180deg, transparent, rgba(255,55,95,0.5))' }} />
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'linear-gradient(135deg, #0071e3, #5e5ce6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff',
          boxShadow: '0 0 40px rgba(0,113,227,0.35)',
          position: 'relative',
        }}>
          <I.Sparkle />
          <div style={{ position: 'absolute', inset: -4, borderRadius: '50%', border: '1px solid rgba(0,113,227,0.3)' }} />
        </div>
        <div style={{ color: 'rgba(245,245,247,0.4)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 4 }}>FlowPath AI</div>
        <div style={{ width: 1, height: 36, background: 'linear-gradient(180deg, rgba(0,113,227,0.5), transparent)' }} />
      </div>

      {/* CX Designer output */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        {right.map((item, i) => (
          <div key={i} style={{ padding: '8px 16px', borderRadius: 8, background: `${item.color}15`, border: `1px solid ${item.color}35`, color: item.color, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
            {item.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Dual capability overview ─────────────────────────────────────────────────

function CapabilityPills() {
  return (
    <section style={{ background: '#f5f5f7', padding: '56px 24px 0' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }} className="caps-grid">
        {/* Pill 1 */}
        <div style={{ background: '#fff', borderRadius: 24, padding: '40px 40px', border: '1px solid rgba(0,0,0,0.06)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: '50%', background: 'rgba(0,113,227,0.06)' }} />
          <div className="chip" style={{ background: 'rgba(0,113,227,0.1)', color: '#0071e3', marginBottom: 20 }}>Core capability</div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, letterSpacing: '-0.02em', color: '#1d1d1f', marginBottom: 12 }}>
            Customer Journey<br />→ Contact Flow
          </h3>
          <p style={{ color: '#6e6e73', fontSize: 16, lineHeight: 1.65, marginBottom: 24 }}>
            Map real customer interactions and auto-generate Amazon Connect contact flows. From whiteboard to production JSON with zero hand-coding.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {['Journey canvas with drag-and-drop', 'Lex V2 intent auto-creation', 'Lambda scaffold generation', 'One-click deploy to Connect'].map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#1d1d1f', fontSize: 14 }}>
                <div style={{ color: '#0071e3', flexShrink: 0 }}><I.Check /></div>
                {f}
              </div>
            ))}
          </div>
        </div>

        {/* Pill 2 */}
        <div style={{ background: 'linear-gradient(135deg, #1c1c1e 0%, #0a0a0a 100%)', borderRadius: 24, padding: '40px 40px', border: '1px solid rgba(255,255,255,0.08)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,55,95,0.08)' }} />
          <div className="chip" style={{ background: 'rgba(255,55,95,0.15)', color: '#ff6b8a', marginBottom: 20 }}>
            <I.Migrate /> Game-changing · New
          </div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, letterSpacing: '-0.02em', color: '#f5f5f7', marginBottom: 12 }}>
            Legacy IVR<br />→ CX Designer
          </h3>
          <p style={{ color: 'rgba(245,245,247,0.55)', fontSize: 16, lineHeight: 1.65, marginBottom: 24 }}>
            Ingest traditional IVR scripts and convert them directly into CX Designer flows — the new Amazon Connect visual builder.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {['Automatic DTMF-to-prompt translation', 'VoiceXML / VXML parsing', 'CX Designer JSON export', 'Fidelity validation report'].map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'rgba(245,245,247,0.8)', fontSize: 14 }}>
                <div style={{ color: '#ff6b8a', flexShrink: 0 }}><I.Check /></div>
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 768px){ .caps-grid{ grid-template-columns:1fr !important; } }`}</style>
    </section>
  )
}

// ─── Features grid ────────────────────────────────────────────────────────────

function Features() {
  const features = [
    { icon: <I.User />, color: '#0071e3', title: 'Journey Mapping', body: 'Visually trace every touchpoint from first call to resolution across voice, chat, and task channels.' },
    { icon: <I.CxDesigner />, color: '#ff6b8a', title: 'CX Designer Export', body: 'Generate CX Designer-native JSON — the new Amazon Connect visual flow builder format — ready to import instantly.' },
    { icon: <I.Bot />, color: '#5e5ce6', title: 'AI Intent Engine', body: 'Lex V2 bots with utterances, slots, and fallback paths auto-created from journey or IVR data. No manual typing.' },
    { icon: <I.Lambda />, color: '#ff9f0a', title: 'Lambda Wiring', body: 'Business logic scaffolded as AWS Lambda functions and wired into each CX Designer node automatically.' },
    { icon: <I.Puzzle />, color: '#30d158', title: 'IVR Parser', body: 'Ingests legacy IVR definitions — DTMF trees, VoiceXML, prompt inventories, and transfer logic — with 95%+ structural fidelity.' },
    { icon: <I.Analytics />, color: '#64d2ff', title: 'Migration Scorecard', body: 'Every migrated flow gets a fidelity score, risk flags, and a side-by-side diff of original IVR vs CX Designer output.' },
    { icon: <I.Database />, color: '#ff375f', title: 'CRM Integration', body: 'Salesforce, Dynamics, and HubSpot context surfaces in CX Designer blocks before the contact reaches an agent.' },
    { icon: <I.Sparkle />, color: '#bf5af2', title: 'Contact Lens Loop', body: 'Sentiment and key phrase feedback from resolved contacts flows back into the Lex model continuously.' },
  ]

  return (
    <section style={{ background: '#f5f5f7', padding: '80px 24px 96px' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div className="chip" style={{ background: 'rgba(0,113,227,0.1)', color: '#0071e3', marginBottom: 20 }}>All capabilities</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 400, letterSpacing: '-0.025em', color: '#1d1d1f', marginBottom: 14 }}>
            Everything you need to move<br /><em>from legacy IVR to CX Designer.</em>
          </h2>
          <p style={{ color: '#6e6e73', fontSize: 18, maxWidth: 480, margin: '0 auto' }}>One platform. End-to-end migration and journey intelligence for Amazon Connect.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
          {features.map((f, i) => (
            <div key={i} className="journey-card" style={{ background: '#fff', borderRadius: 20, padding: 28, border: '1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: `${f.color}18`, border: `1.5px solid ${f.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: f.color, marginBottom: 18 }}>
                {f.icon}
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', color: '#1d1d1f', marginBottom: 8 }}>{f.title}</h3>
              <p style={{ fontSize: 14, color: '#6e6e73', lineHeight: 1.65, margin: 0 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── IVR Migration Section ────────────────────────────────────────────────────

const ivrSteps = [
  {
    phase: '01', title: 'Ingest Legacy IVR',
    description: 'Upload your existing IVR definition — call flow exports, VoiceXML, or raw DTMF trees. FlowPath parses prompt logic, transfer targets, and data-dip integrations automatically.',
    detail: 'Supports .vxml, .ccxml, and structured JSON IVR exports. Max file size 50 MB.',
    color: '#ff6b8a',
    icon: <I.Database />,
    cxBlock: 'Play Prompt', cxType: 'Entry · Legacy parse',
    outputs: ['DTMF menu detected', 'Transfer targets mapped', 'Data-dip endpoints identified'],
  },
  {
    phase: '02', title: 'AI Structural Analysis',
    description: 'The FlowPath engine walks every branch of the IVR tree, classifying each node as a prompt, condition, queue transfer, external API call, or agent escalation — then maps it to the equivalent CX Designer block type.',
    detail: 'ML classifier handles nested DTMF up to 8 levels deep, multi-lingual prompts, and conditional routing with high structural fidelity.',
    color: '#bf5af2',
    icon: <I.Sparkle />,
    cxBlock: 'Check Contact Attributes', cxType: 'Condition · Auto-mapped',
    outputs: ['Block type assigned', 'Branch logic preserved', 'Confidence score: 0.94'],
  },
  {
    phase: '03', title: 'CX Designer Canvas',
    description: 'The migrated flow opens in an interactive CX Designer-compatible canvas. Every node is draggable, branch conditions are editable in plain language, and prompt audio can be re-recorded or replaced with Amazon Polly.',
    detail: 'CX Designer introduced a redesigned drag-and-drop canvas in 2024 with block grouping, annotation layers, and variable scoping — all preserved.',
    color: '#0071e3',
    icon: <I.CxDesigner />,
    cxBlock: 'Get Customer Input', cxType: 'Interaction · CX Designer',
    outputs: ['Drag-and-drop ready', 'Polly TTS substitution', 'Annotation layers added'],
  },
  {
    phase: '04', title: 'Fidelity Validation',
    description: 'Run the migration scorecard. FlowPath simulates 1 000 synthetic calls through both the original IVR and the new CX Designer flow, flagging any divergent paths, missing prompts, or broken transfer targets.',
    detail: 'Scorecard produces PASS / WARN / FAIL per branch. WARN items include suggested fixes; FAIL items block deployment until resolved.',
    color: '#ff9f0a',
    icon: <I.Analytics />,
    cxBlock: 'Invoke AWS Lambda', cxType: 'Validation · Simulation',
    outputs: ['98.4 % path fidelity', '2 WARN: prompt text changed', 'READY to deploy'],
  },
  {
    phase: '05', title: 'Deploy to Amazon Connect',
    description: 'One-click publish pushes the CX Designer flow JSON to your Amazon Connect instance via the AWS SDK. Versioning is automatic — roll back to any prior migration point in seconds.',
    detail: 'Supports multi-region deployments and staging environments. Full IaC export (AWS CDK / CloudFormation) available for enterprise pipelines.',
    color: '#30d158',
    icon: <I.Agent />,
    cxBlock: 'Set Working Queue', cxType: 'Routing · Live',
    outputs: ['Deployed to us-east-1', 'Version 1.0 tagged', 'Rollback ready'],
  },
]

function IVRMigrationSection() {
  const [active, setActive] = useState(0)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [fileFormat, setFileFormat] = useState<'json' | 'file' | null>(null)
  const step = ivrSteps[active]

  const handleFile = async (file?: File) => {
    if (!file) return
    if (file.size > 50 * 1024 * 1024) {
      setUploadedFile(null)
      setFileFormat(null)
      setFileError('This file is larger than the 50 MB limit.')
      return
    }

    setFileError('')
    setUploadedFile(file)

    if (file.name.toLowerCase().endsWith('.json')) {
      try {
        JSON.parse(await file.text())
        setFileFormat('json')
      } catch {
        setFileFormat('file')
      }
    } else {
      setFileFormat('file')
    }
  }

  return (
    <section id="ivr-migration" style={{ background: '#0a0a0a', padding: '96px 24px' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div className="chip" style={{ background: 'rgba(255,55,95,0.15)', color: '#ff6b8a', marginBottom: 20 }}>
            <I.Migrate /> IVR → CX Designer Migration
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 4vw, 52px)', fontWeight: 400, letterSpacing: '-0.025em', color: '#f5f5f7', marginBottom: 16 }}>
            The most game-changing shift<br />
            <span style={{ background: 'linear-gradient(135deg, #ff6b8a 0%, #bf5af2 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              in contact centre history.
            </span>
          </h2>
          <p style={{ color: 'rgba(245,245,247,0.5)', fontSize: 18, maxWidth: 560, margin: '0 auto' }}>
            Thousands of enterprises are moving from proprietary IVR platforms to Amazon Connect CX Designer. FlowPath is the automated migration engine that makes it safe.
          </p>
        </div>


        {/* Step tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 40 }}>
          {ivrSteps.map((s, i) => (
            <button key={i} onClick={() => setActive(i)} style={{ padding: '9px 18px', borderRadius: 980, border: active === i ? `1.5px solid ${s.color}` : '1.5px solid rgba(255,255,255,0.1)', background: active === i ? `${s.color}20` : 'transparent', color: active === i ? s.color : 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s' }}>
              {s.phase} · {s.title}
            </button>
          ))}
        </div>

        {/* Detail split */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }} className="ivr-grid">
          {/* Left */}
          <div className="card-glow" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24, padding: 40 }}>
            <div style={{ width: 50, height: 50, borderRadius: 13, background: `${step.color}20`, border: `1.5px solid ${step.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: step.color, marginBottom: 22 }}>{step.icon}</div>
            <div style={{ color: step.color, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Phase {step.phase}</div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 400, letterSpacing: '-0.02em', color: '#f5f5f7', margin: '10px 0 16px' }}>{step.title}</h3>
            <p style={{ color: 'rgba(245,245,247,0.65)', fontSize: 16, lineHeight: 1.65, marginBottom: 18 }}>{step.description}</p>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '13px 18px', marginBottom: 28 }}>
              <p style={{ color: 'rgba(245,245,247,0.4)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                <span style={{ color: 'rgba(245,245,247,0.65)', fontWeight: 500 }}>Technical note — </span>{step.detail}
              </p>
            </div>
            {active === 0 && (
              <div style={{ marginBottom: 28 }}>
                <input
                  id="ivr-file-upload"
                  type="file"
                  hidden
                  onChange={event => handleFile(event.target.files?.[0])}
                />
                <label
                  htmlFor="ivr-file-upload"
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => {
                    event.preventDefault()
                    void handleFile(event.dataTransfer.files[0])
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderRadius: 14, border: `1px dashed ${fileError ? '#ff375f' : uploadedFile ? '#30d158' : 'rgba(255,107,138,0.55)'}`, background: uploadedFile ? 'rgba(48,209,88,0.08)' : 'rgba(255,107,138,0.06)', cursor: 'pointer' }}
                >
                  <div style={{ width: 42, height: 42, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: uploadedFile ? '#30d158' : '#ff6b8a', background: uploadedFile ? 'rgba(48,209,88,0.14)' : 'rgba(255,107,138,0.14)' }}>
                    {uploadedFile ? <I.Check /> : <I.Upload />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ color: '#f5f5f7', fontSize: 14, fontWeight: 600, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {uploadedFile ? uploadedFile.name : 'Drop your IVR file here or browse'}
                    </p>
                    <p style={{ color: 'rgba(245,245,247,0.42)', fontSize: 12, margin: 0 }}>
                      {uploadedFile ? `${fileFormat === 'json' ? 'Valid JSON' : 'File received'} · Ready for parsing` : 'JSON, VoiceXML, CCXML, or any other file · Max 50 MB'}
                    </p>
                  </div>
                </label>
                {fileError && <p style={{ color: '#ff6b8a', fontSize: 12, margin: '8px 2px 0' }}>{fileError}</p>}
              </div>
            )}
            {/* Outputs */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {step.outputs.map((o, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ color: step.color, flexShrink: 0 }}><I.Check /></div>
                  <span style={{ color: 'rgba(245,245,247,0.6)', fontSize: 14 }}>{o}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 30 }}>
              <button onClick={() => setActive(i => Math.max(0, i - 1))} disabled={active === 0} style={{ padding: '9px 18px', borderRadius: 980, border: '1.5px solid rgba(255,255,255,0.12)', background: 'transparent', color: active === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)', fontSize: 14, cursor: active === 0 ? 'default' : 'pointer', transition: 'all 0.2s' }}>← Previous</button>
              <button onClick={() => setActive(i => Math.min(ivrSteps.length - 1, i + 1))} disabled={active === ivrSteps.length - 1} style={{ padding: '9px 18px', borderRadius: 980, border: `1.5px solid ${step.color}`, background: `${step.color}20`, color: step.color, fontSize: 14, cursor: active === ivrSteps.length - 1 ? 'default' : 'pointer', opacity: active === ivrSteps.length - 1 ? 0.4 : 1, transition: 'all 0.2s' }}>Next step →</button>
            </div>
          </div>

          {/* Right — CX Designer block + scorecard */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* CX Designer block */}
            <div className="card-glow" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24, padding: 36 }}>
              <p style={{ color: 'rgba(245,245,247,0.35)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>Amazon Connect · CX Designer Block</p>
              <div style={{ border: `2px solid ${step.color}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ background: `${step.color}22`, padding: '10px 16px', borderBottom: `1px solid ${step.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ color: step.color, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{step.cxType}</span>
                  <div style={{ padding: '2px 8px', borderRadius: 4, background: 'rgba(48,209,88,0.2)', color: '#30d158', fontSize: 10, fontWeight: 700 }}>CX Designer</div>
                </div>
                <div style={{ padding: '16px 16px' }}>
                  <p style={{ color: '#f5f5f7', fontSize: 16, fontWeight: 600, margin: '0 0 6px' }}>{step.cxBlock}</p>
                  <p style={{ color: 'rgba(245,245,247,0.4)', fontSize: 13, margin: '0 0 14px' }}>Auto-generated from phase {step.phase} IVR analysis</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['Success', 'Error', 'Timeout'].map((label, i) => (
                      <div key={i} style={{ padding: '4px 10px', borderRadius: 6, background: i === 0 ? 'rgba(48,209,88,0.15)' : i === 1 ? 'rgba(255,55,95,0.15)' : 'rgba(255,159,10,0.15)', border: `1px solid ${i === 0 ? 'rgba(48,209,88,0.3)' : i === 1 ? 'rgba(255,55,95,0.3)' : 'rgba(255,159,10,0.3)'}`, color: i === 0 ? '#30d158' : i === 1 ? '#ff375f' : '#ff9f0a', fontSize: 11, fontWeight: 600 }}>{label}</div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Progress bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'rgba(245,245,247,0.4)', fontSize: 12 }}>Migration progress</span>
                <span style={{ color: step.color, fontSize: 12, fontWeight: 600 }}>{active + 1}/{ivrSteps.length}</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${((active + 1) / ivrSteps.length) * 100}%`, background: `linear-gradient(90deg, #ff6b8a, ${step.color})`, borderRadius: 2, transition: 'width 0.4s ease' }} />
              </div>
            </div>

            {/* JSON / VoiceXML → CX snippet */}
            <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
                <span style={{ marginLeft: 8, color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>cx-designer-export.json</span>
              </div>
              <pre style={{ margin: 0, fontSize: 11.5, lineHeight: 1.65, color: 'rgba(245,245,247,0.5)', overflow: 'auto', fontFamily: 'JetBrains Mono, monospace' }}>
{`{
  "Version": "2019-10-30",
  "StartAction": "${step.phase}-entry",
  "Metadata": {
    "EntryPointPosition": { "x": 82, "y": 20 },
    "Designer": { "id": "cxd-2024" }
  },
  "Actions": [{
    "Identifier": "${step.phase}-${step.cxBlock.toLowerCase().replace(/ /g,'-')}",
    "Type": "${step.cxBlock.replace(/ /g,'')}",
    "Parameters": {
      "MigratedFrom": "LegacyIVR",
      "Phase": "${step.phase}",
      "FidelityScore": 0.984
    },
    "Transitions": {
      "NextAction": "next-cx-block",
      "Errors": [{ "NextAction": "fallback" }]
    }
  }]
}`}
              </pre>
            </div>
          </div>
        </div>
      </div>
      <style>{`@media(max-width:768px){ .ivr-grid{ grid-template-columns:1fr !important; } }`}</style>
    </section>
  )
}

// ─── Customer Journey Section ─────────────────────────────────────────────────

const journeySteps = [
  { phase: '01', title: 'Customer Initiation', description: 'A customer contacts your business via phone, chat, or web callback. FlowPath captures the channel, timestamp, and initial intent signal.', detail: 'Supports inbound voice, outbound campaigns, chat widgets, and Amazon Connect Tasks.', color: '#0071e3', icon: <I.Phone />, cxBlock: 'Set Contact Attributes', cxType: 'Entry Point' },
  { phase: '02', title: 'Intelligent Greeting', description: 'The contact flow plays a personalised greeting using real-time CRM lookup. Known customers hear their name and relevant account context.', detail: 'Lambda invocation queries Salesforce; result injected into contact attributes within 200 ms.', color: '#5e5ce6', icon: <I.Bot />, cxBlock: 'Invoke AWS Lambda', cxType: 'Integration Block' },
  { phase: '03', title: 'Intent Capture', description: 'Lex V2 bot prompts the caller. The engine classifies intent into one of your mapped journey paths with a confidence threshold of 0.82.', detail: 'Below threshold → clarification loop (max 2 reprompts) before fallback to agent.', color: '#30d158', icon: <I.Database />, cxBlock: 'Get Customer Input', cxType: 'Interaction Block' },
  { phase: '04', title: 'Smart Routing', description: 'Based on intent, priority tier, and agent availability, FlowPath selects the optimal queue — now as a CX Designer routing block.', detail: 'Skills-based routing with overflow to cross-trained pools and async callback option.', color: '#ff9f0a', icon: <I.Agent />, cxBlock: 'Check Queue', cxType: 'Routing Block' },
  { phase: '05', title: 'Resolution & Feedback', description: 'Contact Lens transcribes and analyses the call. Sentiment and key phrases feed back into the Lex model and your journey map.', detail: 'Journey models improve with each resolved contact via a continuous feedback loop.', color: '#bf5af2', icon: <I.Analytics />, cxBlock: 'Set Recording Behavior', cxType: 'Analytics Block' },
]

function JourneySection() {
  const [active, setActive] = useState(0)
  const step = journeySteps[active]

  return (
    <section id="journey" style={{ background: '#1c1c1e', padding: '96px 24px' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div className="chip" style={{ background: 'rgba(41,151,255,0.15)', color: '#2997ff', marginBottom: 20 }}>Customer Journey</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 4vw, 52px)', fontWeight: 400, letterSpacing: '-0.025em', color: '#f5f5f7', marginBottom: 16 }}>
            Every touchpoint mapped.<br /><span className="gradient-text-warm">Every CX Designer flow generated.</span>
          </h2>
          <p style={{ color: 'rgba(245,245,247,0.5)', fontSize: 18, maxWidth: 500, margin: '0 auto' }}>
            Walk through a real customer journey and see how each step generates a CX Designer block in Amazon Connect.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 40 }}>
          {journeySteps.map((s, i) => (
            <button key={i} onClick={() => setActive(i)} style={{ padding: '9px 18px', borderRadius: 980, border: active === i ? `1.5px solid ${s.color}` : '1.5px solid rgba(255,255,255,0.1)', background: active === i ? `${s.color}20` : 'transparent', color: active === i ? s.color : 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s' }}>
              {s.phase} · {s.title}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }} className="journey-grid">
          <div className="card-glow" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24, padding: 40 }}>
            <div style={{ width: 50, height: 50, borderRadius: 13, background: `${step.color}20`, border: `1.5px solid ${step.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: step.color, marginBottom: 22 }}>{step.icon}</div>
            <div style={{ color: step.color, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Phase {step.phase}</div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 400, letterSpacing: '-0.02em', color: '#f5f5f7', margin: '10px 0 16px' }}>{step.title}</h3>
            <p style={{ color: 'rgba(245,245,247,0.65)', fontSize: 16, lineHeight: 1.65, marginBottom: 18 }}>{step.description}</p>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '13px 18px', marginBottom: 28 }}>
              <p style={{ color: 'rgba(245,245,247,0.4)', fontSize: 13, lineHeight: 1.6, margin: 0 }}><span style={{ color: 'rgba(245,245,247,0.65)', fontWeight: 500 }}>Detail — </span>{step.detail}</p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setActive(i => Math.max(0, i - 1))} disabled={active === 0} style={{ padding: '9px 18px', borderRadius: 980, border: '1.5px solid rgba(255,255,255,0.12)', background: 'transparent', color: active === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)', fontSize: 14, cursor: active === 0 ? 'default' : 'pointer', transition: 'all 0.2s' }}>← Previous</button>
              <button onClick={() => setActive(i => Math.min(journeySteps.length - 1, i + 1))} disabled={active === journeySteps.length - 1} style={{ padding: '9px 18px', borderRadius: 980, border: `1.5px solid ${step.color}`, background: `${step.color}20`, color: step.color, fontSize: 14, cursor: active === journeySteps.length - 1 ? 'default' : 'pointer', opacity: active === journeySteps.length - 1 ? 0.4 : 1, transition: 'all 0.2s' }}>Next →</button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card-glow" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24, padding: 36 }}>
              <p style={{ color: 'rgba(245,245,247,0.35)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>Amazon Connect · CX Designer</p>
              <div style={{ border: `2px solid ${step.color}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ background: `${step.color}22`, padding: '10px 16px', borderBottom: `1px solid ${step.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ color: step.color, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{step.cxType}</span>
                  <div style={{ padding: '2px 8px', borderRadius: 4, background: 'rgba(0,113,227,0.2)', color: '#2997ff', fontSize: 10, fontWeight: 700 }}>CX Designer</div>
                </div>
                <div style={{ padding: '16px 16px' }}>
                  <p style={{ color: '#f5f5f7', fontSize: 16, fontWeight: 600, margin: '0 0 6px' }}>{step.cxBlock}</p>
                  <p style={{ color: 'rgba(245,245,247,0.4)', fontSize: 13, margin: '0 0 14px' }}>Generated from journey phase {step.phase}</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['Success', 'Error'].concat(step.phase === '03' ? ['Timeout'] : []).map((label, i) => (
                      <div key={i} style={{ padding: '4px 10px', borderRadius: 6, background: i === 0 ? 'rgba(48,209,88,0.15)' : i === 1 ? 'rgba(255,55,95,0.15)' : 'rgba(255,159,10,0.15)', border: `1px solid ${i === 0 ? 'rgba(48,209,88,0.3)' : i === 1 ? 'rgba(255,55,95,0.3)' : 'rgba(255,159,10,0.3)'}`, color: i === 0 ? '#30d158' : i === 1 ? '#ff375f' : '#ff9f0a', fontSize: 11, fontWeight: 600 }}>{label}</div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'rgba(245,245,247,0.4)', fontSize: 12 }}>Journey progress</span>
                <span style={{ color: step.color, fontSize: 12, fontWeight: 600 }}>{active + 1}/{journeySteps.length}</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${((active + 1) / journeySteps.length) * 100}%`, background: `linear-gradient(90deg, #0071e3, ${step.color})`, borderRadius: 2, transition: 'width 0.4s ease' }} />
              </div>
            </div>

            <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
                <span style={{ marginLeft: 8, color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>cx-designer-flow.json</span>
              </div>
              <pre style={{ margin: 0, fontSize: 11.5, lineHeight: 1.65, color: 'rgba(245,245,247,0.5)', overflow: 'auto', fontFamily: 'JetBrains Mono, monospace' }}>
{`{
  "Version": "2019-10-30",
  "StartAction": "${step.phase}-entry",
  "Actions": [{
    "Identifier": "${step.phase}-block",
    "Type": "${step.cxBlock.replace(/ /g,'')}",
    "Parameters": {
      "JourneyPhase": "${step.phase}",
      "BlockName": "${step.cxBlock}"
    },
    "Transitions": {
      "NextAction": "next-block",
      "Errors": [{"NextAction": "error-handler"}]
    }
  }]
}`}
              </pre>
            </div>
          </div>
        </div>
      </div>
      <style>{`@media(max-width:768px){ .journey-grid{ grid-template-columns:1fr !important; } }`}</style>
    </section>
  )
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function Stats() {
  const stats = [
    { value: '95%+', label: 'IVR migration fidelity' },
    { value: '8×', label: 'Faster than manual migration' },
    { value: '60%', label: 'Reduction in hold time post-migration' },
    { value: '4 000+', label: 'IVR flows migrated' },
  ]
  return (
    <section style={{ background: '#f5f5f7', padding: '72px 24px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 40, textAlign: 'center' }}>
        {stats.map((s, i) => (
          <div key={i}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, fontWeight: 400, letterSpacing: '-0.03em', color: '#0071e3', lineHeight: 1, marginBottom: 8 }}>{s.value}</div>
            <div style={{ color: '#6e6e73', fontSize: 15 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Conversion steps ─────────────────────────────────────────────────────────

function ConversionSection() {
  const [tab, setTab] = useState<'journey' | 'ivr'>('ivr')

  const ivrPath = [
    { n: '1', title: 'Upload IVR script', body: 'Import your IVR definition — VoiceXML, DTMF trees, or structured exports. FlowPath parses prompt inventories, branch logic, and transfer targets.', color: '#ff6b8a' },
    { n: '2', title: 'AI structural mapping', body: 'Each IVR node is classified and mapped to a CX Designer block type. Handles deep DTMF nesting, multi-lingual prompts, and external API call-outs.', color: '#bf5af2' },
    { n: '3', title: 'Validate on CX Designer canvas', body: 'Open the interactive CX Designer-compatible canvas. Edit prompts, adjust branch conditions, add Polly TTS, and review the fidelity scorecard.', color: '#0071e3' },
    { n: '4', title: 'Deploy via AWS SDK', body: 'One-click publish to your Amazon Connect instance. Full version history, instant rollback, and IaC (CDK/CloudFormation) export for enterprise pipelines.', color: '#30d158' },
  ]

  const journeyPath = [
    { n: '1', title: 'Upload journey data', body: 'Import call scripts, CRM stage maps, chat transcripts, or draw in the visual editor. Supports CSV, JSON, Visio, and Lucidchart exports.', color: '#0071e3' },
    { n: '2', title: 'AI annotates decision points', body: 'The engine identifies decision points, fallback paths, escalation triggers, and data-collection steps. Each node is tagged with a CX Designer block type.', color: '#5e5ce6' },
    { n: '3', title: 'Review on CX Designer canvas', body: 'Drag to reorder, tweak branch conditions, adjust queue priorities, and add custom Lambda hooks on a CX Designer-ready canvas.', color: '#30d158' },
    { n: '4', title: 'Deploy to Amazon Connect', body: 'One-click publish via the AWS SDK. FlowPath versions every deployment and enables instant rollback from the dashboard.', color: '#ff9f0a' },
  ]

  const path = tab === 'ivr' ? ivrPath : journeyPath

  return (
    <section style={{ background: '#fff', padding: '96px 24px' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div className="chip" style={{ background: 'rgba(0,113,227,0.1)', color: '#0071e3', marginBottom: 20 }}>Four-step process</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 3.5vw, 46px)', fontWeight: 400, letterSpacing: '-0.025em', color: '#1d1d1f', marginBottom: 16 }}>
            From legacy system to<br /><em>production CX Designer flow.</em>
          </h2>
          {/* Toggle */}
          <div style={{ display: 'inline-flex', background: 'rgba(0,0,0,0.06)', borderRadius: 980, padding: 4, marginTop: 8 }}>
            {(['ivr', 'journey'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 22px', borderRadius: 980, border: 'none', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#1d1d1f' : '#6e6e73', fontSize: 14, fontWeight: 600, cursor: 'pointer', boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.12)' : 'none', transition: 'all 0.2s' }}>
                {t === 'ivr' ? 'IVR → CX Designer' : 'Journey → Contact Flow'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center' }} className="conv-grid">
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 400, letterSpacing: '-0.02em', color: '#1d1d1f', marginBottom: 12 }}>
              {tab === 'ivr' ? <>Legacy IVR to<br /><em>CX Designer in 4 steps.</em></> : <>Whiteboard to<br /><em>contact flow in 4 steps.</em></>}
            </h3>
            <p style={{ color: '#6e6e73', fontSize: 17, lineHeight: 1.65, marginBottom: 28 }}>
              {tab === 'ivr' ? 'FlowPath is the only platform that understands traditional IVR semantics and translates them directly into the new Amazon Connect CX Designer format — with zero manual JSON editing.' : 'No more disconnected journey maps that gather dust. FlowPath is the bridge between CX strategy and Amazon Connect CX Designer.'}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <a href="#" className="btn-apple btn-apple-primary">{tab === 'ivr' ? 'Start migration free' : 'Start mapping free'}</a>
              <a href="#" className="btn-apple btn-apple-ghost">Watch demo</a>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {path.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 20 }}>
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${s.color}15`, border: `2px solid ${s.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.color, fontSize: 15, fontWeight: 700, flexShrink: 0 }}>{s.n}</div>
                  {i < path.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 24, background: `${s.color}25`, marginTop: 6 }} />}
                </div>
                <div style={{ paddingTop: 6, paddingBottom: i < path.length - 1 ? 20 : 0 }}>
                  <h4 style={{ fontSize: 16, fontWeight: 600, color: '#1d1d1f', marginBottom: 6, letterSpacing: '-0.01em' }}>{s.title}</h4>
                  <p style={{ color: '#6e6e73', fontSize: 14, lineHeight: 1.6, margin: 0 }}>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`@media(max-width:768px){ .conv-grid{ grid-template-columns:1fr !important; gap:48px !important; } }`}</style>
    </section>
  )
}

// ─── Testimonials ──────────────────────────────────────────────────────────────

function Testimonials() {
  const quotes = [
    { quote: "We migrated 47 legacy call flows to Amazon Connect CX Designer in two days. FlowPath's fidelity scorecard caught every edge case our team would have missed.", name: "Sarah Okonkwo", role: "VP CX Engineering, FinServe Global", initials: "SO", color: '#ff6b8a' },
    { quote: "The IVR parser handled our existing scripts without a single manual modification. The CX Designer JSON output was cleaner than anything our team produces by hand.", name: "Marcus Chen", role: "AWS Solutions Architect, TelecomCo", initials: "MC", color: '#0071e3' },
    { quote: "Contact Lens feedback closing the loop into Lex V2 training is genuinely clever. Bot accuracy improved 22 points in eight weeks post-migration.", name: "Priya Sharma", role: "Head of AI Products, RetailCorp", initials: "PS", color: '#bf5af2' },
  ]

  return (
    <section style={{ background: '#1c1c1e', padding: '96px 24px' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 3.5vw, 46px)', fontWeight: 400, letterSpacing: '-0.025em', color: '#f5f5f7' }}>
            Teams already shipping<br /><span className="gradient-text">CX Designer flows.</span>
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px,1fr))', gap: 20 }}>
          {quotes.map((q, i) => (
            <div key={i} className="card-glow journey-card" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 32 }}>
              <div style={{ color: 'rgba(245,245,247,0.75)', fontSize: 15, lineHeight: 1.7, marginBottom: 28 }}>"{q.quote}"</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${q.color}20`, border: `1.5px solid ${q.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: q.color, fontSize: 13, fontWeight: 700 }}>{q.initials}</div>
                <div>
                  <div style={{ color: '#f5f5f7', fontSize: 14, fontWeight: 600 }}>{q.name}</div>
                  <div style={{ color: 'rgba(245,245,247,0.4)', fontSize: 13 }}>{q.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── CTA ──────────────────────────────────────────────────────────────────────

function CTA() {
  return (
    <section style={{ background: '#0a0a0a', padding: '96px 24px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 600, height: 300, background: 'radial-gradient(ellipse, rgba(0,113,227,0.13) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: '40%', left: '30%', width: 300, height: 200, background: 'radial-gradient(ellipse, rgba(255,55,95,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ maxWidth: 680, margin: '0 auto', position: 'relative', zIndex: 10 }}>
        <div className="chip" style={{ background: 'rgba(255,55,95,0.15)', color: '#ff6b8a', marginBottom: 28, display: 'inline-flex' }}>Limited early access · CX Designer beta</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 5vw, 60px)', fontWeight: 400, letterSpacing: '-0.03em', color: '#f5f5f7', marginBottom: 20 }}>
          Ready to retire your<br />legacy IVR for good?
        </h2>
        <p style={{ color: 'rgba(245,245,247,0.5)', fontSize: 18, marginBottom: 44 }}>
          Start with one flow. Migrate your entire IVR estate. All on Amazon Connect CX Designer.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center' }}>
          <a href="#" className="btn-apple btn-apple-primary" style={{ fontSize: 17, padding: '16px 36px' }}>Start free migration</a>
          <a href="#" className="btn-apple btn-apple-light" style={{ fontSize: 17, padding: '16px 36px' }}>Talk to solutions team</a>
        </div>
        <p style={{ color: 'rgba(245,245,247,0.22)', fontSize: 13, marginTop: 22 }}>No credit card · Any AWS region · SOC 2 Type II</p>
      </div>
    </section>
  )
}

// ─── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  const cols = [
    { heading: 'Product', links: ['Journey Mapping', 'IVR Migration', 'CX Designer Export', 'Fidelity Scorecard', 'Analytics'] },
    { heading: 'Migrations', links: ['IVR → CX Designer', 'VoiceXML Parser', 'DTMF Tree Converter', 'Prompt Migration', 'Flow Versioning'] },
    { heading: 'AWS Services', links: ['Amazon Connect', 'Amazon Lex V2', 'AWS Lambda', 'Contact Lens', 'CloudFormation'] },
    { heading: 'Company', links: ['About', 'Careers', 'Blog', 'Privacy', 'Contact'] },
  ]

  return (
    <footer style={{ background: '#f5f5f7', padding: '64px 24px 40px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 40, marginBottom: 56 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #0071e3, #34aadc)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}><I.Flow /></div>
              <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', color: '#1d1d1f' }}>FlowPath</span>
            </div>
            <div style={{ marginBottom: 12 }}><span style={{ padding: '2px 8px', borderRadius: 4, background: 'rgba(0,113,227,0.12)', color: '#0071e3', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>CX Designer Ready</span></div>
            <p style={{ color: '#6e6e73', fontSize: 14, lineHeight: 1.6, margin: 0 }}>The IVR migration and customer journey platform for Amazon Connect.</p>
          </div>
          {cols.map(col => (
            <div key={col.heading}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#1d1d1f', marginBottom: 16 }}>{col.heading}</div>
              {col.links.map(link => (
                <div key={link} style={{ marginBottom: 10 }}>
                  <a href="#" style={{ color: '#6e6e73', fontSize: 14, textDecoration: 'none' }}
                     onMouseEnter={e => (e.currentTarget.style.color = '#0071e3')}
                     onMouseLeave={e => (e.currentTarget.style.color = '#6e6e73')}>{link}</a>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <p style={{ color: '#86868b', fontSize: 13, margin: 0 }}>© 2026 FlowPath, Inc. All rights reserved.</p>
          <p style={{ color: '#86868b', fontSize: 13, margin: 0 }}>Built for Amazon Connect CX Designer · AWS Partner Network</p>
        </div>
      </div>
    </footer>
  )
}

// ─── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <div style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      <Nav />
      <Hero />
      <CapabilityPills />
      <Features />
      <Stats />
      <IVRMigrationSection />
      <JourneySection />
      <ConversionSection />
      <Testimonials />
      <CTA />
      <Footer />
    </div>
  )
}
