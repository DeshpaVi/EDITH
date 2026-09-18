# Auth Setup, Common Errors, and Common Types

## Contents
- [Getting started / authentication](#getting-started--authentication)
- [Common errors](#common-errors)
- [Common types](#common-types)

---

## Getting started / authentication

**Prerequisites:** an ACXD workspace with an Administrator role, and access to the
workspace (Admin Hub).

**Auth model:** ACXD uses API key authentication tied to a "programmatic user" — a
machine identity. Only account administrators can create programmatic users.

### Step 1: Create a programmatic user

In the workspace: Admin Hub → Programmatic Users → Create Programmatic User (name +
optional description), then assign permissions via `roleConfig`:

**Account-level role** (full access across all workspaces in the account):

```json
{ "roleConfig": { "accountRole": "administrator" } }
```

**Workspace-scoped roles** (specific permissions per workspace — pre-defined:
`administrator`, `developer`, `content manager`, `read-only`; or a custom role configured
under Roles in Admin Hub):

```json
{
  "roleConfig": {
    "workspaceRoles": [
      { "workspaceId": "your-workspace-id", "roleId": "role-uuid" }
    ]
  }
}
```

### Step 2: Generate an API key

Admin Hub → Programmatic Users → select user → Generate API Key. **Copy it immediately —
it's shown only once and cannot be retrieved after creation.** Format:
`acxd_live_<prefix>.<secret>`. Max 2 keys per programmatic user.

### Step 3: Install the SDK

```
npm install amazon-connect-acxd-sdk
```

### Step 4: First call

```js
import { AgenticCXDesignerClient, ListContextVariablesCommand } from 'amazon-connect-acxd-sdk';

const client = new AgenticCXDesignerClient({
  apiKey: 'acxd_live_...',
  workspaceId: 'your-workspace-uuid', // required for workspace-scoped operations
});

const response = await client.send(new ListContextVariablesCommand({}));
console.log(response.items);
```

For account-level operations (managing programmatic users, workspaces), `workspaceId` is
not required.

### Permissions

The API key itself carries no permissions — it's just a credential. Permissions resolve
at request time from the programmatic user's currently assigned role. **If the role is
updated in Admin Hub, the change takes effect immediately** — no need to regenerate the
key after a permissions change.

### API Tokens (programmatic management)

The Getting Started steps above describe generating a key through Admin Hub; the same
thing is available as an API for automating key rotation (e.g. from a CI/CD pipeline).

- **CreateApiToken** — `userId` (the programmatic user, required), `description`
  (optional). Returns the full token in `token` — **shown only once, exactly like a
  console-generated key.**
- **ListApiTokens** — `userId` (required). Returns metadata only (`keyPrefix`,
  `description`, `createdAt`) — secrets are never exposed after creation.
- **DeleteApiToken** — `userId`, `keyPrefix` (both required). Permanently revokes.

```js
const token = await client.send(new CreateApiTokenCommand({
  userId: "programmatic-user-uuid",
  description: "CI/CD pipeline",
}));
// token.token: "acxd_live_mPj4Y4hfXKg5NIuhX24d.K9mN2pQ4rS6tU8vW0xY1zA3bC5dE7fG9" — store immediately
```

Errors: `ValidationException` (400), `ConflictException` (409, Create),
`ResourceNotFoundException` (404, Delete), `InternalServerException` (500)

---

## Common errors

All errors return a consistent JSON body:

```json
{
  "type": "ResourceNotFoundException",
  "message": "Secret 'my-secret' not found.",
  "resourceId": "my-secret",
  "resourceType": "Secret"
}
```

| Error | HTTP | Meaning |
| --- | --- | --- |
| `ValidationException` | 400 | Input doesn't meet required format/constraints. Check required params and value validity. |
| `ResourceNotFoundException` | 404 | The specified resource doesn't exist. Verify the identifier and that it hasn't been deleted. |
| `ConflictException` | 409 | Request conflicts with an existing resource (e.g. creating a secret with a name that already exists). |
| `AccessDeniedException` | 403 | The programmatic user lacks permission. Check the user's role configuration. |
| `ThrottlingException` | 429 | Request rate too high. **The SDK automatically retries with exponential backoff** — don't add a second retry layer on top. |
| `InternalServerException` | 500 | Internal error. Retryable — **the SDK automatically retries these**. |
| `SerializationException` | 400 | Request body couldn't be parsed. Verify it's valid JSON. |

---

## Common types

Shared shapes referenced across most resources.

### Metadata Object

Optional organizational metadata for categorizing/grouping resources in the workspace.
**Purely organizational — it does not affect runtime behavior.**

| Field  | Type     | Required | Notes |
| ------ | -------- | -------- | ----- |
| `path` | string   | No       | Folder-like path, e.g. `/support/tags`, `/production`. Max 512 chars. |
| `tags` | string[] | No       | Classification labels for filtering/grouping. Max 5 tags, each max 256 chars. |

```json
{ "metadata": { "path": "/customer-support/sentiment", "tags": ["production", "support"] } }
```

### Pagination

- **`nextToken`** (string) — opaque token returned in list responses when more results
  are available; pass it back to get the next page. `null`/absent means no more pages.
- **`maxResults`** (integer) — max items per page; default/max vary by resource, typically
  1–500 (Knowledge Base list operations cap at 100 — see
  `guardrails-and-knowledge-bases.md`).

### languageCode

A single BCP-47 language code (type `String`), e.g. `en-US`, `es-ES`, `fr-FR`. Supported
codes (non-exhaustive list is exhaustive per the docs):

```
ar-AE ar-KW ar-MEA ar-QA ar-SA az-AZ bg-BG bs-BA ca-ES cs-CZ da-DK de-AT de-CH de-DE
el-GR en-INT en-CA en-IE en-IN en-NZ en-PH en-PK en-SG en-ZA en-EG en-KE en-KW en-MEA
en-MY en-NG en-UAE en-AE en-AU en-GB en-QA en-SE en-US es-419 es-ES es-CB es-US es-AR
es-CL es-CO es-MX es-PE et-EE fi-FI fr-BE fr-CA fr-CH fr-DZ fr-FR hi-IN hr-HR hu-HU
is-IS it-IT id-ID ja-JP kk-KZ ko-KR lt-LT lv-LV mk-MK ms-MY nl-BE nl-NL no-NO pl-PL
pt-BR pt-PT ro-RO ru-KZ ru-RU sk-SK sl-SI sq-AL sr-RS sv-SE th-TH tr-TR uk-UA vi-VN
zh-CN zh-HK zh-TW
```

Useful when mapping a legacy IVR's regional prompt sets — check the caller locale (e.g.
`en-GB` vs `en-US` vs `en-IN`) actually has a matching code before assuming one exists.

### languageCodes

Type `Array` — a list of BCP-47 codes for a resource's supported languages, e.g.
`["en-US", "es-ES", "fr-FR"]`.
