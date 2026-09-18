# Flows and Nodes

A flow represents the structured path a conversation follows to fulfill a user's intent —
answering FAQs, completing a task, or guiding a user toward an action. Each flow combines
logic, prompts, and responses into a graph of connected nodes. Once attached to an
application and deployed, the application can execute the flow. A single flow can be
shared across multiple applications in a workspace.

## Contents
- [ListFlows](#listflows)
- [CreateFlow](#createflow)
- [GetFlow](#getflow)
- [UpdateFlow](#updateflow)
- [DeleteFlow](#deleteflow)
- [Request parameters](#request-parameters)
- [Attached Slot](#attached-slot)
- [Flow Node](#flow-node)
- [Node type notes for migration](#node-type-notes-for-migration)

## ListFlows

Lists all flows in the workspace. Returns summary information without node details.

**Input:** `nextToken` (string, optional), `maxResults` (integer, optional)

```js
await client.send(new ListFlowsCommand({}));
```

Output items look like:

```json
{
  "flowId": "MainFlow",
  "description": "Handles customer support inquiries",
  "mainLanguageCode": "en-US",
  "languageCodes": ["en-US", "es-ES"],
  "slotTypes": [],
  "contextVariables": [],
  "metadata": { "path": "/support", "tags": ["production"] },
  "saveId": "save-abc123",
  "createdAt": "2026-08-01T12:00:00.000Z",
  "updatedAt": "2026-08-01T14:00:00.000Z",
  "updatedBy": "ci-deploy-bot"
}
```

Errors: `ValidationException` (400), `InternalServerException` (500), `ThrottlingException` (429)

## CreateFlow

Creates a new flow with nodes (conversation logic), and optional slot types and context
variables.

**Input**

| Parameter          | Type    | Required |
| ------------------ | ------- | -------- |
| `flowId`           | string  | Yes      |
| `description`      | string  | No       |
| `nodes`            | object  | Yes      |
| `aiDescription`     | string  | No       |
| `untrained`         | boolean | No       |
| `mainLanguageCode`  | string  | No       |
| `languageCode`      | enum    | No       |
| `languageCodes`     | array   | No       |
| `slotTypes`         | array   | No       |
| `contextVariables`  | array   | No       |
| `mcp`               | object  | No       |
| `metadata`          | object  | No       |

```js
const created = await client.send(new CreateFlowCommand({
  flowId: "MainFlow",
  description: "Handles customer support inquiries",
  mainLanguageCode: "en-US",
  languageCodes: ["en-US"],
  slotTypes: [],
  contextVariables: [],
  nodes: {
    "a0000000-0000-4000-8000-000000000001": {
      nodeId: "a0000000-0000-4000-8000-000000000001",
      type: "start",
      childNodes: [{ nodeId: "a0000000-0000-4000-8000-000000000002" }],
    },
    "a0000000-0000-4000-8000-000000000002": {
      nodeId: "a0000000-0000-4000-8000-000000000002",
      type: "basic",
      messages: [{ body: "Hello! How can I help you today?", type: "text" }],
      childNodes: [{ nodeId: "a0000000-0000-4000-8000-000000000003" }],
    },
    "a0000000-0000-4000-8000-000000000003": {
      nodeId: "a0000000-0000-4000-8000-000000000003",
      type: "end",
    },
  },
  metadata: { path: "/support", tags: ["production"] },
}));
```

Output returns the full flow, with server-assigned `messageId`s on each message and a
`saveId`. Errors: `ValidationException` (400), `ConflictException` (409),
`InternalServerException` (500), `ThrottlingException` (429)

## GetFlow

Gets the full flow definition including all nodes, attached slots, and context variables.

**Input:** `flowIdentifier` (string, required), `languageCode` (string, optional)

```js
const fetched = await client.send(new GetFlowCommand({ flowIdentifier: "MainFlow" }));
```

Errors: `ValidationException` (400), `ResourceNotFoundException` (404),
`InternalServerException` (500), `ThrottlingException` (429)

## UpdateFlow

Updates an existing flow. Only include fields you want to change. **Changes do not affect
deployed applications until a new build is created** — this is the key thing to remember
when scripting a migration: editing flows is safe/iterative, and nothing goes live for
end users until `CreateApplicationBuild` + `CreateApplicationDeployment` run.

**Input:** same fields as CreateFlow except `flowIdentifier` (required) replaces `flowId`,
and all other fields become optional.

```js
await client.send(new UpdateFlowCommand({
  flowIdentifier: "MainFlow",
  description: "Updated Primary support flow",
  mainLanguageCode: "en-US",
  languageCodes: ["en-US"],
  slotTypes: [],
  contextVariables: [],
  nodes: { /* full or partial node map */ },
  metadata: { path: "/support", tags: ["production"] },
}));
```

Errors: `ValidationException` (400), `ResourceNotFoundException` (404),
`ConflictException` (409), `InternalServerException` (500), `ThrottlingException` (429)

## DeleteFlow

Deletes a flow. If the flow is attached to applications, detach it first.

**Input:** `flowIdentifier` (string, required). No response body.

Errors: `ValidationException` (400), `ResourceNotFoundException` (404),
`InternalServerException` (500), `ThrottlingException` (429)

## Request parameters

- **`flowId`** — string. The flow identifier. Alphanumeric characters, 3–64 characters.
- **`flowIdentifier`** — string. The flow ID used in Get, Update, and Delete operations.
- **`description`** — string. Flow description. Max 200 characters.
- **`aiDescription`** — string. AI-readable description of what this flow does. Max 1000
  characters. Used by generative features to understand flow purpose — worth writing
  well when a flow contains `generative_*` nodes.
- **`untrained`** — boolean. Whether to skip NLP training for this flow.
- **`mainLanguageCode`** — string. Primary language. See common types.
- **`languageCode`** — string. Language code. See common types.
- **`languageCodes`** — array. Supported languages. See common types.
- **`nodes`** — object. The flow node graph, a map of node IDs to node objects. See
  [Flow Node](#flow-node).
- **`slotTypes`** — array. Slot types attached to this flow. See
  [Attached Slot](#attached-slot).
- **`contextVariables`** — array. Flow-scoped context variables. Each entry:
  `{ "name": "varName", "type": "text|number|boolean" }`.
- **`mcp`** — object. MCP endpoint configuration:
  `{ "input": { "name": "...", "schema": {...} }, "output": { "name": "...", "schema": {...} } }`.
- **`metadata`** — object. Organizational metadata. See common types.
- **`magicLayout`** — boolean. Whether to apply automatic layout during validation.
- **`saveId`** — string. Internal save identifier (read-only).
- **`createdAt`** / **`updatedAt`** — string. ISO 8601 timestamps.
- **`updatedBy`** — string. Identity of who last modified the flow.
- **`nextToken`** / **`maxResults`** — pagination. See common types.

## Attached Slot

| Field           | Type    | Required |
| --------------- | ------- | -------- |
| `name`          | string  | Yes      |
| `type`          | string  | Yes      |
| `sensitive`     | boolean | No       |
| `examples`      | array   | No       |
| `aiDescription` | string  | No       |
| `regex`         | string  | No       |

- **`name`** — Slot name. Alphabetic characters only, 3–30 characters.
- **`type`** — Reference to a Slot Type (see `data-context-slots-modalities.md`). The docs
  cover *custom* slot types only; whether ACXD provides built-ins (an `AMAZON.Number`-style
  catalog, as Lex does) is not stated. Define a custom slot type, or flag the built-in
  reference as needing confirmation — don't carry names over from another platform.
- **`sensitive`** — Whether this slot captures sensitive data (masked in logs/exports).
- **`examples`** — Array of example values, useful for NLU training.
- **`aiDescription`** — AI-readable description of what this slot captures. Max 1000 chars.
- **`regex`** — Optional regex pattern for validation. Max 300 characters. Use this for
  deterministic captures migrated straight from IVR DTMF validation (account numbers,
  zip codes) rather than relying purely on NLU.

## Flow Node

| Field            | Type   | Required |
| ---------------- | ------ | -------- |
| `nodeId`         | string | Yes      |
| `type`           | enum   | Yes      |
| `childNodes`     | array  | No       |
| `dataRequests`   | array  | No       |
| `messages`       | array  | No       |
| `modalities`     | object | No       |
| `canvasMetadata` | object | No       |
| `metadata`       | object | No       |

- **`nodeId`** — Unique node identifier (UUID in practice).
- **`type`** — One of: `basic`, `start`, `end`, `user_input`, `user_choice`, `choice`,
  `data_request`, `redirect`, `escalate`, `split`, `loop`, `define`, `wait`, `transform`,
  `note`, `knowledge_base`, `generative_text`, `generative_task`, `generative_journey`,
  `multimodal`, `intent_capture`, `application_handoff`.
- **`childNodes`** — Connected child nodes. Each entry:
  `{ "nodeId": "...", "name": "...", "conditions": [...] }`. The contents of `conditions`
  are undocumented — don't assume they match the Roles condition-catalog syntax, which is
  a separate system.
- **`dataRequests`** — Data requests triggered by this node.
- **`messages`** — Messages displayed at this node.
- **`modalities`** — Modality-specific content (free-form object).
- **`canvasMetadata`** — Visual editor position/display:
  `{ "x": 100, "y": 200, "width": 300, "height": 150, "color": "#fff", "pageId": "..." }`.
- **`metadata`** — Node-type-specific configuration. Fields depend on `type` — contains
  things like `generativeText`, `choice`, `redirect`, `knowledgeBase`, `loop`,
  `multimodal`, `stateModifications`, `tags`, `name`, `timeout`, etc. **The inner field
  names of these objects are not published** — see "Where the documentation stops" in
  SKILL.md. Mark them as needing confirmation rather than inventing them; `GetFlow` on a
  flow built in the Canvas reveals the real structure.

## Node type notes for migration

These aren't exhaustively documented per-field in the source docs (the shape lives under
the free-form `metadata` object per node `type`), but here's how each maps to legacy IVR
concepts — cross-reference with `migration-playbook.md` for the full table:

- **`start`** / **`end`** — every flow's entry/exit; equivalent to the IVR's opening
  greeting hook and final disposition.
- **`basic`** — a static prompt/announcement (`messages` array). Direct equivalent of an
  IVR "play prompt" block.
- **`user_input`** — free-form capture (paired with an Attached Slot). Equivalent of an
  IVR "collect digits" block when the slot has a `regex`, or a full NLU capture otherwise.
- **`user_choice`** — menu-style capture, typically slot-type-backed with
  `choicePayload` per value. Direct equivalent of a DTMF menu.
- **`choice`** / **`split`** — branching logic without waiting on new user input.
  Equivalent of IVR branch-on-variable (hours of operation, account status, etc.).
- **`data_request`** — invokes a Data Request (webhook). Equivalent of an IVR "data dip."
- **`redirect`** — jumps to another node/flow. Equivalent of an IVR "goto" or submenu
  transfer within the same application.
- **`escalate`** — hands off to a human/queue. Equivalent of an IVR "transfer to agent."
- **`application_handoff`** — hands off to a different ACXD application entirely (useful
  when a large legacy IVR is being decomposed into several smaller ACXD applications
  rather than one monolith).
- **`loop`** — repeats a sub-path; pair with `thresholds.incomprehensionCount` at the
  application level so loops terminate gracefully instead of trapping callers.
- **`wait`** — pause for async completion (e.g. waiting on a slow data request).
- **`define`** / **`transform`** — set or reshape context variables/state without user
  interaction.
- **`knowledge_base`** — answers grounded in a published Knowledge Base. Use this instead
  of `basic` for IVR content that changes often (hours, promotions, policy text) so
  content owners can update it without a flow redeploy.
- **`generative_text`** / **`generative_task`** / **`generative_journey`** — LLM-driven
  response/task/multi-step journey generation. Use where the legacy script was rigid but
  the use case tolerates more natural phrasing; pair with a guardrail since output is less
  deterministic than a `basic` node.
- **`multimodal`** — content that varies by channel/modality (voice vs. chat vs. a rich
  card); references a Modality schema.
- **`intent_capture`** — NLU-first intent recognition, the natural target when collapsing
  a deep DTMF tree into a single conversational turn.
- **`note`** — documentation-only, not part of runtime logic; use freely to record
  migration decisions/rationale directly in the flow for future maintainers.
