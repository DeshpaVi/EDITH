# Limitations

Ordered by how likely they are to change what you decide to build. Several are
properties of Amazon Connect rather than of this app, and are called out as
such — those cannot be engineered around from inside the app.

---

## 1. There is no push API for live transcripts that a browser can use

**Constraint, not a shortcut.** Contact Lens real-time analysis is exposed to
callers in two ways: SigV4-signed `List…` APIs, and a Kinesis Data Stream. A
browser can use neither — the first needs AWS credentials, the second needs a
consumer. So the transcript arrives by **polling a backend proxy**, currently
every 3 seconds (`VITE_TRANSCRIPT_POLL_MS`).

Consequences:

- **Latency floor of roughly one poll interval on top of Contact Lens's own
  2–5s segment cadence.** Expect a spoken sentence to appear 3–8 seconds later.
  This app cannot show word-by-word transcription; Contact Lens emits finished
  segments, not partial hypotheses.
- **API call volume scales with concurrent agents.** 100 agents at 3s is ~33
  requests/second sustained, each costing one `DescribeContact` plus one
  analysis call. Both count against Amazon Connect API quotas for the instance.
  Dropping to 5s costs little in perceived latency and a third of the calls.
- Polling below ~2s gains nothing: it returns the same segments again.

**If you need lower latency or higher agent counts**, the alternative is the
Kinesis path — Contact Lens real-time segment stream → Kinesis Data Stream →
Lambda → DynamoDB + API Gateway **WebSocket** → browser. That is genuinely
push, removes the per-agent polling entirely, and costs a stateful connection
per agent plus a stream to operate. It is a different backend, not a
configuration change; this app's `TranscriptClient` interface is where it would
plug in.

## 2. Voice and chat use different APIs, and one of them is voice-only

- **Voice** → `connect-contact-lens:ListRealtimeContactAnalysisSegments`
- **Chat** → `connect:ListRealtimeContactAnalysisSegmentsV2`

`…V2` **rejects voice contacts** with `InvalidRequestException`. It is not a
newer version of the voice API. The Lambda dispatches on the channel it reads
from `DescribeContact`; both IAM actions are required.

Knock-on effects:

- **Voice segments carry no wall-clock timestamp** — only millisecond offsets
  from the start of the call. The app therefore shows `02:14` for voice and a
  clock time for chat. Correlating a voice turn with an external event by
  timestamp requires adding the call's start time yourself.
- **Voice analysis is retained for 24 hours.** After that the API returns
  nothing. This is a live-call tool, not an archive.
- **Task and email contacts have no real-time transcript at all.** The app says
  so rather than showing an empty panel.

## 3. Real-time analytics must be on *before* the call, in the flow

Contact Lens cannot be switched on mid-call. If the flow's **Set recording and
analytics behavior** block specified post-call analysis — or no analysis — the
transcript panel will be empty for that contact's entire life, and the only fix
is to change the flow for *future* calls.

Related: analysis starts where that block runs. Anything said before it (an
early greeting prompt, a menu) is not in the transcript.

## 4. Attributes are read, not watched

The agent workspace SDK offers no "attribute changed" event. The app re-reads
attributes on a timer (`VITE_ATTRIBUTE_REFRESH_MS`, default 5s) and on the
contact lifecycle events it *does* get (`connected`, `starting ACW`, `cleared`).

So an attribute a flow writes mid-call appears within about 5 seconds, not
instantly. Shortening the interval increases postMessage traffic to the
workspace; it does not make the workspace's own data fresher.

## 5. Sign-in is a click, once per app load

The app holds no tokens in `localStorage` or `sessionStorage` — only in memory.
An agent workstation is not a trusted device, and a token that outlives the tab
is a token that can be lifted from storage later.

The cost: **the agent clicks "Sign in" once each time the app loads**, and the
popup must be opened from that click because browsers block popups from timers.
An OIDC redirect inside the workspace iframe is not an option — Cognito's
Hosted UI, and any SAML IdP behind it, refuse to be framed.

Ways to reduce the friction, in increasing order of how much you give up:

1. Federate the Cognito pool with the IdP the agents are already signed into —
   the popup then completes without a password prompt. **Recommended.**
2. Raise `RefreshTokenValidity` so one sign-in lasts a full shift.
3. Persist the refresh token in `sessionStorage`. This survives app reloads
   within the tab and is a real, if modest, increase in exposure. It is not the
   default for that reason.

## 6. The ownership check depends on usernames lining up

The backend proves the caller is the agent on the contact by matching a JWT
claim (`email` by default) to the agent's **Amazon Connect username**, then
comparing the resolved Connect user id to the contact's `AgentInfo.Id`.

- If usernames and email addresses do not correspond, every request fails
  **closed** with 403. Safe, but it looks like a permissions bug.
- The lookup is cached for 10 minutes per username. A user renamed in Connect
  can see up to 10 minutes of 403s.
- A contact that is still **ringing** has no `AgentInfo` yet, so it is denied
  until the agent accepts it. This is correct — there is nothing to transcribe —
  and resolves on the next poll.
- `ENFORCE_CONTACT_OWNERSHIP=false` removes this check entirely and makes any
  signed-in user able to read any live contact's transcript by id. It exists
  for isolated load testing and nothing else.

## 7. Transferred voice calls need the initial contact

Contact Lens keys voice analysis on the contact the call **started** as. After a
transfer, the receiving agent's contact id returns nothing.

The backend handles this: it authorises against the agent's *current* contact,
then reads `InitialContactId` from `DescribeContact` and queries analysis under
that. The browser never nominates either id — that is what keeps the ownership
check meaningful.

Residual limitation: the transcript the receiving agent sees **includes the
earlier leg of the call**, with the first agent's turns. That is usually what
you want on a warm transfer and may not be what you want on a cold one. There
is no per-leg filter in the API.

## 8. Masking is a display control, not a security control

Sensitive attributes are masked on screen and excluded from *Copy for notes*,
but the raw value is in the page's memory because the workspace handed it over.
A masked account number is protected from a shoulder and a screen-share, not
from devtools or a browser extension.

**If a value must never reach the agent's browser, do not put it in a contact
attribute.** Attributes are visible to any app the agent's security profile
permits, and to the CCP itself.

Compliance text is the mirror image: it is never masked, never trimmed and
never reformatted, because the agent may need to read it back verbatim.

## 9. Scope and layout constraints of the workspace

- The app is an **iframe** hosted by the workspace. It cannot resize its own
  panel, cannot show notifications outside its frame, and shares nothing with
  the CCP beyond the SDK's postMessage channel.
- The **width is the agent's choice** and can be narrow. The layout is
  container-query driven and goes to a single column below ~880px, which is the
  common case in a docked rail.
- The app sees **one contact**: the one in its launch scope, or the one the
  lifecycle events name. On an agent handling concurrent chats it follows the
  contact the workspace has in focus; there is no multi-contact view.
- `AppContext.instanceId` is the **app** instance id, not the Amazon Connect
  instance id. The Connect instance id is fixed in the Lambda's environment at
  deploy time and is never taken from a request.

## 10. Cost drivers to size before a rollout

| Driver | Note |
|---|---|
| Contact Lens real-time | Per analysed minute, per contact. The largest line by far. |
| Amazon Connect API calls | 2 per poll per agent. See §1. |
| Lambda | ~1 invocation per poll per agent; 512MB, sub-second. |
| API Gateway HTTP API | Per request; same volume as the polls. |
| CloudFront + S3 | Negligible — a ~90KB gzipped bundle, cached. |
| Cognito | Free tier covers most agent populations. |

## 11. Known gaps in this build

- **No accessibility audit has been run.** The markup is semantic and
  keyboard-operable, and the transcript uses live regions, but this has not been
  tested with a screen reader.
- **No end-to-end test against a live Connect instance.** The unit tests cover
  the pure layers (25 tests over attribute selection, formatting, masking,
  transcript normalisation and merging). The SDK surface used is taken from the
  published `@amazon-connect/*` type definitions, not from a recorded session.
- **No contact flow JSON is shipped.** Deliberately: an importable flow file
  written from documentation rather than from a real export will fail on import
  in a way that is slow to diagnose. Step 2 of the console guide describes the
  two blocks to configure instead.
- **No supervisor or monitoring view.** The app is scoped to the agent on the
  contact by design.

---

## When the transcript panel stays empty

In the order worth checking:

1. **Is real-time analytics actually on for this call?** The flow block must say
   *Real-time* (or *Real-time and post-call*). Post-call only produces nothing
   live. This is the cause most of the time.
2. **Is call recording on?** Voice analysis reads the recorded stream.
3. **Has the call been connected for more than ~10 seconds?** Analysis takes a
   few seconds to spin up; the app shows *"analysis has not started yet"*.
4. **Is Contact Lens enabled at the instance level?** The flow setting does
   nothing without it.
5. **Did the agent sign in?** The panel shows a **Sign in** button if not.
6. **403 "not assigned to you"** → §6 above.
7. **Check the Lambda's CloudWatch log group** (`/aws/lambda/acw-handoff-transcript`).
   Transcript content is never logged; errors and contact ids are.
