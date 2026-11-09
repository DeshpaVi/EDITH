import type { Checklist, ChecklistItem, ChecklistSummary } from './model'
import { summarize } from './build'

const BADGE = { confirmed: 'confirmed', partial: 'partial', unconfirmed: 'UNCONFIRMED' } as const
const SEVERITY = { blocker: 'BLOCKER', warn: 'warn', info: 'info' } as const

/** Plain Markdown view of a checklist: the "what will be built and what needs a decision" page. Deterministic. */
export function renderChecklist(title: string, checklist: Checklist, selected?: readonly string[]): string {
  const chosen = selected ? new Set(selected) : null
  const summary: ChecklistSummary = summarize(checklist, chosen ?? undefined)
  const lines: string[] = [`# Implementation checklist: ${title}`, '']
  lines.push(
    `${summary.total} items (${summary.byNeed.required} required, ${summary.byNeed.recommended} recommended, ${summary.byNeed.optional} optional). ` +
      `Schema: ${summary.bySchemaStatus.confirmed} confirmed, ${summary.bySchemaStatus.partial} partial, ${summary.bySchemaStatus.unconfirmed} unconfirmed. ` +
      `Reviews: ${summary.reviews.blocker} blocker, ${summary.reviews.warn} warn, ${summary.reviews.info} info.`,
    summary.fullyEmittable ? 'Every selected item can be generated from confirmed schema.' : 'Not everything can be generated yet: see the unconfirmed items and blockers below.',
    '',
  )

  const section = (heading: string, items: ChecklistItem[]) => {
    if (items.length === 0) return
    lines.push(`## ${heading}`, '')
    for (const i of items) {
      const mark = chosen ? (chosen.has(i.id) ? '[x]' : '[ ]') : i.selected ? '[x]' : '[ ]'
      lines.push(`- ${mark} **${i.title}** (${i.kind}, ${BADGE[i.schemaStatus]})`, `  - Why: ${i.reason}`)
      if (i.sources.length > 0) lines.push(`  - From journey steps: ${i.sources.join(', ')}`)
      if (i.params.length > 0) lines.push(`  - You supply: ${i.params.map((p) => (p.secret ? `${p.label} (secret, NoEcho)` : p.label)).join('; ')}`)
      if (i.requires.length > 0) lines.push(`  - Needs: ${i.requires.join(', ')}`)
      for (const n of i.notes) lines.push(`  - Note: ${n}`)
    }
    lines.push('')
  }
  section('Required', checklist.items.filter((i) => i.need === 'required'))
  section('Recommended', checklist.items.filter((i) => i.need === 'recommended'))
  section('Optional', checklist.items.filter((i) => i.need === 'optional'))

  if (checklist.reviews.length > 0) {
    lines.push('## Needs a human decision', '')
    for (const r of checklist.reviews) {
      lines.push(`- **${SEVERITY[r.severity]}: ${r.title}**`, `  - ${r.detail}`)
      if (r.sources.length > 0) lines.push(`  - Steps: ${r.sources.join(', ')}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
