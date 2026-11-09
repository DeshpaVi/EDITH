# Implementation checklist: 2030 Census Questionnaire Assistance (CQA) demo

22 items (18 required, 4 recommended, 0 optional). Schema: 17 confirmed, 3 partial, 2 unconfirmed. Reviews: 1 blocker, 2 warn, 5 info.
Not everything can be generated yet: see the unconfirmed items and blockers below.

## Required

- [x] **ACXD provisioner (CloudFormation custom resource)** (platform.provisioner, partial)
  - Why: ACXD has no import path and no native CloudFormation resource types; its resources are created by ordered SDK calls. A Lambda-backed custom resource performs them, idempotently, and handles stack deletion.
  - Needs: platform.apiKeySecret
  - Note: The provisioner is generated code we own; the ACXD calls it makes are limited to confirmed schema (see each item).
- [x] **ACXD API key in Secrets Manager** (platform.apiKeySecret, confirmed)
  - Why: The provisioner needs an ACXD API key. It is a NoEcho template parameter stored in Secrets Manager; the app never stores or sees it.
  - You supply: ACXD workspace ID; ACXD API key (acxd_live_...) (secret, NoEcho)
- [x] **ACXD application** (acxd.application, partial)
  - Why: The deployable unit that bundles the flows, default behaviours and guardrails.
  - You supply: Application name
  - Note: Default behaviours: Welcome and Unknown to the main conversation flow; Fallback (system failure) and Incomprehension (max misses) to the escalation flow.
  - Note: The application export shape has not been seen; settings follow the SDK docs and are not yet verified against a real export.
- [x] **Thin Amazon Connect contact flow with the Agentic CX block** (connect.contactFlow, partial)
  - Why: Entry, call setup and queue transfer stay in Connect; the conversation moves behind one Agentic CX block, and the Escalation exit transfers to a queue.
  - You supply: Amazon Connect instance ID; ACXD deployment alias
  - Needs: acxd.application
  - Note: Contact-flow JSON for the Agentic CX block is confirmed from a real export.
  - Note: TODO(acxd-schema): confirm that the CloudFormation Connect contact-flow resource accepts the Agentic CX block action type.
  - Note: TODO(acxd-schema): the Set voice block JSON is not in any export; add it in the console.
- [x] **Main conversation flow** (acxd.flow, confirmed)
  - Why: Plays the greeting and handles open conversation (including FAQ answers from knowledge). A Generative Journey with named exit conditions hands the caller to the other flows.
  - From journey steps: greeting, intent, enumeration, faq
  - Needs: acxd.application
  - Note: Greeting and prompts are copied verbatim from the journey.
  - Note: Each exit condition (for example "complete the questionnaire") is wired by a Redirect to the target flow.
  - Note: Intent recognition: after 3 misses the application default Incomprehension routes to the escalation flow (spoken: "I'm sorry, I didn't quite get that.").
- [x] **Knowledge base for self-service answers** (acxd.knowledgeBase, UNCONFIRMED)
  - Why: Self-service steps answer from knowledge, so the Journey needs a knowledge base tool.
  - From journey steps: enumeration, faq
  - You supply: Source content (Q&A JSON/CSV or documents)
  - Needs: acxd.flow.MainConversation
  - Note: The knowledge base export shape has not been seen. The flow node that references it (tool type knowledgeBase) is confirmed.
  - Note: Content must come from the customer; the app cannot invent it.
- [x] **Authentication flow** (acxd.flow, confirmed)
  - Why: The caller is verified before the intents that require it (Census ID, home zip code, last four digits of SSN; any one is enough).
  - From journey steps: auth
  - Needs: acxd.dataRequest.verifyAuth, acxd.contextVariable.isAuthenticated, acxd.flow.Escalation, acxd.flow.MainConversation
  - Note: Prompt text is verbatim. A retry Loop caps attempts at 3 (Loop range 0 to 2, end value is inclusive); the slot is cleared between attempts.
  - Note: The identifiers are captured into ONE slot (authValue) by a Generative Journey with data capture, because a single choice node cannot hold several slots of the same type; the backend checks the value against every identifier.
  - Note: On success: isAuthenticated is set and the caller is redirected to the main conversation flow. On exhaustion, data-request failure or timeout: stuckPoint and customerIntent are set and the caller is redirected to the escalation flow.
- [x] **Context variable isAuthenticated** (acxd.contextVariable, confirmed)
  - Why: Remembers that the caller has authenticated so later requests skip the check.
  - From journey steps: auth
  - Note: Boolean; external modification disallowed so only flows can set it.
- [x] **Data request verifyAuth (External, POST)** (acxd.dataRequest, confirmed)
  - Why: Calls the verification backend with the caller-supplied value and receives { verified: boolean }.
  - From journey steps: auth
  - Needs: platform.apiKeySecret, lambda.function.verifyAuth
  - Note: Request field authValue is sensitive; delete unused fields from the request model because every field is sent.
- [x] **DynamoDB table of respondent records** (dynamodb.table, confirmed)
  - Why: Holds the records the caller is verified against, with an index per identifier that is not the key.
  - From journey steps: auth
  - You supply: Table name
  - Note: Partition key = Census ID; one global secondary index (keys only) for each other identifier.
  - Note: Demo records are seeded by the consultant, not by the app.
- [x] **Verification Lambda with a Function URL** (lambda.function, confirmed)
  - Why: Receives the data request, checks the value against the table and returns { verified }. Protected by an x-api-key header held in the ACXD secret.
  - From journey steps: auth
  - Needs: dynamodb.table.respondents, iam.role.verifyAuth, platform.apiKeySecret
  - Note: Function URL with auth type NONE; the shared header is the guard (demo-grade).
- [x] **IAM role for the verification Lambda** (iam.role, confirmed)
  - Why: GetItem on the table and Query on its indexes, plus basic logging.
  - From journey steps: auth
  - Needs: dynamodb.table.respondents
- [x] **Escalation flow** (acxd.flow, confirmed)
  - Why: Hands the caller to a live agent with context: a generated summary, then an Escalate node that returns control to Connect.
  - From journey steps: agent, intent, auth
  - Needs: acxd.application, acxd.contextVariable.transferSummary, acxd.contextVariable.customerIntent, acxd.contextVariable.stuckPoint
  - Note: Generative text summarises the transcript without identifiers; its Success, Timeout and Failure all continue to Escalate so a failed summary never blocks the transfer.
  - Note: Wired as the application default for Fallback and Incomprehension.
- [x] **Hand-back contact attributes** (connect.contactAttributes, confirmed)
  - Why: Copies the context variables to contact attributes so the agent sees them.
  - From journey steps: agent, intent, auth
  - You supply: Connect queue for escalations
  - Needs: connect.contactFlow
  - Note: Attributes: transferSummary, customerIntent, stuckPoint (mapped from $.AgenticCX.ContextVariables.<name>).
- [x] **Context variable transferSummary** (acxd.contextVariable, confirmed)
  - Why: Carries "conversation summary" to the agent.
  - From journey steps: agent, intent, auth
- [x] **Context variable customerIntent** (acxd.contextVariable, confirmed)
  - Why: Carries "caller intent" to the agent.
  - From journey steps: agent, intent, auth
- [x] **Context variable stuckPoint** (acxd.contextVariable, confirmed)
  - Why: Carries "point at which the caller got stuck" to the agent.
  - From journey steps: agent, intent, auth
- [x] **Languages: en-US, es-US** (acxd.languages, UNCONFIRMED)
  - Why: The journey must serve more than one language: application languages, a voice per language and translations.
  - From journey steps: language
  - Needs: acxd.application
  - Note: TODO(acxd-schema): per-language voices and translations are not verified against a real export.
  - Note: Prompts that are client wording need a person-reviewed translation, not machine output.

## Recommended

- [x] **Guardrail: safety statements** (acxd.guardrail, confirmed)
  - Why: Not in the journey. Recommended baseline from the Census build. Routes statements about self-harm or threats to a safety flow with fixed wording.
  - Needs: acxd.flow.SafetyEscalation
- [x] **Safety escalation flow** (acxd.flow, confirmed)
  - Why: Fixed emergency-resources message, then Escalate with a fixed (not generated) summary.
  - Needs: acxd.application, acxd.contextVariable.transferSummary, acxd.contextVariable.customerIntent
  - Note: The emergency wording is customer-owned; the app uses the Census text only as a starting point and flags it for review.
- [x] **Guardrail: prompt injection** (acxd.guardrail, confirmed)
  - Why: Not in the journey. Recommended baseline from the Census build. Replaces manipulation attempts with a fixed redirect message.
- [x] **Guardrail: toxicity (flag only)** (acxd.guardrail, confirmed)
  - Why: Not in the journey. Recommended baseline from the Census build. Flags targeted abuse without blocking ordinary frustration.

## Needs a human decision

- **BLOCKER: Language detection and switching in ACXD is unverified**
  - The journey detects the caller's language (en-US, es-US; via Lambda (orange decision)). How ACXD detects and switches language in an ACXD-only design has not been verified.
  - Steps: language
- **warn: "Complete the questionnaire (enumeration)" is modelled as a knowledge-grounded conversation**
  - The journey describes completing a questionnaire but not its questions or where answers are stored. It is built as a conversation grounded in the knowledge base; confirm that is intended.
  - Steps: enumeration
- **warn: Part of the source journey is not modelled**
  - Alternate Path 4: caller speaks French; the IVR detects French, collects the call reason, translates it and passes the intent to a French-speaking agent. Deferred by the owner; French is not modelled.
- **info: Assumption to confirm**
  - Authentication succeeds on any ONE of Census ID, home zip code or last four SSN digits (the slide says "either"; the owner decided any one is enough).
- **info: Assumption to confirm**
  - The Auth Failure wording on the slide reads "Can you please provide please provide"; the owner approved the corrected wording used here.
- **info: Assumption to confirm**
  - Census respondent records live in a DynamoDB table.
- **info: Assumption to confirm**
  - "If already authenticated, skip, otherwise send through authentication" means the Authentication step is skipped once the caller has authenticated in the same call.
- **info: Assumption to confirm**
  - The "Anything Else" Yes branch returns to the intent check, so a later request that needs authentication is gated again unless already authenticated.

