import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BRAND } from '../site/brand'
import { Icon } from './icons'
import { Palette } from './Palette'
import { PAGES, pageInfo } from './pages'
import type { PageId } from './pages'
import { hrefFor } from './route'
import { applyTheme, initialTheme } from './theme'
import type { ThemeName } from './theme'
import { useWorkspace } from './workspace'
import './app.css'

/** Sidebar, top bar (breadcrumbs, jump search, theme toggle) and the page area. */
export function Shell({ page, children }: { page: PageId; children: ReactNode }) {
  const ws = useWorkspace()
  const [theme, setTheme] = useState<ThemeName>(initialTheme)
  const [menu, setMenu] = useState(false)
  const [palette, setPalette] = useState(false)
  const info = pageInfo(page)

  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => { setMenu(false) }, [page])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const doneBy = new Map(ws.stages.map((s) => [s.page, s.status === 'done']))
  const groups = ['Workspace', 'Pipeline', 'Tools'] as const

  return (
    <div className="ax">
      <aside className="ax-side" data-open={menu} aria-label="Workspace navigation">
        <a className="ax-brand" href="#/">
          <span className="ax-mark"><Icon name="flow" size={17} /></span>
          <span>{BRAND}</span>
        </a>
        {groups.map((g) => (
          <nav key={g} className="ax-group" aria-label={g}>
            <div className="ax-group-title">{g}</div>
            {PAGES.filter((p) => p.group === g).map((p) => (
              <a key={p.id} className="ax-link" href={hrefFor(p.id)} aria-current={p.id === page ? 'page' : undefined} aria-disabled={p.needsJourney && !ws.session ? true : undefined}>
                <Icon name={p.id} />
                <span>{p.step ? `${p.step} · ${p.label}` : p.label}</span>
                {doneBy.get(p.id) && <span className="ax-badge" title="Done" />}
              </a>
            ))}
          </nav>
        ))}
        <div className="ax-side-foot">
          Held in this tab only; nothing is stored or sent until you deploy.<br />
          <a href="#/">Back to the site</a>
        </div>
      </aside>

      <div className="ax-main">
        <header className="ax-top">
          <button type="button" className="ax-icon-btn ax-menu-btn" aria-label="Open navigation" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="menu" /></button>
          <nav className="ax-crumbs" aria-label="Breadcrumb">
            <span>{BRAND}</span><span aria-hidden="true">/</span>
            {page !== 'overview' && <><span>{info.group}</span><span aria-hidden="true">/</span></>}
            <strong>{info.label}</strong>
          </nav>
          <span className="ax-spacer" />
          <button type="button" className="ax-search" onClick={() => setPalette(true)} aria-label="Jump to a page">
            <Icon name="search" size={16} /><span className="ax-search-text">Jump to…</span><kbd className="ax-kbd">Ctrl K</kbd>
          </button>
          <button type="button" className="ax-icon-btn" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </header>
        <main className="ax-content">{children}</main>
      </div>
      <Palette open={palette} onClose={() => setPalette(false)} onGo={(id) => { window.location.hash = hrefFor(id) }} />
    </div>
  )
}
