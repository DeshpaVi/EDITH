# CLAUDE.md

Project context for Claude Code. Read this before any task in this repo, then `docs/HANDOFF.md`.

## What we're building

A web application for **delivery consultants** that turns a **customer journey** into a working
Amazon Connect + **Agentic CX Designer (ACXD)** implementation on AWS.

The consultant uploads a customer journey in **any form** (a diagram or slide deck, text, an IVR export, and
later more). The app understands it, works out what must be built, and shows a **checklist** (a DynamoDB table?
a Lambda? a contact flow? which ACXD resources? which hand-back attributes?). The consultant selects what the
customer wants. The app then generates a **CloudFormation template** with the target identifiers as
parameters (Connect instance ID, ACXD workspace ID, and so on). The consultant deploys the template with their
own AWS credentials, and the resources exist for testing.

The differentiator is that **ACXD resources are created too**: secrets, data requests, context variables,
slot types, guardrails, flows and the application. ACXD has no import path and no native CloudFormation
resource types (to our knowledge); its resources are created by ordered SDK `Create*` calls with an API key.
So the template carries a **Lambda-backed custom resource** that calls the ACXD SDK in dependency order,
idempotently, and handles stack deletion.

**Two ways to deploy:** download the bundle and deploy it with the AWS CLI (the ACXD key is a `NoEcho` parameter), or deploy
from the app through `Website/deployer-api`: a backend that previews a change set, requires an explicit confirmation, and
runs it in the target account through a customer-created role. In that mode the ACXD key never passes through the app: the
template takes the ARN of a secret the consultant creates in the target account.

**Initial services:** ACXD, Amazon Connect (contact flow), DynamoDB, Lambda (plus IAM and Secrets Manager
they need). Other backends and channels come later; do not hard-code the model to these.

**First slice:** journey in, checklist out, using the **Census CQA demo** as the test case (diagram in
`docs/cqa-demo/`, real built flows in `.claude/skills/ivr-to-acxd-migration/references/verified-exports/`).

**Existing code:** the repo already has parsers for **Amazon Connect contact flow JSON plus the Lex bot
export** (`Website/src/core/parse`, `design`, `emit`). Keep that as a second input path. When it is used, both
files matter: a referenced-but-missing bot export is a coverage gap, never something to work around (see
`SPEC.md`).

## The domain skill

`.claude/skills/ivr-to-acxd-migration/` holds the ACXD expertise. **Consult it before writing any code that
generates ACXD, Connect or Lambda resources.** Start with:

- `references/verified-console-and-export-findings.md`: **ground truth** for node behaviour and JSON shapes,
  verified against a real workspace. It overrides the documentation-derived references where they differ.
- `references/worked-example-census-cqa.md`: a full diagram-to-working-build migration with every
  misconfiguration and fix, and pattern library P1 to P8, which the design and emit layers should reproduce.
- `references/verified-exports/`: real flow, guardrail and Connect exports (sanitized), usable as fixtures.

Prefer the skill over recalled knowledge of Lex, Dialogflow or classic Connect, which have similar concepts
and different schemas.

## Hard constraints

These are not style preferences. Violating them produces a tool that fails in ways users discover late and
expensively.

1. **Never hardcode or client-expose an ACXD API key.** Keys are `acxd_live_<prefix>.<secret>` and carry full
   workspace access. The app never stores one. In the generated template the key is a **`NoEcho` parameter**
   that lands in **Secrets Manager**; the custom resource reads it at deploy time. No key in a React
   component, a published page, a committed file or a generated template body.
2. **Never invent undocumented ACXD schema.** Emit only node types and fields confirmed in the skill's
   verified findings. For anything else (`user_choice`, `user_input`, `knowledge_base`, `define`, `transform`,
   other state-modification operations, the `mask` guardrail action, the Connect Set voice block) generate an
   explicit `// TODO(acxd-schema):` marker or a template-level note saying what must be confirmed. A plausible
   guess that fails at deploy time is worse than a visible gap.
3. **Never silently drop an unrecognized input element.** A journey step, branch, prompt or requirement the
   app cannot map becomes a `requiresReview` entry in the checklist and the report. The same applies to the
   Connect-flow/Lex join: a bot reference that resolves to nothing, an intent branch with no matching intent,
   or an intent the flow never reaches is a `requiresReview` entry, never a guess and never a silent drop.
4. **Never paraphrase compliance text.** Prompts, recording disclosures, consent language and regulated
   wording are copied byte-for-byte from source to output, typos included. If a transform would alter them,
   flag for review. Only the owner decides to correct wording.
5. **Human review gate before anything is created.** The consultant reviews the checklist and the generated
   template before deploying. No code path creates AWS or ACXD resources on its own. The deployer enforces this on the
   server: a change set is previewed first, and execution needs a signed, expiring token bound to that exact change set.
   The backend deploys only templates this tool generates (an allowlist of resource types and IAM actions) and only stacks
   it tagged itself.
6. **Hosting needs a backend.** The site will be hosted on S3/CloudFront (last step), which is static. Anything
   that needs a secret (LLM calls for understanding a journey, any AWS call) must run behind a small backend
   (API Gateway + Lambda), never in browser code.

## Conventions

- TypeScript throughout, `strict: true`. The canonical model is the contract between layers: type it
  precisely and derive from it, don't restate shapes.
- Pipeline: `ingest` (any journey format to a **journey model**) → `design` (journey model to a plan and
  checklist; LLM calls allowed **here only**) → `emit` (plan plus selections to a CloudFormation template; fully
  deterministic and reproducible). The existing Connect/Lex parsers are pure functions `(sourceJson) => IvrModel`
  and stay that way.
- The LLM output is **structured and validated**; unmapped content becomes `requiresReview`, never a guess.
- Every parser, mapper or emitter change ships with a fixture or test. The Census CQA journey and exports are
  the primary fixtures.
- Input field names carry `// TODO(source-schema):` where they are unverified against a real export. Output
  schema gaps carry `// TODO(acxd-schema):`.

## Working notes

- The ACXD flow JSON for `start`, `basic`, `escalate`, `redirect`, `loop`, `split`, `data_request`,
  `generative_text` and `generative_journey` nodes is now **confirmed** from four real flows. Still unconfirmed:
  the nodes listed in constraint #2, and export shapes for applications, data requests, slot types and context
  variables. Asking for one export of each is the fastest way to close the remaining gaps.
- Amazon Connect contact flow JSON for the Agentic CX block is confirmed. The CloudFormation resource for a
  Connect contact flow and whether it accepts the Agentic CX block are **not yet verified**: confirm before the
  emitter relies on them.
- Lex has two export formats in the wild: **V2** (a ZIP: `Manifest.json`, `Bot.json`,
  `BotLocales/<locale>/Intents/<name>/Intent.json`) and **V1** (a single flat JSON with `resource.intents[]`).
  Detect and support both; don't assume V2.
- Journey extraction: a `.pptx` is read deterministically as shapes and arrows in the browser; a model (Bedrock, behind
  `Website/extractor-api`) only interprets it. The model's output is validated, repaired by the model, and every prompt is
  checked against the source wording. The model call itself has not run against a live Bedrock yet.
- Spanish (language detection and switching in an ACXD-only design) is unverified. French is deferred.
- The website now has a landing page (`Website/src/site`) and a workspace shell (`Website/src/app`) behind hash routes; the product name
  (JourneyForge, owner TTEC Digital) is set in `site/brand.ts`. Hosting on S3/CloudFront is `Website/hosting` (private bucket, CloudFront, Basic-auth login: demo-grade only).
