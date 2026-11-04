# Census 2030 — ACXD Live Sync demo

A basic dummy website (3 pages) for testing **ACXD Live Sync** end to end: Touchpoint widget on
the page, a Live Sync Script that highlights and narrates page elements, and Connect routing into
your existing ACXD application. It is a demo, not an official government site; the form submits nothing.

```
livesync-demo/
├─ web/public/          the site (index, respond, faq) + styles
├─ web/src/touchpoint.js  Touchpoint embed (bundled with esbuild)
├─ server/static.mjs    zero-dependency local static server for the site
├─ lambda/              AWS Lambda (handler.mjs) + IAM policy: /config, /livesync-token, /start-chat
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
| `web/src/touchpoint.js`, `lambda/handler.mjs` | response shape Touchpoint expects from the start-chat endpoint |
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

### 1. Install and configure (your machine)
```bash
cd livesync-demo
npm install
cp .env.example .env     # fill ACXD_API_KEY and ACXD_WORKSPACE_ID; git-ignored
```
`.env` is used only by the `acxd/` scripts. Connect and Live Sync values go on the Lambda (step 4).

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

### 4. ACXD application, keys and the Lambda
In the ACXD Canvas, in your existing application: `Start → Live Sync node (declared
actions/scopes) → Exit application`, keeping your `user_input` / `escalate` nodes as needed.
Build and deploy the application to `development`, publish it, and copy the **deployment key**
and **API key**.

Create the API (do this after step 5 so you have the contact flow ID):
1. **IAM role** for the Lambda: attach `AWSLambdaBasicExecutionRole` plus `lambda/iam-policy.json`
   (fill in region, account, instance and flow IDs).
2. **Lambda:** runtime Node.js 20.x, handler `handler.handler`, upload `lambda/handler.mjs`
   (the AWS SDK v3 is included in the runtime). Environment variables:

   | Variable | Value |
   | --- | --- |
   | `CONNECT_INSTANCE_ID` | Connect instance ID |
   | `CONNECT_CONTACT_FLOW_ID` | entry contact flow ID |
   | `LIVESYNC_DEPLOYMENT_KEY` | from the published application |
   | `LIVESYNC_API_KEY` | from the published application |
   | `ALLOWED_ORIGINS` | `http://localhost:3000` (comma-separate more later) |

   For more than a demo, read the two Live Sync keys from Secrets Manager instead of env vars.
3. **API Gateway HTTP API** with Lambda proxy integration (payload format 2.0) and routes
   `GET /config`, `GET /livesync-token`, `POST /start-chat`, `OPTIONS /{proxy+}`, auto-deployed to `$default`.
   Copy the invoke URL, e.g. `https://abc123.execute-api.us-east-1.amazonaws.com`.
   The Lambda sets CORS headers itself; do not also enable API Gateway CORS.
4. Test: `curl <invoke-url>/config` should return your instance ID, region and flow ID.

### 5. Connect wiring
In the Connect contact flow add the **Agentic CX block** (workspace, application, `Development`
alias). Wire the escalation, error and timeout branches to a queue transfer. Publish the flow.
Make sure `CONNECT_CONTACT_FLOW_ID` points at this flow.

### 6. Run the site locally with the widget
Put your invoke URL in `web/public/config.js` (`apiBase`), then:
```bash
npm run dev     # bundles the widget with esbuild, serves http://localhost:3000
```
Open http://localhost:3000 with devtools open. The page loads `/config.js` and
`/touchpoint.bundle.js`, which calls the Lambda for config and keys, then `Touchpoint.init(...)`.
If you serve the site from a different origin or port, add it to the Lambda's `ALLOWED_ORIGINS`.

### 7. Test checklist
- [ ] Widget appears; `POST /start-chat` returns `ParticipantToken` in the Network tab.
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
- `ACXD_API_KEY` is used only by `acxd/*.mjs`, run in your own terminal. Neither the Lambda nor the site ever sees it.
- Live Sync keys must reach the browser for Touchpoint to work; they are served at runtime by the Lambda (Origin-checked via `ALLOWED_ORIGINS`), never compiled into the bundle or committed.
- `.env` and the built bundle are git-ignored.
