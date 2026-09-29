# Legal and Risk

Not legal advice — I'm not a lawyer, and this needs review by counsel before any real
caller is enrolled. What follows is the landscape engineers need to know so the POC is
built safely and nobody is surprised later.

## Contents
- [Why this is different from call recording](#why-this-is-different-from-call-recording)
- [The laws that apply](#the-laws-that-apply)
- [What compliance actually requires](#what-compliance-actually-requires)
- [POC guardrails](#poc-guardrails)
- [Production gate](#production-gate)
- [Why Voice ID going away matters here](#why-voice-id-going-away-matters-here)

## Why this is different from call recording

A call recording is a recording. A **voiceprint is a biometric identifier** — legally
closer to a fingerprint than to an audio file. Several US states regulate its collection
specifically, some with a private right of action, meaning individuals can sue directly
without a regulator getting involved. That is what drives class actions.

The distinction matters because a team already comfortable with "we disclose that calls
are recorded" can reasonably assume voice authentication is covered by the same notice.
It is not.

## The laws that apply

**Illinois BIPA** is the one that drives litigation. Broadly it requires, before
collecting a biometric identifier:
- a **written policy**, made public, with a retention schedule and destruction guidelines;
- **informed written consent** from the individual, obtained beforehand;
- no selling or profiting from the data;
- reasonable care in storage.

It carries statutory damages per violation and a private right of action. Voice biometrics
in contact centres has been litigated under it.

**Texas CUBI** and **Washington** have biometric statutes without the same private right
of action (Texas is enforced by the Attorney General).

**State comprehensive privacy laws** (California CPRA, Colorado, and the growing list)
generally treat biometric data used for identification as **sensitive personal
information**, triggering extra consent, disclosure and opt-out duties.

**GDPR Article 9** classes biometric data used to uniquely identify someone as a special
category — prohibited by default, requiring explicit consent or another narrow basis. Only
relevant if EU residents call in.

For a US-wide senior-care line, assume Illinois callers are in scope. It is not a niche
risk.

## What compliance actually requires

If this ever goes to real callers, the minimum shape is:

1. **Notice and consent before the voiceprint is created** — not after, not buried in a
   terms-of-service update. In an IVR that means a clear spoken notice and an affirmative
   opt-in, captured and stored.
2. **A written, published retention and destruction policy** with specific timeframes.
3. **A working deletion path**, including deletion on request and automatic deletion at
   the retention date.
4. **Encryption at rest and in transit**, with access limited and audited.
5. **An opt-out that doesn't penalise the caller** — they get the existing verification
   route, not worse service.
6. **Vendor and sub-processor clarity** — who else touches the data.

Note that consent has to be meaningful. A notice that says "your call may be recorded"
does not cover creating a voiceprint.

## POC guardrails

These keep the POC in genuinely low-risk territory. They're in the skill's rules for a
reason:

- **Only consenting adult colleagues**, with consent captured in writing before any
  recording. Your own voice is the ideal primary test subject.
- **No customer audio.** Not from Five9, not from Connect recordings, not from any
  historical dataset of real callers. Even for "just testing" — historical recordings were
  not collected with biometric consent.
- **Pseudonymous speaker IDs.** No phone numbers, names or emails as the DynamoDB key.
- **A retention date set on day one**, enforced with a DynamoDB TTL and an S3 lifecycle
  rule, so expiry is automatic rather than remembered.
- **Delete everything when the POC ends**, and be able to show it was deleted.
- **Never log audio or embeddings** to CloudWatch. Scores and decisions only.
- **Keep it in one AWS account/region** so there is no question later about where copies
  live.

A POC on a handful of consenting employees is a normal engineering activity. The moment a
real caller's voice is processed, everything above becomes mandatory.

## Production gate

Before anyone proposes going live, get answers to these. They are the questions counsel
will ask, and having them ready saves weeks:

- Which states do callers come from? Is Illinois in scope?
- Is the caller population elderly or otherwise potentially vulnerable? Does that change
  what "informed consent" requires?
- Is any of this tied to health information (senior-care context)? Does HIPAA apply, and
  is a BAA needed?
- Who owns the published biometric policy, and does one exist?
- What is the retention period, and who signs off on it?
- What does a caller who declines get instead?
- What is voice authentication actually gating? Skipping two security questions carries
  very different risk from account changes.
- Has anyone priced Pindrop? A vendor with an existing compliance posture may be cheaper
  than carrying this liability in-house.

## Why Voice ID going away matters here

AWS withdrew a working voice biometrics service and pointed customers to a Marketplace
partner or to SMS OTP. They did not publish their reasoning, so drawing conclusions would
be speculation.

What can be said plainly: a DIY rebuild moves the compliance and accuracy burden from AWS
to you, without the anti-spoofing and fraud-detection capabilities the original service
had. That is worth stating in the demo — not as a reason to stop, but so the decision to
continue is made with the trade-off visible.
