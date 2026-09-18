/**
 * Lex built-in slot types → documented ACXD constructs.
 *
 * ACXD publishes no built-in slot type catalogue, so referencing one is a guess. But most
 * Lex built-ins don't need one: some are enumerable and become an ordinary custom Slot
 * Type, and many more have a deterministic pattern that fits Attached Slot's documented
 * `regex` field — which the migration playbook recommends anyway, to keep the validation
 * the IVR already enforced rather than relying purely on NLU.
 *
 * That turns most of a blocking gap into a working migration, and narrows what's left from
 * "unknown type" to a precise, answerable question.
 *
 * Source: docs.aws.amazon.com/lexv2/latest/dg/built-in-slots.html (18 types, verified).
 */

export interface BuiltInMapping {
  /** Enumerable values → a real custom Slot Type, fully resolved. */
  values?: string[]
  /** Deterministic pattern → Attached Slot `regex` (documented, max 300 chars). */
  regex?: string
  /** What the slot captures, for the review item when it can't be resolved outright. */
  captures: string
}

export const LEX_BUILT_INS: Record<string, BuiltInMapping> = {
  // Enumerable — becomes an ordinary custom Slot Type. No gap at all.
  'AMAZON.Confirmation': {
    values: ['Yes', 'No', 'Maybe', "Don't know"],
    captures: 'a yes/no/maybe confirmation',
  },

  // Deterministic patterns — carried as an Attached Slot regex.
  'AMAZON.Number': { regex: '^[0-9]+$', captures: 'a number' },
  'AMAZON.AlphaNumeric': { regex: '^[a-zA-Z0-9]+$', captures: 'letters and digits' },
  'AMAZON.PhoneNumber': { regex: '^\\+?[0-9]{7,15}$', captures: 'a phone number' },
  'AMAZON.EmailAddress': { regex: '^[^@\\s]+@[^@\\s]+\\.[a-zA-Z]{2,}$', captures: 'an email address' },
  'AMAZON.Percentage': { regex: '^[0-9]{1,3}\\s?%?$', captures: 'a percentage' },
  'AMAZON.UKPostalCode': { regex: '^[A-Z]{1,2}[0-9][A-Z0-9]?\\s?[0-9][A-Z]{2}$', captures: 'a UK postcode' },

  // Normalised formats — Lex converts these; a regex would reject valid spoken input.
  'AMAZON.Date': { captures: 'a date, normalised to a standard format' },
  'AMAZON.Time': { captures: 'a time, normalised to a standard format' },
  'AMAZON.Duration': { captures: 'a duration, normalised to a standard format' },
  'AMAZON.Currency': { captures: 'a currency amount with its abbreviation' },

  // Open vocabulary — no pattern and no finite value list.
  'AMAZON.City': { captures: 'a city name' },
  'AMAZON.Country': { captures: 'a country name' },
  'AMAZON.State': { captures: 'a state name' },
  'AMAZON.StreetName': { captures: 'a street name' },
  'AMAZON.FirstName': { captures: 'a first name' },
  'AMAZON.LastName': { captures: 'a last name' },
  'AMAZON.FreeFormInput': { captures: 'any free-form text' },
}

export function lookupBuiltIn(slotType: string): BuiltInMapping | undefined {
  return LEX_BUILT_INS[slotType]
}
