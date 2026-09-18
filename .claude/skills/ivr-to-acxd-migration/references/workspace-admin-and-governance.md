# Workspace Administration and Governance

Account/workspace-level resources: who can do what, where secrets live, and how to audit
and roll back changes. Most of this is account-admin territory rather than day-to-day
conversation design, but it matters for migrations done by a team (role separation) or
under compliance requirements (audit trail).

## Contents
- [Workspaces](#workspaces)
- [Team](#team)
- [Users](#users)
- [Roles and permissions](#roles-and-permissions)
- [Secrets](#secrets)
- [Trails (audit log)](#trails-audit-log)
- [Versions (resource history)](#versions-resource-history)

## Workspaces

Isolated environments containing all resources for a project or team. Workspace
operations are **account-level** and don't require a `workspaceId` on the client.

- **ListWorkspaces** — pagination only.
- **CreateWorkspace** — `name` (required), `tags` (array, optional).
- **GetWorkspace** — `workspaceIdentifier` (required).
- **UpdateWorkspace** — `workspaceIdentifier` (required), `name`/`tags` optional.
- **DeleteWorkspace** — `workspaceIdentifier` (required).

```js
await client.send(new ListWorkspacesCommand({}));
// → { items: [{ workspaceId, name, tags: ["prod","main"], createdAt, updatedAt, updatedBy }], nextToken }

await client.send(new CreateWorkspaceCommand({ name: "SDK Test Workspace", tags: ["testing", "sdk"] }));
```

Errors: `ValidationException` (400), `InternalServerException` (500), plus the usual
`ConflictException`/`ResourceNotFoundException` on Create/Get-Update-Delete respectively.

## Team

Account-level team settings. **Each account has a single team resource.**

- **GetTeam** — no input.

```js
await client.send(new GetTeamCommand({}));
// → { teamId, name: "Northwind Corp", createdAt, updatedAt }
```

Errors: `ValidationException` (400), `ResourceNotFoundException` (404),
`InternalServerException` (500)

## Users

Human identities (as opposed to programmatic users, which are machine identities).
Notably, a user's `userArn` points at an actual Amazon Connect instance agent ARN —
ACXD users are tied to the underlying Connect instance's agents, not a separate identity
system.

- **ListUsers** — pagination only.
- **CreateUser** — `userId`, `cxnRole`, `userArn`, `username` (all required);
  `firstName`, `lastName`, `email`, `applicationIds` (array), `roles` (array),
  `defaultRole` (object) all optional.
- **GetUser** / **UpdateUser** / **DeleteUser** — keyed by `userId`.

```js
await client.send(new CreateUserCommand({
  userId: "00000000-0000-4000-8000-000000000099",
  cxnRole: "member",
  userArn: "arn:aws:connect:us-west-2:176202286863:instance/<instance-id>/agent/00000000-0000-4000-8000-000000000099",
  username: "sdk.testuser",
  firstName: "SDK",
  lastName: "TestUser",
  email: "sdk-test@example.com",
  applicationIds: ["a018836f-a909-4be0-a28b-53b413f1429c"],
  defaultRole: { role: "developer" },
  roles: [{ applicationId: "a018836f-a909-4be0-a28b-53b413f1429c", role: "developer" }],
}));
```

### User Role Assignment / Default Role

`roles[]` — per-application role assignments: `{ "applicationId": "...", "role": "..." }`.
`defaultRole` — `{ "role": "..." }`, applied when no application-specific role matches.
`cxnRole` — the user's role at the Connect instance level (e.g. `administrator`,
`member`) — distinct from ACXD application roles.

Errors: `ValidationException` (400), `ConflictException` (409, Create),
`ResourceNotFoundException` (404, Get/Update/Delete), `InternalServerException` (500)

## Roles and permissions

Custom or pre-defined permission sets assignable to programmatic users (and referenced by
human users' `roles[]`). Pre-defined roles: `administrator`, `developer`,
`content manager`, `read-only`.

- **ListRoles** — `type` (optional filter) + pagination.
- **CreateRole** — `name` (required); `type`, `description`, `permissions`,
  `conditionCatalog` optional.
- **GetRole** / **UpdateRole** / **DeleteRole** — keyed by `roleId`. Delete fails
  (`ConflictException`) if the role is still assigned to any programmatic user.
- **GetRolePermissions** — `type` (required, e.g. `studio`) → the full catalog of
  assignable `permissionId`s for that role type, useful for discovering valid values
  before writing a custom role.

```js
await client.send(new CreateRoleCommand({
  name: "Content Editor",
  type: "studio",
  description: "Can edit flows but cannot deploy",
  permissions: [
    { permissionId: "ds:ListFlows", effect: "allow" },
    { permissionId: "ds:CreateFlow", effect: "allow" },
    { permissionId: "ds:UpdateFlow", effect: "allow" },
    { permissionId: "ds:DeleteFlow", effect: "allow" },
    { permissionId: "ds:CreateApplicationDeployment", effect: "deny" },
  ],
}));
```

`type` is one of `studio`, `voicecompass`, `voiceinsights` — the permission catalog
differs by type, so always call `GetRolePermissions` for the relevant `type` rather than
guessing `permissionId` strings.

### Role Permission

`{ "permissionId": "ds:CreateFlow", "effect": "allow"|"deny", "conditionId": "..." }` —
`permissionId`s follow a `ds:VerbNoun` pattern mirroring the SDK command names (e.g.
`ds:CreateFlow` maps to `CreateFlowCommand`). `conditionId` optionally scopes the
permission to a condition from the condition catalog.

### Condition Catalog

Fine-grained, conditional access control — e.g. restrict a role to specific languages or
resources. A condition is either a single comparison or a composite:

```js
// Single: only applies to en-US resources
{ "condition": { "left": { "type": "languageCode" }, "right": { "type": "constant", "value": "en-US" }, "operator": "EQ" } }

// Composite: applies to en-US OR es-ES
{
  "composite": {
    "operator": "OR",
    "items": [
      { "condition": { "left": { "type": "languageCode" }, "right": { "type": "constant", "value": "en-US" }, "operator": "EQ" } },
      { "condition": { "left": { "type": "languageCode" }, "right": { "type": "constant", "value": "es-ES" }, "operator": "EQ" } }
    ]
  }
}
```

Operand types: `languageCode` (the resource's language), `resourceId` (the resource
being accessed), `constant` (a literal to compare against). Comparison operators: `EQ`,
`NEQ`, `PREFIX`, `NOT_PREFIX`, `SUFFIX`, `NOT_SUFFIX`, `CONTAINS`, `NOT_CONTAINS`.
Boolean operators for composites: `AND`, `OR`.

**Migration relevance:** a common pattern when a large IVR is split across a team is a
condition-scoped role — e.g. a translator role that can edit only `es-ES` flow content,
or a content-manager role restricted to a specific `resourceId` prefix matching a
business unit's flows.

## Secrets

Encrypted-at-rest storage for sensitive values (API keys, credentials, connection
strings), referenced from Data Request webhook headers as `{{secrets.my_secret}}` rather
than being inlined.

- **ListSecrets** — pagination only. **Values are never included in list responses.**
- **CreateSecret** — `name`, `secretValue` (required); `description`, `isSensitive`,
  `metadata` optional.
- **GetSecret** — `secretIdentifier` (required) — returns a masked `secretValue` (e.g.
  `"*******89"`), not the plaintext.
- **UpdateSecret** / **DeleteSecret** — keyed by `secretIdentifier`.

```js
await client.send(new CreateSecretCommand({
  name: "stripe_api_key",
  secretValue: "sk_live_...",
  description: "Stripe production API key",
  isSensitive: true,
}));
```

`name` is alphanumeric + underscores, 3–100 characters. `secretValue` is 1–4096
characters, encrypted at rest and never logged. Errors: `ValidationException` (400),
`ConflictException` (409, Create — name already exists), `ResourceNotFoundException`
(404, Get/Update/Delete), `InternalServerException` (500)

## Trails (audit log)

The audit trail of changes to workspace resources — who changed what, and when. Uses an
**async query pattern**: submit a query, then poll for results.

- **StartTrailQuery** — `startTimestamp`, `endTimestamp` (required); optional filters
  `eventType`, `eventName`, `principalId`, `principalEmail`, `sourceIpAddress`, `page`,
  `size`. Returns `{ "resultId": "qry-..." }`.
- **GetTrailQueryResults** — `resultId` (required). Poll until `status` is `SUCCEEDED`.

```js
const q = await client.send(new StartTrailQueryCommand({
  startTimestamp: "2026-08-03T00:00:00.000Z",
  endTimestamp: "2026-08-10T23:59:59.000Z",
  eventType: "WRITE",
  size: 5,
}));
const results = await client.send(new GetTrailQueryResultsCommand({ resultId: q.resultId }));
```

Each result item: `eventVersion`, `eventTime`, `eventSource` (e.g. `acxd.studio`),
`eventName` (e.g. `FlowUpdate`), `eventType` (e.g. `WRITE`), `userAgent`, `requestId`,
`requestParameters` (JSON string), `responseElements` (JSON string), `userType`,
`userId`. **Migration relevance:** trails are the way to prove/reconstruct exactly what
changed during a migration window if something needs to be rolled back or explained to a
compliance reviewer — pair with Versions below for the actual content of each change.

Errors: `ValidationException` (400), `ResourceNotFoundException` (404, results only),
`InternalServerException` (500), `ThrottlingException` (429)

## Versions (resource history)

Every change to a versioned resource creates a retrievable version.

- **ListResourceVersions** — `resourceType`, `resourceId` (both required) + pagination.
  Each item: `versionId`, `lastUpdatedBy`, `updatedAt`, `isLatest`, `isPublished`.
- **GetResourceVersion** — `versionId`, `resourceType`, `resourceId` (all required) →
  full content of that specific version.

```js
const versions = await client.send(new ListResourceVersionsCommand({
  resourceType: "flows",
  resourceId: "DeployTestFlow",
}));
```

**Migration relevance:** before overwriting a flow during iterative migration work,
`ListResourceVersions` lets you confirm what's about to be superseded and
`GetResourceVersion` lets you pull back an earlier version's content if a change needs
reverting — this is finer-grained than an application Build/Deploy rollback, since it
works at the level of a single resource (one flow, one slot type) rather than the whole
application package.
