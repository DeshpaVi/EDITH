# Worked Example: Census CQA Demo (diagram to working ACXD + Connect build)

A real migration done end to end in a real workspace, kept as the **reference for how to work** and as
the **pattern library the app's design and emit layers should reproduce**. Console-level facts it relies on
are in `verified-console-and-export-findings.md`; read that first for exact node behaviour.

## Contents
- [The input](#the-input)
- [Method that worked](#method-that-worked)
- [Requirements as understood](#requirements-as-understood)
- [Build order and config](#build-order-and-config)
- [Misconfigurations and doubts, and how each was resolved](#misconfigurations-and-doubts)
- [Pattern library](#pattern-library)
- [Test matrix and results](#test-matrix-and-results)
- [Open items](#open-items)

## The input

A client call-flow **diagram** (PowerPoint): Incoming call → Main greeting → "How can I help you?" →
Detect Spanish speaker (Set en_US / es_US) → Utterance recognized? (N: "I'm sorry, I didn't quite get
that." ×3 then Route to Agent) → Authentication required for intent? (Y: authentication prompt, N: FAQ
self-service) → Authenticated? (N: Auth Failure prompt ×3 then Route to Agent; Y: enumeration
self-service) → "Anything else?" (Y: loop; N: closing then Disconnect), plus a "Proposed scenarios" slide
(happy path, FAQ-only, partial completion then agent with context, Spanish with failed authentication, French).
Diagram colours: green settings, orange Lambda/decisions, purple announcements, blue separate flows.

Later inputs: exports from the client's workspace: the Connect contact flow with the Agentic CX block, the
`SafetyEscalation` flow, three guardrails (all in `verified-exports/`).

## Method that worked

1. **Read the whole diagram (render the slides to images) and restate the requirement** before proposing anything.
   Text extraction alone loses the arrows.
2. **Separate what is documented from what is not.** State plainly what could not be produced (undocumented
   node metadata, the Agentic CX block JSON) and ask for the unblocker (real exports) instead of guessing.
3. **Ask the few questions that change the design**, with answers recorded: language detection location,
   wording of a prompt, retry counts, backend stubbing, delivery mode (console vs SDK vs both).
4. **Map each diagram element to a construct** (table below), then build **resources in dependency order**,
   **flows next**, **application settings**, **build**, **test**.
5. **One step at a time, with a screenshot loop.** The user sent a screenshot after each step; each step
   either confirmed the config or exposed a misconfig. Do not issue the next block of steps until the
   previous one is confirmed.
6. **Use the Debugger, not guesses,** when a test fails: it showed exactly which node ran, what the Data
   request sent and received, and which condition evaluated.
7. **Correct course openly** when console reality contradicts the reference docs (several times below),
   record the correction, and fold it back into the skill.
8. **Preserve client wording byte for byte** (greeting, authentication prompts). Where the slide had a typo
   ("provide please provide"), the owner chose the corrected text explicitly; never fix it unilaterally.

## Requirements as understood

- Phone IVR for a Census Questionnaire Assistance line, English and Spanish (French deferred).
- Two intent classes: **FAQ** (no authentication, answered from a knowledge base) and **enumeration**
  (complete the questionnaire; requires authentication).
- Authentication = the caller supplies **any one** of Census ID, home zip code, or last four of SSN; a failed
  value can be retried with another; **maximum three attempts**, then a live agent.
- Three failed intent recognitions, or any system failure, go to a live agent with **context**
  (summary, intent, where the caller got stuck).
- Safety statements (self-harm, threats) get a 911/988 message and an agent.
- The customer's real data lives in a table (DynamoDB); demo values: Census ID `12345`, zip `411018`.
- The caller language is detected inside ACXD (not in Connect). **Not implemented yet.**

## Build order and config

| # | Where | What |
|---|---|---|
| 1 | DynamoDB | Table `CensusIds` (key `censusId`), global secondary indexes on `zipCode` and `ssnLastFour` (keys only), one demo item |
| 2 | Lambda | `verify-census-auth` (Node.js 22), env `TABLE_NAME`, `API_KEY`; role allows `GetItem` on the table and `Query` on its indexes; Function URL, auth type NONE (protected by the `x-api-key` header); takes `{authValue}`, checks it against all three fields, returns `{verified}` |
| 3 | ACXD Resources | Secret `demo_api_key` (sensitive); Data request `verifyCensusAuth` (External, POST, header from the secret, request `authValue` sensitive, response `verified` boolean); context variables `isAuthenticated` (boolean, no frontend updates), `customerIntent`, `stuckPoint`, `transferSummary`; slot type `YesNo` |
| 4 | ACXD Flows | `Escalation`, `Authentication`, edits to `CQAInboundDemo` and `SafetyEscalation` (patterns below) |
| 5 | ACXD Application | Attach flows; defaults: Welcome and Unknown → `CQAInboundDemo`, Fallback and Incomprehension → `Escalation`; guardrails Safety, Toxicity, Prompt injection attached |
| 6 | ACXD Deploy | Build and deploy; test in Test tab with the Debugger |
| 7 | Connect | Import the contact flow, add Set voice, publish, attach a number (status: reported done by the user; no screenshot evidence) |

## Misconfigurations and doubts

| Symptom | Root cause | Fix |
|---|---|---|
| Could not generate importable flow JSON at first | node `metadata` / `conditions` undocumented | asked for and received real exports; only start/basic/escalate shapes are known; the rest is console-only |
| Planned `user_input` + three slots for authentication | **User input** is a routing node | switched to Generative Journey + Data capture |
| User choice warned "all choice and associated slots must have different types" | three freeform slots on one node | one slot `authValue`; the Lambda checks it against all three fields |
| User choice with empty Options fired No match instantly; with Options = freeform slot it never matched | User choice is for list selection | replaced by Generative Journey data capture |
| Retries ran back-to-back, never re-asking | the captured slot persisted | **Clear** the slot on the failure path |
| Four attempts instead of three | Loop `To` is inclusive | `From 0 To 2` |
| Valid ID still failed; Data request returned `verified: true` | Split compared a boolean to the **text** `true` | boolean constant in the Split |
| Split / User choice / Redirect warnings (⚠) | missing message; empty Redirect target; unconnected Split exit | message added; Redirect set to a flow; true exit wired |
| State modification "cleared" the summary | dropdown defaults to **Clear** | switch to **Set** |
| Enumeration request answered by the FAQ Journey ("I can't take your actual Census responses…") | a Journey holds the whole conversation, routing never gets a turn | added an exit condition `completeCensus` to the Journey, wired to a Redirect to `Authentication` |
| "Escalation" expected as a default behaviour | console has Fallback / Incomprehension / Unknown / Welcome | map the diagram's "3 misses → agent" to **Incomprehension** |
| Data request payload showed old fields | request model still held the three old fields | delete unused fields (they are sent as empty strings) |
| Agent got an empty summary on the safety path | `SafetyEscalation` set no `transferSummary` | fixed text via state modification (no LLM on safety) |
| Connect Error message looped back into the Agentic CX block | export routed Error back to the block | Error ends in Disconnect |

## Pattern library

Each pattern lists the diagram trigger, the construct, and the confirmed config. These are the units the
app's mapper and emitter should produce (flow node JSON beyond start/basic/escalate remains console-only
until more exports exist).

**P1: Thin Connect flow, conversation in ACXD.** Entry, analytics, one Agentic CX block, Escalation path to
Set contact attributes (`$.AgenticCX.ContextVariables.<name>`) then queue transfer, Disconnect on every
other path. Contact-flow JSON is generated from `connect-contact-flow.AgenticCX.json`.

**P2: Escalation with context.** Flow: Start → Generative text (summarise `{System.transcript}`, no PII in
the summary; Success/Timeout/Failure all continue) → Escalate with state modifications **Set**
`transferSummary` (and intent/stuck-point context variables). Connect copies the variables to contact
attributes.

**P3: Safety guardrail.** Guardrail `trigger: input`, `llmJudge` detection, `enforcement.action: route` to a
`SafetyEscalation` flow: Basic (fixed 911/988 message) → Escalate with **fixed-text** `transferSummary`
and `customerIntent = safety`. Companion guardrails: injection (`modify` with a fixed redirect message),
toxicity (`flag`).

**P4: Authentication gate (any one of N identifiers).** Basic (verbatim prompt) → Generative Journey
(Data capture: one slot `authValue`, Required; Exit when complete; prompt: capture one value, do not
re-ask) → Data request (External) → Split on `<request>.verified = true` (boolean). True → state
modification `isAuthenticated = true` → Redirect to the self-service flow. Else → Basic (failure
wording) with a **Clear** of `authValue` → back to the Loop. Loop `From 0 To N-1` (inclusive) bounds the
attempts; Completed, Data request Failure and Timeout → Redirect to Escalation with `stuckPoint` and
`customerIntent` set.

**P5: Validation backend.** External Data request (POST, secret-backed API-key header) in front of a
Lambda Function URL reading a DynamoDB table; response `{verified: boolean}`; sensitive fields masked.
Static data requests cannot validate caller input.

**P6: FAQ self-service with gated branch.** The conversational flow is a Generative Journey with the
knowledge base as a tool and **named exit conditions** (agent hand-off, `completeCensus`), each wired
to a Redirect. This is how other flows are reached from a Journey.

**P7: Default behaviours.** Welcome and Unknown → the conversational flow; Fallback (system failure) and
Incomprehension (max misses) → the escalation flow. Retry count belongs to Incomprehension plus the
application's incomprehension threshold (not yet confirmed in the console; see open items).

**P8: Retry bounds.** Loop Range for deliberate retry loops; Incomprehension default for NLU misses;
never rely on a single mechanism for both.

## Test matrix and results

| Case | Result |
|---|---|
| FAQ question | Journey answers from the knowledge base, no authentication |
| "Can I complete my census over the phone?" | goes to `Authentication` (after the `completeCensus` exit and routing flag were set) |
| Census ID alone / zip alone / last four alone | all authenticate, then land in `CQAInboundDemo` |
| Wrong value three times | the prompt repeats each time, then escalation |
| Safety statement | 911/988 message then escalation, with the fixed summary |
| Full Connect phone call and Spanish | not tested in this record |

## Open items

- Spanish end to end (language detection, voice per language, translations of flows, slots, knowledge base).
- Incomprehension threshold setting location in the console; confirm it is 3.
- Connect: the Set voice block JSON; a real phone test; Contact Lens on voice.
- The greeting differs between the slide ("Thank you for calling the 2030 Census Questionnaire Assistance
  Center.") and the existing flow ("Thank you for contacting the Census Questionnaire Assistance…").
- A repeated greeting when `Authentication` redirects back to the start of the conversational flow
  (Redirect's optional target not explored).
- French.
