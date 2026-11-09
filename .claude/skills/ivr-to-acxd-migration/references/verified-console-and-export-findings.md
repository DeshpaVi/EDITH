# Verified Console and Export Findings

Everything here was **observed in a real workspace** (Census CQA demo, Nov 2026): real exports,
console screens and the Debugger. It takes priority over the documentation-derived shapes in the other
reference files wherever the two disagree. Every item says how it was verified.

Verification tags: **[export]** read from a real export in `verified-exports/`; **[console]** seen on a
console screen; **[debugger]** seen in the Test-tab Debugger; **[tested]** confirmed by running a
conversation. **Not verified** items are listed at the end; do not treat them as known.

## Contents
- [Console node palette and what each node really does](#console-node-palette)
- [Export JSON shapes](#export-json-shapes)
- [Connect contact flow JSON](#connect-contact-flow-json)
- [Slots, slot types and variables](#slots-slot-types-and-variables)
- [Data requests](#data-requests)
- [Application, defaults, builds, testing](#application-defaults-builds-testing)
- [Corrections to the documentation-derived references](#corrections)
- [Still not verified](#still-not-verified)

## Console node palette

Palette groups [console]: **Basic** (Basic, User choice, User input), **AI** (Generative Journey,
Generative text, Knowledge base, Live Sync), **Logic** (Define, Loop, Split), **Data** (Data request,
Transform), **Redirections** (Escalate, Exit application, Redirect).

| Console node | What it does [console/tested] | Exits |
|---|---|---|
| **Basic** | Sends a message or runs a state-processing step. Takes messages and state modifications. | Next |
| **User input** | **Routing node, not slot capture.** "Capture user response to invoke a flow based on routing data": it sends the caller's reply to a flow matched by AI description. | Flow recognized, No flow recognized |
| **User choice** | Prompt for a **selection**: `Options` (a slot with values) plus `Additional slots`. Needs a message set. Every choice and additional slot must have a **different slot type** (a warning says so). **Unsuitable for free-form capture** (see below). | Match, No match |
| **Generative Journey** | LLM-driven conversation node with a Prompt, **Tools** (Data requests, Flow, Knowledge base, Modality), **Data capture** (slots, each with `Required`), an **Exit when complete** toggle, and named **exit conditions** (name + natural-language description). Model picker (Haiku 4.5, Sonnet 5 seen). | one dot per exit condition, plus Timeout, Failure; completion exit when "Exit when complete" is on |
| **Generative text** | Generates text into an **Output variable** from a Prompt. Accepts `{System.transcript}`. Model picker, temperature, max tokens. | Success, Timeout, Failure |
| **Loop** | `Range` tab: `For each` index variable (default `rangeIndex`), `From`, `To`. **`To` is inclusive**: 0 to 2 runs 3 times. | Next, Completed |
| **Split** | Conditions (`If` left, operator, right) plus a **Chance** tab; has an **else** exit. A condition exit left unconnected raises the warning "Disconnected edges". | one per condition, else |
| **Data request** | Calls a Data request resource. **Payload** maps the request model fields; type `{` for a variable picker. | In progress, Success, Timeout, Failure |
| **Redirect** | Destination: **Page**, **Flow**, **Recognized flow** or **Previous redirect**. Optional target. Takes state modifications. | Continuation |
| **Escalate** | Hands control back to the Amazon Connect contact flow "via the Escalation branch". Takes state modifications and a message. | Continuation (leave unconnected) |
| **Define / Transform / Knowledge base / Live Sync / Exit application** | present in the palette; not exercised in this build. Exit application returns control via the Default branch. | |

### Free-form capture (Census ID, zip, last 4 SSN)
- **User input** does not capture slots (it routes).
- **User choice** with **Options empty** never waits for the caller and fires No match immediately.
  **User choice with Options set to a freeform slot** waits, but a free-form answer never counts as a match.
- **Working pattern [tested]:** a **Basic** node with the exact prompt, then a **Generative Journey** with
  **Data capture** of one slot (Required) and **Exit when complete** on, then the Data request.
  Journey prompt tells it not to greet, not to repeat the question, and to capture a single value.

### State modifications
- Available on Basic, Redirect, Escalate and User input nodes ("Add functionality" > State modifications).
- The first dropdown **defaults to `Clear`**, which blanks the variable. For a value you must switch it to **`Set`**.
- `Set` value box: a text value (T icon) or, for a boolean, a **true/false dropdown**.
- A **sensitive** slot is shown masked (`[Redacted|authValue:Freeformtext]`) in the Debugger.

### Split conditions
- Compare a boolean response field to a **boolean** constant. Typing `true` as **text** never equals a
  boolean `true`: the Split always took **else** until the right side was switched to the boolean dropdown [tested].
- A Data request's response fields appear in the picker as `<DataRequestId>.<field>` (e.g.
  `verifyCensusAuth.verified`) **only once the Data request has a Response model with that field**.

## Export JSON shapes

### Flow export [export: `flow.Authentication.json`, `flow.Escalation.json`, `flow.CQAInboundDemo.json`, `flow.SafetyEscalation.json`]
Top level: `flowId`, `nodes`, `description`, `aiDescription` (also used as the **routing** description), `untrained`,
`slotTypes` (the flow's attached slots), `metadata` (`{path, tags}`), `mainLanguageCode`, `languageCodes`,
`mirroring` (`"none"`), and for entry flows an `mcp` object.
Attached slot: `{name, type, examples: [], sensitive, aiDescription, multiSelect}` (type e.g. `Freeformtext`).

Every node: `nodeId`, `type`, `childNodes[]`, `messages[]`, `modalities` (`{}`), `metadata`, `canvasMetadata`
(`{x, y, width, height, isMinimized}`); `data_request` nodes also carry `dataRequests[]`.
`metadata` always has `stateModifications` (array) and `name`; type-specific objects are listed below.
Messages: `{messageId, body, type: "text", skipTranslation: false, metadata: {alternatePhrasings: []}}`.

**`childNodes[]`** is `{nodeId?, name: "", conditions: []}`. A child with **no `nodeId`** exits the flow (escalate).
Several exits may point at the same `nodeId`. Condition shapes (all confirmed):

| Use | Condition |
|---|---|
| Plain "next" | `conditions: []` |
| Node outcome | `{left: {type: "node_status"}, operator: "eq", right: {type: "constant", value: S}}` with `S` one of `success`, `failure`, `timeout`, `in_progress` (data request), `continuation` (redirect/escalate/loop completed), `data_captured` (journey) |
| Variable test (Split) | `{operator: "eq", left: {type: "variable", name: "verifyCensusAuth.verified"}, right: {type: "constant", value: true}}` (**boolean** constant) |
| Journey exit condition i | `{left: {type: "system", name: "System.gjConditionIndex"}, operator: "eq", right: {type: "constant", value: i}}` (i = index in `exitConditions`) |
| Split else | a child with `conditions: []` listed **after** the condition child |

**Value reference syntax** inside strings: slot `{authValue:Freeformtext}`, flow-local variable
`{customeroutput:NLX.Local}` or `{transferSummary:NLX.Local}`, system `{System.transcript:NLX.System}`.

**Node `metadata` by type (all confirmed):**

| `type` | `metadata` object |
|---|---|
| `start` | none beyond the common fields |
| `basic` | none (messages carry the text); may hold `stateModifications` |
| `escalate` | `name`; optional `nodePayload: {type: "constant", value: "summary={transferSummary:NLX.Local}"}`; messages allowed; one child with no `nodeId`, condition `continuation` |
| `redirect` | `redirect: {flowId, type: "flow"}`; child condition `continuation`. Redirects to the application's default behaviours use ids like `NLX.Escalation` |
| `loop` | `loop: {type: "range", start, startOperand: {type: "constant", value}, end, endOperand: {type: "constant", value}, name: "rangeIndex"}`; children: first `conditions: []` (**Next**), second `continuation` (**Completed**) |
| `split` | `split: {modelType: "amazon-nova-2-lite"}`; children carry the conditions above; else child last |
| `data_request` | `async: false`, `inProgressEnabled: true`, `inProgressTimeout: 0`; node-level `dataRequests: [{type: "custom", dataRequestId, name, payload: {type: "recursive", value: {<field>: {type: "constant", value}}}, urlParams: {}, headers: {}, alwaysRetrigger: false}]`; children for `in_progress`, `success`, `timeout`, `failure` |
| `generative_text` | `generativeText: {modelType, name (output variable), prompt, maxTokens, temperature}`; children `success`, `timeout`, `failure` |
| `generative_journey` | `generativeJourney: {prompt, exitConditions: [{name, prompt}], tools: [{type: "knowledgeBase", knowledgeBaseId, prompt, scopeTags: []}], maxTokens, maxSteps, temperature, enableZeroTurnMode, promptVersion: "latest", incomprehensionEdgeEnabled, modelType, dataCapture: {data: [{required, type: "slot", name}], exitEnabled}}`; model types seen: `anthropic.claude-haiku-4-5`, `anthropic.claude-sonnet-5`; children: `data_captured` (when `exitEnabled`), one `gjConditionIndex` child per exit condition, `timeout`, `failure` |

**`stateModifications` items (confirmed):**
- `{type: "context", name, modification: "set", value: {type: "constant", value}}` (value text or boolean)
- `{type: "slot", name, modification: "clear"}`

Observation: a `data_request` payload lists **every** field of the request model, empty ones as `""`; the Authentication
flow still carries three stale empty fields beside `authValue`.

### Guardrail export [export: `guardrail.*.json`]
`guardrailId` (empty on export), `name`, `active`, `trigger` (`input`), `description`, `rules[]`,
`metadata`, `implementation: "managed"`, `modelType: "amazon-nova-2-lite"`.

Rule: `{id, active, name, description, trigger, detection, enforcement, tags: [{label}]}`.
- `detection`: `{method: "llmJudge", prompt}`. The prompt must end "Respond only with TRUE or FALSE."
  and should include TRUE and FALSE examples.
- `enforcement.action` values **confirmed**: `modify` (`behavior: {message}`), `flag` (no behavior),
  `route` (`behavior: {flowId}`). `mask` is still unconfirmed.
- Order and first-match: only the first triggered rule's action applies.

## Connect contact flow JSON

[export: `connect-contact-flow.AgenticCX.json`, IDs replaced by placeholders.]
Language `Version: "2019-10-30"`; `Actions[]` each with `Identifier`, `Type`, `Parameters`, `Transitions`.

The Agentic CX block:
```
Type: ConnectParticipantWithAgenticCX
Parameters:
  AgentConfiguration: { WorkspaceId, ApplicationId, Alias }          # all three are IDs
  SpeechRecognitionConfiguration: { SpeechRecognitionEngine: "AMAZON_AGENTIC_VOICE" }
  AudioFillerConfiguration: { Enabled: false }
Transitions:
  Conditions: [{ NextAction, Condition: { Operator: "Equals", Operands: ["Escalation"] } }]
  Errors: NoMatchingError, NoMatchingCondition (conversation ended normally), InputTimeLimitExceeded (idle)
```
- `Metadata.ActionMetadata[<id>].parameters.AgentConfiguration` carries console display names
  (`WorkspaceId.displayName`, `ApplicationId.displayName`, `Alias.displayName`).
- **Hand-back attributes:** `UpdateContactAttributes` with
  `Attributes: { name: "$.AgenticCX.ContextVariables.<contextVariable>" }`, and matching
  `ActionMetadata.parameters.Attributes.<name>.useDynamic: true` plus `dynamicParams: [names]`.
- Queue: `UpdateContactTargetQueue` (`QueueId` = queue ARN) then `TransferContactToQueue`.
- `UpdateContactRecordingAndAnalyticsBehavior` in this export is **chat-only**; on voice it raises
  `ChannelMismatch`, which the export routes onward.
- `MessageParticipant` for Timeout/Error messages; `DisconnectParticipant`; `EndFlowExecution`.
- **Not in the export:** the Set voice block's JSON (voice not exported).

## Slots, slot types and variables

- **Built-in slot types [console]:** `NLX.Name`, `NLX.Number`, `NLX.Ordinal`, `NLX.AlphaNumeric`,
  `NLX.PhoneNumber`, `NLX.Text`, `NLX.Time`, and **`Freeformtext`** (plus "Create new slot type").
- Attached slots are set **per flow**: flow settings (gear) > **Attached slots**; each row has a name,
  a type, and an expander for regex and sensitive.
- Flow settings dialog sections [console]: Routing (toggle), MCP, Attached slots, Usage, Languages,
  Versions, Organization, Advanced.
- Custom slot type values: **one synonym per box**, not a comma-separated list.
- Context variable schema root types: String, Number, Boolean, List, Object. **"Text" is "String".**
- Flow-scoped slot names are alphabetic only; a slot used in a Data request shows as `{slotName}` in the picker.

## Data requests

- **External** implementation [tested]: method POST, URL = a Lambda Function URL, header
  `x-api-key: {{secrets.<secretName>}}` (header marked sensitive). Secret created in Resources > Secrets (Sensitive on).
- Request/response model editor: a root **Object** with child fields; the **eye icon** toggles sensitive.
  The **Test** button runs the request.
- The request sent contains **every field in the request model** (empty ones as `""`) plus `nlx_context: []`.
  Delete unused fields from the model; they are sent anyway.
- The response body arrives as `{"statusCode": 200, "statusMessage": "OK", "body": {...}}` and the response
  fields are addressed as `<DataRequestId>.<field>`.
- A **static** (`inline-static`) data request returns a fixed response and cannot check caller input. Use External for validation.

## Application, defaults, builds, testing

- Application page tabs: **Observe, Design, Test, Deploy**. Design lists **Attached flows** and **Guardrails** (each with a +).
- Flow row menu (**⋯**): **Manage default behavior**, **Remove flow**.
- Default behaviors [console]:
  | Default | Description in console |
  |---|---|
  | Welcome | session begins |
  | Fallback | an integration fails or state breaks |
  | Unknown | the user's reply matches no flow or variable |
  | Incomprehension | the maximum incomprehension count is reached |
  There is **no separate "Escalation" default** in the dialog. The diagram's "didn't understand 3 times, route to agent" is **Incomprehension → escalation flow**.
- Deploy tab lists builds with `Live` / `Off`; "Build & deploy" builds then deploys. A flow change needs a **new build** before the full-application Test sees it.
- Test tab: **New conversation test**, **Recorded conversation tests**, **Routing tests**. A flow-level tester also exists on the Canvas (play button).
- **Debugger** (bug icon): select a bot message to see events: *Data requests requested* (url, payload), *Data requests returned*
  (request, response, statusCode), *Condition evaluated*. This is how the Split boolean bug and the empty-slot bug were diagnosed.
- A flow that is the application's **Welcome** and also holds a Generative Journey keeps the whole conversation. Other flows are reached
  only through a Journey **exit condition** wired to a Redirect, or a routing match.

## Corrections

These items in the documentation-derived references were **wrong or misleading in the real console**:

| Reference said | Verified reality |
|---|---|
| `user_input` is free-form capture with an Attached Slot | User input is a **routing** node (Flow recognized / No flow recognized) |
| Free-form / PIN / account-number capture → `user_input` | Use **Generative Journey + Data capture** |
| `defaultFlows.escalation` is the global "agent" target | Console defaults are Welcome, Fallback, Unknown, Incomprehension; the Escalate node returns control to Connect |
| `Fallback` = invalid entry after repeated incomprehension | Fallback = **integration/state failure**; repeated incomprehension is **Incomprehension** |
| Static data request is "good for stubbing" | Fine for a fixed reply, **cannot validate input** |
| Built-in slot types unknown | `NLX.*` and `Freeformtext` listed above |
| Node `metadata` and `childNodes[].conditions` undocumented | Confirmed for start, basic, escalate, redirect, loop, split, data_request, generative_text and generative_journey (see Export JSON shapes) |
| Guardrail action names to be confirmed | `modify`, `flag`, `route` confirmed (`mask` not yet seen) |

## Verified by the first programmatic deployment (SDK `amazon-connect-acxd-sdk` 0.3.0, real workspace)

Source: a CloudFormation custom resource creating the Census build through the SDK, with the SDK's real export list and ACXD's own Build validation.

**SDK commands (Command classes exported by 0.3.0):**
- Full Create / Update / Delete / List and (except where noted) Get exist for: Application, DataRequest, Flow, Guardrail, Secret, SlotType.
- **ContextVariable and AnalyticsTag have no Get**: Create, Update, Delete, List only. Check existence with the list call and match on `name`; the identifier is the name.
- Application also has Builds, Deployments and BuildDiff commands. There is `TestGuardrail` and `ListGuardrailEvents`.
- Every command is built as `new sdk[`<Verb><Kind>Command`](input)`; a missing one fails as "is not a constructor". Check names against the export list before relying on a documented command.
- SDK version matters: pin it. Print it in the build.

**Workspace-level objects that flows and guardrails reference must exist before the application builds.** ACXD's Build validation reports "Unavailable reference" for each missing one, and creating a flow or guardrail that points at a missing object succeeds silently. Found so far:
- **Analytics tags**: guardrail rules carry `tags: [{label}]`. The tag must exist (Create `name` letters/digits/underscores up to 36, `type` positive|negative|neutral, `description` up to 64). A guardrail export does not say a tag's `type`.
- **Custom slot types**: an attached slot's `type: "Freeformtext"` is a *custom* slot type (listed under "Custom" in the slot dropdown, next to `YesNo`), not a built-in. Built-ins are `NLX.Date, Duration, Email, Name, Number, Ordinal, AlphaNumeric, PhoneNumber, Text, Time, Url`. `Freeformtext` has **0 values**, one language, sensitive off, no description. A flow whose slot type is missing shows "Unknown value" (red) in Attached slots.
- Rule: collect every workspace-level reference from the generated flows and guardrails, and create it first. Do not delete shared ones (tags, slot types) when a stack is deleted.

**Application:** creating flows and guardrails does not build or deploy anything. Console steps remain after the stack: Manage default behavior (Incomprehension to the Escalation flow), then Deploy > Build, then deploy and note the deployment alias.

## Still not verified

- Flow JSON for `user_choice`, `user_input`, `knowledge_base`, `define`, `transform`, `live sync`, `multimodal`,
  `intent_capture`, `application_handoff`, `wait`, `exit application` nodes (none appeared in the exports).
- Whether `NLX.Escalation` in a redirect resolves to the application's default behaviour or to a flow named `Escalation`.
- Other `stateModifications` operations (only `set` on context and `clear` on slot are confirmed).
- Other `split` condition types and the `Chance` tab; other loop types (`List`).
- The `mask` guardrail action.
- How the application picks `Authentication` over the Journey: flow **Routing** (`aiDescription`) or only the Journey exit.
- Spanish: language detection and switching in an ACXD-only design, per-language voices, translations.
- The Connect Set voice block JSON; the imported voice flow on a real phone call.
- Application-level and Data request / Context variable **export** shapes (flows, guardrails and one slot type's settings so far).
- Whether the SDK accepts `CreateSlotType` with `values: []` (the console shows a 0-value slot type; first run of the provisioner will tell) and the analytics tag `type` used by the Census workspace.
- Remaining first-run mismatches in command *inputs* (field names) for data requests, flows, guardrails and the application.
