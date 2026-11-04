# Census 2030 — ACXD Live Sync demo

A basic dummy website (3 pages) for testing **ACXD Live Sync** end to end: Touchpoint widget on
the page, a Live Sync Script that highlights and narrates page elements, and Connect routing into
your existing ACXD application. It is a demo, not an official government site; the form submits nothing.

```
livesync-demo/
├─ web/public/          the site (index, respond, faq) + styles
├─ web/src/touchpoint.js  Touchpoint embed (bundled with esbuild)
├─ server/index.mjs     serves site + /api/config, /api/livesync-token, /api/start-chat
└─ acxd/                Live Sync Script definition, create/update, build + deploy
```

Elements Live Sync targets carry stable `data-livesync="..."` attributes (not CSS classes), so
styling changes don't break steps.

## Status: read this first

Written from the handoff doc and the skill reference, **not yet run against live services**. The
`npm install` of `amazon-connect-acxd-sdk` and `@amazon-connect-touchpoint/web` could not be
verified from the build sandbox. Every unverified assumption is marked `TODO(acxd-schema)`:

| Where | What to confirm |
| --- | --- |
| `web/src/touchpoint.js` | `Touchpoint` export name and `init()` option names (the doc itself says "confirm") |
| `web/src/touchpoint.js`, `server/index.mjs` | response shape Touchpoint expects from the start-chat endpoint |
| `acxd/script.definition.mjs` | shape of `trigger.query` (`{selector}` is a guess); `stateModifications` operand shape (left out) |
| `acxd/lib.mjs`, `upsert-script.mjs` | response id fields (`liveSyncScriptId`, `buildId`, `deploymentId`) and the List response key |
| `acxd/build-and-deploy.mjs` | build status strings other than `PENDING` |

Fastest way to settle the `query` shape: build one step in the ACXD Canvas that targets an element,
then read it back with `GetLiveSyncScript` and mirror it in `q()`.

## Step-by-step: configure and test

### 0. Prerequisites
- Node 20.6+ (uses `--env-file`), AWS CLI/credentials with `connect:StartChatContact`.
- Preview access to Agentic CX Designer in your region; your existing workspace, contact flow and agents.
- From ACXD Admin Hub: workspace ID and an API key (`acxd_live_<prefix>.<secret>`) for a programmatic user.
- From Connect: instance ID, region, the entry contact flow ID.

### 1. Install and configure
```bash
cd livesync-demo
npm install
cp .env.example .env     # then fill in values; .env is git-ignored
```
Fill `ACXD_API_KEY`, `ACXD_WORKSPACE_ID`, `AWS_REGION`, `CONNECT_INSTANCE_ID`, `CONNECT_CONTACT_FLOW_ID`.
Leave `LIVESYNC_*` empty for now (step 4).

### 2. Create the Live Sync Script
Preview the payload without any network call:
```bash
npm run acxd:script:dry
```
Create it (or update it if it already exists, matched by name):
```bash
npm run acxd:script
```
Draft edits are not live until built and deployed.

### 3. Build and deploy the script to `development`
```bash
npm run acxd:deploy -- --env development
```
You are asked to type `development` to confirm. The script creates a build, waits for it, then
deploys it. **Rollback** = redeploy an earlier build:
```bash
npm run acxd:deploy -- --env development --build <previousBuildId>
```

### 4. ACXD application and keys (Canvas)
In the ACXD Canvas, in your existing application: `Start → Live Sync node (declared
actions/scopes) → Exit application`, keeping your `user_input` / `escalate` nodes as needed.
Build and deploy the application to `development`, publish it, then copy the **deployment key**
and **API key** into `.env` as `LIVESYNC_DEPLOYMENT_KEY` / `LIVESYNC_API_KEY`.
(For anything beyond local testing, keep these in AWS Secrets Manager and have the server read them from there.)

### 5. Connect wiring
In the Connect contact flow add the **Agentic CX block** (workspace, application, `Development`
alias). Wire the escalation, error and timeout branches to a queue transfer. Publish the flow.
Make sure `CONNECT_CONTACT_FLOW_ID` points at this flow.

### 6. Run the site with the widget
```bash
npm run dev
```
Open http://localhost:3000. The page loads `/touchpoint.bundle.js`, which fetches
`/api/config` and `/api/livesync-token`, then calls `Touchpoint.init(...)`.

### 7. Test checklist
- [ ] Widget appears; `/api/start-chat` returns `ParticipantToken` (browser devtools → Network).
- [ ] Home: `home-welcome` fires on load; Start button is highlighted when it appears.
- [ ] `/respond.html`: intro fires; household-size, address and submit highlight as they scroll into view.
- [ ] "Talk to a person" triggers the `escalate` step and reaches your queue.
- [ ] Redeploying the previous build works (rollback).
- [ ] Only then repeat steps 3–5 for `staging`, then `production`, after sign-off.

### Troubleshooting
- **Widget doesn't show:** console error `[livesync-demo] Touchpoint failed to start` — usually a missing `.env` value or a changed `init()` signature (see the TODO table).
- **Steps don't fire:** check the step's `urlCondition` against the actual URL and that the `data-livesync` element exists; confirm the `query` shape.
- **`ValidationException`:** a step field is out of range (`name` ≤100, `body` ≤1000) or `stepId` isn't a UUIDv4.
- **Keys leaked:** rotate in ACXD and update `.env`/Secrets Manager. The SDK already retries throttling; don't add retry loops.

## Security notes
- `ACXD_API_KEY` is used only by `acxd/*.mjs`, which you run in your own terminal. It is never read by the server or bundle.
- Live Sync keys must reach the browser for Touchpoint to work; they are served at runtime from `/api/livesync-token` (Origin-checked via `ALLOWED_ORIGINS`), never compiled into the bundle.
- `.env` and the built bundle are git-ignored.
