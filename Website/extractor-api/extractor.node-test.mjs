import test from 'node:test'
import assert from 'node:assert/strict'
import { ExtractError, LIMITS, buildConverseInput, documentName, journeyFromResponse, jsonFromText, parseRequest } from './converse.mjs'
import { TOOL_NAME, buildSystemPrompt, buildUserText, EXTRACTION_RULES, JOURNEY_JSON_SCHEMA, FIELDS_BY_KIND } from './contract.mjs'
import { makeHandler } from './index.mjs'

const textBody = (extra = {}) => ({ fileName: 'journey.pptx', kind: 'deck', text: 'SLIDE 1 ... Main Greeting: Hello', ...extra })
const throwsStatus = (fn, status) => assert.throws(fn, (e) => e instanceof ExtractError && e.status === status)

// ---- request validation ------------------------------------------------------------------------------

test('accepts a text request and keeps the notes and feedback', () => {
  const r = parseRequest(textBody({ notes: 'any one id is enough', feedback: [{ path: '$.title', message: 'must be a string' }] }))
  assert.equal(r.kind, 'deck')
  assert.equal(r.notes, 'any one id is enough')
  assert.deepEqual(r.feedback, [{ path: '$.title', message: 'must be a string' }])
})

test('a Visio diagram is a text kind like a deck', () => {
  assert.equal(parseRequest(textBody({ kind: 'diagram', fileName: 'flow.vsdx' })).kind, 'diagram')
  throwsStatus(() => parseRequest({ fileName: 'flow.vsdx', kind: 'diagram' }), 400)
  assert.match(buildConverseInput({ modelId: 'm', request: parseRequest(textBody({ kind: 'diagram', fileName: 'flow.vsdx' })) }).messages[0].content[0].text, /flow\.vsdx \(diagram\)/)
})

test('rejects bodies that are not objects, unknown kinds and missing text', () => {
  throwsStatus(() => parseRequest(null), 400)
  throwsStatus(() => parseRequest(textBody({ kind: 'video' })), 400)
  throwsStatus(() => parseRequest(textBody({ text: '  ' })), 400)
  throwsStatus(() => parseRequest(textBody({ fileName: '' })), 400)
})

test('enforces size limits with 413', () => {
  throwsStatus(() => parseRequest(textBody({ text: 'x'.repeat(LIMITS.maxTextChars + 1) })), 413)
  throwsStatus(() => parseRequest({ fileName: 'a.png', kind: 'image', attachment: { mimeType: 'image/png', base64: 'A'.repeat(LIMITS.maxBase64Chars + 1) } }), 413)
})

test('checks attachment mime types', () => {
  assert.ok(parseRequest({ fileName: 'a.png', kind: 'image', attachment: { mimeType: 'image/png', base64: 'AAAA' } }))
  assert.ok(parseRequest({ fileName: 'a.pdf', kind: 'pdf', attachment: { mimeType: 'application/pdf', base64: 'AAAA' } }))
  throwsStatus(() => parseRequest({ fileName: 'a.png', kind: 'image', attachment: { mimeType: 'application/pdf', base64: 'AAAA' } }), 400)
  throwsStatus(() => parseRequest({ fileName: 'a.pdf', kind: 'pdf', attachment: { mimeType: 'image/png', base64: 'AAAA' } }), 400)
  throwsStatus(() => parseRequest({ fileName: 'a.pdf', kind: 'pdf' }), 400)
})

test('rejects malformed feedback and over-long notes', () => {
  throwsStatus(() => parseRequest(textBody({ feedback: [{ path: 1 }] })), 400)
  throwsStatus(() => parseRequest(textBody({ notes: 'x'.repeat(LIMITS.maxNotesChars + 1) })), 400)
})

test('document names keep to the characters Bedrock allows', () => {
  assert.equal(documentName('Census CQA_Demo Call Flow!.pdf'), 'Census CQA-Demo Call Flow')
  assert.equal(documentName('....pdf'), 'journey')
})

// ---- the Bedrock request ------------------------------------------------------------------------------

test('a text request has one text block carrying the source and the notes', () => {
  const input = buildConverseInput({ modelId: 'm', request: parseRequest(textBody({ notes: 'NOTE-X' })) })
  assert.equal(input.messages[0].content.length, 1)
  assert.match(input.messages[0].content[0].text, /Main Greeting: Hello/)
  assert.match(input.messages[0].content[0].text, /NOTE-X/)
})

test('an image or pdf is sent as bytes, before the text', () => {
  const img = buildConverseInput({ modelId: 'm', request: parseRequest({ fileName: 'a.png', kind: 'image', attachment: { mimeType: 'image/png', base64: Buffer.from('PNGDATA').toString('base64') } }) })
  assert.equal(img.messages[0].content[0].image.format, 'png')
  assert.equal(Buffer.from(img.messages[0].content[0].image.source.bytes).toString(), 'PNGDATA')
  const pdf = buildConverseInput({ modelId: 'm', request: parseRequest({ fileName: 'My Flow.pdf', kind: 'pdf', attachment: { mimeType: 'application/pdf', base64: 'AAAA' } }) })
  assert.equal(pdf.messages[0].content[0].document.format, 'pdf')
  assert.equal(pdf.messages[0].content[0].document.name, 'My Flow')
  assert.ok(pdf.messages[0].content[1].text)
})

test('the model is forced to answer through the schema tool, deterministically', () => {
  const input = buildConverseInput({ modelId: 'the-model', request: parseRequest(textBody()) })
  assert.equal(input.modelId, 'the-model')
  assert.deepEqual(input.toolConfig.toolChoice, { tool: { name: TOOL_NAME } })
  assert.equal(input.toolConfig.tools[0].toolSpec.inputSchema.json, JOURNEY_JSON_SCHEMA)
  assert.equal(input.inferenceConfig.temperature, 0)
})

test('the system prompt carries every extraction rule, verbatim wording first among them', () => {
  const prompt = buildSystemPrompt()
  for (const rule of EXTRACTION_RULES) assert.ok(prompt.includes(rule))
  assert.match(EXTRACTION_RULES[1], /VERBATIM/)
})

test('validation feedback is appended for a repair attempt', () => {
  const text = buildUserText({ fileName: 'a', kind: 'text', text: 'body', feedback: [{ path: '$.steps[0].kind', message: 'must be one of' }] })
  assert.match(text, /FAILED VALIDATION/)
  assert.match(text, /\$\.steps\[0\]\.kind: must be one of/)
})

// ---- reading the answer ---------------------------------------------------------------------------------

test('reads the journey from the tool call', () => {
  const journey = { title: 'x' }
  assert.equal(journeyFromResponse({ output: { message: { content: [{ text: 'thinking' }, { toolUse: { name: TOOL_NAME, input: journey } }] } } }), journey)
})

test('reports a truncated or missing answer clearly', () => {
  assert.throws(() => journeyFromResponse({ stopReason: 'max_tokens' }), /too large/)
  assert.throws(() => journeyFromResponse({ output: { message: { content: [{ text: 'no tool' }] } } }), /did not return a journey/)
})

// ---- the handler -----------------------------------------------------------------------------------------

const env = { ACCESS_TOKEN: 'secret-token', MODEL_ID: 'model-1' }
const okResponse = (journey) => ({ output: { message: { content: [{ toolUse: { name: TOOL_NAME, input: journey } }] } }, usage: { inputTokens: 10, outputTokens: 5 } })
const event = (body, headers = { authorization: 'Bearer secret-token' }, extra = {}) => ({ requestContext: { http: { method: 'POST' } }, headers, body: JSON.stringify(body), ...extra })
const handlerWith = (converse, e = env) => makeHandler({ env: e, converse })

test('refuses to run without an access token configured', async () => {
  const res = await handlerWith(async () => okResponse({}), { MODEL_ID: 'm' })(event(textBody()))
  assert.equal(res.statusCode, 500)
})

test('rejects a missing or wrong token without calling the model', async () => {
  let calls = 0
  const h = handlerWith(async () => (calls++, okResponse({})))
  assert.equal((await h(event(textBody(), {}))).statusCode, 401)
  assert.equal((await h(event(textBody(), { authorization: 'Bearer nope' }))).statusCode, 401)
  assert.equal(calls, 0)
})

test('only POST is accepted', async () => {
  const res = await handlerWith(async () => okResponse({}))({ requestContext: { http: { method: 'GET' } }, headers: {} })
  assert.equal(res.statusCode, 405)
})

test('bad JSON and invalid requests are 400', async () => {
  const h = handlerWith(async () => okResponse({}))
  assert.equal((await h({ ...event(textBody()), body: '{oops' })).statusCode, 400)
  assert.equal((await h(event({ fileName: 'a', kind: 'nope' }))).statusCode, 400)
})

test('returns the journey and usage on success', async () => {
  const res = await handlerWith(async (input) => (assert.equal(input.modelId, 'model-1'), okResponse({ title: 'T' })))(event(textBody()))
  assert.equal(res.statusCode, 200)
  const { version, ...rest } = JSON.parse(res.body)
  assert.deepEqual(rest, { journey: { title: 'T' }, usage: { inputTokens: 10, outputTokens: 5 } })
  assert.match(version, /^extractor-v\d+$/)
})

test('accepts a base64-encoded body (as Function URLs may send)', async () => {
  const e = event(textBody())
  e.body = Buffer.from(e.body).toString('base64')
  e.isBase64Encoded = true
  assert.equal((await handlerWith(async () => okResponse({ title: 'T' }))(e)).statusCode, 200)
})

test('maps model errors to clear statuses; only an access error shows AWS\'s explanation (an operator needs it), anything else stays generic', async () => {
  const fail = (name) => handlerWith(async () => { throw Object.assign(new Error('internal arn:aws:...'), { name }) })(event(textBody()))
  assert.equal((await fail('ThrottlingException')).statusCode, 429)
  const denied = await fail('AccessDeniedException')
  assert.equal(denied.statusCode, 502)
  assert.ok(denied.body.includes('The model could not be used'))
  const other = await fail('SomethingElse')
  assert.equal(other.statusCode, 502)
  assert.ok(!other.body.includes('arn:aws'))
})

test('never logs the source content, the notes or the token', async () => {
  const lines = []
  const original = console.log
  console.log = (...a) => lines.push(a.join(' '))
  try {
    await handlerWith(async () => okResponse({ title: 'T' }))(event(textBody({ text: 'CONFIDENTIAL-SOURCE-TEXT', notes: 'CONFIDENTIAL-NOTES' })))
    await handlerWith(async () => { throw new Error('boom') })(event(textBody({ text: 'CONFIDENTIAL-SOURCE-TEXT' })))
  } finally {
    console.log = original
  }
  const all = lines.join('\n')
  assert.ok(lines.length > 0)
  for (const secret of ['CONFIDENTIAL-SOURCE-TEXT', 'CONFIDENTIAL-NOTES', 'secret-token']) assert.ok(!all.includes(secret), secret)
})

test('toolChoice auto drops the forced tool call and asks for the tool in the prompt', () => {
  const forced = buildConverseInput({ modelId: 'm', request: parseRequest(textBody()) })
  const auto = buildConverseInput({ modelId: 'm', request: parseRequest(textBody()), toolChoice: 'auto' })
  assert.ok(forced.toolConfig.toolChoice)
  assert.equal(auto.toolConfig.toolChoice, undefined)
  assert.ok(auto.toolConfig.tools.length === 1)
  assert.match(auto.system[0].text, new RegExp(`Call the tool ${TOOL_NAME} exactly once`))
})

test('a journey in the model\'s text is accepted, with or without a code fence, and reasoning blocks are ignored', () => {
  const journey = { title: 'T' }
  assert.deepEqual(jsonFromText('```json\n{"title":"T"}\n```'), journey)
  assert.deepEqual(jsonFromText('Here it is: {"title":"T"} done'), journey)
  assert.equal(jsonFromText('no json here'), null)
  assert.equal(jsonFromText('{broken'), null)
  const response = { output: { message: { content: [{ reasoningContent: { reasoningText: { text: 'thinking' } } }, { text: '{"title":"T"}' }] } } }
  assert.deepEqual(journeyFromResponse(response), journey)
})

test('the handler retries once without a forced tool call when the model refuses one, and explains an image sent to a text-only model', async () => {
  const { makeHandler } = await import('./index.mjs')
  const seen = []
  const env = { ACCESS_TOKEN: 'tok', MODEL_ID: 'm' }
  const journey = { title: 'T' }
  const converse = async (input) => {
    seen.push(Boolean(input.toolConfig.toolChoice))
    if (input.toolConfig.toolChoice) throw Object.assign(new Error('This model does not support toolChoice of type tool'), { name: 'ValidationException' })
    return { output: { message: { content: [{ toolUse: { name: TOOL_NAME, input: journey } }] } } }
  }
  const call = (body, deps) => makeHandler(deps)({ requestContext: { http: { method: 'POST' } }, headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) })
  const ok = await call(textBody(), { env, converse })
  assert.equal(ok.statusCode, 200)
  assert.deepEqual(seen, [true, false])
  const textOnly = async () => { throw Object.assign(new Error('The model does not support the image content block'), { name: 'ValidationException' }) }
  const img = await call({ fileName: 'a.png', kind: 'image', attachment: { mimeType: 'image/png', base64: 'AAAA' } }, { env, converse: textOnly })
  assert.equal(img.statusCode, 502)
  assert.match(JSON.parse(img.body).error, /cannot read images or PDFs/)
})

test('toolChoice none sends no tool and puts the schema in the prompt', () => {
  const none = buildConverseInput({ modelId: 'm', request: parseRequest(textBody()), toolChoice: 'none' })
  assert.equal(none.toolConfig, undefined)
  assert.match(none.system[0].text, /exactly one JSON object/)
  assert.ok(none.system[0].text.includes('"type"'))
})

test('the handler steps down tool, auto, none as the model refuses each, and stops there', async () => {
  const { makeHandler } = await import('./index.mjs')
  const modes = []
  const env = { ACCESS_TOKEN: 'tok', MODEL_ID: 'm' }
  const call = (deps) => makeHandler(deps)({ requestContext: { http: { method: 'POST' } }, headers: { authorization: 'Bearer tok' }, body: JSON.stringify(textBody()) })
  const converse = async (input) => {
    modes.push(!input.toolConfig ? 'none' : input.toolConfig.toolChoice ? 'tool' : 'auto')
    if (input.toolConfig) throw Object.assign(new Error('This model does not support tool use'), { name: 'ValidationException' })
    return { output: { message: { content: [{ text: '{"title":"T"}' }] } } }
  }
  const ok = await call({ env, converse })
  assert.equal(ok.statusCode, 200)
  assert.deepEqual(modes, ['tool', 'auto', 'none'])
  // A validation error unrelated to tools is not retried.
  modes.length = 0
  const bad = await call({ env, converse: async () => { modes.push('x'); throw Object.assign(new Error('Malformed input request'), { name: 'ValidationException' }) } })
  assert.equal(bad.statusCode, 502)
  assert.equal(modes.length, 1)
})

test('a model that rejects the temperature field gets the request again without it', async () => {
  const { makeHandler } = await import('./index.mjs')
  const seen = []
  const env = { ACCESS_TOKEN: 'tok', MODEL_ID: 'm' }
  const converse = async (input) => {
    seen.push('temperature' in input.inferenceConfig)
    if ('temperature' in input.inferenceConfig) throw Object.assign(new Error("This model doesn't support the temperature field. Remove temperature and try again."), { name: 'ValidationException' })
    return { output: { message: { content: [{ toolUse: { name: TOOL_NAME, input: { title: 'T' } } }] } } }
  }
  const res = await makeHandler({ env, converse })({ requestContext: { http: { method: 'POST' } }, headers: { authorization: 'Bearer tok' }, body: JSON.stringify(textBody()) })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(seen, [true, false])
  assert.equal('temperature' in buildConverseInput({ modelId: 'm', request: parseRequest(textBody()), temperature: null }).inferenceConfig, false)
  assert.equal(buildConverseInput({ modelId: 'm', request: parseRequest(textBody()) }).inferenceConfig.temperature, 0)
})

test('an access error shows AWS\'s own explanation so the cause can be told apart', async () => {
  const { makeHandler } = await import('./index.mjs')
  const converse = async () => { throw Object.assign(new Error('User: arn:aws:sts::1:assumed-role/x/y is not authorized to perform: bedrock:InvokeModel on resource: arn:aws:bedrock:us-east-1:1:inference-profile/us.m'), { name: 'AccessDeniedException' }) }
  const res = await makeHandler({ env: { ACCESS_TOKEN: 'tok', MODEL_ID: 'm' }, converse })({ requestContext: { http: { method: 'POST' } }, headers: { authorization: 'Bearer tok' }, body: JSON.stringify(textBody()) })
  assert.equal(res.statusCode, 502)
  assert.match(JSON.parse(res.body).error, /not authorized to perform: bedrock:InvokeModel on resource/)
})

test('a model with a smaller output limit gets the request again with the limit its error names, or 5000 if none is named', async () => {
  const { makeHandler } = await import('./index.mjs')
  const run = async (message) => {
    const seen = []
    const converse = async (input) => {
      seen.push(input.inferenceConfig.maxTokens)
      if (input.inferenceConfig.maxTokens > 10000) throw Object.assign(new Error(message), { name: 'ValidationException' })
      return { output: { message: { content: [{ toolUse: { name: TOOL_NAME, input: { title: 'T' } } }] } } }
    }
    const res = await makeHandler({ env: { ACCESS_TOKEN: 'tok', MODEL_ID: 'm' }, converse })({ requestContext: { http: { method: 'POST' } }, headers: { authorization: 'Bearer tok' }, body: JSON.stringify(textBody()) })
    return { status: res.statusCode, seen }
  }
  assert.deepEqual(await run('The maximum tokens you requested exceeds the model limit of 10000.'), { status: 200, seen: [16000, 10000] })
  assert.deepEqual(await run('Invalid value for maxTokens'), { status: 200, seen: [16000, 5000] })
})

test('the prompt and schema spell out the fields each kind needs, and repair feedback says what to put in each missing field', () => {
  const prompt = buildSystemPrompt()
  assert.match(prompt, /FIELDS EACH KIND MUST HAVE/)
  for (const line of FIELDS_BY_KIND) assert.ok(prompt.includes(line))
  const props = JOURNEY_JSON_SCHEMA.properties.steps.items.properties
  for (const field of ['text', 'question', 'languages', 'identifiers']) assert.match(props[field].description, /REQUIRED/)
  const text = buildUserText({ fileName: 'a.pptx', kind: 'deck', text: 'x', feedback: [{ path: '$.steps[0].text', message: 'must be a non-empty string' }, { path: '$.steps[3].question', message: 'must be a non-empty string' }, { path: '$.steps[5].languages', message: 'must be an array of non-empty strings' }] })
  assert.match(text, /\$\.steps\[0\]\.text: must be a non-empty string\. Fix: put the exact words spoken/)
  assert.match(text, /question: must be a non-empty string\. Fix: put the question/)
  assert.match(text, /languages: must be an array of non-empty strings\. Fix: put the language codes/)
})

test('DEBUG_SHAPE logs which step fields are present or empty, never their values', async () => {
  const { makeHandler } = await import('./index.mjs')
  const lines = []
  const original = console.log
  console.log = (...a) => lines.push(a.join(' '))
  try {
    const converse = async () => ({ output: { message: { content: [{ toolUse: { name: TOOL_NAME, input: { title: 'T', steps: [{ id: 'a', kind: 'greeting', text: '', label: 'SECRET-LABEL' }] } } }] } } })
    await makeHandler({ env: { ACCESS_TOKEN: 'tok', MODEL_ID: 'm', DEBUG_SHAPE: '1' }, converse })({ requestContext: { http: { method: 'POST' } }, headers: { authorization: 'Bearer tok' }, body: JSON.stringify(textBody()) })
  } finally {
    console.log = original
  }
  const all = lines.join('\n')
  assert.match(all, /"kind":"greeting".*"empty":\["text"\]/)
  assert.ok(!all.includes('SECRET-LABEL'))
})

test('the rules keep legend items and start markers out of the steps and keep ids unique', () => {
  const prompt = buildSystemPrompt()
  assert.match(prompt, /"Legend".*NOT steps/)
  assert.match(prompt, /"Incoming Call".*NOT steps/)
  assert.match(prompt, /every step id is unique/)
  const text = buildUserText({ fileName: 'a.pptx', kind: 'deck', text: 'x', feedback: [{ path: '$.unmapped[0].source', message: 'must be a non-empty string' }, { path: '$.steps[17].id', message: 'duplicate step id "172"' }] })
  assert.match(text, /unmapped\[0\]\.source: must be a non-empty string\. Fix: say where it came from/)
  assert.match(text, /duplicate step id "172"\. Fix: every step needs its own id/)
})

test('a repair request carries the previous answer so the model edits it, and the rules cover missing next and edges to unknown ids', () => {
  const previous = { title: 'T', steps: [{ id: 'a', kind: 'end' }] }
  const request = parseRequest(textBody({ feedback: [{ path: '$.steps[0].next', message: 'must be an array of edges' }], previous }))
  assert.deepEqual(request.previous, previous)
  const text = buildUserText({ fileName: 'a.pptx', kind: 'deck', text: 'x', feedback: request.feedback, previous })
  assert.match(text, /change only what the problems require/)
  assert.ok(text.includes('YOUR PREVIOUS ANSWER\n\n' + JSON.stringify(previous)))
  assert.match(text, /use \[\] for a step that leads nowhere/)
  assert.throws(() => parseRequest(textBody({ previous: 'not an object' })), /previous must be/)
  assert.ok(!buildUserText({ fileName: 'a', kind: 'text', text: 'x' }).includes('PREVIOUS ANSWER'))
  const prompt = buildSystemPrompt()
  assert.match(prompt, /"next": \[\] \(an empty list\)/)
  assert.match(prompt, /never point to a name such as "end"/)
})

test('the schema and hints say what name and context need for the step kinds that use them', () => {
  const props = JOURNEY_JSON_SCHEMA.properties.steps.items.properties
  assert.match(props.name.description, /REQUIRED and non-empty for self_service and data_lookup/)
  assert.match(props.context.description, /Never use empty strings/)
  const text = buildUserText({ fileName: 'a.pptx', kind: 'deck', text: 'x', feedback: [{ path: '$.steps[8].context', message: 'must be an array of non-empty strings' }, { path: '$.steps[10].name', message: 'must be a non-empty string' }] })
  assert.match(text, /context: must be an array of non-empty strings\. Fix: list what the agent should receive/)
  assert.match(text, /name: must be a non-empty string\. Fix: give a short name taken from the source label/)
})

test('the rules cover diagram titles in prompts and shapes that must not be dropped', () => {
  const prompt = buildSystemPrompt()
  assert.match(prompt, /"Title: wording"/)
  assert.match(prompt, /ONLY the wording after the colon/)
  assert.match(prompt, /never leave a shape out/)
  assert.match(buildUserText({ fileName: 'a', kind: 'deck', text: 'x', feedback: [{ path: '$.steps', message: 'the shape "X" is not covered' }] }), /every non-legend shape with text must become a step/)
})

test('every successful answer carries the extractor version, so a stale deployment is visible', async () => {
  const { makeHandler, VERSION } = await import('./index.mjs')
  const converse = async () => ({ output: { message: { content: [{ toolUse: { name: TOOL_NAME, input: { title: 'T' } } }] } } })
  const res = await makeHandler({ env: { ACCESS_TOKEN: 'tok', MODEL_ID: 'm' }, converse })({ requestContext: { http: { method: 'POST' } }, headers: { authorization: 'Bearer tok' }, body: JSON.stringify(textBody()) })
  assert.equal(JSON.parse(res.body).version, VERSION)
  assert.match(VERSION, /^extractor-v\d+$/)
})
