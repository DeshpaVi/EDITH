# Voice-auth POC (infrastructure)

Custom speaker verification on Amazon Connect after Voice ID end of support (20 May 2026).
Source of truth: `HANDOFF.md` and `.claude/skills/voice-auth-poc/`. **Consenting colleagues only;
no customer audio** (see the skill's legal reference before enrolling anyone).

## Stacks

| Template | Creates |
|---|---|
| `infra/01-foundation.yaml` | KMS CMK, enrolment bucket (lifecycle = retention, no versioning), `voiceprints` + `verification-log` tables (KMS, TTL, PITR off), ECR repo, SSM threshold params |
| `infra/02-compute-connect.yaml` | Enrol + verify Lambdas (one container image), least-privilege roles, log groups with retention, verify alias + provisioned concurrency, and (optional) Connect Lambda association, invoke permission, and live media streaming config |

Deploy: `./deploy.sh foundation` -> build and push the image to the ECR repo output -> `./deploy.sh compute`.
Thresholds have no default on purpose: run stage 1 first and pass calibrated values.

## Not in CloudFormation yet (and why)

| Item | Status |
|---|---|
| Lex V2 bot (free-speech capture) + Connect flow | Stage 4. Depends on the image; Lex-to-Connect association in CFN needs checking |
| SageMaker endpoint | Only if provisioned concurrency doesn't hold the 8 s budget |
| SMS OTP step-up | End User Messaging origination identity needs registration/approval; not something CFN can complete |
| Connect instance itself | Assumed to exist |

## Code (stages 1-3)

| Path | Purpose |
|---|---|
| `scripts/stage1_eval.py` | **Stage 1.** `data/<speaker>/*.wav` -> genuine vs impostor score distributions; `--telephony` downsamples to 8 kHz. Run this first and pick thresholds from it |
| `app/embed.py` | ECAPA-TDNN embedding, silence trim, averaging |
| `app/mkv.py` | Minimal Matroska reader; selects `AUDIO_FROM_CUSTOMER` by name |
| `app/scoring.py` | Cosine, three-band decision, speaker-ID validation (pseudonymous `spk_...` only) |
| `app/handler.py` | `enrol_handler` (enrol/delete; requires `consentRef`) and `verify_handler` (never raises; returns flat string attributes) |
| `tests/` | `pip install -r requirements-dev.txt && pytest tests` (no torch needed) |

Status: unit tests pass (19). **Not yet exercised:** the real model, and a real KVS `GetMedia`
call. Both need audio / a live call. Things still to confirm on the first real call: the KVS
stream name vs the IAM scope, that Connect's track is named `AUDIO_FROM_CUSTOMER`, and the
Invoke-Lambda event shape (`Details.Parameters`, `Details.ContactData.ContactId`).

## This instance

Live media streaming is already configured (prefix `vmail-connect-win-demo-manual-contact-`,
key `aws/kinesisvideo`, 1 h retention), so `ManageMediaStreamingConfig` defaults to `false` and
the stack reuses it. Note the 1 h retention bounds how long after Start-media-streaming the
verify Lambda can still read the fragment.
