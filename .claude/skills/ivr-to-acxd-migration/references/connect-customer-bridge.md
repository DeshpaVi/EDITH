# Connect Customer ↔ ACXD Bridge

This is the piece that makes "IVR migration" concrete rather than conceptual: how a
classic Amazon Connect **Connect Customer** contact flow (the block-based flow builder —
Play Prompt, Get Customer Input, Invoke Lambda, Transfer to Queue, Set Voice, and so on)
hands a conversation off to an **Agentic CX Designer** application. Everything here is
console/admin-guide territory, not SDK calls — but it's the step that actually cuts a
live IVR over, so don't treat an ACXD build as the finish line of a migration.

## Contents
- [Division of responsibility](#division-of-responsibility)
- [The conversational AI lifecycle](#the-conversational-ai-lifecycle)
- [Builds and deployments (console side)](#builds-and-deployments-console-side)
- [Connecting a contact flow to ACXD](#connecting-a-contact-flow-to-acxd)
- [Voice vs. chat block settings](#voice-vs-chat-block-settings)
- [Publishing and redeploying](#publishing-and-redeploying)
- [Core capability reference](#core-capability-reference)

## Division of responsibility

| Connect Customer flows | Agentic CX Designer |
| --- | --- |
| Manages the customer entry point into the experience. | Designs and runs the conversational AI experience. |
| Handles contact flows, routing, queues, and channel setup. | Handles applications, flows, nodes, prompts, integrations, knowledge bases, guardrails, and analytics. |
| Routes the customer into the selected ACXD application and environment. | Executes the selected application logic and returns the next response or action. |
| Supports escalation into the contact center experience. | Determines when and how the conversation should escalate based on the application design. |

In a typical setup, a customer enters through a Connect Customer flow. That flow uses an
**Agentic CX block** to invoke the selected application and deployed environment. From
that point, ACXD handles flow routing, user responses, API calls, knowledge retrieval,
generative AI behavior, guardrails, and monitoring — until it hands control back.

**What this means for a migration:** don't try to rebuild the entire legacy IVR inside a
single ACXD flow if the source system also did pure routing (which queue, is it after
hours, which DID/number was dialed) upstream of any conversation. That routing logic can
often stay in the (much thinner) Connect Customer flow; the Agentic CX block is placed
where the legacy IVR's *conversational* logic used to start. What moves into ACXD is
everything the caller actually experienced as a menu, a prompt, a capture, or a data
lookup.

## The conversational AI lifecycle

ACXD brings build, test, deploy, observe, and optimize into one workspace:

| Capability | What it helps you do |
| --- | --- |
| Build | Create applications, flows, nodes, prompts, slots, variables, integrations, knowledge bases, and guardrails. |
| Test | Validate routing, flow behavior, variables, state, tools, and troubleshooting details before deployment. |
| Deploy | Package application changes into builds and deploy them to the appropriate environment. |
| Observe | Review conversation history, transcripts, evaluations, analytics, guardrails, and performance after deployment. |
| Optimize | Use analytics, tags, A/B tests, and conversation review to improve the experience over time. |

## Builds and deployments (console side)

This mirrors `CreateApplicationBuild`/`CreateApplicationDeployment` in the SDK
(`applications-builds-deployments.md`), but described as the console workflow, since a
migration is often done partly by hand in the workspace and partly by SDK:

A **build** packages the current application version — attached flows, routing
descriptions, default behavior, guardrails, slots, language settings, and application
settings — into an immutable snapshot. Edits made after a build are not included in any
deployment until another build is created. **A build is required before test chats work**
from a flow's Canvas or the application's Test tab, and before any application change can
be released.

To create or manage builds: open **Applications** → select the application → **Deploy**
tab → choose the environment (development or production) → **Build & deploy**. The build
process walks through validation checks (disconnected flow paths, incomplete
configuration — critical errors in red should be resolved first; warnings in yellow are
worth reviewing for user-experience impact), a changelog description, then **Build**.

Create a new build whenever you make a meaningful change: added/removed a flow, updated
default flows, changed slot configuration, updated routing descriptions, added languages,
or changed guardrails.

A **deployment** makes a selected build available for use through a flow in Connect
Customer. Only one build can be active in an environment at a time. To deploy: open the
**Deploy** tab → hover over a build's status in the builds table → **Deploy**. A
successful deployment shows a **Live** status. Roll back by hovering a past build and
choosing **Rollback**. After deployment, the application's **Access** details (URL, API
key) are what a frontend/implementation team needs to wire up a custom channel.

## Connecting a contact flow to ACXD

Once an application has been deployed at least once:

1. **Create or choose a contact flow** in Connect Customer that will route incoming calls
   or chats to the application. This flow should carry whatever routing logic connects
   the customer entry point (a phone number, a chat endpoint) to the deployed application
   — queue selection, hours-of-operation branching, and similar routing concerns belong
   here, upstream of the conversational logic.
2. **Choose a voice persona** (voice channels only): add a **Set voice** block, select
   the voice provider, language, and persona, and confirm — this is separate from and
   precedes the Agentic CX block.
3. **Add the Agentic CX block.** Configure:
   - The workspace where the application lives.
   - The name of the ACXD application.
   - The deployed environment alias (e.g. `Development`, `Production`).
   - Required block pathways: escalation, error, and timeout handling.

   This block is what tells Connect Customer which ACXD application and environment to
   invoke during the conversation.

## Voice vs. chat block settings

Depending on the channel, configure additional settings directly on the Agentic CX block:

- **Speech recognition** (voice) — which engine transcribes the customer's voice input
  before ACXD processes it. Set it **manually** when the flow should always use the same
  engine, or **dynamically** when the engine should vary by contact flow logic, contact
  attributes, language, or region.
- **Audio filler** (voice) — plays while the application needs a moment to generate
  output, retrieve/send data, or complete a tool call, so the pause doesn't feel dead air.
  Worth enabling on any flow with `data_request` or `generative_*` nodes in the critical
  path.
- **Idle chat timeout** (chat) — how long a chat contact can sit inactive before being
  considered idle. When it fires, the Connect Customer flow exits the Agentic CX block on
  the **Idle timeout** edge — make sure that edge is wired to a sensible next step (a
  final message, then end) rather than left dangling.

## Publishing and redeploying

Publish the Connect Customer flow to make it live on the relevant phone numbers or chat
endpoints. After that initial publish, **you do not need to republish the contact flow
every time the ACXD application changes** — the Agentic CX block continues pointing at
the selected application/environment, and any newly deployed build for that environment
becomes what live conversations use automatically. You only need to republish the contact
flow itself if you change the flow, or change the Agentic CX block's own configuration
(workspace, application, environment alias, pathways, voice/chat settings).

This separation is useful during a migration: once the bridge is wired and published
once, iterating on the ACXD application (new builds, new deployments) doesn't require
touching or republishing the legacy contact flow again.

## Core capability reference

For orientation when scoping a migration, ACXD's stated core capabilities:

| Capability | Description |
| --- | --- |
| Visual workflow design | Build structured conversation paths using a no-code Canvas. |
| Deterministic logic | Guide users through predictable steps, decisions, user choices, API calls, and controlled handoffs. |
| Generative AI nodes | Generate dynamic responses, classify user intent, transform data, and support more flexible interactions. |
| Agentic experiences | Agent nodes reason through multi-step tasks, call tools, collect information, and complete goals. |
| Knowledge bases | Ground responses in trusted content. |
| Integrations and Data requests | Connect conversations to managed services, custom APIs, and external systems. |
| Guardrails | Apply safety, brand, compliance, and policy controls to inputs and outputs. |
| Testing and debugging | Test applications/flows, inspect event logs, troubleshoot variables, state, tools, routing. |
| Analytics and monitoring | Observe live performance, review transcripts, track tags, analyze flow traversal. |

Note: Amazon Connect also has a separate, more autonomous "agentic self-service" feature
(orchestrator AI agents invoked from a **Get customer input** block, using MCP tools and
a Return-to-Control model) that is distinct from ACXD's Agentic CX block. If a request is
about that feature specifically rather than ACXD, flag the distinction rather than
conflating the two — they're both under the Amazon Connect umbrella but are different
building blocks.
