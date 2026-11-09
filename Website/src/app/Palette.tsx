import { useEffect, useMemo, useRef, useState } from 'react'
import { PAGES } from './pages'
import type { PageId } from './pages'

/** Ctrl/Cmd+K jump search over the workspace pages. */
export function Palette({ open, onClose, onGo }: { open: boolean; onClose: () => void; onGo: (id: PageId) => void }) {
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return PAGES.filter((p) => needle === '' || `${p.label} ${p.blurb}`.toLowerCase().includes(needle))
  }, [q])
  useEffect(() => {
    if (open) {
      setQ('')
      setIndex(0)
      input.current?.focus()
    }
  }, [open])
  if (!open) return null
  const go = (id: PageId) => { onGo(id); onClose() }
  return (
    <div className="ax-palette-back" onMouseDown={onClose}>
      <div className="ax-palette" role="dialog" aria-modal="true" aria-label="Jump to a page" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder="Jump to…"
          aria-label="Jump to a page"
          onChange={(e) => { setQ(e.target.value); setIndex(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, hits.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter' && hits[index]) go(hits[index].id)
          }}
        />
        <ul role="listbox">
          {hits.map((p, i) => (
            <li key={p.id}>
              <button type="button" role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => go(p.id)}>
                {p.label}<small>{p.group}</small>
              </button>
            </li>
          ))}
          {hits.length === 0 && <li style={{ padding: 12, color: 'var(--ax-faint)', fontSize: 14 }}>No page matches.</li>}
        </ul>
      </div>
    </div>
  )
}
