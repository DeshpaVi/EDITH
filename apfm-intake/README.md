# apfm-intake

Scoring service for the APFM agentic intake POC (Amazon Connect + Agentic CX Designer).
Separate from the IVR-migration web app elsewhere in this repo.

## Behaviour

- ACXD converses normally. After each captured answer the Journey agent calls the
  `SaveIntakeField` Data request. The Lambda scores that one answer and stores it. The
  response is just `{"saved": true}`: no score, no next step, so scores never steer the call.
- After the last question a deterministic `GetIntakeSummary` Data request returns the plain
  average of the six field scores (unanswered = 0) and a route:

  | Average | `apfm_route` |
  |---|---|
  | >= 0.85 | `STANDARD` |
  | 0.60 - 0.84 | `VERIFICATION` |
  | < 0.60 | `VERIFICATION_2` |
  | caller urgently asks for a person | `STANDARD` (`apfm_route_reason=URGENT_REQUEST`) |

- Connect only routes: Set contact attributes (Agentic CX namespace) -> Check contact
  attributes on `apfm_route` (text match) -> Set working queue -> Transfer to queue.

## Fields

`caller_for`, `benefit_type`, `phone`, `city` (caller location), `care_level`, `move_timeline`.
Scores come from the spreadsheet rows, encoded as rules in `src/apfm_intake/scoring.py`.
Thresholds live in `config.py` (env: `APFM_STANDARD_MIN`, `APFM_VERIFICATION_MIN`).

## Run the tests

    PYTHONPATH=src python3 -m unittest discover -s tests -v

## Open items (marked `TODO` in code)

- `TODO(acxd-schema)`: how ACXD wraps an External Data request (body/headers) and whether
  ANI is exposed to it. Confirm with a real Data request test.
- `TODO(geocode)`: city/ZIP resolution is a tiny static gazetteer; unknown places score 0.75
  as unverified, never as a unique city. Replace with a real lookup.
- Phone is validated as NANP in pure Python (no libphonenumber layer yet).
- Compliance wording (disclosure, TCPA consent) is not in this service; it lives in the
  ACXD flow and needs APFM approval.
- Deployment (Lambda, DynamoDB table with TTL on `expires_at`, API endpoint, `APFM_API_TOKEN`
  stored in ACXD Secrets) is phase C.
