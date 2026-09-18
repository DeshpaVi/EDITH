# Live Sync Scripts and Touchpoint

A different migration surface from phone IVR: **web-page-synchronized conversations**.
Relevant when the target isn't (only) a phone tree but a web chat/voice widget that
should highlight or step through page content in sync with the conversation — e.g. "walk
me through checkout" guiding the user's on-screen cursor/highlights, not just replying in
a chat bubble.

## Contents
- [Touchpoint (the widget)](#touchpoint-the-widget)
- [Live Sync Scripts (the ACXD side)](#live-sync-scripts-the-acxd-side)
- [Steps and triggers](#steps-and-triggers)
- [Builds and deployments](#builds-and-deployments)

## Touchpoint (the widget)

Touchpoint (`@amazon-connect-touchpoint/web`, `npm i @amazon-connect-touchpoint/web`) is
a drop-in conversational UI/SDK for Connect Customer: one widget for chat, voice, and
voice-mini, plus **Live Sync** — the technology that keeps a voice or chat conversation
in sync with the on-screen interface.

Prerequisites to embed it: a Connect Customer instance with a contact flow, a
`StartChatContact` endpoint (chat) or `StartWebRTCContact` endpoint (voice) that mints
contact credentials, the instance ID, contact flow ID, and AWS region. Live Sync
specifically is optional and additionally requires an ACXD application — plain chat and
voice work without it.

To enable Live Sync: in the ACXD Canvas, wire `Start → Live Sync node (with declared
actions/scopes) → Exit application`; publish the application and copy its deployment key
and API key; route the contact flow into it; pass the keys to Touchpoint as
`liveSync.deploymentKey` / `liveSync.apiKey`.

## Live Sync Scripts (the ACXD side)

A Live Sync Script is an ordered sequence of **steps** the widget executes against the
page.

- **ListLiveSyncScripts** — pagination only.
- **CreateLiveSyncScript** — `name`, `steps` (required); `description`, `metadata`
  optional.
- **GetLiveSyncScript** / **UpdateLiveSyncScript** / **DeleteLiveSyncScript** — keyed by
  `liveSyncScriptIdentifier` (a UUIDv4).

```js
await client.send(new CreateLiveSyncScriptCommand({
  name: "checkout-walkthrough",
  description: "Guides a new user through checkout",
  steps: [
    {
      stepId: "d4e5f6a7-8b9c-4d0e-1f2a-3b4c5d6e7f80",
      name: "welcome-step",
      body: "Welcome! Can I help you find something?",
      action: "continue",
      trigger: { event: "pageLoad", once: true },
    },
  ],
}));
```

The full resource (returned on Create/Get/Update, omitted from list summaries) includes
an `apiKey` field — **sensitive**, the credential Touchpoint uses to run this script on a
live page.

## Steps and triggers

Each entry in `steps[]`:

| Field | Type | Notes |
| --- | --- | --- |
| `stepId` | string (UUIDv4) | Required. |
| `name` | string | Max 100 chars. |
| `description` | string | Max 200 chars. |
| `action` | string | Terminal action: `escalate`, `end`, `continue`. |
| `group` | string | Optional grouping label, max 100 chars. |
| `body` | string | Required. The message shown to the user, max 1000 chars. |
| `skipTranslation` / `translated` | boolean | Translation control/status. |
| `variations` | array | A/B alternatives: `{ body, percentage (0-100), tags }`. |
| `trigger` | object | See below. |
| `stateModifications` | array | State writes when the step runs. |
| `tags` | array | Analytics tag references: `[{ "label": "..." }]`. |

`trigger` defines when the step fires on the page:
- `event` — one of `click`, `pageLoad`, `appear`, `enterViewport`.
- `query` — a selector/query document identifying the target element.
- `once` — boolean, fire only once.
- `highlight` — boolean, highlight the target element.
- `urlCondition` — `{ "operator": "contains"|"matches_regex"|"smart_match", "value": "..." }`
  restricting the step to matching URLs.

`stateModifications[]` entries: `type: "context"`, `name` (the state variable),
`modification` (`clear`|`set`|`increment`|`decrement`|`push`|`pop`|`custom`),
`functionName` (for `custom`), `value` (an operand object).

## Builds and deployments

Live Sync Scripts have their own build/deploy lifecycle, parallel to (but separate from)
application builds/deployments:

- **ListLiveSyncScriptBuilds** / **CreateLiveSyncScriptBuild** — `liveSyncScriptIdentifier`
  (required); Create also takes `description`, `languageSettings`. Status: `PENDING` →
  built.
- **GetLiveSyncScriptBuild** — `liveSyncScriptIdentifier` + `buildIdentifier`.
- **ListLiveSyncScriptDeployments** / **CreateLiveSyncScriptDeployment** —
  `liveSyncScriptIdentifier` + `buildIdentifier` (required); `description`,
  `environment` (`development`/`qa`/`staging`/`production`), `languageCodes`,
  `analyticsTags` optional.
- **GetLiveSyncScriptDeployment** / **UpdateLiveSyncScriptDeployment** /
  **DeleteLiveSyncScriptDeployment** — keyed by `liveSyncScriptIdentifier` +
  `deploymentIdentifier`.

```js
const build = await client.send(new CreateLiveSyncScriptBuildCommand({
  liveSyncScriptIdentifier: scriptId,
  description: "first build",
  languageSettings: [{ languageCode: "en-US" }],
}));

const deployment = await client.send(new CreateLiveSyncScriptDeploymentCommand({
  liveSyncScriptIdentifier: scriptId,
  buildIdentifier: build.buildId,
  description: "first deployment",
  environment: "development",
}));
```

Errors across Live Sync Script operations follow the standard shape:
`ValidationException` (400), `ConflictException` (409, Create), `ResourceNotFoundException`
(404, Get/Update/Delete and any operation referencing a script/build/deployment ID),
`InternalServerException` (500).
