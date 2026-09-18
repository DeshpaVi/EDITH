# Applications, Builds, and Deployments

An application is the top-level container for flows, builds, and deployments. It bundles
flows, knowledge bases, language settings, guardrails, and integrations into a single
deployable package within a workspace.

## Contents
- [Applications: CRUD](#applications-crud)
- [Application Settings](#application-settings)
- [Deployment Settings (one-click deploy)](#deployment-settings-one-click-deploy)
- [Application Builds](#application-builds)
- [Application Deployments](#application-deployments)
- [End-to-end quick start](#end-to-end-quick-start)

## Applications: CRUD

**ListApplications** — `nextToken`/`maxResults` in, paginated `items` out.

```js
await client.send(new ListApplicationsCommand({}));
```

**CreateApplication**

| Parameter            | Type   | Required |
| --------------------- | ------ | -------- |
| `name`                | string | Yes      |
| `flows`               | array  | No       |
| `settings`            | object | Yes      |
| `description`         | string | No       |
| `metadata`            | object | No       |
| `deploymentSettings`  | object | No       |

```js
await client.send(new CreateApplicationCommand({
  name: "MyFirstApp",
  description: "My first application",
  settings: {
    conversationTTL: 5,
    thresholds: { incomprehensionCount: 2 },
  },
}));
```

Output includes server-filled defaults, e.g.:

```json
{
  "applicationId": "05c3fcc2-7900-41c4-adee-b59dc69be8ae",
  "name": "MyFirstApp",
  "flows": [],
  "settings": {
    "languageCode": "en-US",
    "languageCodes": ["en-US"],
    "languageSettings": [{ "languageCode": "en-US", "useNativeLanguage": true }],
    "defaultFlows": {},
    "thresholds": { "incomprehensionCount": 2 },
    "conversationTTL": 5,
    "repeatOnIncomprehension": false,
    "clusters": {
      "enabled": false,
      "frequency": { "count": 1, "resolution": "MONTH" },
      "phraseThreshold": { "count": 100 },
      "retention": { "count": 30, "resolution": "DAY" }
    }
  },
  "deploymentSettings": {
    "oneClickDeployEnabled": true,
    "environment": "production",
    "contextAttributes": []
  },
  "description": "My first application",
  "createdAt": "2026-08-07T22:36:43.411Z",
  "updatedAt": "2026-08-07T22:36:43.411Z",
  "metadata": {},
  "updatedBy": "ci-deploy-bot"
}
```

Errors: `ValidationException` (400), `ConflictException` (409),
`InternalServerException` (500)

**GetApplication** — `applicationIdentifier` (required) → full application details
including flows, settings, guardrails, deployment configuration. Errors:
`ValidationException` (400), `ResourceNotFoundException` (404),
`InternalServerException` (500)

**UpdateApplication** — same shape as Create but all fields optional except
`applicationIdentifier`. Only include fields you want to change; returns the full updated
application. Errors: `ResourceNotFoundException` (404), `ValidationException` (400),
`InternalServerException` (500)

**DeleteApplication** — `applicationIdentifier` (required). Removes the application *and
all its builds and deployments*. No response body. Errors: `ValidationException` (400),
`ResourceNotFoundException` (404), `InternalServerException` (500)

### Application request parameters

- **`applicationIdentifier`** — the unique ID (assigned on creation), used in Get/Update/Delete.
- **`name`** — 1–100 characters.
- **`description`** — max 200 characters.
- **`flows`** — array of flow references: `[{"flowId": "MainFlow"}, {"flowId": "MainFlowTwo"}]`.
- **`settings`** — see [Application Settings](#application-settings).
- **`deploymentSettings`** — see [Deployment Settings](#deployment-settings-one-click-deploy).
- **`metadata`** — organizational metadata, see common types.
- **`createdAt`** / **`updatedAt`** / **`updatedBy`** — audit fields.

## Application Settings

| Field                      | Type    | Required |
| --------------------------- | ------- | -------- |
| `languageCode`              | string  | No       |
| `languageCodes`             | array   | No       |
| `languageSettings`          | array   | No       |
| `defaultFlows`              | object  | No       |
| `guardrails`                | array   | No       |
| `lifecycleHooks`            | object  | No       |
| `thresholds`                | object  | No       |
| `conversationTTL`           | integer | No       |
| `autoCorrection`            | boolean | No       |
| `childDirected`             | boolean | No       |
| `repeatOnIncomprehension`   | boolean | No       |
| `clusters`                  | object  | No       |

- **`languageSettings[]`** — per-language config: `languageCode` (required),
  `useNativeLanguage` (boolean), `useLex3pAsr` (boolean, use Lex third-party ASR),
  `projectId` (string, external project ID), `voice` (string, TTS voice identifier —
  directly relevant when porting IVR voice prompts).
- **`defaultFlows`** — flow assignments for system events, each
  `{ "flowId": "...", "quickReplies": [...] }` (quickReplies optional except where noted):
  - `welcome` — triggered on conversation start.
  - `fallback` — triggered when no intent matches. **This is your IVR "invalid entry"
    equivalent.**
  - `unknown` — triggered on unknown input; supports `knowledgeBaseId` to answer from a
    KB instead of a fixed fallback message.
  - `escalation` — triggered when escalation is requested. **Your IVR "agent" global
    command target.**
  - `frustration` — triggered when frustration is detected (sentiment-based escalation —
    something most legacy IVRs couldn't do at all).
  - `help` — triggered when the user asks for help.
  - `repeat` — triggered when the user asks to repeat. **Your IVR "press * to repeat."**
  - `resume` — triggered when a conversation resumes (e.g. after a timeout/reconnect).
- **`guardrails`** — references attached to the application: `[{ "guardrailId": "..." }]`.
- **`lifecycleHooks`** — flow IDs invoked at lifecycle events: `conversationStart`,
  `conversationEnd`, `escalation`, `stateModification`, `messageReceived`.
- **`thresholds.incomprehensionCount`** — integer, default 2. Number of consecutive
  incomprehensions before triggering fallback. **This is the direct analog of an IVR's
  "max invalid entries before transfer to agent" setting** — set it deliberately during
  migration rather than leaving the default.
- **`conversationTTL`** — integer, 1–60 minutes, default 5. Session timeout.
- **`autoCorrection`** — boolean, default false. Auto-correct user input.
- **`childDirected`** — boolean, default false. COPPA compliance flag.
- **`repeatOnIncomprehension`** — boolean, default false. Repeat last message on
  incomprehension (vs. moving straight to fallback).
- **`clusters`** — analytics clustering of similar user messages: `enabled` (boolean),
  `frequency` (`{count, resolution: HOUR|DAY|WEEK|MONTH}`), `phraseThreshold`
  (`{count}`, minimum 30), `retention` (`{count, resolution: DAY}`, 1–90 days).

## Deployment Settings (one-click deploy)

- **`oneClickDeployEnabled`** — boolean. Enable automatic deployment on build success.
- **`environment`** — one of `development`, `qa`, `staging`, `production`. Target for
  automatic deployments.
- **`contextAttributes`** — array of `{ "key": "attribute_name", "value": ... }`, max 50
  entries. Injected into automatic deployments.

## Application Builds

A build compiles an application's flows and configuration into an **immutable**
deployable artifact.

**Quick start**

```js
const build = await client.send(new CreateApplicationBuildCommand({
  applicationIdentifier: app.applicationId,
}));
const status = await client.send(new GetApplicationBuildCommand({
  applicationIdentifier: app.applicationId,
  buildIdentifier: build.buildId,
}));
console.log(status.status); // "PENDING" | "BUILT" | "FAILED"
```

- **ListApplicationBuilds** — `applicationIdentifier` (required) + pagination.
- **CreateApplicationBuild** — `applicationIdentifier` (required), `version` (string, max
  16 chars), `description` (string, max 200 chars), `languageSettings` (array, per-
  language build config). **A validation check runs automatically — review results to
  catch errors before deploying.**
- **GetApplicationBuild** — `applicationIdentifier` + `buildIdentifier` (both required).
  Status transitions `PENDING` → `BUILT` (success) or `FAILED` (with error details).
- **GetApplicationBuildDiff** — `applicationIdentifier`, `buildIdentifier`,
  `previousBuildIdentifier` (all required). Returns what changed between two builds:
  `properties`, `settings`, `modifiedSlotTypes`, `modifiedDataRequests`,
  `modifiedActions`, `attachedFlows`, `detachedFlows`, `modifiedFlows`. Useful for
  reviewing a migration incrementally, build over build.

Errors across build operations: `ValidationException` (400), `ResourceNotFoundException`
(404), `InternalServerException` (500)

## Application Deployments

Deploying pushes a successful build live for end users across chat, voice, IVR, website,
mobile, or MCP clients. **Only one build is live per application at a time** — deploying a
new build deactivates the previous one. Roll back by deploying an older build again.

**Quick start**

```js
const build = await client.send(new CreateApplicationBuildCommand({
  applicationIdentifier: app.applicationId,
}));
// poll GetApplicationBuild until status !== "PENDING"
const deployment = await client.send(new CreateApplicationDeploymentCommand({
  applicationIdentifier: app.applicationId,
  buildIdentifier: build.buildId,
  environment: "production",
  languageCodes: ["en-US"],
}));
// poll GetApplicationDeployment until deploymentStatus === "deployed"
```

- **ListApplicationDeployments** — `applicationIdentifier` (required) + pagination.
- **CreateApplicationDeployment** — `applicationIdentifier`, `buildIdentifier` (required);
  `description`, `environment` (enum), `languageCodes`, `analyticsTags`
  (`[{"label": "..."}]`), `contextAttributes` (`[{"key": "...", "value": "..."}]`, max 50)
  all optional.
- **GetApplicationDeployment** — `applicationIdentifier` + `deploymentIdentifier`.
  `deploymentStatus` is e.g. `pending`/`deployed`.
- **UpdateApplicationDeployment** — same inputs as Create plus `deploymentIdentifier`
  (required); use this to deploy a different build to the same deployment slot, i.e. a
  **rollback** is `UpdateApplicationDeployment` with an older `buildIdentifier`.
- **DeleteApplicationDeployment** — removes a deployment, taking the application offline
  until redeployed.

Errors across deployment operations: `ValidationException` (400),
`ResourceNotFoundException` (404), `InternalServerException` (500)

## End-to-end quick start

The full create → attach → build → deploy sequence, as documented:

```js
// 1. Create an Application
const app = await client.send(new CreateApplicationCommand({
  name: "CustomerSupport",
  settings: { conversationTTL: 5, thresholds: { incomprehensionCount: 2 } },
}));

// 2. Create a Flow
const flow = await client.send(new CreateFlowCommand({
  flowId: "GreetingFlow",
  description: "GreetingFlow",
  nodes: {},
}));

// 3. Attach flow to app
const updatedApp = await client.send(new UpdateApplicationCommand({
  applicationIdentifier: app.applicationId,
  flows: [{ flowId: "GreetingFlow" }],
}));

// 4. Create a build
const build = await client.send(new CreateApplicationBuildCommand({
  applicationIdentifier: app.applicationId,
}));

// 5. Confirm it built successfully before deploying
const buildStatus = await client.send(new GetApplicationBuildCommand({
  applicationIdentifier: app.applicationId,
  buildIdentifier: build.buildId,
}));
if (buildStatus.status !== "BUILT") {
  throw new Error("Build failed, cannot deploy.");
}

// 6. Deploy
const deployment = await client.send(new CreateApplicationDeploymentCommand({
  applicationIdentifier: app.applicationId,
  buildIdentifier: build.buildId,
  environment: "production",
  languageCodes: ["en-US"],
}));
```
