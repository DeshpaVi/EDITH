import type { CSSProperties } from 'react'

/**
 * Every colour, radius and text style of the implementation tool lives here. Colours are CSS variables (see app/app.css), so the dark and light themes switch without re-rendering. Restyling the tool means
 * editing this file (or replacing the components in ui.tsx); the logic in controller.ts does not change.
 */
export const color = {
  bg: 'var(--ax-bg)',
  surface: 'var(--ax-surface)',
  surfaceStrong: 'var(--ax-surface-strong)',
  border: 'var(--ax-border)',
  text: 'var(--ax-text)',
  textMuted: 'var(--ax-muted)',
  textFaint: 'var(--ax-faint)',
  accent: 'var(--ax-accent)',
  accentSoft: 'var(--ax-accent-soft)',
  onAccent: 'var(--ax-on-accent)',
  good: 'var(--ax-good)',
  warn: 'var(--ax-warn)',
  bad: 'var(--ax-bad)',
  input: 'var(--ax-input)',
  code: 'var(--ax-code)',
} as const

export const radius = { card: 16, control: 10, pill: 980 } as const

export const panel: CSSProperties = {
  background: color.surface,
  border: `1px solid ${color.border}`,
  borderRadius: radius.card,
  padding: 24,
}

export const heading: CSSProperties = { color: color.text, fontWeight: 600, margin: 0 }
export const muted: CSSProperties = { color: color.textMuted, fontSize: 14, lineHeight: 1.6 }

export const input: CSSProperties = {
  width: '100%',
  background: color.input,
  border: `1px solid ${color.border}`,
  borderRadius: radius.control,
  color: color.text,
  padding: '10px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
}

export const mono: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }

export const severityColor = { blocker: color.bad, warn: color.warn, info: color.accent } as const
export const statusColor = { confirmed: color.good, partial: color.warn, unconfirmed: color.bad } as const
