# EDITH Handoff: where we are (2026-11-09)

> Update (same day): the product direction changed. `CLAUDE.md` now describes a journey-in, CloudFormation-out
> app for delivery consultants; the first slice is journey in, checklist out, with the Census CQA demo as the test case.

Fresh handoff. It replaces the earlier "ACXD Implementation Handoff" doc, whose open questions are now
answered. Read this, then `CLAUDE.md`, then the skill (`.claude/skills/ivr-to-acxd-migration/`).

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
