# IVR → ACXD Migration Playbook

## Contents
- [Full mapping table](#full-mapping-table)
- [Containment & escalation recipes](#containment--escalation-recipes)
- [Accessibility & parity risks to flag](#accessibility--parity-risks-to-flag)
- [Worked example: a 3-option billing IVR](#worked-example-a-3-option-billing-ivr)
- [Migration checklist](#migration-checklist)

This applies whether the source is a classic Amazon Connect contact flow, a third-party
IVR platform (Genesys, Avaya, Nuance, etc.), or a paper call-flow script — the concepts
below are IVR-concept-to-ACXD-concept, not vendor-specific. If the source material is
ambiguous about a detail (exact wording of a compliance prompt, exact digit mapping),
ask rather than guess — compliance/legal language especially shouldn't be paraphrased.

**Not everything moves into ACXD.** When the source is a classic Amazon Connect contact
flow, pure entry/routing logic — which queue, is it after hours, which number was dialed,
channel setup — stays in a (trimmed) contact flow that then hands off to the ACXD
application through an Agentic CX block. Only the caller-facing conversational logic
(menus, prompts, capture, data dips, escalation *decisions*, though not queue mechanics
themselves) is what actually maps to the table below. See
`references/connect-customer-bridge.md` for exactly how that handoff is wired and
published.

## Full mapping table

| Legacy IVR element | ACXD construct | Notes |
| --- | --- | --- |
| Queue/business-hours/DID routing *before* any conversation starts | Stays in the (trimmed) Connect Customer contact flow, upstream of the Agentic CX block | Not an ACXD construct at all — see `connect-customer-bridge.md`. |
| Opening greeting | `start` node → `basic` node | First message after `start`. |
| Static announcement / prompt | `basic` node (`messages`) | Use as-is for wording that must stay exact (legal, compliance). |
| DTMF menu ("press 1 for billing...") | `user_choice` node + Slot Type with `choicePayload` per value | One value per digit; `choicePayload` carries the old routing intent. |
| DTMF menu, being upgraded to NLU | `intent_capture` node | Deliberate design upgrade, not a default — say so explicitly. |
| Free-form digit capture (account #, PIN) | `user_input` node + Attached Slot with `regex`, `sensitive: true` | Keep the same validation regex the IVR used where possible. |
| Backend lookup / data dip | Data Request (webhook) → `data_request` node | `sensitive: true` on the Data Request if the payload includes PII. |
| Branch on account status / hours-of-operation / queue depth | `data_request` node feeding a `choice`/`split` node | Same two-step shape regardless of what's being checked. |
| Transfer to agent/queue | `escalate` node | Pair with `defaultFlows.escalation` at the application level for the global "0 for an agent" case. |
| Transfer to a different IVR application/module | `application_handoff` node | Use when decomposing one large legacy IVR into several ACXD applications. |
| Submenu / "go back" navigation | `redirect` node between flows, or nested `user_choice` nodes within one flow | Prefer separate flows once a submenu has its own significant logic — keeps individual flows readable. |
| Repeat prompt ("press * to repeat") | `defaultFlows.repeat` | Application-level, not per-node. |
| Invalid entry / no-match | `defaultFlows.fallback` + `thresholds.incomprehensionCount` | Set the threshold deliberately — this is your "max invalid attempts." |
| No input (silence timeout) | `conversationTTL` (session-level) + `repeatOnIncomprehension` | `conversationTTL` is the outer session bound; per-turn silence handling is closer to `repeatOnIncomprehension`. |
| Compliance/recording disclosure | `basic` node with exact legal wording, or a `guardrail` with `trigger: "output"` if it must appear even when other flow paths change | Treat wording changes as a compliance review item, not a copy edit. |
| PCI-scope payment collection | `user_input` node, Attached Slot `sensitive: true`, plus a masking `guardrail` on `trigger: "input"` and/or `"output"` | The IVR likely relied on carrier/network-level PCI segmentation ACXD doesn't have automatically — guardrails are the replacement. |
| Multi-language IVR | `mainLanguageCode` + `languageCodes` on app/flow, `languageSettings[].voice` per language | Confirm every legacy locale has a matching BCP-47 code (see common types). |
| Static FAQ content (hours, address, policy) | `basic` node (rarely-changing) or `knowledge_base` node (frequently-changing) | Move to a KB whenever content owners update it more than once a quarter. |
| Sentiment-triggered escalation (rare in legacy IVR) | `defaultFlows.frustration` | New capability — flag as a design upgrade, not a like-for-like mapping. |
| Session variables carried across menu levels | Context Variable | Don't manually re-thread state through every node's `metadata` — use a Context Variable instead. |
| Legacy "hold music while looking something up" | `wait` node around a slow `data_request` | |

## Containment & escalation recipes

**"Max invalid entries before transfer to agent"** (classic IVR containment setting):

```js
settings: {
  thresholds: { incomprehensionCount: 3 },   // matches "3 invalid attempts" IVR config
  repeatOnIncomprehension: true,              // repeat the prompt on 1st/2nd miss
  defaultFlows: {
    fallback: { flowId: "EscalationFlow" },   // 3rd miss falls through here
  },
}
```

**Global "0 for an agent" / "representative" stop-word**, implemented as a guardrail so it
works from *any* node without being wired into each one individually:

```js
await client.send(new CreateGuardrailCommand({
  name: "Agent Escalation Keyword",
  trigger: "input",
  active: true,
  rules: [
    {
      name: "Agent request",
      detection: { method: "keyword", keywords: ["agent", "representative", "human", "operator"] },
      enforcement: { action: "route", behavior: { flowId: "EscalationFlow" } },
      active: true,
    },
  ],
}));
```

**PCI-safe payment capture** — mask on the way in and the way out:

```js
// Slot: sensitive capture
{ name: "cardNumber", type: "PaymentCardType", sensitive: true, regex: "^[0-9]{13,19}$" }

// Guardrail: don't let a card number leak back out in a bot response, transcript, or log
await client.send(new CreateGuardrailCommand({
  name: "Card Number Masking",
  trigger: "output",
  active: true,
  rules: [{
    name: "Card number pattern",
    detection: { method: "regex", pattern: "\\b(?:\\d[ -]*?){13,19}\\b" },
    enforcement: { action: "mask", behavior: { maskText: "[CARD NUMBER REDACTED]" } },
    active: true,
  }],
}));
```

## Accessibility & parity risks to flag

Call these out explicitly rather than letting them pass silently during a migration:

- **NLU confidence vs. deterministic DTMF.** A phone keypad has zero ambiguity; NLU does
  not. A menu option that was unambiguous as "press 3" may need a confirmation turn once
  it's "say what you're calling about."
- **Latency.** A `data_request` webhook replacing what used to be a synchronous mainframe
  dip inside a telecom switch can be materially slower — decide if a `wait` node / hold
  message is needed.
- **DTMF fallback for accessibility/noisy environments.** If the target channel is still
  voice, consider whether `user_choice` nodes should still accept DTMF-style input
  alongside speech, not just NLU.
- **Compliance wording drift.** Never silently reword a recording disclosure, consent
  script, or regulated disclosure during migration — flag it for legal review instead of
  improving it stylistically.
- **Session state assumptions.** Legacy IVRs often relied on ANI-based (caller ID) lookups
  that have no equivalent when the same application also serves chat/web. Check whether
  authentication logic assumed a phone channel.

## Worked example: a 3-option billing IVR

**Legacy script (as given by the customer):**

> "Thanks for calling Acme Billing. For account balance, press 1. To make a payment,
> press 2. For all other questions, press 0 to speak with a representative. If we don't
> hear anything in 5 seconds, we'll repeat this menu; after 3 tries we'll transfer you."

**ACXD design:**

- **Application** `AcmeBilling`, `settings.thresholds.incomprehensionCount: 3`,
  `settings.repeatOnIncomprehension: true`, `settings.defaultFlows.fallback` and
  `.escalation` both pointing at an `EscalationFlow`.
- **Flow** `BillingMenu`:
  - `start` → `basic` (the greeting above, verbatim) → `user_choice` node backed by a
    `BillingMenuOption` slot type:
    - `{ value: "balance", choicePayload: "1", synonyms: ["account balance", "how much do I owe"] }`
    - `{ value: "payment", choicePayload: "2", synonyms: ["make a payment", "pay my bill"] }`
    - `{ value: "other", choicePayload: "0", synonyms: ["representative", "agent", "something else"] }`
  - `balance` branch → `data_request` node calling a `getAccountBalance` Data Request →
    `basic` node reporting the result.
  - `payment` branch → `redirect` to a separate `PaymentFlow` (kept separate since payment
    collection has its own PCI-guardrail requirements — see recipe above).
  - `other` branch → `escalate` node.
- A guardrail with `trigger: "input"`, `detection.method: "keyword"`,
  `keywords: ["representative", "agent", "operator"]`, `enforcement.action: "route"` to
  `EscalationFlow` covers the case where the caller says "representative" mid-menu instead
  of navigating the choice node — something the original DTMF menu couldn't support at all
  (you could only press 0 at the prompt, not interrupt).

This mapping preserves 1:1 IVR parity for the timing/attempt-count behavior while
upgrading the option matching from digit-exact to synonym-aware — a deliberate,
called-out design improvement rather than a silent one.

## Migration checklist

- [ ] Source material inventoried (script, DTMF tree, data dips, transfers, compliance
      text, language variants, global commands) — confirmed with the requester, not assumed.
- [ ] Every DTMF option mapped to a `user_choice`/`intent_capture` node with a decision
      recorded on which approach was used and why.
- [ ] Every data dip mapped to a Data Request with `sensitive` set correctly.
- [ ] Containment settings (`incomprehensionCount`, `repeatOnIncomprehension`,
      `defaultFlows.fallback`) set to match (or deliberately improve on) the legacy config.
- [ ] Global commands (agent, repeat, help) implemented as guardrails/`defaultFlows`
      rather than duplicated per-node.
- [ ] Sensitive capture paired with masking on the way in (slot/modality `sensitive`/
      `isSensitive`) *and* the way out (output-trigger guardrail).
- [ ] Compliance/legal wording carried over verbatim, flagged for legal sign-off if any
      change was necessary.
- [ ] Language/locale coverage checked against the supported BCP-47 code list.
- [ ] Build created and validated (`GetApplicationBuild` status `BUILT`, not `FAILED`)
      before any deployment step is proposed.
- [ ] Deployment targeted at a non-production environment first (`development`/`qa`/
      `staging`) unless the requester says otherwise.
- [ ] Agentic CX block wired into the (trimmed) legacy contact flow — workspace,
      application, environment alias, and escalation/error/timeout pathways all set —
      and the contact flow published. This is the step that actually cuts the IVR over;
      an ACXD build with no bridge wired is not yet a migration.
