import { describe, expect, it } from 'vitest'
import { attributeManifest, validateManifest, type AttributeManifest } from '../config/attributes'
import { formatValue, maskValue } from './format'
import { selectAttributes, toClipboardText } from './select'

const manifest: AttributeManifest = {
  version: 1,
  source: 'test',
  groups: [
    {
      id: 'g1',
      label: 'Group one',
      attributes: [
        { key: 'plain', label: 'Plain', format: 'text' },
        { key: 'needed', label: 'Needed', format: 'text', required: true },
        { key: 'acct', label: 'Account', format: 'text', sensitive: true, mask: 'last4' },
        { key: 'amount', label: 'Amount', format: 'currency', currencyFrom: 'ccy' },
        {
          key: 'auth',
          label: 'Auth',
          format: 'badge',
          badgeMap: { verified: 'good', failed: 'bad' },
        },
        { key: 'notice', label: 'Notice', format: 'text', compliance: true },
      ],
    },
  ],
}

describe('selectAttributes', () => {
  it('surfaces attributes the manifest does not declare instead of dropping them', () => {
    const model = selectAttributes(manifest, { plain: 'a', surprise: 'from a flow change' })
    expect(model.unmapped).toEqual([{ key: 'surprise', value: 'from a flow change' }])
    expect(model.totals.unmapped).toBe(1)
  })

  it('keeps a declared-but-absent attribute on screen as a gap', () => {
    const model = selectAttributes(manifest, { plain: 'a' })
    const row = model.groups[0]!.rows.find((r) => r.key === 'needed')
    expect(row?.state).toBe('missing')
    expect(row?.display).toBe('Not set')
    expect(model.missingRequired.map((r) => r.key)).toEqual(['needed'])
  })

  it('masks a sensitive value for display but keeps the revealed form available', () => {
    const model = selectAttributes(manifest, { acct: '400211987654' })
    const row = model.groups[0]!.rows.find((r) => r.key === 'acct')!
    expect(row.display).toBe('••••••••7654')
    expect(row.display).not.toContain('4002')
    expect(row.revealed).toBe('400211987654')
  })

  it('does not reformat compliance text', () => {
    const wording = '  This call MAY be recorded.  '
    const model = selectAttributes(manifest, { notice: wording })
    const row = model.groups[0]!.rows.find((r) => r.key === 'notice')!
    expect(row.raw).toBe(wording)
    expect(row.display).toBe(wording)
  })

  it('reads the currency from the sibling attribute the spec names', () => {
    const model = selectAttributes(manifest, { amount: '134.50', ccy: 'GBP' })
    const row = model.groups[0]!.rows.find((r) => r.key === 'amount')!
    expect(row.revealed).toContain('134.50')
    expect(row.revealed).toMatch(/£|GBP/)
  })

  it('shows a bare number rather than guessing a symbol when no currency is set', () => {
    const model = selectAttributes(manifest, { amount: '134.5' })
    const row = model.groups[0]!.rows.find((r) => r.key === 'amount')!
    expect(row.revealed).toBe('134.50')
    expect(row.warning).toMatch(/currency/i)
  })

  it('flags a badge value the manifest does not document', () => {
    const model = selectAttributes(manifest, { auth: 'partial' })
    const row = model.groups[0]!.rows.find((r) => r.key === 'auth')!
    expect(row.tone).toBe('neutral')
    expect(row.warning).toMatch(/documented/)
  })
})

describe('toClipboardText', () => {
  it('omits sensitive values rather than pasting masked bullets into a CRM', () => {
    const model = selectAttributes(manifest, { plain: 'a', acct: '400211987654' })
    const text = toClipboardText(model, 'contact-1')
    expect(text).not.toContain('•')
    expect(text).not.toContain('400211987654')
    expect(text).toContain('Omitted (sensitive): Account')
  })
})

describe('formatValue', () => {
  it('shows an unparseable value raw, with a warning, rather than blanking it', () => {
    const result = formatValue({ key: 'd', label: 'D', format: 'date' }, 'not-a-date')
    expect(result.text).toBe('not-a-date')
    expect(result.warning).toBeDefined()
  })

  it('treats a date-only string as a local date', () => {
    const result = formatValue({ key: 'd', label: 'D', format: 'date' }, '1984-03-11')
    expect(result.text).toMatch(/11/)
    expect(result.text).toMatch(/1984/)
  })

  it('formats durations in seconds', () => {
    expect(formatValue({ key: 'x', label: 'X', format: 'duration' }, '186').text).toBe('3m 06s')
    expect(formatValue({ key: 'x', label: 'X', format: 'duration' }, '45').text).toBe('45s')
  })
})

describe('maskValue', () => {
  it('never lets a last4 mask reveal more than the last four characters', () => {
    expect(maskValue('123456789', 'last4')).toBe('•••••6789')
    expect(maskValue('abc', 'last4')).toBe('abc')
    expect(maskValue('secret', 'all')).not.toContain('s')
  })
})

describe('validateManifest', () => {
  it('reports a duplicate key instead of silently shadowing one', () => {
    const { problems } = validateManifest({
      groups: [
        { id: 'a', label: 'A', attributes: [{ key: 'k', label: 'K', format: 'text' }] },
        { id: 'b', label: 'B', attributes: [{ key: 'k', label: 'K2', format: 'text' }] },
      ],
    })
    expect(problems.join(' ')).toMatch(/already declared/)
  })

  it('accepts the manifest that ships with the app', () => {
    const { problems } = validateManifest(attributeManifest)
    expect(problems).toEqual([])
  })
})
