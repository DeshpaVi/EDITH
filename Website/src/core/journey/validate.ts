import type { Journey, JourneyStep, StepKind } from './model'

export interface ValidationIssue {
  path: string
  message: string
}

export type ValidationResult =
  | { ok: true; journey: Journey; issues: [] }
  | { ok: false; journey?: undefined; issues: ValidationIssue[] }

const STEP_KINDS: readonly StepKind[] = [
  'greeting', 'announcement', 'language_detection', 'intent_capture', 'decision', 'authentication',
  'data_lookup', 'self_service', 'confirmation', 'escalation', 'closing', 'end', 'unknown',
]
const CHANNELS = ['voice', 'chat', 'web']
const DATA_SOURCES = ['dynamodb', 'http_api', 'lambda', 'unknown']
const EXHAUSTED = ['escalate', 'end', 'unknown']

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Kinds whose `text` is spoken to the caller and must be non-empty and verbatim. */
const SPOKEN: readonly StepKind[] = ['greeting', 'announcement', 'closing', 'intent_capture', 'authentication', 'confirmation']

class Checker {
  readonly issues: ValidationIssue[] = []
  fail(path: string, message: string) {
    this.issues.push({ path, message })
  }
  str(o: Obj, key: string, path: string, opts: { allowEmpty?: boolean } = {}): string {
    const v = o[key]
    if (typeof v !== 'string' || (!opts.allowEmpty && v.trim() === '')) {
      this.fail(`${path}.${key}`, 'must be a non-empty string')
      return ''
    }
    return v
  }
  optStr(o: Obj, key: string, path: string) {
    if (o[key] !== undefined && typeof o[key] !== 'string') this.fail(`${path}.${key}`, 'must be a string when present')
  }
  bool(o: Obj, key: string, path: string) {
    if (typeof o[key] !== 'boolean') this.fail(`${path}.${key}`, 'must be a boolean')
  }
  strArr(o: Obj, key: string, path: string, opts: { nonEmpty?: boolean } = {}): string[] {
    const v = o[key]
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x === '')) {
      this.fail(`${path}.${key}`, 'must be an array of non-empty strings')
      return []
    }
    if (opts.nonEmpty && v.length === 0) this.fail(`${path}.${key}`, 'must not be empty')
    return v as string[]
  }
  oneOf(o: Obj, key: string, path: string, allowed: readonly string[]) {
    if (typeof o[key] !== 'string' || !allowed.includes(o[key] as string)) {
      this.fail(`${path}.${key}`, `must be one of: ${allowed.join(', ')}`)
    }
  }
}

function checkRetry(c: Checker, v: unknown, path: string) {
  if (!isObj(v)) return c.fail(path, 'must be an object')
  if (!Number.isInteger(v.maxAttempts) || (v.maxAttempts as number) < 0) c.fail(`${path}.maxAttempts`, 'must be a non-negative integer')
  c.oneOf(v, 'onExhausted', path, EXHAUSTED)
  c.optStr(v, 'reprompt', path)
}

function checkDataSource(c: Checker, v: unknown, path: string) {
  if (!isObj(v)) return c.fail(path, 'must be an object')
  c.oneOf(v, 'type', path, DATA_SOURCES)
  c.optStr(v, 'description', path)
}

function checkStep(c: Checker, s: unknown, path: string): void {
  if (!isObj(s)) return c.fail(path, 'must be an object')
  c.str(s, 'id', path)
  c.str(s, 'label', path)
  c.str(s, 'source', path)
  if (typeof s.kind !== 'string' || !STEP_KINDS.includes(s.kind as StepKind)) {
    return c.fail(`${path}.kind`, `must be one of: ${STEP_KINDS.join(', ')}`)
  }
  if (!Array.isArray(s.next)) c.fail(`${path}.next`, 'must be an array of edges')
  else
    s.next.forEach((e, i) => {
      if (!isObj(e)) return c.fail(`${path}.next[${i}]`, 'must be an object')
      c.str(e, 'to', `${path}.next[${i}]`)
      c.optStr(e, 'label', `${path}.next[${i}]`)
    })

  const kind = s.kind as StepKind
  if (SPOKEN.includes(kind)) {
    c.str(s, 'text', path)
    if (s.compliance !== undefined) c.bool(s, 'compliance', path)
  }
  switch (kind) {
    case 'language_detection':
      c.strArr(s, 'languages', path, { nonEmpty: true })
      c.optStr(s, 'method', path)
      break
    case 'intent_capture':
      if (!Array.isArray(s.intents)) c.fail(`${path}.intents`, 'must be an array')
      else
        s.intents.forEach((it, i) => {
          const p = `${path}.intents[${i}]`
          if (!isObj(it)) return c.fail(p, 'must be an object')
          c.str(it, 'name', p)
          c.bool(it, 'requiresAuth', p)
          c.oneOf(it, 'handledBy', p, ['self_service', 'agent'])
        })
      checkRetry(c, s.retry, `${path}.retry`)
      break
    case 'decision':
      c.str(s, 'question', path)
      break
    case 'authentication':
      c.strArr(s, 'identifiers', path, { nonEmpty: true })
      c.oneOf(s, 'match', path, ['any', 'all'])
      c.optStr(s, 'failurePrompt', path)
      checkRetry(c, s.retry, `${path}.retry`)
      checkDataSource(c, s.verifiesAgainst, `${path}.verifiesAgainst`)
      break
    case 'data_lookup':
      c.str(s, 'name', path)
      c.str(s, 'purpose', path)
      c.strArr(s, 'inputs', path)
      c.strArr(s, 'outputs', path)
      checkDataSource(c, s.dataSource, `${path}.dataSource`)
      break
    case 'self_service':
      c.str(s, 'name', path)
      c.oneOf(s, 'mode', path, ['faq', 'transaction', 'form', 'other'])
      c.bool(s, 'separateFlow', path)
      c.oneOf(s, 'content', path, ['knowledge_base', 'api', 'unknown'])
      break
    case 'escalation':
      c.str(s, 'reason', path)
      c.strArr(s, 'context', path)
      c.optStr(s, 'queue', path)
      break
    case 'end':
      c.oneOf(s, 'disposition', path, ['disconnect', 'return'])
      break
    case 'unknown':
      c.str(s, 'raw', path)
      break
    default:
      break
  }
}

/**
 * Validates untrusted journey JSON (LLM output or a fixture). Pure; collects every issue
 * instead of stopping at the first, so a consultant sees the whole problem at once.
 */
export function validateJourney(input: unknown): ValidationResult {
  const c = new Checker()
  if (!isObj(input)) return { ok: false, issues: [{ path: '$', message: 'journey must be an object' }] }

  c.str(input, 'title', '$')
  c.optStr(input, 'origin', '$')
  const channels = c.strArr(input, 'channels', '$')
  channels.forEach((ch, i) => {
    if (!CHANNELS.includes(ch)) c.fail(`$.channels[${i}]`, `must be one of: ${CHANNELS.join(', ')}`)
  })
  c.strArr(input, 'languages', '$', { nonEmpty: true })

  if (!Array.isArray(input.steps) || input.steps.length === 0) c.fail('$.steps', 'must be a non-empty array')
  else input.steps.forEach((s, i) => checkStep(c, s, `$.steps[${i}]`))

  for (const [key, fields] of [
    ['scenarios', ['name', 'description']],
    ['assumptions', ['statement']],
    ['unmapped', ['description', 'source']],
  ] as const) {
    const arr = input[key]
    if (!Array.isArray(arr)) c.fail(`$.${key}`, 'must be an array')
    else
      arr.forEach((it, i) => {
        if (!isObj(it)) return c.fail(`$.${key}[${i}]`, 'must be an object')
        for (const f of fields) c.str(it, f, `$.${key}[${i}]`)
      })
  }

  // Graph integrity: unique ids and edges that resolve.
  if (Array.isArray(input.steps)) {
    const ids = new Set<string>()
    for (const [i, s] of input.steps.entries()) {
      if (!isObj(s) || typeof s.id !== 'string') continue
      if (ids.has(s.id)) c.fail(`$.steps[${i}].id`, `duplicate step id "${s.id}"`)
      ids.add(s.id)
    }
    for (const [i, s] of input.steps.entries()) {
      if (!isObj(s) || !Array.isArray(s.next)) continue
      for (const [j, e] of s.next.entries()) {
        if (isObj(e) && typeof e.to === 'string' && !ids.has(e.to)) {
          c.fail(`$.steps[${i}].next[${j}].to`, `edge points at unknown step "${e.to}"`)
        }
      }
    }
  }

  return c.issues.length === 0
    ? { ok: true, journey: input as unknown as Journey, issues: [] }
    : { ok: false, issues: c.issues }
}

export type { JourneyStep }
