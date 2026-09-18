# IVR → Agentic CX Designer: Build Spec

## The problem

Migrating an IVR onto ACXD is currently manual, slow, and requires someone who knows both
the legacy platform and ACXD's SDK well. That combination is rare. The work is also highly
repetitive — the same handful of patterns (menu, capture, data dip, transfer, containment
rule) recur in nearly every IVR ever built.

Repetitive work requiring rare expertise is exactly what's worth automating.

## Architecture

The core decision is a **canonical intermediate model**. Without it, supporting N source
platforms against ACXD means N converters, each carrying full ACXD knowledge. With it:

```
  Connect flow JSON ─┐                                          ┌─▶ contact-flow.json
  Lex bot export ────┼─▶ parse ─▶ IvrModel ─▶ design ─▶ AcxdPlan ┤      (console import)
  Genesys / Avaya ───┤             ▲                      │      └─▶ migrate.ts
  Script / PDF ──────┘        (canonical)        human review gate      (user runs it)
```

N parsers, one designer, one emitter. New source platforms cost a parser. ACXD expertise
lives once.

### Inputs: a Connect IVR is two files, not one

When a Connect IVR uses a Lex bot — and a conversational one always does — the flow
export and the bot export hold **disjoint halves of the same conversation**:

| Contact flow JSON | Lex bot export |
|---|---|
| "invoke the bot at this alias ARN" | intents + sample utterances |
| branch on the returned intent name | slots, their prompts, their retry counts |
| queue / transfer / routing after the branch | slot types, values, **synonyms** |
| | confirmation and closing prompts |
| | fulfillment / dialog Lambda hooks |

Parse the flow alone and you get a routing skeleton — *"call bot X, branch on `PayBill`
/ `CheckBalance`"* — the intent **names** and nothing else. No utterances, no slot
prompts, no validation. That is exactly the conversational layer ACXD exists to hold, so
a flow-only migration produces a shell. **Without the Lex export there is no
conversational customer experience to migrate.**

So the parser takes two inputs and stays pure:

```ts
(flowJson: unknown, lexExport?: unknown) => IvrModel
```

Lex is optional — a pure-DTMF IVR has no bot — but when a flow references a bot alias
and no export was supplied, that is a first-class coverage gap, never a silent pass.

#### The join

The two files are correlated deterministically, in two hops:

```
flow block ──(bot alias ARN)──▶ Lex bot
     │
     └──(branch condition = intent name)──▶ Intent ──▶ slots, utterances, prompts
```

Every way the join can fail is surfaced, never guessed:

| Case | Handling |
|---|---|
| Flow references a bot that wasn't uploaded | `requiresReview` — "upload the export for alias X" |
| Flow branches on an intent absent from the bot | Dangling reference — surfaced |
| Bot has intents the flow never branches on | Orphan intents — a human decides if they're dead |
| Flow references 2+ bots | Multi-upload; the model holds `bots[]` |
| Alias ARN differs by account/region | Name-based fallback match, flagged as heuristic |

### Layers

| Layer | Input | Output | Deterministic? |
|---|---|---|---|
| Parse | Source export | `IvrModel` | Yes — pure function, testable |
| Design | `IvrModel` | `AcxdPlan` | Mostly; LLM for judgment calls |
| Review | `AcxdPlan` | Approved `AcxdPlan` | Human |
| Emit | `AcxdPlan` | SDK code / API calls | Yes |

Keeping parse and emit deterministic means the same input always produces the same output,
which is what makes the tool trustworthy for something as consequential as a contact
center cutover. The LLM's role is bounded: naming, synonym generation, and recommending
upgrades beyond literal parity — never structural translation.

## The canonical model

```ts
export interface IvrModel {
  /** One entry per uploaded artifact — a flow export plus zero or more bot exports. */
  sources: Array<{
    platform: 'amazon-connect' | 'amazon-lex';
    kind: 'contact-flow' | 'lex-bot';
    name: string;
    importedAt: string;
  }>;
  entryNodeId: string;
  nodes: Record<string, IvrNode>;
  /** Conversational assets the contact flow references but does not contain. */
  nlu?: NluModel;
  /** Behavior that belongs upstream of ACXD, not inside it. */
  routing: RoutingConfig;
  /** Global conversational behavior the legacy IVR enforced. */
  containment: ContainmentConfig;
  languages: string[];
  coverage: CoverageReport;
}

export type IvrNode =
  | PromptNode | MenuNode | IntentNode | CaptureNode | LookupNode
  | BranchNode | TransferNode | SetVarNode | WaitNode
  | LoopNode | EndNode | UnknownNode;

interface PromptNode {
  kind: 'prompt';
  id: string;
  text: string;
  /** True when wording is regulated and must survive migration byte-for-byte. */
  compliance: boolean;
  next?: string;
}

interface MenuNode {
  kind: 'menu';
  id: string;
  prompt: string;
  options: Array<{ key: string; label: string; next: string }>;
  timeoutSeconds?: number;
  maxAttempts?: number;
  next?: string;
}

/**
 * A `GetParticipantInput` backed by a Lex bot. Distinct from `MenuNode` because the two
 * diverge at the ACXD end (`intent_capture` vs `user_choice`) — keeping them separate
 * stops the designer having to sniff a flavour out of an overloaded node.
 */
interface IntentNode {
  kind: 'intent';
  id: string;
  botRef: string;             // bot alias ARN exactly as written in the flow
  cases: Array<{ intent: string; next: string }>;
  resolved: boolean;          // did the join find this bot among the uploads?
  next?: string;
}

interface CaptureNode {
  kind: 'capture';
  id: string;
  prompt: string;
  variable: string;
  validation?: { regex?: string; minLength?: number; maxLength?: number };
  sensitive: boolean;         // drives ACXD `sensitive` + masking guardrail
  next?: string;
}

interface LookupNode {
  kind: 'lookup';
  id: string;
  system: string;             // e.g. Lambda ARN or service name
  requestVars: string[];
  responseVars: string[];
  next?: string;
  onError?: string;
}

interface BranchNode {
  kind: 'branch';
  id: string;
  on: string;                 // variable or expression source
  cases: Array<{ when: string; next: string }>;
  default?: string;
}

interface TransferNode {
  kind: 'transfer';
  id: string;
  target: { type: 'queue' | 'flow' | 'number'; ref: string };
}

interface UnknownNode {
  kind: 'unknown';
  id: string;
  sourceType: string;         // the original Action Type
  raw: unknown;               // preserved verbatim
  next?: string;
}

interface RoutingConfig {
  /** Stays in the Connect contact flow, upstream of the Agentic CX block. */
  hoursOfOperation?: unknown;
  queueAssignments: string[];
  recordingBehavior?: unknown;
  voice?: { provider?: string; voiceId?: string };
}

interface ContainmentConfig {
  maxInvalidAttempts?: number;   // → thresholds.incomprehensionCount
  repeatOnInvalid?: boolean;     // → repeatOnIncomprehension
  onExhausted?: string;          // → defaultFlows.fallback target
  globalCommands: Array<{ key: string; intent: 'agent' | 'repeat' | 'help'; target?: string }>;
}

/** Everything the bot export contributes that the flow cannot know. */
interface NluModel {
  bots: Array<{
    ref: string;              // alias ARN or name, used as the join key
    name: string;
    locales: string[];
    confidenceThreshold?: number;
    intents: NluIntent[];
    slotTypes: NluSlotType[];
  }>;
}

interface NluIntent {
  name: string;
  utterances: string[];
  slots: Array<{
    name: string;
    slotType: string;
    prompt?: string;
    required: boolean;
    maxRetries?: number;
    sensitive: boolean;
  }>;
  confirmationPrompt?: string;
  closingResponse?: string;
  fulfillmentHook?: string;   // Lambda ARN → becomes a Data Request
  dialogHook?: string;        // needs judgment — always requiresReview
}

interface NluSlotType {
  name: string;
  builtIn: boolean;           // built-in → TODO(acxd-schema), name is unpublished
  values: Array<{ value: string; synonyms: string[] }>;
}

/**
 * Coverage is two-dimensional. A run that maps every flow block but resolves none of the
 * bot's intents is not a 100% migration, and a single percentage would report it as one.
 */
interface CoverageReport {
  flow: { totalActions: number; mapped: number; unknown: Array<{ id: string; sourceType: string }> };
  nlu: { totalIntents: number; resolved: number; orphaned: string[]; dangling: string[] };
  /** Things a human must decide, not defects. */
  requiresReview: Array<{ nodeId: string; reason: string }>;
}
```

`UnknownNode` and `CoverageReport` are the honesty mechanism. A migration tool that claims
100% coverage is lying; one that says "94 of 100 blocks mapped, here are the 6 that need
you" is usable.

## Amazon Connect block mapping

**Verify these Action Type strings against a real export before trusting the parser.**
They're written from general knowledge of Connect's flow JSON and may drift by version.

| Connect Action Type | IR node | ACXD outcome |
|---|---|---|
| `MessageParticipant` | `prompt` | `basic` node |
| `GetParticipantInput` (DTMF options) | `menu` | `user_choice` + Slot Type, `choicePayload` = digit |
| `GetParticipantInput` (Lex bot) | `intent` | `intent_capture` — already NLU, join to the bot export |
| `StoreUserInput` | `capture` | `user_input` + attached slot (+`sensitive` if encrypted) |
| `InvokeLambdaFunction` | `lookup` | Data Request (`external` webhook) + `data_request` node |
| `CheckAttribute` / `Compare` | `branch` | `choice` or `split` node |
| `CheckHoursOfOperation` | `routing` | Stays in contact flow |
| `UpdateContactAttributes` | `setVar` | `define` node / Context Variable |
| `TransferContactToQueue` | `transfer` | `escalate` node |
| `TransferToFlow` | `transfer` | `redirect` or `application_handoff` |
| `SetWorkingQueue` | `routing` | Stays in contact flow |
| `UpdateContactRecordingBehavior` | `routing` | Stays in contact flow |
| `UpdateContactTextToSpeechVoice` | `routing.voice` | `languageSettings[].voice` |
| `Wait` | `wait` | `wait` node |
| `Loop` | `loop` | `loop` node |
| `DisconnectParticipant` | `end` | `end` node |
| *anything else* | `unknown` | Surfaced in coverage report |

Detection rules worth building in:

- **Compliance prompts** — a `MessageParticipant` whose text matches recording/consent
  patterns gets `compliance: true` and becomes read-only downstream.
- **PCI scope** — a `StoreUserInput` with encryption parameters set implies card capture:
  force `sensitive: true` and require a masking guardrail in the plan.
- **Containment** — a menu's retry/error transitions looping back to itself reveal the
  "N invalid attempts" rule. Extract it into `ContainmentConfig` rather than reproducing
  the loop structurally; ACXD handles it as application settings.
- **Language branches** — a menu option that only sets a language and re-enters the menu
  is not a menu option in ACXD. Collapse it into `languages[]`.

That last pair matters: naive structural translation would reproduce retry loops and
language menus as flow nodes, which is exactly the "1:1 port that under-uses the platform"
failure the skill warns about.

## Lex bot mapping

A Lex-sourced IVR is **already NLU**, so "design beyond parity" mostly doesn't apply to
it. The upgrade recommendations shift from *"collapse this DTMF tree"* to *"these three
intents have two utterances each and will misfire."*

| Lex V2 | ACXD outcome | Note |
|---|---|---|
| Bot / BotLocale | Application + `mainLanguageCode` / `languageCodes` | |
| Intent | `intent_capture` target, or its own flow | |
| Sample utterances | The intent's training phrases | The actual NLU payload |
| Slot | `user_input` + Attached Slot | |
| Slot elicitation prompt | The `user_input` node's message | |
| Custom slot type + synonyms | ACXD Slot Type | Synonyms map ~1:1 — the cleanest transfer in the migration |
| Built-in slot type (`AMAZON.*`) | `TODO(acxd-schema)` | Gap #3 — ACXD built-in names are unpublished |
| Slot `maxRetries` | `thresholds.incomprehensionCount` + `repeatOnIncomprehension` | App-level, not per-node |
| `confirmationSetting` | A `user_choice` confirmation turn | |
| `fulfillmentCodeHook` (Lambda) | Data Request + `data_request` node | Same shape as a flow-level dip |
| `dialogCodeHook` | Judgment call — `requiresReview` | Often decomposes into several `data_request`s |
| `intentClosingSetting` | `basic` node | |
| `AMAZON.FallbackIntent` | `defaultFlows.fallback` | |
| Session attributes | Context Variables | |
| `nluIntentConfidenceThreshold` | Not a mapping — feeds the NLU-confidence risk item | |

Because Lex slot types already carry human-authored synonyms, a Lex-sourced migration
gets synonym generation **for free** — and copied synonyms beat generated ones, because
someone who knew the business wrote them.

## The deliverable

**ACXD has no import path.** The SDK surface is ~110 operations and none of them ingest
an application definition; the only file upload in the entire API is
`PutKnowledgeBaseDocument`, for knowledge-base source documents. ACXD resources are
created by API call, in dependency order.

Amazon Connect *contact flows* do have console import/export — that is where the input
comes from, and it is also how half the output lands. The capability does not extend to
ACXD, which is a separate product with an API-only lifecycle.

So a migration produces **two downloadable artifacts**:

| Artifact | Contents | How the user applies it |
|---|---|---|
| `contact-flow.json` | Trimmed contact flow — hours, queues, recording, voice, plus the Agentic CX block | Import in the Connect console |
| `migrate.ts` | Ordered `Create*` calls for every ACXD resource, then build + deploy | Runs it themselves, with their own key |

**The POC needs no credentials of any kind.** Parse, design, and emit are pure functions
over uploaded files and run entirely client-side. The user's ACXD key never leaves their
own terminal — we never store it, proxy it, or see it. That is not a security measure
bolted on; it falls out of the architecture.

## Milestones

**M1 — Parser.** Connect JSON + Lex export → `IvrModel`. Fixtures for a simple menu, a
nested menu, a flow with a Lambda dip, a flow containing at least one unhandled Action
type, a Lex-backed flow with its bot export, and the same flow with the bot **missing**.
*Done when:* parsing a real exported flow produces a two-dimensional coverage report and
never throws on unrecognized input.

**M2 — Designer.** `IvrModel` → `AcxdPlan`: slot types, data requests, guardrails, flows,
application settings, plus a risk list and upgrade recommendations. Deterministic mapping
first; LLM second, only for naming, synonyms, and beyond-parity suggestions.
*Done when:* the utility-billing example produces a plan a human reviewer agrees with.

**M3 — Emitter.** `AcxdPlan` → the two artifacts above. `migrate.ts` in correct
dependency order (slot types → secrets → data requests → guardrails → flows →
application → build → deploy), plus the trimmed `contact-flow.json` carrying the routing
that stays upstream. `TODO(acxd-schema)` markers wherever shapes are unconfirmed.
*Done when:* generated code is syntactically valid TypeScript and orders resources so no
reference precedes its definition.

**M4 — UI.** Upload → coverage report → plan review → export code. This is the
stakeholder demo. Match the Figma design.
*Done when:* someone non-technical can run a flow through it unaided.

**M5 — Live emit (post-POC, needs API key).** Execute against a real workspace, poll
build status, surface validation errors, deploy to `development`. Behind the review gate.

M1–M4 need no ACXD credentials at all, which is why the POC is achievable before the key
question is resolved — and why "get a key" is not on the critical path.

## Stack

Currently Vite + React + TypeScript (`Website/`), with the core as pure TypeScript under
`Website/src/core/` — no React, no I/O, no network. Vitest for parser fixtures.

Next.js was the original call, to get a server side for the eventual API key. Deferred:
M1–M4 need no server, because nothing in the POC holds a credential. Revisit at M5, when
live emit actually needs one.

### Where the LLM sits

The design layer is a large deterministic core with three narrow holes in it. The LLM
does naming, synonym generation, and beyond-parity recommendations — and nothing else.
It never chooses a node type; that stays in the mapping table, because structural
translation must be reproducible, fixture-testable, and impossible to get silently
wrong.

Enforced by types rather than convention — the LLM never returns an `AcxdPlan`, only
small typed patches that deterministic code validates and applies:

```ts
nameResources(plan)               => Record<string, string>
generateSynonyms(values, context) => Record<string, string[]>
recommendUpgrades(model, plan)    => Recommendation[]   // advisory, never mutates
```

**The test of whether it's bounded:** delete every LLM call and you still get a complete,
valid, deployable plan — just with mechanical names and no synonyms.

The POC ships **deterministic-only**, since a browser-side LLM call means a provider key
in the browser. Risks stay rule-based and are unaffected.

Figma stays the design source for the UI. Export the design and rebuild it as React
components — a Figma-hosted page cannot hold a credential or run the parser.

## What good looks like

The tool should be honest about what it doesn't know. A migration that surfaces six
ambiguous blocks and explains them is more valuable than one that silently guesses and
produces a flow that fails validation — or worse, one that passes validation and quietly
drops a compliance disclosure.
