---
name: voice-auth-poc
description: "Building a custom voice biometric authentication proof-of-concept on AWS after Amazon Connect Voice ID reached end of support on 20 May 2026. Covers speaker verification with an open-source embedding model (SpeechBrain ECAPA-TDNN), enrolment and verification flows, pulling live caller audio out of Amazon Connect via Kinesis Video Streams, Lambda container packaging, SageMaker endpoints, cosine-similarity thresholds and FAR/FRR tuning, 8 kHz telephony accuracy limits, spoofing exposure, and the biometric-privacy law (BIPA, CUBI, GDPR Art.9) that governs voiceprints. Use for any task on this POC: architecture, model choice, Connect flow wiring, scoring thresholds, test design, or deciding whether to go to production."
---

# Custom Voice Authentication POC on AWS

Amazon Connect Voice ID ended support on **20 May 2026**. AWS did not ship a replacement
and does not offer speaker verification in any other service. Their published guidance is
to use an AWS Marketplace partner (Pindrop) or a DIY one-time-passcode over SMS. Neither
is voice biometrics.

This skill covers building the biometric piece yourself: an open-source speaker embedding
model, wrapped in AWS services, proving the concept on a handful of consenting voices.

## Is it possible? Short answer

**Yes, for a limited-user POC.** The components all exist and the architecture is
well-trodden. A working demo — enrol a voice, call in, get authenticated — is a few days
of work, not months.

**Production for real callers is a different question**, and the blocker is not
technical. Voiceprints are regulated biometric identifiers. See
`references/legal-and-risk.md` before anyone proposes putting this in front of customers.
The short version: Illinois BIPA carries a private right of action with statutory damages
per violation, and contact-centre voice biometrics has been litigated. A POC on your own
voice is fine. Real callers need written consent, a published retention schedule, and
legal sign-off first.

## What you're building

```
ENROLMENT (one-time, per speaker)
  Recorded audio (S3) ──▶ Lambda/SageMaker ──▶ embedding (192-d vector) ──▶ DynamoDB
                           speaker model                                    "voiceprint"

VERIFICATION (per call)
  Connect flow
    └▶ Start media streaming ──▶ Kinesis Video Streams (customer audio, 8 kHz PCM)
    └▶ Lex/prompts collect ~15s of speech   ◀── buffer fills while the caller talks
    └▶ Invoke Lambda (8s budget) ──▶ read buffered KVS fragments
                                  ──▶ embedding ──▶ cosine similarity vs enrolled
                                  ──▶ return score + decision as contact attributes
    └▶ Check contact attributes ──▶ authenticated / step-up / failed
```

The ordering matters: audio must already be buffered in KVS **before** the Lambda runs,
because the Lambda has 8 seconds, not 15. Details in `references/architecture.md`.

## Services required

| Service | Role | Required? |
|---|---|---|
| Amazon Connect | Telephony, flow, contact attributes | Yes (live path) |
| Kinesis Video Streams | Carries live caller audio out of Connect | Yes (live path) |
| AWS Lambda (container image) | KVS reader, orchestration, scoring | Yes |
| Amazon S3 | Enrolment audio, model artefacts | Yes |
| Amazon DynamoDB | Voiceprint vectors, enrolment metadata, audit log | Yes |
| Amazon SageMaker | Hosts the embedding model warm (avoids Lambda cold start) | Recommended for live path |
| AWS KMS | Encrypts voiceprints and audio at rest | Yes |
| CloudWatch | Logs, metrics, score distribution | Yes |
| Amazon Transcribe | Optional: checks the caller said the expected phrase (weak liveness) | Optional |
| AWS End User Messaging SMS | OTP as the step-up factor when voice fails | Recommended |

No AWS service does the biometric matching. That comes from the model you bring.

## The three honest caveats

State these up front in any demo. They are not reasons to stop; they are reasons this is
a POC and not an authentication system.

1. **Telephony audio is 8 kHz narrowband.** Published speaker-verification accuracy
   (~1% EER) is measured on 16 kHz clean audio. Over a phone line, expect materially
   worse. Mitigation: enrol over the phone too, so enrolment and verification conditions
   match. Never enrol from a laptop mic and verify over PSTN.
2. **No anti-spoofing.** A recording of the enrolled voice will pass. Voice ID had
   spoofing detection built in; a DIY build does not, and voice cloning from a few
   seconds of audio is now trivial. This is why voice must be **one factor among
   several**, never the sole gate on anything sensitive.
3. **You cannot measure accuracy with three voices.** FAR/FRR estimates need hundreds of
   trials across many speakers. A POC proves the pipeline works, not that the thresholds
   are right. See `references/model-and-accuracy.md`.

## Alternatives to weigh before building

Worth putting in front of the customer alongside the POC, because one of them may be the
better answer:

- **Pindrop** (AWS Marketplace) — AWS's own recommendation. Production-grade, includes
  anti-spoofing and fraud detection, and the vendor carries the compliance burden.
- **OTP over SMS** (AWS End User Messaging) — AWS's DIY recommendation. Far cheaper,
  legally simple, no biometric exposure, widely understood by callers.
- **ANI + knowledge-based verification** — no new services at all.

The POC's real value may be demonstrating *what voice authentication buys over these*,
which is a UX argument (no passcodes, no security questions) rather than a security one.

## Where to look

- `references/architecture.md` — the two build paths, KVS mechanics, the 8-second Lambda
  constraint, contact flow wiring, IAM.
- `references/model-and-accuracy.md` — model choice, embeddings, cosine thresholds,
  FAR/FRR, the 8 kHz problem, how to test with few speakers.
- `references/implementation.md` — build order, code sketches, packaging, deployment.
- `references/legal-and-risk.md` — biometric privacy law, consent, retention, what the
  POC must do to stay safe.

## Rules for this project

1. **POC uses only consenting voices** — yours and colleagues who agreed in writing.
   No customer audio, no recordings from the Five9 or Connect estate, ever.
2. **Voiceprints are encrypted at rest** (KMS) and deletable on request. Build the delete
   path on day one, not later.
3. **Never log raw audio or embeddings** to CloudWatch. Log scores and decisions only.
4. **The demo must show a failure case**, not just a success. A voice-auth demo that only
   ever succeeds tells stakeholders nothing about whether it works.
5. **Voice is a factor, not the gate.** Always wire a step-up path (OTP, agent
   verification) for the failure branch.
6. **Delete POC data when the POC ends.** Set a retention date at the start.
