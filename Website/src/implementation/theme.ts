import type { CSSProperties } from 'react'

/**
 * Every colour, radius and text style of the implementation tool lives here. Restyling the tool means
 * editing this file (or replacing the components in ui.tsx); the logic in controller.ts does not change.
 */
export const color = {
  bg: '#0a0a0a',
  surface: 'rgba(255,255,255,0.04)',
  surfaceStrong: 'rgba(255,255,255,0.08)',
  border: 'rgba(255,255,255,0.1)',
  text: '#f5f5f7',
  textMuted: 'rgba(245,245,247,0.6)',
  textFaint: 'rgba(245,245,247,0.38)',
  accent: '#0a84ff',
  good: '#30d158',
  warn: '#ff9f0a',
  bad: '#ff375f',
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
  background: 'rgba(0,0,0,0.35)',
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
