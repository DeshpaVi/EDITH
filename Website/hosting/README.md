# Hosting the website (S3 + CloudFront, with a login)

`site.template.json` creates, in one stack:
- a **private** S3 bucket (public access blocked; only CloudFront can read it, through an origin access control),
- a CloudFront distribution (HTTPS only, HTTP/2 and 3, security headers),
- a **CloudFront Function** that asks for a login id and password before anything is served (HTTP Basic authentication).

## Deploy (about 5 minutes)

On a machine with Node 20+, the AWS CLI and AWS credentials that can create S3, CloudFront and CloudFormation resources:

```bash
cd Website
SITE_USERNAME=demo SITE_PASSWORD='choose-a-long-password' ./hosting/deploy-site.sh
```

It builds the site (`npm ci && npm run build`), creates or updates the stack `journeyforge-site`, uploads `dist/` and invalidates the cache.
The last line prints the address (`https://dxxxxxxxx.cloudfront.net`). Opening it shows the browser's login prompt.
Without the two variables the script asks for them. `STACK` and `AWS_REGION` (default `us-east-1`) can be overridden.

## The login id and password

- They are the stack parameters `SiteUsername` (3 to 32 letters, digits, `.`, `_`, `-`) and `SitePassword` (12 to 64 characters, `NoEcho`).
- **Change the password:** run the script again with a new `SITE_PASSWORD`; the function updates in place. Every visitor is asked again.
- **Several people:** share the one login for a demo, or extend the function (compare against a few `Basic ...` values). For individual accounts use the next option.
- A browser remembers the login for the session. To log out, close the browser or use a private window.

## What this protects, and what it does not

Good enough for a controlled demo with management. It is **not** a user system:
- one shared credential, no individual accounts, no audit of who logged in, no lockout after wrong guesses;
- the password is embedded (base64) in the CloudFront Function, so anyone with CloudFront or CloudFormation read access in that account can recover it, even though the parameter is `NoEcho`;
- Basic authentication sends the credential with every request (over HTTPS, so it is encrypted in transit).

For anything beyond the demo, replace the function with per-user sign-in: **Amazon Cognito** (hosted UI) with a Lambda@Edge or CloudFront Function that checks its token, or put the site behind your company's SSO (AWS IAM Identity Center or an OIDC provider). The site is static, so this needs no change to the app itself. Restrict access to the stack to the people who should see the password.

## The app's backends

The site itself needs nothing else. The workspace steps that call a backend (reading a deck with the model, deploying from the app) need those backends deployed (`extractor-api`, `deployer-api`) and their URLs given at build time (`VITE_EXTRACTOR_URL`, `VITE_DEPLOYER_URL`, then rebuild). Without them, a demo can still: load the Census example, review the checklist, generate and download the CloudFormation bundle, and generate the Amazon Connect contact flow.

## Remove it

Empty the bucket (`aws s3 rm s3://<bucket> --recursive`), then delete the stack.
