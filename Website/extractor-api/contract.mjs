// The extraction contract: what the model is told, and the shape it must answer in. Shared by the
// backend (which sends it to the model) and the browser (which validates the answer), so the two cannot
// drift. Plain JavaScript so the Lambda needs no build step.

export const TOOL_NAME = 'submit_journey'

/** Rules every extraction must follow (CLAUDE.md constraints 2 to 4, applied to reading a journey). */
export const EXTRACTION_RULES = [
  'Call the submit_journey tool exactly once with the complete journey. Do not answer in prose.',
  'Copy every prompt, greeting, announcement and closing VERBATIM from the source: same words, same punctuation, same typographic characters, typos included. Never paraphrase, correct, shorten or translate wording.',
  'Mark regulated wording (recording disclosures, consent, legal text) with compliance: true.',
  'Give each step a unique id and a "next" list of edges. Label a branch with the source label exactly as written (for example "Y", "N", "fallback: 3x").',
  'Put in "source" where each step came from (for example "slide 1, shape 69").',
  'If a step, branch or paragraph cannot be classified, emit an "unknown" step or add it to "unmapped". Never guess and never drop it.',
  'Anything you inferred rather than read goes into "assumptions", one statement each.',
  'Do not invent backends, queues, data stores, intents or wording. Use dataSource type "unknown" when the source does not say. Consultant notes may state facts; treat them as authoritative and record that they came from the notes.',
  'Arrows marked as not attached to a target, and branch-label matches, are heuristics from the file reader: confirm them from meaning, and add an assumption when you rely on one.',
  'A shape or box titled "Legend", and the sample shapes inside it that only explain colours (for example "Start", "Settings", "Announcements", "Lambda", "Separate Flow", "Prompts / Input"), are NOT steps. Use them only to interpret colours.',
  'Markers that only show where the call begins ("Incoming Call", "Start") are NOT steps and say nothing to the caller. The first real step (usually the greeting) is where the journey starts. Never give a spoken kind (greeting, announcement, closing, confirmation, intent_capture, authentication) to a shape that has no wording.',
  'One step per source shape. If several arrows lead to the same shape, give the arrows the same target id (several edges to one step); never create a second step for a shape you already used, so every step id is unique.',
  'Every step has a "next" list. A step that leads nowhere (the call ends, or the caller is transferred) has "next": [] (an empty list), never a missing field. Every edge "to" must be the id of another step you defined: if a path ends the call, add a step of kind "end" with its own id and point to that id; never point to a name such as "end" that is not a step id.',
  'Every "unmapped" item needs a "source" saying where it came from, for example "slide 1, shape 69"; if you cannot tell, write "source not identified".',
]

const STEP_KINDS = ['greeting', 'announcement', 'language_detection', 'intent_capture', 'decision', 'authentication', 'data_lookup', 'self_service', 'confirmation', 'escalation', 'closing', 'end', 'unknown']

const str = { type: 'string' }
const strs = { type: 'array', items: { type: 'string' } }
const described = (schema, description) => ({ ...schema, description })
const retry = {
  type: 'object',
  properties: { maxAttempts: { type: 'integer', minimum: 0 }, onExhausted: { type: 'string', enum: ['escalate', 'end', 'unknown'] }, reprompt: str },
  required: ['maxAttempts', 'onExhausted'],
}
const dataSource = { type: 'object', properties: { type: { type: 'string', enum: ['dynamodb', 'http_api', 'lambda', 'unknown'] }, description: str }, required: ['type'] }

/**
 * JSON Schema of the journey, used as the tool input schema. Steps are one flat object with kind-specific
 * fields optional; the browser's validator (validateJourney) is the strict check.
 */
export const JOURNEY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: str,
    origin: str,
    channels: { type: 'array', items: { type: 'string', enum: ['voice', 'chat', 'web'] } },
    languages: { type: 'array', items: str, minItems: 1 },
    steps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: str,
          kind: { type: 'string', enum: STEP_KINDS },
          label: str,
          source: str,
          next: { type: 'array', items: { type: 'object', properties: { to: str, label: str }, required: ['to'] } },
          text: described(str, 'The words spoken or shown to the caller, copied VERBATIM from the source. REQUIRED and non-empty for greeting, announcement, closing, confirmation, intent_capture and authentication steps; omit for other kinds.'),
          compliance: { type: 'boolean' },
          languages: described(strs, 'BCP-47 language codes such as en-US. REQUIRED and non-empty for language_detection steps; omit for other kinds.'),
          method: str,
          intents: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: str, description: str, requiresAuth: { type: 'boolean' }, handledBy: { type: 'string', enum: ['self_service', 'agent'] } },
              required: ['name', 'requiresAuth', 'handledBy'],
            },
          },
          retry,
          question: described(str, 'The question a decision step asks (it is not spoken to the caller). REQUIRED and non-empty for decision steps; omit for other kinds.'),
          identifiers: described(strs, 'What the caller must provide to be verified, one entry each. REQUIRED and non-empty for authentication steps.'),
          match: { type: 'string', enum: ['any', 'all'] },
          failurePrompt: str,
          verifiesAgainst: dataSource,
          name: str,
          purpose: str,
          inputs: strs,
          outputs: strs,
          dataSource,
          mode: { type: 'string', enum: ['faq', 'transaction', 'form', 'other'] },
          separateFlow: { type: 'boolean' },
          content: { type: 'string', enum: ['knowledge_base', 'api', 'unknown'] },
          reason: described(str, 'Why the caller is transferred to an agent. REQUIRED for escalation steps.'),
          context: strs,
          queue: str,
          disposition: { type: 'string', enum: ['disconnect', 'return'] },
          raw: described(str, 'The source text that could not be classified. REQUIRED for unknown steps.'),
        },
        required: ['id', 'kind', 'label', 'source', 'next'],
      },
    },
    scenarios: { type: 'array', items: { type: 'object', properties: { name: str, description: str }, required: ['name', 'description'] } },
    assumptions: { type: 'array', items: { type: 'object', properties: { statement: str, source: str }, required: ['statement'] } },
    unmapped: { type: 'array', items: { type: 'object', properties: { description: str, source: str }, required: ['description', 'source'] } },
  },
  required: ['title', 'channels', 'languages', 'steps', 'scenarios', 'assumptions', 'unmapped'],
}

const KIND_GUIDE = [
  'greeting: the first words spoken (text, verbatim).',
  'announcement: any other fixed prompt that needs no answer (text, verbatim).',
  'language_detection: a step that detects or sets the caller language (languages as BCP-47 codes such as en-US; convert en_US to en-US and add an assumption).',
  'intent_capture: asks the caller what they need and recognises the intent. intents lists each intent with requiresAuth and handledBy; retry holds the miss limit ("fallback 3x" = maxAttempts 3, onExhausted escalate) and the wording played between misses.',
  'decision: a yes/no or multi-way branch that asks no question of the caller (question).',
  'authentication: verifies the caller (text = the prompt; identifiers; match any|all; failurePrompt; retry; verifiesAgainst).',
  'data_lookup: a backend call that is not authentication.',
  'self_service: an automated flow that serves the caller (faq, form, transaction, other; separateFlow true when the source draws it as its own flow; content says where answers come from).',
  'confirmation: asks whether the caller needs anything else or confirms something (text, verbatim).',
  'escalation: transfer to a live agent (reason; context = what the agent should receive).',
  'closing: the final words (text, verbatim). end: disconnect or return.',
  'unknown: anything you cannot classify (raw = the source text).',
]

/** The fields each kind must carry (mirrors the browser's validator). Weaker models skip optional-looking fields unless told. */
export const FIELDS_BY_KIND = [
  'greeting, announcement, closing, confirmation: text (non-empty, verbatim).',
  'language_detection: languages (non-empty list of BCP-47 codes).',
  'intent_capture: text (the prompt, verbatim), intents (each with name, requiresAuth, handledBy), retry (maxAttempts, onExhausted).',
  'decision: question (non-empty).',
  'authentication: text (the prompt, verbatim), identifiers (non-empty), match (any or all), retry, verifiesAgainst (type, even if "unknown").',
  'data_lookup: name, purpose, inputs, outputs, dataSource (type).',
  'self_service: name, mode, separateFlow, content.',
  'escalation: reason, context (a list, possibly empty).',
  'end: disposition (disconnect or return).',
  'unknown: raw.',
  'Every step: id, kind, label, source, next. Leave out fields that belong to other kinds.',
]

/** One line of help per field the validator names, so a repair attempt knows what to put there. */
const FIELD_HINTS = {
  next: 'every step has a "next" list; use [] for a step that leads nowhere (an end or a transfer), never leave it out.',
  to: 'an edge target must be the id of a step you defined; if the path ends the call, add a step of kind "end" with its own id and point to that id.',
  source: 'say where it came from in the source, for example "slide 1, shape 69", or write "source not identified".',
  id: 'every step needs its own id: one step per shape; when several arrows reach the same shape, point them at the same step instead of creating a second one.',
  text: 'put the exact words spoken to the caller, copied from the source (greeting, announcement, closing, confirmation, intent_capture, authentication steps).',
  question: 'put the question the decision asks, from the source (decision steps).',
  languages: 'put the language codes the step detects or sets, such as ["en-US", "es-US"] (language_detection steps).',
  identifiers: 'list what the caller must give to be verified (authentication steps).',
  reason: 'say why the caller is transferred (escalation steps).',
  disposition: 'use "disconnect" or "return" (end steps).',
  raw: 'copy the source text you could not classify (unknown steps).',
}

export function buildSystemPrompt() {
  return [
    'You turn a customer journey (an IVR or virtual-agent call flow, drawn or written) into a structured journey for an implementation tool.',
    'The journey describes the customer experience, not an implementation. Do not design or add anything the source does not contain.',
    '',
    'RULES',
    ...EXTRACTION_RULES.map((r, i) => `${i + 1}. ${r}`),
    '',
    'STEP KINDS',
    ...KIND_GUIDE.map((k) => `- ${k}`),
    '',
    'FIELDS EACH KIND MUST HAVE (a missing or empty field makes the answer invalid)',
    ...FIELDS_BY_KIND.map((k) => `- ${k}`),
    '',
    'READING A DIAGRAM',
    '- When the source lists shapes and arrows, each arrow is an edge from the first shape to the second. A decision shape has one edge per branch; the branch label comes from the nearest label text.',
    '- A loop back to an earlier step is an edge back to it.',
    '- Shape colours usually match a legend; use the legend meaning as a hint, not as proof.',
    '- Short scenario or narrative text belongs in "scenarios"; do not turn it into steps unless the diagram lacks them.',
    '- channels: "voice" for phone/IVR, "chat" for chat or messaging, "web" for web. Say in an assumption how you decided.',
  ].join('\n')
}

/** The user message text: what the source is, its content, consultant notes, and any validation feedback to fix. */
export function buildUserText({ fileName, kind, text, notes, feedback, previous }) {
  const parts = [`Source file: ${fileName} (${kind}).`]
  if (text) parts.push('SOURCE CONTENT', text)
  else parts.push('The source is attached. Read it carefully, including any text inside images.')
  if (notes && notes.trim() !== '') parts.push('CONSULTANT NOTES (authoritative facts from the person running this migration)', notes.trim())
  if (feedback && feedback.length > 0) {
    parts.push(
      previous
        ? 'YOUR PREVIOUS ANSWER FAILED VALIDATION. Below are the problems and then your previous answer. Return the COMPLETE corrected journey: change only what the problems require and keep everything else exactly as it was.'
        : 'YOUR PREVIOUS ANSWER FAILED VALIDATION. Return the corrected, complete journey.',
      ...feedback.map((f) => {
        const field = /\.([A-Za-z]+)(?:\[\d+\])?$/.exec(f.path)?.[1]
        const hint = field && FIELD_HINTS[field] ? ` Fix: ${FIELD_HINTS[field]}` : ''
        return `- ${f.path}: ${f.message}.${hint}`
      }),
    )
    if (previous) parts.push('YOUR PREVIOUS ANSWER', JSON.stringify(previous))
  }
  return parts.join('\n\n')
}
