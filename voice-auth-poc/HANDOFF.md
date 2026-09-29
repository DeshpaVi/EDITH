# Custom Voice Authentication on Amazon Connect — Handoff

**Context:** Amazon Connect Voice ID reached end of support on **20 May 2026**. This
document answers whether a custom voice biometric authentication POC is feasible, what it
needs, and what it would take to build.

---

## Summary

| Question | Answer |
|---|---|
| Is Voice ID really unavailable? | Yes. End of support 20 May 2026. No AWS replacement service. |
| Can we build a custom version? | **Yes** — for a limited-user POC, in a few days. |
| Is it production-ready? | **No.** Accuracy over telephony, no anti-spoofing, and biometric privacy law are all real blockers. |
| Should we build it? | Build the POC. Decide production separately, with legal input and a Pindrop price for comparison. |

---

## 1. Where Voice ID stands

AWS ended support on 20 May 2026 and stopped accepting new customers a year earlier. Their
published transition guidance offers two routes:

- **AWS Marketplace partner** — Pindrop is named explicitly.
- **DIY one-time passcode** over AWS End User Messaging SMS.

Neither is voice biometrics. **No other AWS service does speaker verification.** Amazon
Transcribe does speaker *diarization* — separating who spoke when — which is a different
problem and cannot verify identity.

So a custom build means bringing an open-source speaker model and wrapping it in AWS
services. That part is well-understood and achievable.

---

## 2. Clarification 1 — What services are required?

| Service | Role | Required |
|---|---|---|
| Amazon Connect | Telephony, contact flow, attributes | Live path |
| Kinesis Video Streams | Carries live caller audio out of Connect | Live path |
| AWS Lambda (container image) | KVS reader, scoring, orchestration | Yes |
| Amazon S3 | Enrolment recordings, model artefacts | Yes |
| Amazon DynamoDB | Voiceprints, audit log | Yes |
| Amazon SageMaker | Keeps the model warm for the live path | Recommended |
| AWS KMS | Encryption at rest | Yes |
| CloudWatch | Logs, score metrics | Yes |
| AWS End User Messaging SMS | OTP step-up when voice is inconclusive | Recommended |
| Amazon Transcribe | Optional weak liveness check (did they say the expected phrase) | Optional |

**The biometric matching itself is not an AWS service.** It comes from an open-source
model — recommended: **SpeechBrain ECAPA-TDNN** (Apache 2.0, ~80 MB, 192-dimension
embeddings), baked into the Lambda container image.

Infrastructure cost at POC scale is negligible — tens of dollars a month, mostly the
optional SageMaker endpoint. The cost is engineering time.

---

## 3. Clarification 2 — Is a small custom auth for limited users possible?

**Yes.** This is the right scope, and limited users is exactly where it works best.

How it works:

**Enrolment (once per person)**
Record 3-5 clips of ~30 seconds each → convert each to a 192-number vector via the model →
average them into one "voiceprint" → store encrypted in DynamoDB. No audio is needed after
that.

**Verification (per call)**
Caller rings in → Connect streams their audio to Kinesis Video Streams → a Lex bot asks
two or three questions while ~15 seconds of speech accumulates → Lambda reads that
buffered audio, converts it to a vector, and compares it to the stored voiceprint by
cosine similarity → returns a score → the flow branches on it.

**One design constraint worth knowing now:** Connect's Invoke Lambda block times out at
**8 seconds**, but verification needs ~10+ seconds of speech. The Lambda therefore cannot
listen in real time. The fix is to let the bot collect speech first, then have the Lambda
read audio that is already buffered — which takes a second or two. This shapes the whole
flow design.

**Use three outcome bands, not pass/fail:**

| Score | Outcome |
|---|---|
| High | Authenticated — skip security questions |
| Middle | Inconclusive — step up to OTP or agent verification |
| Low | Not authenticated — standard verification |

A binary decision forces a choice between rejecting genuine callers and admitting
impostors. Three bands sends the uncertain middle somewhere useful.

---

## 4. Clarification 3 — Can we customise despite the feature being gone?

**Yes, technically.** Nothing prevents it: the audio is reachable, the models are open
source and permissively licensed, and the AWS building blocks are all standard.

Three things you lose relative to Voice ID, and should say out loud rather than discover
later:

**Accuracy over telephony.** Published benchmarks (~1% error) are measured on 16 kHz clean
audio. Phone calls are 8 kHz narrowband, which discards roughly half the frequency range
these models rely on. Expect materially worse results. The main mitigation is to enrol
over the phone as well, so enrolment and verification conditions match — enrolling on a
laptop mic and verifying over PSTN is the most common reason POCs like this disappoint.

**Anti-spoofing.** Voice ID detected replay and synthesised speech. A DIY build does not.
A recording of the enrolled voice will pass, and cloning a voice from a few seconds of
audio is now trivial. This is the reason voice must be **a factor, not the gate** — good
for "skip two security questions", not for account changes or anything financial.

**Compliance posture.** With Pindrop, the vendor carries much of that burden. Build it
yourself and it sits with you.

---

## 5. The blocker nobody expects: biometric privacy law

*Not legal advice. This needs counsel before any real caller is enrolled.*

A voiceprint is not a call recording. It is a **biometric identifier**, regulated
specifically:

- **Illinois BIPA** — requires a published written policy with a retention schedule, and
  informed written consent *before* collection. Carries statutory damages and a **private
  right of action**, which is what drives class actions. Contact-centre voice biometrics
  has been litigated under it.
- **Texas CUBI**, **Washington** — similar duties, enforced by the state rather than
  individuals.
- **California CPRA and other state privacy laws** — biometric data used for
  identification is *sensitive personal information*, with extra consent and opt-out
  duties.
- **GDPR Article 9** — special category data, prohibited by default, if any EU residents
  call.

An existing "this call may be recorded" notice **does not cover creating a voiceprint**.

For a nationwide senior-care line, assume Illinois callers are in scope. The caller
population is also elderly, which raises the bar on what informed consent means.

**None of this blocks the POC**, provided it stays within the guardrails below.

---

## 6. POC guardrails

These keep this in normal-engineering territory:

- Only **consenting adult colleagues**, consent in writing before recording. Your own
  voice as the primary subject.
- **No customer audio ever** — not from Five9, not from Connect recordings, not from any
  historical call archive. Those were not collected with biometric consent.
- **Pseudonymous speaker IDs** — no phone numbers or names as keys.
- **Retention date set on day one**, enforced by DynamoDB TTL and an S3 lifecycle rule.
- **Delete everything when the POC ends**, and be able to evidence it.
- **Never log audio or embeddings** — scores and decisions only.

---

## 7. Build plan

| Stage | Deliverable | Proves | Est. |
|---|---|---|---|
| 1 | Local script: two WAVs → similarity score | The model separates voices | 0.5 day |
| 2 | Lambda container: enrol + verify from S3 | Runs in AWS | 1 day |
| 3 | KVS reader: stream ARN → PCM | Live audio reachable | 1 day |
| 4 | Connect flow end to end | Call in, get authenticated | 1 day |
| 5 | Demo script incl. failure cases | Presentable | 0.5 day |

**Do not skip stage 1.** If scores don't separate on clean local audio, nothing downstream
will work, and you'll have spent a day on infrastructure to find that out.

---

## 8. Demo design

Include the failures. A voice-auth demo that only ever succeeds proves nothing:

1. Enrolment — show the recordings and the resulting voiceprint.
2. **Genuine call** — authenticated, security questions skipped, score shown.
3. **Impostor call** — a colleague claiming your identity, rejected, routed to step-up.
4. **Replay attack** — play a recording of your voice; it will likely pass. Show it, then
   explain why voice is a factor and not a gate. Volunteering this is far stronger than
   being caught by the question.
5. **Opt-out** — caller declines, gets the normal route, no penalty.

---

## 9. Recommendation

**Build the POC.** It's a few days, the cost is trivial, and it answers a question the
customer is actually asking. Scope it to consenting colleagues.

**Treat production as a separate decision**, gated on three things: a real accuracy
measurement over telephony, legal sign-off on the biometric consent model, and a Pindrop
price for comparison. A vendor that already carries the compliance and anti-spoofing
burden may well be cheaper than owning that liability in-house.

**Frame the value honestly.** Over a phone line, without anti-spoofing, voice
authentication is a **friction-reduction** feature — fewer security questions, faster
handling — rather than a security upgrade. That's a legitimate and valuable thing to
demo. Positioning it as a security improvement invites a question the POC can't answer.

---

## 10. Open questions for the customer

1. What would voice authentication actually gate? Skipping security questions and
   authorising account changes carry very different risk.
2. Which states do callers come from? Is Illinois in scope?
3. Does an existing biometric policy exist, and who owns it?
4. Is the senior-care context PHI-bearing? Does HIPAA apply, and is a BAA in place?
5. What does a caller who declines voice authentication get instead?
6. Has Pindrop been priced? It's AWS's own recommended route.
7. What's the current verification process, and how long does it take? That's the
   baseline any saving is measured against.

---

## Appendix — reference docs

- Voice ID overview: `docs.aws.amazon.com/connect/latest/adminguide/voice-id.html`
- End of support notice: `.../amazonconnect-voiceid-end-of-support.html`
- Live media streaming setup: `.../customer-voice-streams.html`
- Media stream contact attributes: `.../media-streaming-attributes.html`
- Reference implementation pattern (transcription, same KVS mechanics):
  `github.com/amazon-connect/amazon-connect-realtime-transcription`
