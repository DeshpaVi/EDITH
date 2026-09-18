# Data Requests, Context Variables, Slot Types, and Modalities

## Contents
- [Data Requests](#data-requests)
- [Context Variables](#context-variables)
- [Slot Types](#slot-types)
- [Modalities](#modalities)

---

## Data Requests

A data request is a webhook integration that retrieves or sends data during a
conversation — the direct equivalent of an IVR "data dip" to a backend system (CRM,
billing, mainframe).

### CRUD

**ListDataRequests** — pagination only.

**CreateDataRequest**

| Parameter         | Type    | Required |
| ------------------ | ------- | -------- |
| `dataRequestId`    | string  | Yes      |
| `type`             | enum    | Yes      |
| `webhook`          | object  | Yes      |
| `requestSchema`    | object  | No       |
| `responseSchema`   | object  | No       |
| `sensitive`        | boolean | No       |
| `description`      | string  | No       |
| `metadata`         | object  | No       |

`type` (the return type) is one of `text`, `number`, `boolean`, `list<text>`, `object`,
`list<object>`.

```js
await client.send(new CreateDataRequestCommand({
  dataRequestId: "getCustomerInfo",
  type: "object",
  webhook: {
    implementation: "inline-static",
    code: JSON.stringify({ name: "John Doe", tier: "premium" }),
  },
  responseSchema: {
    type: "object",
    properties: { name: { type: "string" }, tier: { type: "string" } },
  },
  description: "Returns static customer info for testing",
  sensitive: false,
}));
```

**GetDataRequest** — `dataRequestIdentifier` (required).
**UpdateDataRequest** — same shape as Create, `dataRequestIdentifier` required, rest optional.
**DeleteDataRequest** — `dataRequestIdentifier` (required). No response body.

Errors across these: `ValidationException` (400), `ConflictException` (409, Create only),
`ResourceNotFoundException` (404, Get/Update/Delete), `InternalServerException` (500)

### Webhook Config

| Field             | Type    | Required |
| ------------------ | ------- | -------- |
| `implementation`   | enum    | Yes      |
| `method`           | enum    | No       |
| `url`              | string  | No       |
| `headers`          | array   | No       |
| `code`             | string  | No       |
| `environments`     | object  | No       |
| `provider`         | object  | No       |
| `mcp`              | object  | No       |
| `sendContext`      | boolean | No       |

- **`implementation`** — `inline-static` (fixed response, good for stubbing during
  migration before the real backend integration is wired up), `external` (real HTTP
  webhook), or `mcp` (Model Context Protocol tool call).
- **`method`** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (for `external`).
- **`url`** — max 2048 characters (for `external`).
- **`headers[]`** — `key` (max 128 chars), `value` (max 4096 chars, supports secret
  references like `{{secrets.my_secret}}`), `sensitive` (boolean, masked in logs),
  `dynamic` (boolean, evaluated at runtime), `required` (boolean).
- **`code`** — inline code for `inline-static`, max 200,000 characters.
- **`environments`** — free-form per-environment config object.
- **`provider`** — `{ providerId, actionId }` for managed integrations.
- **`mcp.tools[]`** — for `mcp` implementation: `name` (required), `enabled` (boolean),
  `requestSchema`, `responseSchema`. Max 100 tools.
- **`sendContext`** — whether to send conversation context along with the webhook request.

**`requestSchema`/`responseSchema`** use the same JSON Schema convention as Context
Variables (must have `type`, `$ref`, or `anyOf` at the top level).

`dataRequestId` is alphanumeric only, 3–100 characters.

---

## Context Variables

A context variable is a typed variable available across conversations within a
workspace — use it to pass information between flows or set it from external systems.
This is where migrated IVR "session variables" (account number already captured,
authentication state, etc.) should generally live instead of being re-threaded through
every node manually.

### CRUD

**ListContextVariables** — no input parameters.

**CreateContextVariable**

| Parameter                        | Type    | Required |
| ---------------------------------- | ------- | -------- |
| `name`                             | string  | Yes      |
| `schema`                           | object  | No       |
| `disallowExternalModification`     | boolean | No       |
| `metadata`                         | object  | No       |

```js
await client.send(new CreateContextVariableCommand({
  name: "customer_tier",
  schema: { type: "string", isSensitive: false },
  disallowExternalModification: false,
  metadata: { path: "/crm", tags: ["segmentation"] },
}));
```

**UpdateContextVariable** — `contextVariableIdentifier` (required) + `schema`,
`disallowExternalModification`, `metadata` (all optional).
**DeleteContextVariable** — `contextVariableIdentifier` (required). No response body.

Errors: `ValidationException` (400), `ConflictException` (409, Create only),
`ResourceNotFoundException` (404, Update/Delete), `InternalServerException` (500)

### Fields

- **`name`** — letters and underscores only, cannot start with `nlx_context`, max 64 chars.
- **`type`** — `text`, `string`, `number`, or `boolean`.
- **`schema`** — a JSON Schema object; must have at least one of `type`, `$ref`, or
  `anyOf` at the top level. Defaults if omitted. Examples:
  - Simple string: `{ "type": "string" }`
  - Number with constraints: `{ "type": "number", "minimum": 0, "maximum": 100 }`
  - Object: `{ "type": "object", "properties": { "tier": {"type":"string"}, "score": {"type":"number"} } }`
  - Union: `{ "anyOf": [{"type":"string"}, {"type":"number"}] }`
- **`disallowExternalModification`** — if true, only flows can update the variable (not
  external systems mid-conversation). Set this for anything authenticated/authorized
  during the flow itself, so an external system can't spoof it.

---

## Slot Types

A slot type is a custom entity type: a list of values (with optional synonyms) the NLP
engine uses to identify entities in conversation. This is the direct backing store for
DTMF menu options once they become `user_choice` node values.

### CRUD

**ListSlotTypes** — pagination only.

**CreateSlotType**

| Parameter           | Type    | Required |
| --------------------- | ------- | -------- |
| `slotTypeId`          | string  | Yes      |
| `values`              | array   | Yes      |
| `sensitive`           | boolean | No       |
| `mainLanguageCode`    | string  | No       |
| `languageCodes`       | array   | No       |
| `description`         | string  | No       |
| `metadata`            | object  | No       |

```js
await client.send(new CreateSlotTypeCommand({
  slotTypeId: "ProductCategory",
  values: [
    { value: "Electronics", synonyms: ["tech", "gadgets", "devices"] },
    { value: "Clothing", synonyms: ["apparel", "fashion"] },
    { value: "Home", synonyms: ["household", "furniture"] },
  ],
  sensitive: false,
  mainLanguageCode: "en-US",
  languageCodes: ["en-US"],
  description: "Product categories for the catalog",
  metadata: { path: "/commerce", tags: ["catalog"] },
}));
```

**GetSlotType** — `slotTypeIdentifier` (required), `languageCode` (optional, get values
in a specific language).
**UpdateSlotType** — same shape as Create, `slotTypeIdentifier` required, rest optional.
**DeleteSlotType** — `slotTypeIdentifier` (required). No response body.

Errors across these: `ValidationException` (400), `ConflictException` (409, Create only),
`ResourceNotFoundException` (404, Get/Update/Delete), `InternalServerException` (500)

`slotTypeId` is alphabetic only, 3–100 characters.

### Slot Type Value

| Field               | Type    | Required |
| -------------------- | ------- | -------- |
| `value`              | string  | Yes      |
| `valueId`            | string  | No (server-generated) |
| `synonyms`           | array   | No       |
| `skipTraining`       | boolean | No       |
| `skipTranslation`    | boolean | No       |
| `choicePayload`      | string  | No       |

- **`value`** — canonical value, 1–256 chars.
- **`synonyms`** — alternative phrases mapping to this value, each 1–256 chars. **This is
  where you fold in whatever alternate phrasings callers actually used for a DTMF option**
  (e.g. "billing" → synonyms `["pay my bill", "invoice", "payment"]`) — something a
  keypad menu never needed to account for.
- **`choicePayload`** — payload sent when this value is selected in a `user_choice`
  node. Max 200 chars. **This is the field that carries the old DTMF digit's routing
  intent** when migrating a menu 1:1.
- **`skipTraining`** — exclude this value from NLP training (e.g. a legacy/deprecated
  option you're keeping for backward compatibility but not actively promoting).
- **`skipTranslation`** — skip auto-translation for this value.

---

## Modalities

A modality defines the input/output schema for a specific interaction channel (text,
voice, custom/rich). Use this to model channel-specific structured data — e.g. a rich
card on chat/web that has no phone-call equivalent, or fields that need `isSensitive`
masking regardless of channel.

### CRUD

**ListModalities** — pagination only.

**CreateModality** — `modalityId` (required), `schema` (required), `metadata` (optional).

```js
await client.send(new CreateModalityCommand({
  modalityId: "checkout_form",
  schema: {
    type: "object",
    description: "Checkout form data",
    properties: {
      productId: { type: "string", description: "Product SKU" },
      quantity: { type: "number", description: "Quantity to order" },
      confirmed: { type: "boolean", description: "User confirmed" },
      ssn: { type: "string", description: "Social security number", isSensitive: true },
    },
  },
  metadata: { path: "/commerce", tags: ["checkout"] },
}));
```

**GetModality** — `modalityIdentifier` (required).
**UpdateModality** — `modalityIdentifier` (required), `schema`/`metadata` optional.
**DeleteModality** — `modalityIdentifier` (required). No response body (HTTP 204).

Errors across these: `ValidationException` (400), `ConflictException` (409, Create only),
`ResourceNotFoundException` (404, Get/Update/Delete), `InternalServerException` (500)

`modalityId` is alphanumeric + underscores, cannot start with a digit, max 50 chars.

### Modality Schema (recursive)

| Field         | Type    | Required |
| -------------- | ------- | -------- |
| `type`        | string  | Yes      |
| `description` | string  | No       |
| `isSensitive` | boolean | No       |
| `properties`  | object  | No (required when `type` is `object`) |
| `items`       | object  | No (required when `type` is `array`) |

`type` is one of `string`, `number`, `boolean`, `array`, `object`. `properties` is a map
of field name → schema object (recursive) for `object` types; `items` is a schema object
(recursive) for `array` types. `isSensitive` marks a field as masked in logs/exports —
set this on any field carrying what used to be protected by IVR-side network
segmentation (SSNs, card numbers, DOBs used for verification).

```json
{
  "type": "object",
  "description": "User profile card",
  "properties": {
    "name": { "type": "string", "description": "Display name" },
    "age": { "type": "number" },
    "preferences": {
      "type": "array",
      "items": { "type": "string", "description": "A preference tag" }
    },
    "ssn": { "type": "string", "isSensitive": true }
  }
}
```
