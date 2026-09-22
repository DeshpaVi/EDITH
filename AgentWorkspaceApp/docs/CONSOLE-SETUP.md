# Console setup, service by service

Everything below is console/GUI work. The AWS resources themselves are in
`infra/` and can be deployed with `infra/deploy.sh` or by uploading the two
templates in the CloudFormation console — but the Amazon Connect side has no
CloudFormation support worth using, so steps 1, 2, 6 and 7 are console-only.

Do them in this order. Four steps consume a value produced by an earlier one.

| # | Service | What you do | Produces |
|---|---------|-------------|----------|
| 1 | Amazon Connect | Note the instance ID; confirm Contact Lens is on | `ConnectInstanceId` |
| 2 | Amazon Connect | Turn on real-time analytics in the flow; set the attributes | — |
| 3 | CloudFormation | Deploy `hosting.yaml` | app origin, callback URL |
| 4 | CloudFormation | Deploy `backend.yaml` | API URL, Cognito client id |
| 5 | Amazon Cognito | Create a user per agent | — |
| 6 | Amazon Connect | Register the third-party application | — |
| 7 | Amazon Connect | Grant it on the security profile | — |
| 8 | Verify | Place a test call | — |

---

## 1. Amazon Connect — instance ID and Contact Lens

1. Open the **Amazon Connect** console → **Instances** → click your instance.
2. Copy the **Instance ARN**. The UUID after `instance/` is the
   `ConnectInstanceId` parameter both templates need.
   `arn:aws:connect:eu-west-2:111122223333:instance/`**`a1b2c3d4-...`**
3. In the left nav choose **Analytics tools**. Confirm **Contact Lens** is
   enabled for the instance. If it is not, enable it here — the flow-level
   setting in step 2 has no effect until it is.

> Contact Lens is billed per analysed minute, separately from Connect's own
> per-minute charge. Enabling it instance-wide does not incur cost by itself;
> the flow block in step 2 is what starts analysis on a given contact.

## 2. Amazon Connect — the contact flow

Two separate things happen in the flow: the attributes get set, and analysis
gets turned on.

### 2a. Turn on real-time analytics

1. Open the Connect **admin website** (`https://<alias>.my.connect.aws`) →
   **Routing** → **Flows** → open the inbound flow.
2. Drag in a **Set recording and analytics behavior** block, or open the
   existing one. Place it **before** the contact reaches a queue — analysis
   starts from where this block runs, and anything said earlier is not
   transcribed.
3. Configure:
   - **Call recording**: *On*, Agent and Customer. (Voice analysis reads the
     recorded audio stream; without recording there is nothing to analyse.)
   - **Amazon Connect Contact Lens speech analytics**: *Enable*.
   - **Analytics mode**: **Real-time** — or *Real-time and post-call* if you
     also want post-call summaries. **Post-call only produces no live
     transcript**, and this is the single most common reason the panel stays
     empty.
   - **Language**: match the caller population. One language per contact.
   - **Redaction**: optional. If you turn it on, the app marks redacted spans
     rather than hiding that anything was removed.
4. For chat contacts, the equivalent setting is **Contact Lens conversational
   analytics** on the same block, also set to include real-time.
5. **Save** and **Publish** the flow.

### 2b. Set the attributes the app displays

Anywhere in the flow before the transfer to queue, add **Set contact
attributes** blocks writing the keys listed in
`src/config/attribute-manifest.json`. The attribute **key** must match the
manifest byte-for-byte and is case-sensitive — `authStatus` and `AuthStatus`
are different attributes.

Sources you can set them from:

| Where the value comes from | How |
|---|---|
| A **Get customer input** / DTMF menu | Set attributes on each branch |
| A **Lex bot** | Use the *Lex session attributes* namespace, or copy them into user-defined attributes |
| An **Agentic CX (ACXD) block** | Map the application's context variables to contact attributes on the way out |
| A **Lambda** data dip | *External* namespace → Set contact attributes |
| A recording disclosure | Set the attribute to the **exact wording the prompt plays** — do not re-type it |

Anything you set that is *not* in the manifest still appears in the app, under
**Unmapped**. That is deliberate: a flow change should be visible on the next
call, not invisible until somebody re-reads the handoff document.

Then edit `src/config/attribute-manifest.json` so the keys, labels, grouping and
formats match your handoff document, and rebuild. That file is the only thing
you need to change to alter what the panel shows.

## 3. CloudFormation — hosting

Console route: **CloudFormation** → **Create stack** → *With new resources* →
**Upload a template file** → `infra/hosting.yaml`.

- Stack name: `acw-handoff-hosting`
- `AppName`: `acw-handoff`
- `WorkspaceOrigins`: narrow this to your own instance once you know it works,
  e.g. `https://acme.my.connect.aws`. The default wildcards let any Connect
  instance frame the app.

Create the stack, then open its **Outputs** tab and copy `AppOrigin`,
`CallbackUrl`, `BucketName`, `ArtifactsBucketName` and `DistributionId`.

## 4. CloudFormation — backend

First build and upload the Lambda:

```bash
cd AgentWorkspaceApp/backend && npm ci && npm run build
cd dist && zip -r ../transcript-lambda.zip .
aws s3 cp ../transcript-lambda.zip s3://<ArtifactsBucketName>/acw-handoff/transcript-lambda.zip
```

Then **CloudFormation** → **Create stack** → upload `infra/backend.yaml`:

| Parameter | Value |
|---|---|
| `ConnectInstanceId` | from step 1 |
| `AllowedOrigin` | the `AppOrigin` output of step 3 |
| `CallbackUrl` | the `CallbackUrl` output of step 3 |
| `CognitoDomainPrefix` | globally unique, e.g. `acme-acw-handoff` |
| `LambdaCodeS3Bucket` | the `ArtifactsBucketName` output of step 3 |
| `LambdaCodeS3Key` | `acw-handoff/transcript-lambda.zip` |
| `UsernameClaim` | `email` for a SAML-federated instance — see the note below |
| `EnforceContactOwnership` | `true` |

Tick **I acknowledge that AWS CloudFormation might create IAM resources** and
create the stack. Copy `ApiBaseUrl`, `CognitoDomain` and `CognitoClientId` from
the Outputs tab.

> **`UsernameClaim` matters.** The backend proves the caller is the agent on
> the contact by matching a JWT claim against the agent's **Amazon Connect
> username**. On a SAML-federated instance that username is the agent's email,
> so `email` is right. On an instance with Connect-managed users whose
> usernames are not emails, no claim will match and every request returns 403.
> In that case either align the usernames or change `USERNAME_CLAIM` on the
> Lambda to a claim you can populate.

## 5. Amazon Cognito — agent accounts

The pool is created with self-service sign-up disabled, so accounts are created
for agents rather than by them.

1. **Cognito** → **User pools** → `acw-handoff-agents` → **Users** → **Create
   user**.
2. Email address: **the same value as the agent's Amazon Connect username**.
3. Send an invitation, or set a password and require a change on first sign-in.

For anything past a pilot, federate this pool with the same identity provider
Amazon Connect uses (**User pool** → **Sign-in experience** → **Federated
identity provider sign-in**) so agents do not carry a second password. Then add
that provider to the app client's **Supported identity providers** and set
`VITE_COGNITO_SCOPES` accordingly.

## 6. Build and upload the app

```bash
cd AgentWorkspaceApp
cat > .env.production.local <<'ENV'
VITE_BRIDGE=workspace
VITE_TRANSCRIPT_SOURCE=api
VITE_API_BASE_URL=<ApiBaseUrl from step 4>
VITE_AUTH_MODE=cognito
VITE_COGNITO_DOMAIN=<CognitoDomain from step 4>
VITE_COGNITO_CLIENT_ID=<CognitoClientId from step 4>
ENV
npm ci && npm run build
aws s3 sync dist/assets s3://<BucketName>/assets --cache-control 'public,max-age=31536000,immutable' --delete
aws s3 sync dist s3://<BucketName> --exclude 'assets/*' --cache-control 'no-cache' --delete
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths '/index.html'
```

Open `<AppOrigin>/` directly in a browser to confirm it loads. It will show
*"No response from the Amazon Connect agent workspace"* — that is the correct
result outside the workspace and proves the hosting works.

## 7. Amazon Connect — register the third-party application

1. **Amazon Connect console** (not the admin website) → **Instances** → your
   instance → **Third-party applications** in the left nav.
2. **Add application**:
   - **Name**: `contact-handoff` (internal identifier).
   - **Display name**: `Contact handoff` — this is the label the agent sees.
   - **Access URL**: the `AccessUrl` output of step 3, e.g.
     `https://d111111abcdef8.cloudfront.net/`. It must be HTTPS.
   - **Application permissions**: tick **Contact — read** (also shown as
     *Contact details*). Without it the SDK returns nothing and the panel stays
     empty with no error.
3. **Add application**.

> The app is framed by the workspace, so its hosting must permit that. The
> `hosting.yaml` response headers policy already sends
> `Content-Security-Policy: frame-ancestors …` and deliberately sends no
> `X-Frame-Options`. If you host the app somewhere else, reproduce both.

## 8. Amazon Connect — grant it on the security profile

1. Connect **admin website** → **Users** → **Security profiles**.
2. Open the profile your agents use (e.g. `Agent`).
3. Expand the **Third-party applications** (or *Applications*) section.
4. Tick **Contact handoff** → **Save**.
5. Agents already signed in must **refresh the workspace** to see it; the app
   list is read at workspace load.

## 9. Verify

1. Sign in to the agent workspace as an agent with that security profile.
2. Place a test call through the flow you edited in step 2.
3. Answer it. Open **Contact handoff** from the app rail.
   - The attributes panel should populate immediately from the workspace SDK.
   - The transcript panel shows **Sign in** the first time. Click it, complete
     the Cognito popup, and turns start appearing within a few seconds.
4. If the transcript stays empty, work down the list in
   [LIMITATIONS.md](./LIMITATIONS.md#when-the-transcript-panel-stays-empty).

---

## What to check when something does not appear

| Symptom | Almost always |
|---|---|
| App missing from the rail | Security profile not granted, or workspace not refreshed |
| App tile blank / frame error | `X-Frame-Options` being sent, or `frame-ancestors` missing the workspace origin |
| "No response from the agent workspace" | The page is open outside the workspace, or the Access URL points somewhere else |
| Attributes all "Not set" | Manifest keys do not match the flow's keys (case-sensitive) |
| Real values under **Unmapped** | Same cause, seen from the other side — copy the keys from there into the manifest |
| Transcript: "not enabled for this contact" | The flow set post-call analytics, not real-time |
| Transcript: 403 "not assigned to you" | `UsernameClaim` does not resolve to the agent's Connect username |
| Transcript: "analysis has not started yet" | Normal for the first few seconds of a call |
