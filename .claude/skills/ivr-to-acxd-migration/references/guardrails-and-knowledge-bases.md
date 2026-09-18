# Guardrails and Knowledge Bases

## Contents
- [Guardrails: CRUD](#guardrails-crud)
- [TestGuardrail](#testguardrail)
- [ListGuardrailEvents](#listguardrailevents)
- [Guardrail Rule shape](#guardrail-rule-shape)
- [Knowledge Bases: CRUD](#knowledge-bases-crud)
- [Publishing a Knowledge Base](#publishing-a-knowledge-base)
- [Response Config](#response-config)
- [Knowledge Base Articles](#knowledge-base-articles)
- [Knowledge Base Documents](#knowledge-base-documents)

---

## Guardrails

Guardrails define safety rules that monitor conversation content and enforce behavior —
masking, modifying, rerouting, or flagging — when violations are detected. This is the
ACXD-native way to implement things a legacy IVR often did structurally (network
segmentation for PCI, hard-coded compliance branches).

### Guardrails: CRUD

**ListGuardrails** — pagination only.

**CreateGuardrail**

| Parameter          | Type    | Required |
| ------------------- | ------- | -------- |
| `name`              | string  | Yes      |
| `rules`             | array   | Yes      |
| `trigger`           | string  | Yes      |
| `description`       | string  | No       |
| `active`            | boolean | No       |
| `metadata`          | object  | No       |
| `fallbackBehavior`  | object  | No       |

```js
await client.send(new CreateGuardrailCommand({
  name: "PII Filter",
  trigger: "output",
  description: "Masks PII in bot responses",
  active: true,
  rules: [
    {
      name: "Email detection",
      detection: {
        method: "regex",
        pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
      },
      enforcement: { action: "mask", behavior: { maskText: "[REDACTED]" } },
      active: true,
    },
  ],
  metadata: { path: "/safety", tags: ["pii"] },
}));
```

**GetGuardrail** — `guardrailIdentifier` (required).
**UpdateGuardrail** — same shape as Create, `guardrailIdentifier` required, rest optional.
**DeleteGuardrail** — `guardrailIdentifier` (required). No response body.

Errors across these: `ValidationException` (400), `ConflictException` (409, Create only),
`ResourceNotFoundException` (404, Get/Update/Delete), `InternalServerException` (500)

### TestGuardrail

Tests a guardrail against sample input **without affecting live conversations** — use
this to validate a masking/compliance rule before wiring it into a deployed flow.

**Input:** `guardrailIdentifier` (required), `input` (string, required), `trigger`
(optional).

```js
await client.send(new TestGuardrailCommand({
  guardrailIdentifier: created.guardrailId,
  input: "My email is john@example.com",
}));
```

```json
{
  "input": "My email is john@example.com",
  "processedInput": "My email is [REDACTED]",
  "output": "My email is [REDACTED]",
  "blocked": false,
  "terminalRuleId": null,
  "violations": [
    {
      "ruleId": "r1a2b3c4-...",
      "ruleName": "Email detection",
      "action": "mask",
      "behavior": { "maskText": "[REDACTED]" },
      "metadata": { "pattern": "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}" },
      "latencyMs": 12
    }
  ]
}
```

### ListGuardrailEvents

Lists historical guardrail trigger events — useful for auditing masking/compliance
behavior post-migration.

**Input:** `startTimestamp`, `endTimestamp` (both required, ISO 8601); optional filters:
`guardrailIdentifier`, `behaviorType` (`mask`|`modify`|`route`|`flag`), `userId`,
`applicationId`, `conversationId`, `languageCode`, `ruleId`, `sortBy` (`timestamp`),
`sortOrder` (`asc`|`desc`), `timezone`, plus pagination.

### Guardrail Rule shape

| Field                | Type    | Required |
| --------------------- | ------- | -------- |
| `id`                  | string  | No (server-generated) |
| `name`                | string  | Yes      |
| `detection`           | object  | Yes      |
| `enforcement`         | object  | Yes      |
| `description`         | string  | No       |
| `active`               | boolean | No       |
| `stateModifications`  | array   | No       |
| `tags`                | array   | No       |

**Detection**

| Field       | Type   | Required |
| ----------- | ------ | -------- |
| `method`    | enum   | Yes      |
| `pattern`   | string | No       |
| `keywords`  | array  | No       |
| `prompt`    | string | No       |
| `threshold` | float  | No       |

`method` is one of `regex`, `keyword`, `llmJudge`. `pattern` (regex, max 200 chars) pairs
with `regex`; `keywords` (max 200, each max 50 chars) pairs with `keyword`; `prompt` (LLM
evaluation prompt, max 4000 chars) + `threshold` (0–1 confidence) pair with `llmJudge`.

**Enforcement**

| Field      | Type   | Required |
| ---------- | ------ | -------- |
| `action`   | enum   | Yes      |
| `behavior` | object | No       |
| `tags`     | array  | No       |

`action` is one of `mask`, `modify`, `route`, `flag`. `behavior` shape depends on `action`:

- **`mask`/`flag`:** `{ "maskChar": "*", "maskText": "[REDACTED]" }`
- **`modify`:** `{ "message": "I can't help with that.", "prompt": "...", "flowId": "..." }`
  — `message` is a static replacement (max 500 chars), `prompt` generates one via LLM
  (max 1000 chars), `flowId` routes there after modification.
- **`route`:** `{ "flowId": "EscalationFlow" }` (required) — this is the shape for the
  "global agent command" / "compliance stop-word" guardrails described in the migration
  playbook.

**Fallback Behavior** — what happens if guardrail processing itself fails (e.g. LLM
timeout): `type` is `continue` (proceed without guardrail) or `routeToFlow` (route to a
safe flow, requires `flowId`). **Always set this explicitly for guardrails guarding
compliance-sensitive content** — silently continuing past a failed PII filter is rarely
the right default.

Guardrail request parameters not covered above: `guardrailId` (assigned identifier),
`trigger` (`input` = check user messages, `output` = check bot responses), `active`
(boolean), `createdAt`/`updatedAt`/`lastUpdatedBy` (audit fields).

---

## Knowledge Bases

Knowledge bases power AI-generated responses from articles (structured Q&A) or documents
(uploaded files). **They must be published before they're available in conversations** —
creating one doesn't make it live.

### Knowledge Bases: CRUD

**ListKnowledgeBases** — pagination only.

**CreateKnowledgeBase**

| Parameter          | Type   | Required |
| ------------------- | ------ | -------- |
| `name`              | string | Yes      |
| `type`              | enum   | Yes      |
| `description`       | string | No       |
| `response`          | object | No       |
| `mainLanguageCode`  | enum   | No       |
| `languageCodes`     | array  | No       |
| `metadataSchema`    | object | No       |
| `metadata`          | object | No       |

`type` is `articles` or `documents`. `metadataSchema` is a JSON Schema for
article/document metadata structure.

```js
await client.send(new CreateKnowledgeBaseCommand({
  name: "Product FAQ",
  type: "articles",
  description: "Common product questions",
  response: { summarize: true, minConfidenceScore: 70, k: 3 },
  mainLanguageCode: "en-US",
  languageCodes: ["en-US"],
  metadata: { path: "/support", tags: ["faq"] },
}));
```

**GetKnowledgeBase** — `knowledgeBaseId` (required).
**UpdateKnowledgeBase** — same shape as Create, `knowledgeBaseId` required, rest optional.
**DeleteKnowledgeBase** — `knowledgeBaseId` (required). No response body.
**CloneKnowledgeBase** — `knowledgeBaseId` (required), `name` (optional new name),
`portTranslations` (boolean, whether to copy translations). Creates a copy with a new ID
— useful for a staging/production split during migration testing.

Errors across these: `ValidationException` (400), `ConflictException` (409, Create only),
`ResourceNotFoundException` (404, Get/Update/Delete/Clone), `InternalServerException` (500)

`creationStatus` on a KB is `PENDING` or `SUCCEEDED`.

### Publishing a Knowledge Base

**PublishKnowledgeBase** — `knowledgeBaseId` (required); `deploymentId`, `version`,
`description` optional. Triggers indexing.

```js
await client.send(new PublishKnowledgeBaseCommand({
  knowledgeBaseId: created.knowledgeBaseId,
  version: "1.0",
  description: "Initial publish",
}));
// → { deploymentId, knowledgeBaseId, status: "scheduled", version, description, updatedBy }
```

**GetKnowledgeBasePublication** — `knowledgeBaseId` + `deploymentId` (both required).
`status` is `scheduled`, `published`, or `failed`.

**ListKnowledgeBasePublications** — `knowledgeBaseId` (required) + pagination
(`maxResults` 1–100 here, note the smaller cap than most other list operations).

### Response Config

Controls how a knowledge base answers within a conversation (used both on
`CreateKnowledgeBase`/`UpdateKnowledgeBase` and referenced from `knowledge_base` flow
nodes):

| Field                 | Type    | Notes |
| ---------------------- | ------- | ----- |
| `summarize`            | boolean | Whether to summarize retrieved content before returning it. |
| `minConfidenceScore`   | float (0–100) | Results below this score aren't returned — raise this if migrating a compliance-sensitive FAQ where a wrong answer is worse than no answer. |
| `temperature`          | float   | LLM sampling temperature for response generation. |
| `topP`                 | float   | Top-p sampling parameter. |
| `k`                    | integer | Number of results retrieved from the KB. |

## Knowledge Base Articles

Structured Q&A content within a knowledge base of `type: "articles"`. Each article pairs
one question with one or more response messages — this is the natural home for the FAQ
content a legacy IVR read out verbatim, once it's the kind of content that should stay
editable without a flow redeploy.

- **ListKnowledgeBaseArticles** — `knowledgeBaseId` (required) + pagination
  (`maxResults` 1–100).
- **CreateKnowledgeBaseArticle** — `knowledgeBaseId`, `question`, `responses` (required);
  `articleMetadata`, `payload`, `tags` optional.
- **GetKnowledgeBaseArticle** / **UpdateKnowledgeBaseArticle** /
  **DeleteKnowledgeBaseArticle** — keyed by `knowledgeBaseId` + `articleId`.

```js
await client.send(new CreateKnowledgeBaseArticleCommand({
  knowledgeBaseId: "kb-a1b2c3d4-...",
  question: { text: "How do I reset my password?" },
  responses: [
    { type: "text", body: "Go to Settings > Security > Reset Password." },
    { type: "text", body: "If you still have trouble, contact support." },
  ],
  tags: ["account", "security"],
}));
```

`question.text` (required) is what gets matched against user queries — write it the way
callers actually phrase the question, not the internal title the legacy IVR script used.
`question.messageId` is server-generated; `question.skipTranslation`/`.translated` control
translation. `responses[]` are message objects (`{ type: "text", body: "..." }`) — an
article can have multiple response messages, delivered in order. `payload` holds raw
content up to 10,000 characters when needed beyond structured responses. `tags` (max 5,
each max 256 chars) are classification labels, separate from analytics tags.

Errors: `ValidationException` (400), `ResourceNotFoundException` (404, all but List),
`InternalServerException` (500)

## Knowledge Base Documents

Uploaded files (PDFs, text, HTML) within a knowledge base of `type: "documents"`.
Documents are registered via the API, then uploaded through a pre-signed URL — the SDK
never carries the file bytes directly.

- **ListKnowledgeBaseDocuments** — `knowledgeBaseId` (required) + pagination.
- **GetKnowledgeBaseDocument** — `knowledgeBaseId`, `documentId` (required) → a
  pre-signed **download** URL.
- **PutKnowledgeBaseDocument** — `knowledgeBaseId`, `documentId`, `contentType`
  (required); `customerMetadata` optional. Registers the document and returns a
  pre-signed **upload** URL plus form `fields` for a multipart upload.
- **DeleteKnowledgeBaseDocument** — `knowledgeBaseId`, `documentId`.

```js
const upload = await client.send(new PutKnowledgeBaseDocumentCommand({
  knowledgeBaseId: KNOWLEDGE_BASE_ID,
  documentId: "product-guide-v2.pdf",
  contentType: "application/pdf",
  customerMetadata: { category: "guides", version: "2.0" },
}));
// upload.url + upload.fields → perform the actual multipart form upload of the file bytes
```

`documentId` is user-provided (often just the filename), max 255 characters.
`uploadStatus` is `PENDING` (registered, not yet uploaded), `UPLOADED` (file received), or
`DELETED`. `customerMetadata` structure is whatever the knowledge base's `metadataSchema`
defines.

Errors: `ValidationException` (400), `ResourceNotFoundException` (404),
`InternalServerException` (500)
