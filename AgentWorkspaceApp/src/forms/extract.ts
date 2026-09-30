/**
 * Field extractors. Each reads the customer's words from the first trigger
 * onward and returns the most recent value it can justify, or nothing.
 *
 * Two kinds of evidence are used:
 *  - what the customer *said* ("I live in Pune", "my mother Sunita");
 *  - what the customer *answered* — a one-word reply is meaningless alone
 *    ("Platinum", "62", "Pune") but clear against the agent question before it.
 *
 * "Nothing" is a valid, common result. A wrong auto-fill is worse than a blank
 * the agent completes, so every pattern is anchored and none guesses.
 */

import type { FieldSuggestion, Utterance } from './types'

interface Window {
  /** Customer turns from the trigger onward, each with the turn before it. */
  turns: Array<{ text: string; prev: string }>
}

type Extractor = (w: Window) => FieldSuggestion | undefined

const found = (value: string, evidence: string): FieldSuggestion => ({ value, origin: 'transcript', evidence })

export function buildWindow(utterances: readonly Utterance[], from: number): Window {
  const turns: Window['turns'] = []
  for (let i = from; i < utterances.length; i++) {
    const u = utterances[i]!
    if (u.role !== 'CUSTOMER') continue
    turns.push({ text: u.text, prev: i > 0 ? utterances[i - 1]!.text : '' })
  }
  return { turns }
}

/** Latest match wins: a customer who corrects themselves means the correction. */
function latest(w: Window, pick: (t: Window['turns'][number]) => string | undefined): FieldSuggestion | undefined {
  for (let i = w.turns.length - 1; i >= 0; i--) {
    const t = w.turns[i]!
    const value = pick(t)
    if (value) return found(value, t.text)
  }
  return undefined
}

const titleCase = (s: string) =>
  s
    .trim()
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')

// Words that follow a place or a name in speech but are not part of it.
const STOP = new Set([
  'and', 'but', 'so', 'because', 'right', 'now', 'currently', 'please', 'since', 'for', 'with', 'my',
  'her', 'his', 'the', 'a', 'an', 'is', 'was', 'too', 'also', 'only', 'just', 'about', 'who', 'which',
  'that', 'there', 'here', 'yes', 'no', 'not', 'she', 'he', 'they', 'we', 'i', 'it', 'at', 'on', 'near',
])

/** Up to two plain words, stopping at the first filler. */
function place(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const words: string[] = []
  for (const word of raw.split(/\s+/)) {
    const clean = word.replace(/[^A-Za-z'-]/g, '')
    if (!clean || STOP.has(clean.toLowerCase()) || words.length === 2) break
    words.push(clean)
  }
  return words.length > 0 ? titleCase(words.join(' ')) : undefined
}

const asked = (prev: string, re: RegExp) => re.test(prev)

/** A short reply with no sentence structure: "Pune", "Pune, Maharashtra." */
function bareReply(text: string): string | undefined {
  const cleaned = text.trim().replace(/[.!,]+$/, '')
  if (cleaned.split(/\s+/).length > 3 || /[?]/.test(cleaned)) return undefined
  return cleaned.replace(/^(?:it'?s|it is|that'?s|in|from)\s+/i, '')
}

// --- credit card --------------------------------------------------------

const cardTier: Extractor = (w) =>
  latest(w, (t) => {
    const m = [...t.text.matchAll(/\b(gold|platinum)\b/gi)].pop()
    return m ? titleCase(m[1]!) : undefined
  })

const customerId: Extractor = (w) =>
  latest(w, (t) => {
    const m = t.text.match(/\b(?:customer\s*(?:id|number)|id)\s*(?:is|number is|:)?\s*([A-Za-z]{0,4}-?\d[\d-]{3,})/i) ??
      t.text.match(/\b(CUS-?\d{4,})\b/i)
    if (m) return m[1]!.toUpperCase()
    if (asked(t.prev, /\b(?:customer|user)\s*(?:id|number)\b/i)) {
      const bare = t.text.match(/\b([A-Za-z]{0,4}-?\d{4,})\b/)
      return bare?.[1]?.toUpperCase()
    }
    return undefined
  })

const existingCustomer: Extractor = (w) =>
  latest(w, (t) => {
    if (/\b(?:new\s+customer|not\s+(?:yet\s+)?(?:a\s+|an\s+)?(?:existing\s+)?customer|first[-\s]time\s+customer|don'?t\s+have\s+an?\s+account)\b/i.test(t.text))
      return 'No'
    if (/\b(?:existing\s+customer|already\s+(?:a\s+|an\s+)?(?:customer|with\s+you)|been\s+a\s+customer|i\s+have\s+an?\s+account)\b/i.test(t.text))
      return 'Yes'
    if (asked(t.prev, /\b(?:existing|current)\s+customer|already\s+(?:a\s+)?customer\b/i)) {
      if (/^\s*(?:yes|yeah|yep|yup|sure|correct|i am|i do)\b/i.test(t.text)) return 'Yes'
      if (/^\s*(?:no|nope|nah|not yet|i'?m not)\b/i.test(t.text)) return 'No'
    }
    return undefined
  })

const CITY_SELF = /\b(?:i|we)(?:\s+(?:currently|now))?\s+(?:live|stay|reside|am\s+based|'m\s+based|am\s+located)\s+in\s+([A-Za-z][A-Za-z\s'-]*)/i
const CITY_FROM = /\b(?:i'?m|i\s+am)\s+(?:from|in|calling\s+from)\s+([A-Za-z][A-Za-z\s'-]*)/i
const CITY_ASKED = /\b(?:which|what)\s+city\b|\bwhere\s+(?:do\s+you|are\s+you)\s+(?:live|based|located|staying)\b|\byour\s+city\b/i

const ownCity: Extractor = (w) =>
  latest(w, (t) => {
    const m = t.text.match(CITY_SELF) ?? t.text.match(CITY_FROM)
    if (m) return place(m[1])
    if (asked(t.prev, CITY_ASKED) && !/relative|mother|father|wife|husband|brother|sister|son|daughter/i.test(t.prev))
      return place(bareReply(t.text))
    return undefined
  })

// --- relative -----------------------------------------------------------

const RELATIONS: Array<[RegExp, string]> = [
  [/\bmother-in-law\b/i, 'Mother-in-law'],
  [/\bfather-in-law\b/i, 'Father-in-law'],
  [/\b(?:mother|mom|mum)\b/i, 'Mother'],
  [/\b(?:father|dad)\b/i, 'Father'],
  [/\b(?:grandmother|grandma)\b/i, 'Grandmother'],
  [/\b(?:grandfather|grandpa)\b/i, 'Grandfather'],
  [/\bwife\b/i, 'Wife'],
  [/\bhusband\b/i, 'Husband'],
  [/\bspouse\b/i, 'Spouse'],
  [/\bbrother\b/i, 'Brother'],
  [/\bsister\b/i, 'Sister'],
  [/\bson\b/i, 'Son'],
  [/\bdaughter\b/i, 'Daughter'],
  [/\b(?:uncle)\b/i, 'Uncle'],
  [/\b(?:aunt|aunty)\b/i, 'Aunt'],
  [/\bcousin\b/i, 'Cousin'],
]

function relationIn(text: string): string | undefined {
  for (const [re, label] of RELATIONS) if (re.test(text)) return label
  return undefined
}

const relation: Extractor = (w) =>
  latest(w, (t) => {
    // Only "my/his/her <relation>" or a direct answer — a stray "son" inside
    // another sentence is not the relative being described.
    const m = t.text.match(
      /\b(?:my|his|her|our)\s+(mother-in-law|father-in-law|mother|mom|mum|father|dad|wife|husband|spouse|brother|sister|son|daughter|uncle|aunt|aunty|grandmother|grandfather|grandma|grandpa|cousin)\b/i,
    )
    if (m) return relationIn(m[1]!)
    if (asked(t.prev, /\brelation(?:ship)?\b|\b(?:related|relative)\b/i)) return relationIn(t.text)
    return undefined
  })

const REL_WORDS =
  '(?:mother-in-law|father-in-law|mother|mom|mum|father|dad|wife|husband|spouse|brother|sister|son|daughter|uncle|aunt|aunty|grandmother|grandfather|grandma|grandpa|cousin)'

const relativeName: Extractor = (w) =>
  latest(w, (t) => {
    const explicit =
      t.text.match(/\b(?:name\s+is|named|called)\s+([A-Za-z][A-Za-z\s'-]*)/i) ??
      // "my mother Sunita" — the name must be capitalised, or "my mother and I" reads as a name.
      t.text.match(new RegExp(`\\b(?:my|his|her)\\s+${REL_WORDS}\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)`))
    if (explicit) return place(explicit[1])
    if (asked(t.prev, /\bname\b/i) && !/\byour\s+name\b/i.test(t.prev)) return place(bareReply(t.text))
    return undefined
  })

const ONES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

/** "sixty two", "sixty-two", "62" -> 62. Speech-to-text emits either. */
function ageFrom(text: string): number | undefined {
  const digits = text.match(/\b(\d{1,3})\b/)
  if (digits) return Number(digits[1])
  const words = text.toLowerCase().match(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](one|two|three|four|five|six|seven|eight|nine))?\b/)
  if (words) return TENS[words[1]!]! + (words[2] ? ONES[words[2]]! : 0)
  const one = text.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/)
  return one ? ONES[one[1]!] : undefined
}

const age: Extractor = (w) =>
  latest(w, (t) => {
    const stated = t.text.match(
      /\b(?:is|are|aged?|turned|turns|she'?s|he'?s|they'?re)\s+((?:\d{1,3})|(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?))(?:\s*(?:years?|yrs?)(?:\s+old)?)?\b/i,
    ) ?? t.text.match(/\b(\d{1,3}|\w+(?:[-\s]\w+)?)\s*(?:years?|yrs?)\s+old\b/i)
    if (stated) {
      const n = ageFrom(stated[1]!)
      if (n !== undefined && n >= 0 && n <= 120) return String(n)
    }
    if (asked(t.prev, /\bhow\s+old\b|\bage\b/i)) {
      const n = ageFrom(t.text)
      if (n !== undefined && n >= 0 && n <= 120) return String(n)
    }
    return undefined
  })

const relativeCity: Extractor = (w) =>
  latest(w, (t) => {
    // Third person: "she lives in Pune", "my mother is based in Pune".
    const m = t.text.match(/\b(?:lives?|stays?|resides?|is\s+based|is\s+living|is\s+staying|is\s+located|lives\s+over)\s+in\s+([A-Za-z][A-Za-z\s'-]*)/i)
    if (m && !/\b(?:i|we)\s+(?:live|stay)\s+in\b/i.test(t.text)) return place(m[1])
    if (asked(t.prev, CITY_ASKED) || asked(t.prev, /\bwhich\s+city\b/i)) return place(bareReply(t.text))
    return undefined
  })

// --- password reset (placeholder) ---------------------------------------

const verifyChannel: Extractor = (w) =>
  latest(w, (t) => {
    if (/\b(?:e-?mail)\b/i.test(t.text)) return 'Email'
    if (/\b(?:sms|text\s+message|text\s+me|a\s+text|phone)\b/i.test(t.text)) return 'SMS'
    return undefined
  })

const resetReason: Extractor = (w) =>
  latest(w, (t) => {
    if (/\b(?:locked\s+out|account\s+is\s+locked|locked)\b/i.test(t.text)) return 'Account locked'
    if (/\bexpired\b/i.test(t.text)) return 'Password expired'
    if (/\b(?:forgot|forgotten|don'?t\s+remember|can'?t\s+remember|lost)\b/i.test(t.text)) return 'Forgot password'
    return undefined
  })

export const EXTRACTORS: Readonly<Record<string, Extractor>> = {
  cardTier,
  customerId,
  existingCustomer,
  ownCity,
  relativeName,
  relation,
  age,
  relativeCity,
  verifyChannel,
  resetReason,
}
