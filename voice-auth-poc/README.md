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
| Lambda image / handlers (`enrol_handler`, `verify_handler`), Dockerfile | Stages 1-3 code, next |
| Lex V2 bot (free-speech capture) + Connect flow | Stage 4. Depends on the image; Lex-to-Connect association in CFN needs checking |
| SageMaker endpoint | Only if provisioned concurrency doesn't hold the 8 s budget |
| SMS OTP step-up | End User Messaging origination identity needs registration/approval; not something CFN can complete |
| Connect instance itself | Assumed to exist |
