---
name: ivr-to-acxd-migration
description: "Expert guidance for conversational design and migrating contact center experiences from legacy IVR (DTMF menus, call flows, data dips, transfers) to Amazon Connect's Agentic CX Designer (ACXD) — a CCaaS/conversational-AI platform on AWS. Covers the full ACXD SDK (amazon-connect-acxd-sdk) — workspaces, applications, flows and node types, builds/deployments, guardrails, knowledge bases, slot types, context variables, data requests/webhooks, and modalities. Use this whenever the user mentions IVR migration, Agentic CX Designer, ACXD, converting DTMF menus to conversational flows, building or editing Amazon Connect conversational AI flows/applications, CCaaS/contact-center conversational design, or wants ACXD API/SDK code (CreateFlow, CreateApplication, guardrails, knowledge bases, etc.) — even if they don't name ACXD explicitly and just describe a contact-center or IVR modernization task."
---

# IVR → Agentic CX Designer (ACXD) Migration & Conversational Design

Act with two hats on at once: the **conversation designer** who thinks about caller
experience, containment, and accessibility, and the **platform engineer** who knows the
exact ACXD SDK shapes. Most real requests need both — a mapping decision (design) has to
land in a specific node/field shape (engineering), and a piece of generated code should
be traceable back to a conversational design reason, not just a schema fill-in.

## Mental model

- **Workspace** — isolated environment holding everything below, scoped via `workspaceId`.
- **Application** — the top-level conversational AI unit; bundles flows + settings +
  guardrails + deployment config; goes through a build → deploy lifecycle before it's live.
- **Flow** — the actual conversation logic: a graph of typed nodes (`start`, `basic`,
  `user_input`, `user_choice`, `choice`, `data_request`, `redirect`, `escalate`, `split`,
  `loop`, `define`, `wait`, `transform`, `note`, `knowledge_base`, `generative_text`,
  `generative_task`, `generative_journey`, `multimodal`, `intent_capture`,
  `application_handoff`, `end`). A single flow can be shared across applications.
- **Build** — an immutable compiled artifact of an application's flows + config. Always
  build before deploying; check status (`PENDING` → `BUILT`/`FAILED`) before moving on.
- **Deployment** — publishes a build to an environment (`development`/`qa`/`staging`/
  `production`) across whichever channels the app targets — chat, voice, IVR, website,
  mobile, or MCP clients. Only one build is live per application at a time; rollback means
  deploying an older build.
- **Supporting resources a flow leans on:** Slot Types (custom entities), Context
  Variables (cross-conversation state), Data Requests (webhook data dips), Guardrails
  (safety/compliance enforcement), Knowledge Bases (FAQ/document-grounded answers),
  Modalities (channel-specific input/output schemas).

**How the two systems connect:** ACXD does not replace a contact center's entry point —
it plugs into one. In Amazon Connect specifically, the legacy IVR *is* a **Connect
Customer contact flow** (the block-based flow builder: Play Prompt, Get Customer Input,
Invoke Lambda, Transfer to Queue, Set Voice, etc.). That flow still owns routing, queues,
and channel setup; it hands the conversation to ACXD through a single **Agentic CX
block**, configured with the workspace, the ACXD application name, and a deployed
environment alias (`Development`/`Production`), plus block pathways for escalation,
error, and timeout. From that point on, ACXD owns the conversation — turns, state, tool
calls, knowledge retrieval, guardrails — until it returns control (resolved, or via the
escalation/timeout pathway back into the contact flow). This is the concrete version of
"IVR → ACXD migration": the contact flow keeps whatever pure telephony/routing logic it
must (queues, business-hours routing before the caller ever reaches conversational logic,
number/channel setup), and everything that was conversation logic — menus, prompts,
capture, data dips — moves into the ACXD application behind the Agentic CX block. If the
source system is a different CCaaS platform (Genesys, Avaya, Nuance, etc.) rather than
classic Amazon Connect, the same shape still applies: something upstream owns entry/
routing, and everything past that point is conversation logic and belongs in ACXD. See
`references/connect-customer-bridge.md` for the full block configuration (voice persona,
speech recognition, audio filler, idle chat timeout).

**Auth:** an API key is issued to a "programmatic user" (`roleConfig`: account-level
administrator, or workspace-scoped with a pre-defined or custom role). Key format is
`acxd_live_<prefix>.<secret>`, shown once — treat it like any other secret. Permissions
resolve at request time from the user's current role, so a role change in Admin Hub takes
effect immediately without rotating the key.

```js
import { AgenticCXDesignerClient, <CommandName> } from "amazon-connect-acxd-sdk";

const client = new AgenticCXDesignerClient({
  apiKey: "acxd_live_...",
  workspaceId: "your-workspace-uuid", // not required for account-level ops (programmatic users, workspaces)
});

const response = await client.send(new <CommandName>({ ... }));
```

Every operation follows this Command pattern. List operations paginate via
`nextToken`/`maxResults`. Full auth setup and shared types are in
`references/auth-errors-common-types.md`.

## Migrating an IVR to ACXD — the workflow

This is the core job. Work through it in order, but calibrate depth to what's actually
being asked (see "Choosing the deliverable" below) — a quick mapping question doesn't
need all five steps spelled out in the reply.

1. **Inventory the legacy IVR.** Before mapping anything, get (or reconstruct from what
   the user gives you) the call-flow structure: greeting/prompts, the DTMF menu tree
   (digit → destination), data dips to backend systems, transfer/escalation points,
   compliance announcements (recording disclosure, PCI masking), language/hours-of-
   operation branching, repeat/no-input/no-match handling, and global commands (e.g. "0"
   for an agent, "*" to repeat). If the source is a classic Amazon Connect contact flow,
   this inventory is literally its block diagram — Play Prompt, Get Customer Input,
   Invoke Lambda, Transfer to Queue, and so on; each block type has a natural ACXD
   counterpart (see the mapping table). If the user hasn't supplied this, ask for the
   script, flow diagram, or a plain-language walkthrough before designing — don't invent
   menu content to fill gaps.

2. **Map each IVR element to an ACXD construct.** `references/migration-playbook.md` has
   the full table and a worked before/after example; the essentials:
   - DTMF menu choice → a `user_choice` node backed by a Slot Type whose values carry
     `choicePayload`, **or** an `intent_capture`/NLU-first design if you're upgrading past
     strict digit parity — decide this deliberately and say which you chose and why.
   - Free-form / account-number / PIN capture → a `user_input` node with an Attached Slot
     (`sensitive: true`, optional `regex`).
   - Backend data dip → a Data Request (webhook) invoked from a `data_request` node.
   - Transfer to queue/agent → an `escalate` node (or `application_handoff` to hand off to
     another ACXD application).
   - Static FAQ/compliance readout → a `basic` node (fixed message), or a
     `knowledge_base` node if the content should stay dynamic/versioned outside a redeploy.
   - Repeat / no-input / no-match handling → `application.settings.thresholds
     .incomprehensionCount` + `repeatOnIncomprehension` + `defaultFlows.fallback`/`.repeat`.
   - Global "agent" command / stop-words → a `guardrail` with `trigger: "input"` and
     `enforcement.action: "route"` — not logic re-implemented in every node.
   - Branch on hours-of-operation/queue state → a `data_request` feeding a `choice`/
     `split` node.
   - Multi-language IVR → `mainLanguageCode` + `languageCodes`, plus per-language `voice`/
     `useNativeLanguage` in `application.settings.languageSettings`.

3. **Design beyond parity.** A straight 1:1 port under-uses the platform. Flag (don't
   silently assume) opportunities: collapsing a deep DTMF tree into a single NLU-first
   `user_choice`/`intent_capture`, moving static prompts into a `knowledge_base` node so
   content owners can update copy without a redeploy, adding guardrails for PII the legacy
   IVR only handled via network segmentation, and using `generative_text`/
   `generative_journey` nodes where the old script was rigid but the use case tolerates
   more flexible phrasing.

4. **Validate before generating.** Call out migration risks explicitly: NLU confidence vs.
   deterministic DTMF (a menu that was unambiguous on a phone keypad may need a
   confirmation step once it's intent-based), latency added by data requests replacing
   what used to be a synchronous mainframe call, and anything sensitive that needs
   `isSensitive`/guardrail masking that the IVR previously handled structurally.

5. **Generate the deliverable.** See below.

Building the ACXD application (steps 1–5) is necessary but not sufficient — the legacy
IVR isn't actually replaced until the old contact flow is repointed at it. That last step
is wiring an Agentic CX block into the existing (trimmed-down) contact flow, which is a
console/admin action, not an SDK call; name it explicitly as the final checklist item
rather than treating the ACXD build as the finish line. Details in
`references/connect-customer-bridge.md`.

## Choosing the deliverable

Infer this from the request rather than defaulting to everything every time:

- **"design", "map out", "what would this look like", "how should we structure"** → a
  design artifact: a node/flow table (or a short diagram) plus the resource list (slot
  types, data requests, guardrails, knowledge bases) it depends on. Skip SDK code unless
  it's needed to make a specific point.
- **"build", "create", "generate the flow", "write the code"** → real SDK code using
  `CreateFlow`/`CreateApplication`/etc., following the exact shapes in
  `references/flows-and-nodes.md` and `references/applications-builds-deployments.md`.
  Use realistic `flowId`/`nodeId` values (node IDs are UUIDs in the examples), never
  placeholders like `"TODO"`.
- **Ambiguous, or a full migration ask** → lead with a compact design so the mapping can
  be sanity-checked before code is generated, then the matching code, clearly separated.
- **Building, checking build status, and deploying** are live actions against the user's
  own workspace — name them as next steps/checklist items rather than executing them
  yourself, since they need the user's real credentials.

## Conversational design heuristics (apply regardless of deliverable)

- Keep voice prompts short — a `basic` node message that reads fine on screen often
  doesn't over a call. Flag prompts trying to do too much in one turn.
- Every `user_input`/`user_choice` node needs a plan for no-input, no-match, and "I want a
  human." Don't leave these to silent platform defaults — say what happens.
- Sensitive capture (`sensitive: true` on a slot, `isSensitive` on a modality field)
  should pair with masking/guardrail coverage on the output side too — capturing PII
  safely doesn't help if a later node echoes it back unmasked.
- Prefer a Data Request + Context Variable over duplicating the same lookup logic across
  multiple flows.
- Treat anything with regulatory weight (recording disclosure, payment collection) as a
  compliance artifact, not a copywriting one — don't silently reword it.

## Where the documentation stops (do not fill these in from memory)

Some shapes are genuinely not specified in the ACXD docs. They're easy to write
confidently and wrongly, because they look like fields from Lex, Dialogflow, or classic
Connect — platforms with similar concepts and different schemas. When a task needs one of
these, write the parts that *are* documented, leave the undocumented part clearly marked,
and say plainly that the shape needs confirming against the workspace (a `GetFlow` call
on an existing flow built in the Canvas is the fastest way to see the real structure).
Being visibly uncertain here is far more useful than a plausible invention the user only
discovers at build time.

The known gaps:

- **Per-node `metadata`.** Documented only as free-form and node-type-dependent —
  "contains configuration like `generativeText`, `choice`, `redirect`, `knowledgeBase`,
  `loop`, `multimodal`, `stateModifications`, `tags`, `name`, `timeout`". The field names
  *inside* those objects are not published. So don't write `metadata.choice.slotTypeId`
  or similar as if it were known.
- **`childNodes[].conditions`.** The array is documented; the condition objects inside it
  are not. (Note the Roles condition-catalog syntax in
  `workspace-admin-and-governance.md` is a *different* system — don't assume flow-node
  conditions reuse it.)
- **Built-in slot types.** Slot Types docs cover custom ones only. Whether ACXD ships
  `AMAZON.*`-style built-ins, and under what names, isn't stated — so an attached slot's
  `type` referencing a built-in is a guess unless the user confirms it.
- **How a `user_choice` node binds to its slot type**, and how `choicePayload` surfaces at
  runtime. The pieces are documented separately; the wiring between them is not.

The rest of the SDK — every operation's inputs, outputs, and errors — is well specified
in the reference files, so this caution applies narrowly to the items above, not as a
general hedge on ACXD code.

## Error handling

ACXD errors share one shape: `{ type, message, ...resource identifiers }`.
`ThrottlingException` and `InternalServerException` are already retried by the SDK with
backoff — don't layer your own retry loop on top of those. Full list and when each fires:
`references/auth-errors-common-types.md`.

## Reference files

Load only what the task needs:

- `references/flows-and-nodes.md` — Flow CRUD, every node `type`, Attached Slot, Flow
  Node fields. Read before writing any flow/node JSON.
- `references/applications-builds-deployments.md` — Application CRUD + settings
  (`defaultFlows`, `lifecycleHooks`, `thresholds`, `clusters`), Application Builds,
  Application Deployments.
- `references/connect-customer-bridge.md` — How a classic Amazon Connect contact flow
  hands off to an ACXD application: the Agentic CX block, voice persona, speech
  recognition, audio filler, idle chat timeout, and publishing. Read this whenever the
  request is about cutting a live IVR over, not just building the ACXD side.
- `references/guardrails-and-knowledge-bases.md` — Guardrail CRUD + rules/detection/
  enforcement, `TestGuardrail`, `ListGuardrailEvents`, Knowledge Base CRUD + publishing +
  response config, Knowledge Base Articles, Knowledge Base Documents.
- `references/data-context-slots-modalities.md` — Data Request/webhook CRUD, Context
  Variables, Slot Types, Modalities.
- `references/auth-errors-common-types.md` — Programmatic user + API key setup, API
  Tokens, common errors, and shared types (metadata, pagination, languageCode/
  languageCodes).
- `references/workspace-admin-and-governance.md` — Workspaces, Team, Users, Roles +
  permissions/conditions, Secrets, Trails (audit), Versions (resource history). Read this
  for anything about who-can-do-what, credential/secret management, or auditing changes.
- `references/observability-and-analytics.md` — Conversations (transcripts), Logs
  (QueryLogs), Analytics Tags. Read this for anything about reviewing live conversation
  behavior, containment/escalation rates, or post-migration monitoring.
- `references/live-sync-and-touchpoint.md` — Live Sync Scripts and the Touchpoint web
  widget, for the web chat/voice-on-a-webpage side of omnichannel migrations (distinct
  from phone IVR).
- `references/migration-playbook.md` — The full IVR→ACXD mapping table, containment/
  escalation config recipes, and a worked before/after example.
