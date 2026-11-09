import type { CSSProperties, ReactNode } from 'react'
import { color, input, mono, muted, panel, radius } from './theme'

/** Small presentational pieces. Replace these to change the look; they take no business logic. */

export function download(filename: string, data: string | Uint8Array, mime: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...panel, ...style }}>{children}</div>
}

export function Chip({ children, tone = color.textMuted }: { children: ReactNode; tone?: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: radius.pill, border: `1px solid ${tone}`, color: tone, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
      {children}
    </span>
  )
}

export function Button({ children, onClick, disabled, kind = 'primary', type = 'button' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: 'primary' | 'ghost'; type?: 'button' | 'submit' }) {
  const primary = kind === 'primary'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '10px 20px',
        borderRadius: radius.pill,
        border: primary ? 'none' : `1px solid ${color.border}`,
        background: primary ? color.accent : 'transparent',
        color: primary ? '#fff' : color.text,
        fontSize: 14,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 16 }}>
      <span style={{ display: 'block', color: color.text, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</span>
      {children}
      {hint && <span style={{ display: 'block', ...muted, fontSize: 12, marginTop: 4 }}>{hint}</span>}
    </label>
  )
}

export function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input style={input} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
}

export function TextArea({ value, onChange, rows = 4, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea style={{ ...input, resize: 'vertical', ...mono }} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
}

export function Code({ children, maxHeight = 360 }: { children: string; maxHeight?: number }) {
  return <pre style={{ ...mono, background: 'rgba(0,0,0,0.5)', border: `1px solid ${color.border}`, borderRadius: radius.control, padding: 14, margin: 0, overflow: 'auto', maxHeight, color: color.text, whiteSpace: 'pre-wrap' }}>{children}</pre>
}

export function Problems({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <ul role="alert" style={{ margin: '12px 0', paddingLeft: 18, color: color.bad, fontSize: 14, lineHeight: 1.6 }}>
      {items.map((m) => <li key={m}>{m}</li>)}
    </ul>
  )
}
