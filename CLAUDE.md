# CLAUDE.md

Project context for Claude Code. Read this before any task in this repo.

## What we're building

A web application that migrates existing IVRs onto Amazon Connect's **Agentic CX
Designer (ACXD)**. A user arrives with a legacy IVR and leaves with a working ACXD
application design plus the SDK code to create it.

v1 scope: **Amazon Connect contact flow JSON exports plus the Amazon Lex bot export they
reference** as the input, and a **demo/POC for stakeholders** as the output — the app
produces a migration design and two downloadable artifacts, but does not write to
anyone's live workspace.

**Both input files matter.** The contact flow holds routing and the intent branch names;
the Lex bot holds the utterances, slot prompts, slot types, and synonyms. Flow-only
input yields a routing skeleton with no conversational content — which is the entire
thing ACXD exists to hold. Treat a referenced-but-missing bot export as a coverage gap,
never as something to work around.

**The output is two files, not an API call.** ACXD has no import path — resources are
created by ordered `Create*` calls. So the app emits `migrate.ts` (the user runs it, with
their own key, in their own terminal) and `contact-flow.json` (the user imports it in the
Connect console). **The POC therefore needs no credentials of any kind** — getting an
ACXD key is not on the critical path for M1–M4.

## The domain skill

`.claude/skills/ivr-to-acxd-migration/` holds researched ACXD expertise: the full SDK
surface, the IVR→ACXD mapping playbook, and the Connect-flow-to-ACXD bridge. **Consult it
before writing any code that generates ACXD resources.** It is the source of truth for
SDK shapes — prefer it over recalled knowledge of Lex, Dialogflow, or classic Connect,
which have similar concepts and different schemas.

## Hard constraints

These are not style preferences. Violating them produces a tool that fails in ways users
discover late and expensively.

1. **Never hardcode or client-expose an ACXD API key.** Keys are
   `acxd_live_<prefix>.<secret>` and carry full workspace access. They live in server-side
   env vars only. No key in a React component, a published page, or a committed file.
2. **Never invent undocumented ACXD schema.** Per-node `metadata` shapes,
   `childNodes[].conditions` contents, and built-in slot type names are not published by
   AWS. Where the emitter needs one, generate an explicit `// TODO(acxd-schema):` marker
   with a note on what needs confirming. A plausible guess that fails at build time is
   worse than a visible gap. See "Where the documentation stops" in the skill.
3. **Never silently drop an unrecognized input block.** Any contact flow Action type the
   parser doesn't handle becomes an `unknown` node in the model and surfaces in the UI's
   coverage report. Silent omission means a migrated IVR is quietly missing behavior.
   The same applies to the join between the two inputs: a bot reference that resolves to
   nothing, an intent branch with no matching intent, or an intent the flow never reaches
   is a `requiresReview` entry — never a guess and never a silent drop.
4. **Never paraphrase compliance text.** Recording disclosures, consent language, and
   regulated wording are copied byte-for-byte from source to output. If a transform would
   alter them, flag for legal review instead.
5. **Human review gate before any write.** No code path creates ACXD resources without an
   explicit user confirmation step. This holds even after live emit ships in a later
   milestone.

## Conventions

- TypeScript throughout, `strict: true`. The canonical model is the contract between
  layers — type it precisely and derive from it, don't restate shapes.
- Parsers are pure functions: `(sourceJson) => IvrModel`. No I/O, no LLM calls. This keeps
  them unit-testable against fixtures.
- LLM calls belong in the design layer only, never the parser or emitter. Parsing and code
  generation must be deterministic and reproducible.
- Every parser change ships with a fixture in `Website/src/core/fixtures/`.
- Input field names carry `// TODO(source-schema):` where they're unverified against a
  real export — the input-side sibling of `TODO(acxd-schema)`. Both formats are currently
  written from documentation, not from a confirmed export.

## Working notes

- Amazon Connect contact flow JSON structure **and the Lex V2 export layout** are written
  from documentation and **need verifying against real exports** before the parsers are
  trusted. Getting one real exported flow plus its bot export is an early, cheap,
  high-value task.
- Lex has two export formats in the wild: **V2** (a ZIP — `Manifest.json`, `Bot.json`,
  `BotLocales/<locale>/Intents/<name>/Intent.json`) and **V1** (a single flat JSON with
  `resource.intents[]`). Detect and support both; don't assume V2.
- The single highest-leverage unblock for the whole project is one `GetFlow` response from
  a real ACXD workspace containing a `user_choice`, `data_request`, and `knowledge_base`
  node. That resolves constraint #2 for the entire emitter. Ask about it rather than
  working around it indefinitely.
