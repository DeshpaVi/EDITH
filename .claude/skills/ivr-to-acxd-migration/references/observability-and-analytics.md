# Observability and Analytics

Reviewing what deployed applications actually did — transcripts, event logs, and
sentiment/outcome tagging. This is where you validate a migration held up in production,
not just in design: containment rate, escalation rate, and where callers actually got
stuck.

## Contents
- [Conversations](#conversations)
- [Logs](#logs)
- [Analytics Tags](#analytics-tags)

## Conversations

Conversation history and full transcripts.

**ListConversations** — `startTimestamp`, `endTimestamp` (required); rich optional
filters: `userId`, `applicationId`, `conversationIdentifier`, `flowId`, `flowIds`,
`languageCode`, `utterance` (filter by user utterance text, max 2000 chars), `search`
(full-text search, max 2000 chars), `analyticsTags`, `excludeTrivials`, `userEngagement`,
`sortBy`, `sortOrder`, `includeSilence`, `includeEvaluations`, `timezone`, plus
pagination (`maxResults` 10–300).

```js
await client.send(new ListConversationsCommand({
  startTimestamp: sevenDaysAgo.toISOString(),
  endTimestamp: now.toISOString(),
  maxResults: 10,
}));
```

List items are summaries: `conversationId`, `firstTimestamp`, `applicationId`, `userId`,
`firstUtterance`, `flowIds` (all flows traversed), `elapsedSeconds`, `analyticsTags`,
`avgSentimentScore` (0–1), `avgResponseTime`.

**GetConversation** — `conversationIdentifier` (required); `includeSilence`,
`includeEvaluations` optional. Returns the full transcript:

```js
await client.send(new GetConversationCommand({ conversationIdentifier: "..." }));
```

```json
{
  "conversationId": "...", "timestamp": "...", "userId": "...", "applicationId": "...",
  "duration": 120.5, "flowIds": ["MainFlow", "SupportFlow"], "analyticsTags": ["resolved_issue"],
  "responseTime": 1.2,
  "messages": [
    { "isApplication": false, "text": "I need help with my order", "timestamp": "...", "flowId": "MainFlow", "isEscalation": false, "isIncomprehension": false },
    { "isApplication": true, "text": "I'd be happy to help! Can you provide your order number?", "timestamp": "...", "flowId": "SupportFlow", "nodeId": "ask-order-number", "isEscalation": false, "isIncomprehension": false }
  ],
  "evaluationResults": [{ "evaluationId": "...", "evaluationName": "Quality Check", "score": 0.95, "result": "pass", "feedback": null }]
}
```

Each message: `isApplication` (bot vs. user), `text`, `timestamp`, `flowId`, `nodeId`
(bot messages only — the node that generated it), `correlationId`, `isEscalation`,
`isIncomprehension`, `isStructured`, `analyticsTags`, `type`.

**Migration relevance:** filter by `isIncomprehension: true` messages (via
`GetConversation` inspection, since it's not a direct list filter) to find where the new
ACXD flow is mismatching intent the old DTMF menu never could have gotten wrong — this is
the concrete evidence for the "NLU confidence vs. deterministic DTMF" risk called out in
the migration playbook. `isEscalation` messages show exactly where callers bailed to a
human, which is the containment-rate signal for comparing against the legacy IVR's own
transfer rate.

Errors: `ValidationException` (400), `ResourceNotFoundException` (404, Get only),
`InternalServerException` (500)

## Logs

Time- and attribute-filtered event logs, queried asynchronously like Trails.

**QueryLogs** — `timeFilter` (required, relative or absolute), `searchFilter`,
`sortOrder`, `maxResults`, `nextToken` (all optional).

```js
// Relative (last 7 days, in ms)
await client.send(new QueryLogsCommand({
  timeFilter: { relative: { span: "604800000" } },
  maxResults: 10,
}));

// Absolute
await client.send(new QueryLogsCommand({
  timeFilter: { absolute: { startTimestamp: oneDayAgo.toISOString(), endTimestamp: now.toISOString() } },
  maxResults: 10,
}));

// Filtered by event type
await client.send(new QueryLogsCommand({
  timeFilter: { relative: { span: "604800000" } },
  searchFilter: { eventType: "ConversationStarted" },
  maxResults: 10,
}));
```

Output includes a `queryStatus` (`progressPercentage`, `cumulativeBytesScanned`,
`cumulativeBytesMetered`) alongside `items`, each with `eventType`, `eventTime`, and
`commonProperties` (a `[{key, value}]` array carrying `conversationId`, `applicationId`,
`userId`, etc.). Unlike `GetConversation`, this is raw event-level data suitable for
building custom dashboards or exporting to an external observability pipeline.

Errors: `ValidationException` (400), `InternalServerException` (500)

## Analytics Tags

Label conversation events with a sentiment classification for reporting.

- **ListAnalyticsTags** — no input.
- **CreateAnalyticsTag** — `name`, `type`, `description` (all required); `metadata`
  optional. `type` is one of `positive`, `negative`, `neutral`.
- **UpdateAnalyticsTag** — `name` (required, identifies the tag) + optional fields.
- **DeleteAnalyticsTag** — `name` (required).

```js
await client.send(new CreateAnalyticsTagCommand({
  name: "resolved_issue",
  type: "positive",
  description: "Customer issue was resolved",
}));
```

`name` is alphanumeric + underscores, max 36 characters. `description` max 64 characters.
`isSystemTag` (boolean, read-only) marks platform-managed tags that can't be modified or
deleted. Tags are referenced elsewhere by `{ "label": "tag_name" }` — in guardrail rules
(applied when a rule triggers), application deployments, and flow node `metadata.tags`.

**Migration relevance:** create tags that mirror whatever outcome categories the legacy
IVR's reporting already used (e.g. `resolved_issue`, `transferred_to_agent`,
`abandoned`), so before/after containment comparisons use consistent categories rather
than starting analytics from scratch.

Errors: `ValidationException` (400), `ConflictException` (409, Create),
`ResourceNotFoundException` (404, Update/Delete), `InternalServerException` (500)
