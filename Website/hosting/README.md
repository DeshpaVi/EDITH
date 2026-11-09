# Hosting the website (S3 + CloudFront, with a login)

Two options, same bucket-and-CloudFront layout (the S3 bucket is private; only CloudFront can read it, HTTPS only, security headers):

| | Cognito sign-in (default) | Shared username and password |
|---|---|---|
| Template | `site-cognito.template.json` | `site.template.json` |
| Users | individual accounts, emailed temporary password, optional authenticator-app MFA | one shared login |
| Use for | the real thing, and the demo if you can wait for the email | a quick demo |

## Cognito sign-in

How it works: CloudFront runs a small **CloudFront Function** on every request. It lets the request through only if it carries a valid signed session cookie; otherwise it sends the browser to `/auth/login`. `/auth/*` is served by a small **Lambda** that runs the Amazon Cognito Hosted UI sign-in (authorization code flow with PKCE), checks the result, and issues the session cookie (HttpOnly, Secure, signed with a key, 8 hours by default). Nothing but the Cognito user id is kept in the cookie; tokens are never stored or logged.

Deploy (Node 20+, AWS CLI, openssl, zip, credentials that can create S3, CloudFront, Cognito, Lambda, IAM, SSM and CloudFormation resources):

```bash
cd Website
ADMIN_EMAIL=you@company.com DOMAIN_PREFIX=journeyforge-yourco ./hosting/deploy-site.sh
```

- `ADMIN_EMAIL` is the first user. Cognito emails it a temporary password; the first sign-in asks for a new one (12+ characters, mixed case, a digit and a symbol).
- `DOMAIN_PREFIX` becomes `<prefix>.auth.<region>.amazoncognito.com`. It must be unique in the region and must not contain "aws", "amazon" or "cognito".
- The script builds the site, zips `auth-lambda/index.mjs` and uploads it to a small bucket it creates on first use (`journeyforge-pkg-<account>-<region>`), deploys the stack `journeyforge-site`, uploads `dist/`, invalidates the cache and prints the address.
- **Add users:** Cognito console, User pools, `journeyforge-site-users`, Create user; or
  `aws cognito-idp admin-create-user --user-pool-id <UserPoolId output> --username them@company.com --user-attributes Name=email,Value=them@company.com Name=email_verified,Value=true`.
  Nobody can sign themselves up.
- **MFA:** optional. A user turns on an authenticator app after signing in through the Cognito page; to require it, set the pool's MFA to Required in the console.
- **Remove a user or lock everyone out:** disable or delete them in Cognito; their cookie still works until it expires (8 hours by default; `SESSION_HOURS`). To cut every session at once, run the script again: each deploy makes a new session key.
- **Sign out:** the workspace sidebar has a "Sign out" link when built by this script.
- Region: any region that has Cognito. CloudFront itself is global.

What to know:
- Not run against real AWS yet. The pieces are tested separately (the sign-in Lambda and the session check function, 9 tests; the template for broken references and circular dependencies), but not the Cognito Hosted UI round trip or CloudFront behaviour. Expect to fix small things on the first deploy. `AuthInvokePermission` carries a `TODO(aws-schema)`.
- The session key is a `NoEcho` parameter, but it is written into the CloudFront Function and the Lambda settings, so anyone with read access to those in that account can read it and could forge a session. Restrict the stack to the people who should have that.
- The `/auth/*` Lambda has a public Function URL (it is only reachable through CloudFront by design, but the URL itself is not secret). It holds no secret that helps an attacker: the state and verifier live in the visitor's own cookie.
- The Cognito pool, users included, is deleted with the stack.
- Emails use Cognito's built-in sender (a small daily limit). Fine for a demo; use SES for more.
- After signing in the browser lands on the landing page, not on the page that was requested (the `#/app/...` part does not survive the sign-in round trip).

## Deploying from the console instead of the script

1. Build: `cd Website && npm ci && VITE_AUTH=cognito npm run build` (PowerShell: `$env:VITE_AUTH="cognito"; npm run build`). This makes `dist/`.
2. S3: create a bucket for code in the stack's region (public access blocked) and upload `auth.zip`: a zip with `auth-lambda/index.mjs` at its root.
3. CloudFormation: Create stack, With new resources, upload `site-cognito.template.json`. Parameters: `AdminEmail`, `DomainPrefix`, `SessionKey` (32 to 64 letters and digits; `openssl rand -hex 24`), `SessionHours`, `AuthCodeBucket`, `AuthCodeKey`. Tick the IAM acknowledgement. Wait for CREATE_COMPLETE (5 to 10 minutes).
4. Outputs tab: open `SiteBucketName` in S3 and upload the contents of `dist/` (files and the `assets` folder, not `dist` itself).
5. CloudFront: the distribution (`DistributionId`), Invalidations, create `/*`.
6. Open `SiteUrl`, sign in with the emailed temporary password.

## Shared username and password

```bash
AUTH=basic SITE_USERNAME=demo SITE_PASSWORD='choose-a-long-password' ./hosting/deploy-site.sh
```

One login for everyone (HTTP Basic authentication in a CloudFront Function). Parameters `SiteUsername` (3 to 32 letters, digits, `.`, `_`, `-`) and `SitePassword` (12 to 64 characters, `NoEcho`). To change the password, run it again. The password is embedded (base64) in the function, so anyone with CloudFront or CloudFormation read access can recover it. No individual accounts, no audit, no lockout. Switching between the two options means deploying to a different `STACK` name or deleting the old stack first.

## The app's backends

The site itself needs nothing else. The workspace steps that call a backend (reading a deck with the model, deploying from the app) need those backends deployed (`extractor-api`, `deployer-api`) and their URLs given at build time (`VITE_EXTRACTOR_URL`, `VITE_DEPLOYER_URL`, then rebuild). Without them a demo can still load the Census example, review the checklist, generate and download the CloudFormation bundle, and generate the Amazon Connect contact flow.

## Changing the Cognito template

It is generated: edit `build-cognito-template.mjs` (and `session-check.js`, `auth-lambda/index.mjs`), run `node hosting/build-cognito-template.mjs`, and run `npm run test:hosting` (it fails if the committed JSON is out of date).

## Remove it

Empty the site bucket (`aws s3 rm s3://<SiteBucketName> --recursive`), then delete the stack.
