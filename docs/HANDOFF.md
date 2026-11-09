# EDITH Handoff: where we are (2026-11-09)

> Update (same day): the product direction changed. `CLAUDE.md` now describes a journey-in, CloudFormation-out
> app for delivery consultants; the first slice is journey in, checklist out, with the Census CQA demo as the test case.

Fresh handoff. It replaces the earlier "ACXD Implementation Handoff" doc, whose open questions are now
answered. Read this, then `CLAUDE.md`, then the skill (`.claude/skills/ivr-to-acxd-migration/`).

## 0. Slice 1 status (journey in, checklist out)

Built in `Website/src/core/` (pure TypeScript, no UI yet):
- `journey/`: the **journey model** (`model.ts`), a collecting validator (`validate.ts`), the extractor port with
  the rules an LLM extractor must follow (`extract.ts`), and the Census CQA journey fixture
  (`fixtures/census-cqa.journey.json`, authored from the diagram and our decisions).
- `checklist/`: deterministic rules (`rules.ts`), assembly, summary and selection (`build.ts`), a Markdown report
  (`report.ts`), and tests. The rules encode patterns P1 to P8 from the skill. Every item says why it exists, what the
  consultant supplies, and whether the emitter can generate it from **confirmed** schema; anything unconfirmed or
  unmappable becomes a `requiresReview` entry.
- Output for the Census journey: `docs/cqa-demo/CHECKLIST.generated.md` (22 items, 1 blocker: language detection).

Verification caveat: this sandbox cannot reach the npm registry, so **vitest could not be installed here**. The new
code is strictly type-checked with the global `tsc`, and its tests (43) pass under a local stand-in for vitest kept
outside the repo. Run `npm test` and `npm run typecheck` in `Website/` on a machine with registry access before
trusting the result. The existing parser/design/emit code was not touched.

## 0b. Slice 2 status (emitter)

Built (pure TypeScript in `Website/src/core/emit/`, plus `Website/provisioner/`):
- `acxd/`: deterministic ids, a `FlowBuilder` that writes only confirmed node shapes, builders for the Escalation,
  Safety, Authentication and Main flows, and `buildAcxdSpec` (context variables, data request, secret reference,
  guardrails from supplied wording, application settings). **Golden tests compare generated flows with the real
  exports** (Escalation, SafetyEscalation, Authentication) after documented normalisations; mutating the builder
  makes them fail.
- `cfn/`: `buildTemplate` (DynamoDB table with an index per identifier, IAM roles, the verification Lambda inline with
  a Function URL, Secrets Manager, the provisioner, and one `Custom::AcxdProvision` carrying the spec as a single JSON
  string) and the generic verification Lambda source (under the 4096-character inline limit, enforced by a test).
- `connect/agenticContactFlow.ts`: contact-flow JSON for the Agentic CX block, checked against the real export.
- `bundle.ts` + `readme.ts`: `emitBundle(journey, selection, options)` returns `template.json`, `acxd-spec.json`,
  `README.md` (deploy steps), the provisioner, and `skipped` / `warnings` / `blockers` / `consoleSteps`.
- `Website/provisioner/`: the custom-resource handler (create or update by name, reverse delete, no secrets logged).
  13 tests on the real Node test runner: `npm run test:provisioner`.
- Example output for the Census journey: `docs/cqa-demo/generated-bundle/`.

Verification caveats (read these):
- Vitest could not be installed here (registry blocked). 95 tests under a local vitest stand-in pass and the code is
  strictly type-checked with the global `tsc`. Run `npm test` and `npm run typecheck` in `Website/` before trusting it.
- **Nothing here has run against a live AWS account or ACXD workspace.** The first deployment is the real test.
  Unverified: the ACXD SDK command shapes the provisioner uses (names follow the documented pattern; secret, guardrail and
  application identifier semantics are guesses), whether `amazon-connect-acxd-sdk` installs from `latest` (pin it),
  and the `InvokedViaFunctionUrl` Lambda permission property.
- Not generated (reported in `skipped`): knowledge base creation, languages/voices/translations, the SDK key for the
  Incomprehension default (console step), the Connect Set voice block, build and deploy of the ACXD application.

**Finding to check in the Census workspace:** the exported Authentication flow redirects to `NLX.Escalation` (the
system default) rather than to the flow named `Escalation`. Our `Escalation` flow, which generates `transferSummary`,
may therefore not run on the authentication-failure path (it is set as the Fallback and Incomprehension defaults). Check
the Debugger on a failed authentication: does the Generative text run, and does `transferSummary` reach the agent? The
emitter redirects to the `Escalation` flow by id.

## 0c. Slice 3 status (checklist and bundle UI)

Built in `Website/src/implementation/` and added to the page as `<ImplementationSection />` (after the IVR migration section):
1. **Journey:** load the Census CQA example or upload journey JSON (validated, errors shown with paths). Diagram and deck
   upload arrives with the extractor.
2. **Checklist:** required items locked, recommended switchable, dependencies kept with a plain-language notice, schema status
   badges, "needs a human decision" first, assumptions collapsed.
3. **Bundle:** details form (application name, table, identifier attributes, knowledge base id, safety message, main prompt,
   guardrail wording), then generate, preview any file, download one file or everything as a zip. Skipped items, warnings,
   blockers and console steps are listed.
4. **Connect flow:** form for the ids that exist only after deployment, validated, then generate and download the contact flow.
The ACXD API key is never requested or shown anywhere.

Structure: all logic is in `controller.ts` (pure, 25 tests); `theme.ts` holds every colour and style; `ui.tsx` the primitives;
`ImplementationSection.tsx` the screens. A look-and-feel rework only touches `theme.ts` and `ui.tsx` (and the layout in the
section file).

Verification: React and Vite could not be installed here, so the UI has **not** been built with Vite or run in a real React.
The components type-check against a loose stand-in for React's types, and were driven end to end (load, toggle, generate,
preview, validation errors, contact flow) with a throwaway test renderer and screenshotted in Chromium. Run
`npm run dev` and click through once on a machine with the dependencies. The `zipFiles` test ran against a stand-in for
`fflate`, so it should be re-run for real.

## 0d. Slice 4 status (the extractor)

Turns an uploaded diagram, deck, document, PDF, image or text file into the journey JSON the tool already consumes.
Two stages, so the model interprets a clean structure instead of guessing from pixels:
1. **Deterministic reading in the browser** (`Website/src/core/journey/source/`): a small XML reader, `.pptx` read as a
   flow graph (shapes, theme colours mapped to the legend, every arrow with its start and end shape, branch labels
   matched to the arrow that leaves nearest, unattached arrows guessed from where their free end lands and labelled as
   heuristics), `.docx` text, text files; images and PDFs stay binary. Tested on the real Census deck: 22 arrows, 2
   unattached ones resolved correctly, Y/N labels on the right branches.
2. **A thin backend** (`Website/extractor-api/`): a Lambda Function URL in front of Amazon Bedrock Converse with a forced
   tool call, temperature 0, bearer-token auth, size limits, no content logged. The prompt and the JSON schema are fixed in
   `contract.mjs`, shared with the browser, so the endpoint is not a general model proxy. `template.json` deploys it.
   21 tests on the real Node test runner (`npm run test:extractor`).
3. **A pipeline in the browser** (`core/journey/extract/`): validates the model's answer, sends the problems back for a
   corrected answer (up to 3 attempts; we never patch the answer ourselves), then **checks every prompt against the source
   wording** (exact, typographic-only, or missing) and records the result in the journey, so it appears in the checklist.
   The UI (step 1) has the upload, URL, token (memory only) and notes fields, and shows how the journey was read.

Verification caveats: the model call has **never run against Bedrock**. Unverified: the Bedrock model id (deliberately not
defaulted; confirm it), that Converse returns the forced tool call in the shape the code expects for your model, image/PDF
reading quality, and the `InvokedViaFunctionUrl` permission property. A deck with grouped shapes ignores group transforms.
Visio, legacy `.ppt`/`.doc` are rejected with guidance. Auth is one shared bearer token (demo-grade): add a real authorizer
before wider use. The Census journey fixture uses straight quotes where the deck has curly ones; the wording check reports that.

## 0e. Slice 5 status (deploy from the app)

A **deployer backend** (`Website/deployer-api/`) and a **Deploy step** in the UI. The consultant prepares a deployable ("managed")
bundle, connects to the deployer, picks a target account, gives the ACXD workspace id and the ARN of a secret that holds the
API key (in the target account), previews a CloudFormation change set, ticks a review, types the stack name back, and
deploys; the screen then follows progress and offers the Connect flow prefilled with the stack outputs. A typed confirmation
also guards deleting the stack.
- Template mode `managed` (`buildTemplate({ mode: 'managed' })`): no API-key parameter, the key comes from a secret ARN; the
  provisioner package comes from an artifacts bucket; IAM roles live under the path `/edith/`.
- Server-side gate (`confirm.mjs`, `policy.mjs`): signed expiring token bound to the change set; allowlist of resource types
  and IAM actions; only `edith-*` stacks tagged `edith-managed`; no `NoEcho` parameters; no content in logs.
- Customer onboarding: `customer-role.template.json` (deploy role with an ExternalId, plus the CloudFormation stack role);
  `deployer-api/README.md` has the full setup, the security model and the limits.
- 32 deployer tests on the real Node runner (`npm run test:deployer`); 26 browser-side tests; the UI was driven end to end
  against a fake deployer (preview, refusals, confirmation, execute, status, prefilled Connect flow, delete).

**Nothing has run against a real AWS account.** First deployment will show: the exact IAM permissions CloudFormation needs
for these resources, cross-account read of the provisioner package, `InvokedViaFunctionUrl`, and the ACXD SDK calls.
Auth is one shared bearer token (demo-grade). Review the customer role before installing it anywhere real. Templates over
51,200 bytes now go through S3 (see 0h).

## 0f. Visio support

`.vsdx` drawings are read like decks (`core/journey/source/vsdx.ts`): pages, shapes (groups flattened from their origin),
Visio shape types (Decision, Process, Terminator) as hints, text with paragraph breaks, fill colours, and edges from the
**connection records** (which shape each connector end is glued to), with connector labels and arrowhead direction. An
arrow glued at one end only is reported and its target guessed from the free end. The graph model is shared with the
PowerPoint reader (`deck.ts`); the source kind is `diagram` (the backend accepts it). Legacy binary `.vsd` is refused with
guidance. **Verified only against drawings built by hand in the tests**: run a real `.vsdx` through it before relying on it
(known gaps: group rotation and scaling, text that lives only in a master).

Not yet built: a Connect-side CloudFormation resource, grouped-shape transforms, a stronger authorizer, S3 template upload.

## 1. The product (unchanged, see `CLAUDE.md`)

EDITH is a web app (`Website/`, TypeScript) that migrates a legacy IVR onto Amazon Connect's Agentic CX
Designer (ACXD). v1 input: Amazon Connect contact flow JSON plus the Lex bot export. v1 output: a migration
design plus two files, `migrate.ts` (ordered SDK `Create*` calls) and `contact-flow.json` (Connect import).
No credentials, no writes to a live workspace, human review gate before any write. Layers:
`parse` (pure) → `model` (canonical) → `design` (LLM allowed here only) → `emit` (deterministic).

## 2. What happened this session

We configured, by hand and in a real workspace, a customer's call flow (the **Census CQA demo**) from a
client diagram, and tested it. That work is the **ground truth for the app's building blocks**. It was
captured in the skill so the design and emit layers can reproduce it.

| Deliverable | Where |
|---|---|
| Console configuration guide (written before testing; the worked example supersedes it where they differ) | `docs/cqa-demo/CONFIGURATION-GUIDE.md` |
| Demo auth Lambda + tests (DynamoDB lookup, `authValue` checked against three fields) | `docs/cqa-demo/verify-census-auth/` |
| Connect contact flow JSON (voice-ready variant of the client's export) | `docs/cqa-demo/contact-flow/CQA_ACXD_Call.json` |
| Verified console and export facts | `.claude/skills/ivr-to-acxd-migration/references/verified-console-and-export-findings.md` |
| Full worked example, misconfigs and fixes, pattern library P1 to P8 | `.claude/skills/ivr-to-acxd-migration/references/worked-example-census-cqa.md` |
| Sanitized real exports (flow, 3 guardrails, Connect flow) | `.claude/skills/ivr-to-acxd-migration/references/verified-exports/` |
| Corrections to older skill notes | `SKILL.md`, `references/migration-playbook.md`, `flows-and-nodes.md`, `applications-builds-deployments.md` |

State of the Census build (from the user's reports and screenshots):
- Working and tested in the ACXD Test tab: FAQ via knowledge base; enumeration request routed to
  Authentication; authentication on Census ID, zip, or last four (each alone); three failures then escalation;
  safety statement then 911/988 then escalation with a fixed summary.
- Reported done by the user without screenshots: the Connect flow import and publish.
- **Not done:** Spanish; a real phone call test; French (deferred by the user).

## 3. Key lessons that change the app (the important part)

1. **Node semantics differ from the documentation-derived references.** User input is a routing node; User
   choice is list selection; free-form capture is a Generative Journey with Data capture. Defaults are
   Welcome / Fallback / Unknown / Incomprehension (no Escalation default). Details in the verified-findings file.
2. **What we can now emit confidently:** flow JSON for `start`, `basic`, `escalate` (with the one known
   condition shape); guardrail JSON (`llmJudge`; `modify`, `flag`, `route`); the Connect contact flow for the
   Agentic CX block with hand-back attributes. **What we still cannot:** the metadata and conditions of every
   other node, and the `stateModifications` item shape.
3. **The process is part of the product.** The migration only converged through small steps, a screenshot or
   Debugger check after each, and honest course corrections. The app's review UI should do the same: show the
   mapping, flag unverified constructs, and keep a human confirmation before any write.
4. **Real data lives behind a data request**; a static data request cannot validate input.
5. **Client wording is copied verbatim**, including typos, unless the owner decides otherwise.

## 4. Mapping the Census patterns to the app

| App layer | What the Census build gives it |
|---|---|
| `parse` | A real Connect contact flow (Agentic CX block, attribute mapping, queue transfer); real guardrail and flow exports. Candidate **fixtures** (already sanitized in `verified-exports/`) |
| `model` | Needs nodes for: routing intent, list selection, free-form capture, data request with response check, retry loop, escalation with context |
| `design` | Pattern library P1 to P8 as the target designs for IVR constructs (menu, capture, data dip, retry, agent transfer) |
| `emit` | Contact-flow JSON for P1 is possible now; `migrate.ts` for guardrails and resources is documented; flow nodes for start, basic, escalate, redirect, loop, split, data_request, generative_text and generative_journey are now emittable from confirmed shapes; other node types need `TODO(acxd-schema)` markers |

## 5. Open items and what is blocked

1. ~~Flow exports of the working flows~~ **Received (2026-11-09)** and saved in `verified-exports/`. They confirm
   the JSON for `redirect`, `loop`, `split`, `data_request`, `generative_text`, `generative_journey` and the
   `stateModifications` shapes. Remaining export gaps are listed in the verified-findings file.
2. Spanish: language detection and switching in ACXD, voice per language, translations. Unverified.
3. Real phone test, and the Connect Set voice block JSON.
4. Incomprehension threshold: the console location and value (3) were not confirmed on a screen.
5. Greeting wording differs between the client slide and the existing flow.
6. Decide whether the sanitized exports become parser fixtures under `Website/src/core/fixtures/`.
7. `docs/cqa-demo/contact-flow/CQA_ACXD_Call.json` contains the real workspace, application, alias and queue
   IDs and the AWS account ID, because it was derived from the client's export. Check the repo's visibility, and
   sanitize before any wider sharing (the copy under `verified-exports/` is already sanitized).
8. `CLAUDE.md` constraint #2 still says built-in slot names are unknown; update it to point at the verified
   findings (not changed in this pass, because `CLAUDE.md` is the user's file).

## 6. Not touched

`voice-auth-poc/`, `AgentWorkspaceApp/` and the app source under `Website/` were not changed. The repo's
existing `voice-auth-poc` skill is unrelated to the Census flow (no voice biometrics in this POC).

## 7. How to resume

Paste this into the next session:

> Read `CLAUDE.md`, `docs/HANDOFF.md`, then the skill `.claude/skills/ivr-to-acxd-migration/`, starting with
> `references/verified-console-and-export-findings.md` and `references/worked-example-census-cqa.md`. Treat
> the verified findings as the ground truth for node behaviour and the "still not verified" list as the
> boundary of what may be emitted without a `TODO(acxd-schema)` marker. Then proceed with: <next task>.

## 0g. Website restyle (landing page and workspace shell)

- `Website/src/site/`: the new landing page (from the shared "Stylish Mixed Theme" zip). `landing.css` is that stylesheet with every
  selector scoped under `.lp` (generated once by a throwaway script; edit it by hand now). `brand.ts` holds the product name
  ("JourneyForge", owner "TTEC Digital"). Marketing copy was rewritten to claim only what the tool does; the hero preview is labelled a sample.
- `Website/src/app/`: the workspace. Hash routes (`route.ts`: `#/app`, `#/app/<page>`; anything else is the landing page, so in-page
  anchors still work on static hosting). `Shell.tsx` = sidebar, breadcrumbs, Ctrl/Cmd+K jump search (`Palette.tsx`), theme toggle
  (`theme.ts`, stored in localStorage when allowed). `workspace.tsx` holds the shared state (journey, details, bundle result, deploy
  prefill) in memory only. `progress.ts` computes the Overview ring from what was actually done. `Pages.tsx` keeps visited pages mounted.
- `implementation/theme.ts` colours are now CSS variables (`app/app.css`, dark default, `[data-theme=light]`). `ImplementationSection.tsx`
  became `implementation/steps.tsx` (exported step components). The old marketing IVR section was replaced by `app/pages/MigrationPage.tsx`
  (real report only, no illustrative mock). Old Apple-style homepage code was removed.
- Verified: type-check and 223 shim tests (incl. new `route.test.ts`, `progress.test.ts`), plus a throwaway renderer driving the whole
  flow and Playwright screenshots in dark, light and phone width. NOT verified: real React/Vite runtime (`npm run dev`), the web fonts,
  and the reference screenshots were matched by description, not pixel-compared. Journeys are session-only: no sign-in or saved list yet.

## 0h. Large templates in the deployer

`deployer-api` now stores a template over 51,200 bytes in the artifact bucket (`templates/<sha256>.json`) and passes `TemplateURL`; over 1 MB is refused (413). The tool role gained `s3:PutObject` on `templates/*`. Tested with fakes (33 deployer tests); not run against real S3 or CloudFormation. Same-region bucket assumed. The Census template is 36.7 KB, so this only matters for larger journeys.

## 0i. Name, branding, hosting

Product name is "JourneyForge" with "TTEC Digital" under the logo (landing nav, workspace sidebar, footer): one place, `Website/src/site/brand.ts`. `Website/hosting/` has the S3 + CloudFront stack with a login prompt (CloudFront Function, HTTP Basic), `deploy-site.sh` and a README that covers the login id/password and its limits. The template was checked structurally and the auth function was exercised in Node; it has NOT been deployed to real AWS, and the site has not been built with Vite here (no registry access), so `npm run build` is the first real build.

## 0j. Cognito login for the hosted site

`Website/hosting/site-cognito.template.json` (generated by `build-cognito-template.mjs`): private S3 + CloudFront; a CloudFront Function (`session-check.js`) checks a signed `jf_session` cookie on every request; `/auth/*` goes to a Lambda (`auth-lambda/index.mjs`) running Cognito Hosted UI sign-in (code flow + PKCE), admin-created users only, optional TOTP MFA. Cognito ids reach the Lambda through an SSM parameter to avoid a circular reference. `deploy-site.sh` defaults to this (`AUTH=cognito`); `AUTH=basic` keeps the shared-password stack. `npm run test:hosting` runs 9 tests (Lambda, session function, template references, no cycles, committed JSON in sync). NOT verified on real AWS: the Hosted UI round trip, CloudFront behaviour, `InvokedViaFunctionUrl`, and `cloudfront-js-2.0` `require('crypto').createHmac(...).digest('hex')`. The session key is readable by account admins (function code and Lambda env); a stronger design is Lambda@Edge verifying Cognito JWTs, at the cost of us-east-1 and slow deletes.

## 0k. Console-deployable bundle, Connect instance parts, deployer and provisioner for the console

- Bundle step has a deploy mode: **CloudFormation console** (default; managed-style template: secret ARN, provisioner from S3, README with console steps) or CLI. Emitter mode `'console'`; template identical to `'managed'`. Bucket parameters are validated so a pasted `s3://` path is refused up front (this was a real failure on the hosting stack).
- Connect flow step: queue ARN can be built from region, account id, **Connect instance id** and queue id (`composeQueueArn`). The instance id is only ever used inside the queue ARN; there is no separate instance resource in the bundle (no Connect CloudFormation resource yet).
- `deployer-api/template.json` now takes its code from S3 (`DeployerCodeBucket/Key`); roles have fixed names under `/edith/`, so ARNs are predictable and the deployer installs in one pass. `provisioner/README.md` and `build.sh` (prints the SDK version) are for CloudShell.
- Provisioner reviewed against the skill's SDK references (client constructor, Create/Get/Update/Delete/List shapes, identifier fields, application `flows`/`settings.guardrails`): consistent. Still never run against a real workspace.
- `docs/TEST-GUIDE.md`: the first end-to-end test of the Census journey. 227 shim tests, 33 deployer, 22 extractor, 10 hosting.

## 0l. First real run of the provisioner (SDK 0.3.0)

First deploy failed at the first ACXD calls: `GetContextVariableCommand` does not exist in `amazon-connect-acxd-sdk` 0.3.0 (confirmed from the real export list; saved as `provisioner/fixtures-sdk-exports.json`). Context variables are now looked up through `ListContextVariablesCommand` (identifier = name). A test checks every command the provisioner can call against the real export list, and a missing command now fails with its name and the similar exports. The secret create worked before the failure, so the workspace may hold a leftover secret from the failed run; redeploying updates it. Expect more first-run mismatches in command inputs (field names), not only command names.

## 0m. Two gaps found by ACXD's own Build validation (real workspace)

Build failed with "Unavailable reference" for (1) the analytics tags (`safety`, `promptinjection`, `toxicity`) that guardrail rules reference, and (2) the slot type `Freeformtext` that the Authentication flow attaches. Both are workspace-level objects that exist in the source workspace and not in a new one. Now created by the provisioner, before the guardrails and the flows: `analyticsTags` (type 'negative' is an assumption; description <= 64 chars) and `slotTypes` (`Freeformtext`: no values, sensitive off, journey languages; read from the source workspace). Neither is deleted with the stack (shared). General lesson for the app: a journey implementation also needs every workspace-level object its flows reference; collect them from the generated flows rather than assuming they exist.

## 0n. Application name rule

Update failed with `ValidationException: name is not in the expected format` at the application step: the bundle form had defaulted the application name to the journey title, which contains parentheses. Now `applicationNameFrom()` sanitizes the default and `generateBundle` refuses names outside `[A-Za-z0-9 _-]` (1 to 100). The same run showed the analytics tags, the `Freeformtext` slot type (`values: []`) and in-place updates of flows, data request, context variables and guardrails all work against the real SDK.
