# Architecture

## Contents
- [Two paths, in order](#two-paths-in-order)
- [Path A: offline verification](#path-a-offline-verification)
- [Path B: live in-call verification](#path-b-live-in-call-verification)
- [The 8-second constraint](#the-8-second-constraint)
- [Getting audio out of Connect](#getting-audio-out-of-connect)
- [Audio format](#audio-format)
- [Data model](#data-model)
- [IAM](#iam)
- [Cost](#cost)

## Two paths, in order

Build A first. It proves the biometric core works with no telephony involved, and takes
hours. Then build B, which adds Connect, KVS and real-time constraints.

| | Path A (offline) | Path B (live) |
|---|---|---|
| Input | WAV files in S3 | Live call audio via KVS |
| Trigger | S3 event or manual invoke | Connect Invoke Lambda block |
| Time budget | Minutes | 8 seconds |
| Proves | Model works, thresholds sane | End-to-end call authentication |
| Services | S3, Lambda, DynamoDB | + Connect, KVS, (SageMaker) |

## Path A: offline verification

```
S3 (enrol/<speaker>/*.wav) ──▶ Lambda (container, model baked in)
                                  ├─▶ embed → DynamoDB  (enrolment)
                                  └─▶ embed → cosine vs stored → score (verification)
```

Two Lambda entry points, or one with a `mode` parameter: `enrol` and `verify`.
Deliverable is a CLI or small script that prints the similarity score and pass/fail.

This is where thresholds get tuned and where you learn what scores same-speaker vs
different-speaker pairs actually produce on your audio.

## Path B: live in-call verification

```
Caller
  └▶ Connect flow
       1. Play prompt (consent notice — REQUIRED, see legal reference)
       2. Start media streaming        → KVS stream created, ARN in contact attributes
       3. Set contact attributes       → persist streamARN + startFragmentNumber
       4. Get customer input (Lex)     → asks 2-3 questions; ~15s of speech accumulates
       5. Invoke Lambda (verify)       → reads BUFFERED KVS fragments, scores, returns
       6. Check contact attributes     → branch on the returned decision
            ├─ authenticated  → skip security questions, route to agent
            ├─ inconclusive   → step-up (OTP via End User Messaging)
            └─ failed         → standard verification with agent
       7. Stop media streaming
```

Step 4 is what makes step 5 possible. The caller's speech fills the KVS buffer while Lex
collects answers; the Lambda then reads back a segment that already exists rather than
waiting for one.

## The 8-second constraint

**Connect's Invoke Lambda block times out at 8 seconds.** Speaker verification needs
roughly 10 seconds of net speech. These are irreconcilable if the Lambda tries to listen
in real time.

Three ways to handle it, in order of preference:

1. **Buffer-then-read (recommended).** Collect speech via Lex/prompts first, then invoke
   Lambda to read the buffered fragments. Reading ~15s of buffered PCM from KVS and
   scoring it takes ~1-3s with a warm model.
2. **SageMaker endpoint for inference.** Keeps PyTorch warm so the Lambda only does I/O
   and an HTTP call. Removes cold-start risk from the 8s budget entirely. Costs ~$50/month
   for a small always-on instance; use serverless inference if idle cost matters.
3. **Async with polling.** Lambda kicks off processing and returns immediately; the flow
   plays a message, loops a Wait block, then re-invokes to fetch the result. More moving
   parts, more flow complexity. Use only if 1 and 2 fail.

Do **not** try to solve this with a longer Lambda timeout — the limit is on the Connect
side, not Lambda's.

## Getting audio out of Connect

**Instance setup:** AWS console → your instance → **Data storage** → **Live media
streaming** → enable, set a stream prefix and retention, choose the KMS key
(`aws/kinesisvideo` or your own CMK).

**Flow:** add the **Start media streaming** block. It can stream:
- what the customer says (what you need for verification),
- what the customer hears (agent speech and prompts),
- or both.

Stream **from the customer** only. Streaming both mixes agent audio into the track and
ruins the embedding.

**Contact attributes** exposed under the `Media streams` namespace:

| Attribute | JSONPath |
|---|---|
| Customer audio stream ARN | `$.MediaStreams.Customer.Audio.StreamARN` |
| Customer audio start timestamp | `$.MediaStreams.Customer.Audio.StartTimestamp` |
| Customer audio stop timestamp | `$.MediaStreams.Customer.Audio.StopTimestamp` |
| Customer audio start fragment number | `$.MediaStreams.Customer.Audio.StartFragmentNumber` |

Persist the ARN and start fragment with a **Set contact attributes** block immediately
after Start media streaming, then pass them to the Lambda. The stream name is not
otherwise discoverable from inside the flow — a known limitation people have raised with
AWS.

**Reading the stream:** `kinesis-video-media:GetMedia` with the stream ARN and a
`StartSelector` of `FRAGMENT_NUMBER` (the start fragment) or `PRODUCER_TIMESTAMP`. The
response is an MKV (Matroska) byte stream that must be parsed to extract the raw PCM.

## Audio format

What Connect puts into KVS:

| Property | Value |
|---|---|
| Container | MKV (Matroska), fragmented |
| Codec | Raw PCM, signed 16-bit little-endian |
| Sample rate | **8000 Hz** |
| Channels | Mono per track |
| Tracks | `AUDIO_FROM_CUSTOMER`, `AUDIO_TO_CUSTOMER` |

Select the `AUDIO_FROM_CUSTOMER` track. Both tracks appear in the same stream when you
stream both directions, which is another reason to stream customer-only.

Parsing MKV in Python: `ebmlite` works, or write a minimal SimpleBlock parser — Connect's
MKV is simple and regular. There is also an official Java parser library
(`amazon-kinesis-video-streams-parser-library`) if the team prefers Java.

**Resampling:** the model expects 16 kHz. Upsample 8 kHz → 16 kHz (e.g. `torchaudio` or
`scipy.signal.resample_poly`). Understand that this does not recover lost information; it
only matches the model's expected input shape. See `model-and-accuracy.md`.

## Data model

**DynamoDB `voiceprints`**

| Attribute | Type | Note |
|---|---|---|
| `speakerId` (PK) | S | Pseudonymous ID, never a phone number or name |
| `embedding` | B | 192-float vector, KMS-encrypted |
| `enrolledAt` | S | ISO timestamp |
| `sampleCount` | N | Number of enrolment clips averaged |
| `consentRef` | S | Pointer to the signed consent record |
| `retentionUntil` | S | Hard delete date — enforced with TTL |

Set the DynamoDB **TTL attribute to `retentionUntil`**. Retention then happens by default
rather than by someone remembering.

**DynamoDB `verification_log`** — `contactId`, `speakerId`, `score`, `decision`,
`timestamp`. Scores and decisions only. Never the audio, never the embedding.

**S3** — enrolment audio under `enrol/<speakerId>/`, SSE-KMS, lifecycle rule to delete at
the retention date. Block public access. Versioning off (so deletes are real deletes).

## IAM

Lambda execution role needs:

```
kinesisvideo:GetDataEndpoint          on the stream ARN
kinesis-video-media:GetMedia          on the stream ARN
dynamodb:GetItem, PutItem, Query      on the two tables
s3:GetObject, PutObject               on the enrolment prefix
kms:Decrypt, GenerateDataKey          on the CMK
sagemaker:InvokeEndpoint              if using SageMaker
```

Connect needs `lambda:InvokeFunction` on the verification function — add it through the
Connect console (Flows → AWS Lambda) so the resource policy is created correctly.

Scope every ARN. Do not grant `kinesisvideo:*` on `*`.

## Cost

POC scale is negligible; these are the lines that exist:

| Service | Rough |
|---|---|
| KVS ingestion | ~$0.0085/GB; 8 kHz PCM ≈ 1 MB/minute, so pennies |
| KVS storage | Set retention to 1-2 hours for a POC — you only need the buffer |
| Lambda | Container, 2-3 GB memory for PyTorch; sub-dollar at POC volume |
| SageMaker | ~$50-70/month for a small always-on CPU endpoint; serverless is cheaper if idle |
| DynamoDB, S3, KMS | Cents |

The meaningful cost is engineering time, not infrastructure.
