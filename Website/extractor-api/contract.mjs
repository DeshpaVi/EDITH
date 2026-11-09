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
]

const STEP_KINDS = ['greeting', 'announcement', 'language_detection', 'intent_capture', 'decision', 'authentication', 'data_lookup', 'self_service', 'confirmation', 'escalation', 'closing', 'end', 'unknown']

const str = { type: 'string' }
const strs = { type: 'array', items: { type: 'string' } }
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
          text: str,
          compliance: { type: 'boolean' },
          languages: strs,
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
          question: str,
          identifiers: strs,
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
          reason: str,
          context: strs,
          queue: str,
          disposition: { type: 'string', enum: ['disconnect', 'return'] },
          raw: str,
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
    'READING A DIAGRAM',
    '- When the source lists shapes and arrows, each arrow is an edge from the first shape to the second. A decision shape has one edge per branch; the branch label comes from the nearest label text.',
    '- A loop back to an earlier step is an edge back to it.',
    '- Shape colours usually match a legend; use the legend meaning as a hint, not as proof.',
    '- Short scenario or narrative text belongs in "scenarios"; do not turn it into steps unless the diagram lacks them.',
    '- channels: "voice" for phone/IVR, "chat" for chat or messaging, "web" for web. Say in an assumption how you decided.',
  ].join('\n')
}

/** The user message text: what the source is, its content, consultant notes, and any validation feedback to fix. */
export function buildUserText({ fileName, kind, text, notes, feedback }) {
  const parts = [`Source file: ${fileName} (${kind}).`]
  if (text) parts.push('SOURCE CONTENT', text)
  else parts.push('The source is attached. Read it carefully, including any text inside images.')
  if (notes && notes.trim() !== '') parts.push('CONSULTANT NOTES (authoritative facts from the person running this migration)', notes.trim())
  if (feedback && feedback.length > 0) {
    parts.push(
      'YOUR PREVIOUS ANSWER FAILED VALIDATION. Return the corrected, complete journey.',
      ...feedback.map((f) => `- ${f.path}: ${f.message}`),
    )
  }
  return parts.join('\n\n')
}
