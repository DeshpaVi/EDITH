# Contact handoff — Amazon Connect agent workspace app

A third-party application for the Amazon Connect agent workspace. It shows the
agent two things about the call they just answered:

1. **The attributes the IVR collected**, laid out the way the handoff document
   describes them — grouped, labelled, formatted, and with sensitive values
   masked until deliberately revealed.
2. **The live Contact Lens transcript**, in a secondary pane alongside.

> **Standalone.** This directory has its own `package.json`, `tsconfig.json`,
> `vite.config.ts` and dependencies. It shares no build configuration, no
> source, and no tooling with the IVR→ACXD migration tool in `Website/`.
> Building or changing one cannot affect the other.

## What the agent sees

```
┌──────────────────────────────────────────────────────────────┐
│ Contact handoff   Voice · Billing-Tier1 · 3m 06s in IVR      │
├───────────────────────────────┬──────────────────────────────┤
│ Collected attributes   18/22  │ Live transcript          6   │
│                               │                              │
│ IDENTITY & VERIFICATION  5/7  │ 00:00  System                │
│   Customer ID  CUS-4417829    │        This call may be …    │
│   Account      ••••••••7654 ↻ │ 00:04  Agent                 │
│   Auth         [Partial]      │        Thanks for holding…   │
│ INTENT & SELF-SERVICE    4/6  │ 00:11  Customer              │
│   Stated intent  DisputeCharge│        Yes, there's a charge…│
│   Escalation     Not set      │                              │
│ UNMAPPED                  2   │                              │
│   experimentCohort  ivr-…-b   │                              │
└───────────────────────────────┴──────────────────────────────┘
```

Three behaviours are deliberate:

- A declared attribute the flow did **not** set stays on screen as *Not set*.
  An agent scanning for "Authentication" must find it and see it is blank, not
  fail to find it and assume they missed it.
- An attribute the contact carries that the manifest does **not** declare is
  listed under **Unmapped**. A flow change becomes visible on the next call
  rather than invisible until somebody re-reads the handoff document.
- Compliance text — recording disclosures, consent wording — renders verbatim
  in its own block. Never masked, never trimmed, never reformatted.

## Configuring what is displayed

Edit **`src/config/attribute-manifest.json`**. That is the only file you need
to touch to change the panel. Each entry maps one contact attribute key to a
label, a group, a format and an optional mask:

```json
{
  "key": "authStatus",
  "label": "Authentication",
  "format": "badge",
  "required": true,
  "badgeMap": { "verified": "good", "partial": "warn", "failed": "bad" }
}
```

The `key` must match the key the contact flow writes, **byte-for-byte and
case-sensitively**. If you are unsure of the exact keys, run a test call and
read them off the **Unmapped** section — that is what it is for.

Formats: `text`, `multiline`, `phone`, `currency`, `date`, `datetime`,
`duration`, `boolean`, `badge`, `url`. Flags: `sensitive` + `mask`
(`last4` | `all` | `none`), `required`, `compliance`, `help`, `currencyFrom`.

The manifest is validated at load; mistakes surface as a banner in the app
rather than a broken panel.

## Architecture

```
  Agent workspace (iframe host)
        │  postMessage, via @amazon-connect/app + /contact
        ▼
  ┌─────────────────────────┐
  │  This app (React/Vite)  │
  │                         │        HTTPS + Cognito ID token
  │  attributes ◀───────────┤
  │  transcript ────────────┼──▶ API Gateway (JWT authorizer)
  └─────────────────────────┘             │
                                          ▼
                                   Lambda (execution role)
                                     │  1. DescribeContact
                                     │     → is this agent on this contact?
                                     │     → which channel? which initial id?
                                     ▼
                       voice → connect-contact-lens:ListRealtimeContactAnalysisSegments
                       chat  → connect:ListRealtimeContactAnalysisSegmentsV2
```

The two panes share a contact but not a data path, so one failing leaves the
other standing.

**Why there is a backend at all:** Contact Lens real-time is a SigV4-signed AWS
API. A browser cannot call it without AWS credentials, and AWS credentials in a
browser are a breach, not a trade-off. The Lambda holds the only credentials in
the system and proves the caller is the agent on the contact before returning a
word of it. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md#1-there-is-no-push-api-for-live-transcripts-that-a-browser-can-use).

## Layout

```
src/
  config/     attribute-manifest.json  ← the handoff document, as config
              attributes.ts            manifest types + validation
              runtime.ts               env-driven config, all public
  connect/    types.ts                 the bridge contract
              workspaceBridge.ts       the real @amazon-connect/* binding
              mockBridge.ts            fixture contact for local dev
              useContact.ts            bridge → React state
  attributes/ format.ts                pure value formatting + masking
              select.ts                manifest + attributes → panel model
  transcript/ types.ts                 wire format, shared with the Lambda
              normalize.ts             AWS responses → wire format (pure, shared)
              merge.ts                 page merging + dedupe (pure)
              client.ts                API client
              useTranscript.ts         polling loop
  auth/       cognitoPkce.ts           authorization-code + PKCE, popup
  components/ AttributePanel, TranscriptPanel, ContactHeader, Notice
backend/
  src/        handler.ts               GET /transcript
              authorize.ts             agent-owns-contact check
infra/
  hosting.yaml    S3 + CloudFront, CSP frame-ancestors for the workspace
  backend.yaml    Cognito + HTTP API + Lambda + IAM
  deploy.sh       the whole sequence, in order
docs/
  CONSOLE-SETUP.md  service-by-service GUI steps
  LIMITATIONS.md    read before committing to a rollout
```

Everything above `connect/types.ts` is written against `ContactSnapshot`, never
against the Amazon Connect SDK. That is what lets the whole app run outside the
workspace against fixtures, and keeps an SDK upgrade to one file.

## Local development

```bash
npm install
cp .env.example .env.local     # set VITE_BRIDGE=mock, VITE_TRANSCRIPT_SOURCE=mock
npm run dev
```

The mock bridge serves a fixture contact that is deliberately imperfect: one
required attribute is missing and two attributes are unmapped, because those are
the two cases the panel most needs to handle well. The mock transcript reveals a
scripted conversation over ~15 seconds.

```bash
npm run typecheck      # tsc --noEmit, strict
npm test               # 25 unit tests over the pure layers
npm run build          # typecheck + production bundle
```

The tested layers are the deterministic ones: attribute selection, formatting,
masking, clipboard export, manifest validation, transcript normalisation for
both channels, and page merging. The React components and the SDK binding are
not unit-tested — see [LIMITATIONS §11](docs/LIMITATIONS.md#11-known-gaps-in-this-build).

## Deploying

```bash
CONNECT_INSTANCE_ID=<uuid> COGNITO_PREFIX=<unique> ./infra/deploy.sh
```

Then do the Amazon Connect console steps — registering the app, granting it on
the security profile, and turning on real-time analytics in the flow. Those have
no API worth using and are step-by-step in
[docs/CONSOLE-SETUP.md](docs/CONSOLE-SETUP.md).

## Security posture

- **No AWS credentials anywhere in the browser.** The Lambda's execution role is
  the only principal with access to contact data.
- **No client secret.** The Cognito app client is public; PKCE protects the code
  exchange.
- **Tokens in memory only** — not `localStorage`, not `sessionStorage`.
- **Every request is authorised twice**: the API Gateway JWT authorizer proves
  *who*, and the Lambda's `DescribeContact` check proves *this agent is on this
  contact*.
- **The Connect instance id is fixed at deploy time** and never read from a
  request, so a caller cannot point the proxy at another instance.
- **CSP `frame-ancestors`, no `X-Frame-Options`** — the workspace can frame the
  app; nothing else can.
- **Transcript content is never logged.**
