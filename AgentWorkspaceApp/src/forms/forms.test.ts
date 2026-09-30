import { describe, expect, it } from 'vitest'
import { formManifest, formManifestProblems } from '../config/forms'
import type { TranscriptItem } from '../transcript/types'
import { detectForms } from './detect'

let n = 0
const say = (role: 'AGENT' | 'CUSTOMER', content: string): TranscriptItem => ({
  kind: 'turn',
  id: `t${++n}`,
  sortKey: n,
  role,
  content,
})
const C = (t: string) => say('CUSTOMER', t)
const A = (t: string) => say('AGENT', t)

const detect = (items: TranscriptItem[], attrs: Record<string, string> = {}) => detectForms(formManifest, items, attrs)
const field = (items: TranscriptItem[], formId: string, key: string, attrs: Record<string, string> = {}) =>
  detect(items, attrs).find((f) => f.formId === formId)?.fields[key]

describe('manifest', () => {
  it('is valid', () => expect(formManifestProblems).toEqual([]))
})

describe('detection', () => {
  it('opens nothing for an unrelated conversation', () => {
    expect(detect([A('How can I help?'), C("There's a charge I don't recognise.")])).toEqual([])
  })

  it('ignores trigger words the agent says', () => {
    expect(detect([A('Are you calling about a credit card or your mother’s account?')])).toEqual([])
  })

  it('ignores system announcements', () => {
    const sys: TranscriptItem = { kind: 'turn', id: 'sys', sortKey: 0, role: 'SYSTEM', content: 'credit card calls are recorded' }
    expect(detect([sys])).toEqual([])
  })

  it('opens forms in the order the topics were raised', () => {
    const forms = detect([C('I want a new credit card.'), A('Sure.'), C('And I need to add my mother too.')])
    expect(forms.map((f) => f.formId)).toEqual(['credit_card', 'relative'])
  })
})

describe('credit card form', () => {
  const convo = () => [
    A('How can I help you today?'),
    C('I want to enroll for a new credit card.'),
    A('Happy to help. Would you like the Gold or Platinum card?'),
    C('Platinum.'),
    A('Are you an existing customer with us?'),
    C('Yes, I am.'),
    A('And which city do you live in?'),
    C('Pune.'),
  ]

  it('fills the type, existing-customer flag and city from the conversation', () => {
    const [form] = detect(convo())
    expect(form?.fields.card_type?.value).toBe('Platinum')
    expect(form?.fields.existing_customer?.value).toBe('Yes')
    expect(form?.fields.city).toMatchObject({ value: 'Pune', origin: 'transcript' })
  })

  it('does not take the tier from what the agent offered', () => {
    expect(field([C('I want a credit card.'), A('Gold or Platinum?')], 'credit_card', 'card_type')).toBeUndefined()
  })

  it('lets a later correction win', () => {
    const items = [C('I want a credit card, the Gold one.'), A('OK'), C('Actually, make it Platinum.')]
    expect(field(items, 'credit_card', 'card_type')?.value).toBe('Platinum')
  })

  it('seeds customer id and city from the IVR when the call did not say them', () => {
    const items = [C('I want a credit card.')]
    const attrs = { customer_id: 'CUS-4417829', city: 'Mumbai' }
    expect(field(items, 'credit_card', 'customer_id', attrs)).toEqual({ value: 'CUS-4417829', origin: 'attribute' })
    expect(field(items, 'credit_card', 'city', attrs)?.value).toBe('Mumbai')
  })

  it('prefers what the customer said over the IVR value', () => {
    const items = [C('I want a credit card.'), C('I live in Pune.')]
    expect(field(items, 'credit_card', 'city', { city: 'Mumbai' })).toMatchObject({ value: 'Pune', origin: 'transcript' })
  })

  it('reads a spoken customer id', () => {
    expect(field([C('New credit card please, my customer ID is CUS-882931.')], 'credit_card', 'customer_id')?.value).toBe('CUS-882931')
  })

  it('reads a new customer as No', () => {
    expect(field([C("I'd like a credit card, I'm a new customer.")], 'credit_card', 'existing_customer')?.value).toBe('No')
  })

  it('does not read "new credit card" as a new customer', () => {
    expect(field([C('I want a new credit card.')], 'credit_card', 'existing_customer')).toBeUndefined()
  })

  it('reads a bare "no" against the agent question', () => {
    const items = [C('Credit card please.'), A('Are you an existing customer?'), C('No.')]
    expect(field(items, 'credit_card', 'existing_customer')?.value).toBe('No')
  })
})

describe('relative form', () => {
  it('fills all four fields from one sentence', () => {
    const [form] = detect([C('I want to update details for my mother Sunita, she is 62 and lives in Pune.')])
    expect(form?.formId).toBe('relative')
    expect(form?.fields.relation?.value).toBe('Mother')
    expect(form?.fields.relative_name?.value).toBe('Sunita')
    expect(form?.fields.age?.value).toBe('62')
    expect(form?.fields.city?.value).toBe('Pune')
  })

  it('fills from agent-led questions and short answers', () => {
    const items = [
      C('I want to add a family member.'),
      A('What is their name?'),
      C('Rahul Sharma.'),
      A('How are they related to you?'),
      C('Brother.'),
      A('How old is he?'),
      C('Forty five.'),
      A('Which city does he live in?'),
      C('Nagpur.'),
    ]
    const [form] = detect(items)
    expect(form?.fields).toMatchObject({
      relative_name: { value: 'Rahul Sharma' },
      relation: { value: 'Brother' },
      age: { value: '45' },
      city: { value: 'Nagpur' },
    })
  })

  it('does not mistake the customer’s own city for the relative’s', () => {
    expect(field([C('I live in Mumbai and I want to add my father.')], 'relative', 'city')).toBeUndefined()
  })

  it('does not take "my mother and" as a name', () => {
    expect(field([C('My mother and I both want this.')], 'relative', 'relative_name')).toBeUndefined()
  })

  it('never prefills the relative’s city from the IVR', () => {
    expect(field([C('Add my mother.')], 'relative', 'city', { city: 'Mumbai' })).toBeUndefined()
  })
})

describe('password reset placeholder', () => {
  it('opens and fills what it can', () => {
    const [form] = detect([C('I forgot my password, can you send it by email?')], { customer_id: 'CUS-1' })
    expect(form?.formId).toBe('password_reset')
    expect(form?.fields.verify_via?.value).toBe('Email')
    expect(form?.fields.reason?.value).toBe('Forgot password')
    expect(form?.fields.user_id?.origin).toBe('attribute')
  })
})

describe('robustness', () => {
  it('rejects a spoken value the select cannot hold', () => {
    expect(field([C('I want a credit card, maybe the silver one')], 'credit_card', 'card_type')).toBeUndefined()
  })

  it('counts repeated mentions so a dismissed form can reopen', () => {
    const forms = detect([C('credit card'), C('about that credit card again')])
    expect(forms[0]?.triggerCount).toBe(2)
  })
})
