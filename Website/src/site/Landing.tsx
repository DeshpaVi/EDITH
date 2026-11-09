import { useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import { BRAND, COMPANY } from "./brand"

const OPEN_APP = "#/app"

const Icon = ({ name, size = 20 }: { name: string; size?: number }) => {
  const paths: Record<string, ReactNode> = {
    flow: (
      <>
        <rect x="3" y="3" width="6" height="6" rx="2" />
        <rect x="15" y="15" width="6" height="6" rx="2" />
        <path d="M9 6h3a3 3 0 0 1 3 3v6M15 18h-3a3 3 0 0 1-3-3v-2" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    menu: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </>
    ),
    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
        <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m0 0L7 9m5-5 5 5" />
        <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      </>
    ),
    nodes: (
      <>
        <circle cx="5" cy="6" r="2" />
        <circle cx="19" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="m7 7 4 9m6-9-4 9M7 6h10" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
    code: (
      <>
        <path d="m8 9-3 3 3 3m8-6 3 3-3 3" />
        <path d="m14 6-4 12" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />
      </>
    ),
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

const journeyStages = [
  {
    id: "01",
    title: "Welcome",
    subtitle: "Personalized entry",
    color: "#9b8cff",
    output: "Set contact attributes",
    type: "SET_ATTRIBUTES",
    note: "Recognize the customer and initialize context.",
  },
  {
    id: "02",
    title: "Understand",
    subtitle: "Capture intent",
    color: "#ff9d70",
    output: "Get customer input",
    type: "GET_INPUT",
    note: "Collect intent through voice or keypad input.",
  },
  {
    id: "03",
    title: "Decide",
    subtitle: "Apply routing rules",
    color: "#63d9c5",
    output: "Check contact attributes",
    type: "CHECK_ATTRIBUTE",
    note: "Branch on customer tier, intent, and availability.",
  },
  {
    id: "04",
    title: "Resolve",
    subtitle: "Connect or automate",
    color: "#f7cc67",
    output: "Transfer to queue",
    type: "TRANSFER_QUEUE",
    note: "Move the customer to the best resolution path.",
  },
]

function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <a
      className={`brand ${dark ? "brand-dark" : ""}`}
      href="#top"
      aria-label={`${BRAND} home`}
    >
      <span className="brand-mark">
        <Icon name="flow" size={18} />
      </span>
      <span className="brand-text">
        <span>{BRAND}</span>
        <small>{COMPANY}</small>
      </span>
    </a>
  )
}

function Nav() {
  const [open, setOpen] = useState(false)
  return (
    <header className="nav-wrap">
      <nav className="nav shell" aria-label="Main navigation">
        <Brand />
        <div className={`nav-links ${open ? "nav-open" : ""}`}>
          <a href="#platform" onClick={() => setOpen(false)}>
            Platform
          </a>
          <a href="#how-it-works" onClick={() => setOpen(false)}>
            How it works
          </a>
          <a href="#security" onClick={() => setOpen(false)}>
            Security
          </a>
          <a href={OPEN_APP} className="nav-cta" onClick={() => setOpen(false)}>
            Open the workspace <Icon name="arrow" size={15} />
          </a>
        </div>
        <button
          className="menu-button"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          <Icon name={open ? "close" : "menu"} />
        </button>
      </nav>
    </header>
  )
}

function FlowPreview() {
  const [active, setActive] = useState(1)
  const stage = journeyStages[active]
  return (
    <div
      className="product-window"
      aria-label="Interactive customer journey conversion preview"
    >
      <div className="window-bar">
        <div className="window-dots">
          <span />
          <span />
          <span />
        </div>
        <div className="window-title">
          <span className="status-dot" /> Sample preview / not your data
        </div>
        <button className="export-button">Export ACXD</button>
      </div>
      <div className="workspace">
        <aside className="workspace-sidebar">
          <span className="eyebrow">Journey stages</span>
          {journeyStages.map((item, index) => (
            <button
              key={item.id}
              className={`stage-button ${active === index ? "active" : ""}`}
              onClick={() => setActive(index)}
            >
              <span className="stage-number" style={{ color: item.color }}>
                {item.id}
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
            </button>
          ))}
          <div className="validation">
            <Icon name="shield" size={17} />
            <span>
              <strong>Sample checks</strong>
              <small>Illustration only</small>
            </span>
          </div>
        </aside>
        <div className="canvas">
          <div className="canvas-grid" />
          <div className="journey-label">Customer journey</div>
          <div className="flow-track">
            {journeyStages.map((item, index) => (
              <div
                key={item.id}
                className={`flow-item ${active === index ? "selected" : ""}`}
                onClick={() => setActive(index)}
              >
                <button
                  className="journey-node"
                  style={{ "--node-color": item.color } as CSSProperties}
                  aria-label={`Select ${item.title}`}
                >
                  <span>{item.id}</span>
                  <strong>{item.title}</strong>
                </button>
                {index < journeyStages.length - 1 && (
                  <div className="connector">
                    <span />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="transform-line">
            <span>
              <Icon name="spark" size={15} /> {BRAND} maps intent, logic, and
              routing
            </span>
          </div>
          <div className="output-card" key={stage.id}>
            <div
              className="output-accent"
              style={{ background: stage.color }}
            />
            <div
              className="output-icon"
              style={{ color: stage.color, background: `${stage.color}18` }}
            >
              <Icon name="nodes" />
            </div>
            <div>
              <small>ACXD BLOCK · {stage.type}</small>
              <strong>{stage.output}</strong>
              <p>{stage.note}</p>
            </div>
            <span className="ready-pill">
              <Icon name="check" size={13} /> Ready
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Hero() {
  return (
    <main id="top" className="hero">
      <div className="hero-glow glow-one" />
      <div className="hero-glow glow-two" />
      <div className="shell hero-inner">
        <div className="hero-copy">
          <div className="announcement">
            <span>Preview</span> Journey to Amazon Connect and ACXD{" "}
            <Icon name="arrow" size={14} />
          </div>
          <h1>
            Turn every customer journey into an <em>ACXD flow.</em>
          </h1>
          <p>
            Upload a customer journey, review what has to be built, and get a
            CloudFormation bundle that creates the AWS and ACXD resources.
            Nothing is created until you have reviewed it.
          </p>
          <div className="hero-actions">
            <a href={OPEN_APP} className="button button-primary">
              Open the workspace <Icon name="arrow" size={17} />
            </a>
            <a href="#platform" className="button button-secondary">
              Explore the platform
            </a>
          </div>
          <div className="trust-line">
            <span>
              <Icon name="check" size={15} /> Human review before deploy
            </span>
            <span>
              <Icon name="check" size={15} /> ACXD resources included
            </span>
            <span>
              <Icon name="check" size={15} /> CloudFormation output
            </span>
          </div>
        </div>
        <FlowPreview />
      </div>
    </main>
  )
}

const benefits = [
  {
    icon: "nodes",
    title: "Journey-aware generation",
    text: "Reads a diagram, deck or document as shapes and arrows, so the connections come from the file. Stages, decisions and outcomes become a checklist of what to build.",
  },
  {
    icon: "spark",
    title: "Nothing silently dropped",
    text: "Anything the tool cannot map is listed for review instead of guessed, and prompts and consent wording are copied exactly as written.",
  },
  {
    icon: "shield",
    title: "Reviewed before it exists",
    text: "You choose what to build, review the generated template, and only then deploy, from the command line or with a previewed change set.",
  },
]

function Platform() {
  return (
    <section id="platform" className="platform section">
      <div className="shell">
        <div className="section-heading split-heading">
          <div>
            <span className="kicker">One connected platform</span>
            <h2>Your journey map should do more than sit in a deck.</h2>
          </div>
          <p>
            {BRAND} makes the customer journey executable. Every touchpoint
            becomes an item you can review, select and generate.
          </p>
        </div>
        <div className="benefit-grid">
          {benefits.map((item, index) => (
            <article className="benefit-card" key={item.title}>
              <span className="card-index">0{index + 1}</span>
              <div className="benefit-icon">
                <Icon name={item.icon} />
              </div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              <a href="#how-it-works">
                Learn more <Icon name="arrow" size={15} />
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function Transformation() {
  const [step, setStep] = useState(0)
  const steps = [
    {
      n: "01",
      label: "Map",
      title: "Bring the journey into focus",
      text: "Upload a PowerPoint, Visio, Word, PDF, image or text file, or load a structured journey.",
      icon: "upload",
    },
    {
      n: "02",
      label: "Choose",
      title: "Decide what gets built",
      text: "Each stage becomes a checklist item: tables, functions, ACXD resources, hand-back attributes. You select what the customer wants.",
      icon: "spark",
    },
    {
      n: "03",
      label: "Validate",
      title: "Close the gaps",
      text: "Every item that needs a human decision is listed with the reason. Resolve them before generating.",
      icon: "shield",
    },
    {
      n: "04",
      label: "Deploy",
      title: "Generate and deploy",
      text: "Download a CloudFormation bundle, or deploy from the app into a target account after reviewing the change set. The ACXD API key stays in your account.",
      icon: "code",
    },
  ]
  const current = steps[step]
  return (
    <section id="how-it-works" className="transformation section">
      <div className="shell">
        <div className="section-heading center-heading">
          <span className="kicker kicker-light">From journey to deployment</span>
          <h2>A clear path from journey to ACXD.</h2>
          <p>
            Four steps, with a human decision before anything is created.
          </p>
        </div>
        <div className="process-tabs" role="tablist">
          {steps.map((item, index) => (
            <button
              key={item.n}
              className={step === index ? "active" : ""}
              onClick={() => setStep(index)}
              role="tab"
              aria-selected={step === index}
            >
              <span>{item.n}</span>
              {item.label}
            </button>
          ))}
        </div>
        <div className="process-panel">
          <div className="process-copy">
            <span className="process-icon">
              <Icon name={current.icon} size={25} />
            </span>
            <span className="eyebrow">Step {current.n}</span>
            <h3>{current.title}</h3>
            <p>{current.text}</p>
            <a href={OPEN_APP} className="text-link">
              Open the workspace <Icon name="arrow" size={16} />
            </a>
          </div>
          <div className="process-visual">
            <div className="mini-top">
              <span>
                <i /> Journey.flowpath
              </span>
              <span>Autosaved</span>
            </div>
            <div className="mini-canvas">
              <div className="mini-node start">
                <span>Journey stage</span>
                <strong>{journeyStages[step]?.title || "Welcome"}</strong>
              </div>
              <div className="mini-arrow">
                <Icon name="arrow" size={20} />
              </div>
              <div className="mini-node result">
                <span>Generated block</span>
                <strong>
                  {journeyStages[step]?.output || "Set contact attributes"}
                </strong>
              </div>
            </div>
            <div className="mini-footer">
              <span>
                <Icon name="check" size={14} /> Mapping complete
              </span>
              <strong>{25 * (step + 1)}%</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Security() {
  return (
    <section id="security" className="security section">
      <div className="shell security-grid">
        <div>
          <span className="kicker">Designed for responsible delivery</span>
          <h2>Keep control from blueprint to deployment.</h2>
          <p>
            Review the checklist and the generated template. Deploy with your own credentials, or let the app preview a change set that you confirm.
          </p>
          <a href={OPEN_APP} className="button button-dark">
            Open the workspace <Icon name="arrow" size={16} />
          </a>
        </div>
        <div className="security-list">
          <div>
            <Icon name="shield" />
            <span>
              <strong>Human-in-the-loop</strong>
              <small>
                A model only reads the journey. Its output is validated and checked against the source wording; the template is built without it.
              </small>
            </span>
          </div>
          <div>
            <Icon name="code" />
            <span>
              <strong>Portable output</strong>
              <small>
                Plain CloudFormation, plus the Amazon Connect contact flow JSON.
              </small>
            </span>
          </div>
          <div>
            <Icon name="chart" />
            <span>
              <strong>Change visibility</strong>
              <small>
                Every checklist item says why it is there and whether its schema is confirmed.
              </small>
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

function CTA() {
  return (
    <section id="demo" className="cta-section section">
      <div className="cta-orb orb-a" />
      <div className="cta-orb orb-b" />
      <div className="shell cta-inner">
        <span className="kicker kicker-light">
          Start from a journey
        </span>
        <h2>Make customer journeys deployable.</h2>
        <p>
          See how {BRAND} turns your journey into a bundle your team can review and deploy.
        </p>
        <div className="hero-actions">
          <a
            href={OPEN_APP}
            className="button button-white"
          >
            Open the workspace <Icon name="arrow" size={17} />
          </a>
          <a href="#top" className="button button-glass">
            Back to top
          </a>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer>
      <div className="shell footer-main">
        <div className="footer-brand">
          <Brand dark />
          <p>Customer journeys, transformed into Amazon Connect flows.</p>
        </div>
        <div>
          <strong>Product</strong>
          <a href="#platform">Platform</a>
          <a href="#how-it-works">How it works</a>
          <a href="#security">Security</a>
        </div>
        <div>
          <strong>Resources</strong>
          <a href={OPEN_APP}>Workspace</a>
          <a href="#security">Security</a>
        </div>
        <div>
          <strong>Workspace</strong>
          <a href={OPEN_APP}>Overview</a>
          <a href="#/app/journey">Journey</a>
        </div>
      </div>
      <div className="shell footer-bottom">
        <span>© 2026 {COMPANY}. All rights reserved.</span>
        <span>For Amazon Connect and ACXD</span>
      </div>
    </footer>
  )
}

export function Landing() {
  return (
    <>
      <Nav />
      <Hero />
      <Platform />
      <Transformation />
      <Security />
      <CTA />
      <Footer />
    </>
  )
}
