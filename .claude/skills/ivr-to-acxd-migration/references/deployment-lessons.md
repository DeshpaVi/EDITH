# Deployment lessons (first real deployment of a generated build)

Learned deploying the Census CQA journey through the JourneyForge app: website on S3/CloudFront with Cognito, Bedrock-backed extractor,
and a CloudFormation stack that creates the AWS resources and the ACXD resources through a Lambda-backed custom resource. Each item was a
real failure or surprise; the fix is in the code and the check is in a test. Use this list as a preflight.

## ACXD
1. **Trust the SDK's export list, not the documentation.** `GetContextVariableCommand` and `GetAnalyticsTag...` do not exist in 0.3.0.
   Read the list (`Object.keys(await import('amazon-connect-acxd-sdk'))`) and keep it as a test fixture. Pin the SDK version.
2. **Everything a flow or guardrail references must exist first:** analytics tags, custom slot types (`Freeformtext`, `YesNo`), knowledge bases,
   data requests, context variables, secrets. Creating the referencing object succeeds; the application's **Build** is where it fails
   ("Unavailable reference"). Run Build validation after every deployment.
3. A new workspace does not contain what the source workspace had. Export every referenced object from the source (slot type settings,
   tag names and types), not only the flows.
4. Creating resources does not deploy them: Manage default behavior, Build, deploy, deployment alias are console steps.
5. **Validate names in the app, not at deploy time.** ACXD rejected an application name with parentheses; the form defaulted to the journey title. Sanitize defaults and refuse bad input in the form. Keep the application name the same across updates.
6. **A resource that creates successfully can still be wrong.** The data request was created with the documented secret syntax and flat webhook; the console flagged the header red and the live call failed. After the first deployment, export each generated resource from the console and diff it with what the tool emits (the exports are fixtures now). The first sign was only "We encountered an issue" in the Test tab.
7. Do not delete shared workspace objects (tags, slot types) when a stack is deleted.

## Amazon Bedrock
6. **The AWS account type matters.** An account billed through a channel partner (reseller or distributor) can be refused Anthropic models:
   "Access to this model is not available for channel program accounts". Find this out before the demo: try the model in the Bedrock
   playground in the account first. Options: ask the account owner / Solution Provider, use a direct AWS account for the extractor only
   (with approval for the data), or a non-Anthropic model.
7. Newer models are served through **cross-region inference profiles**: use the inference-profile id (e.g. `us.<model>`), not the bare model id.
   Copy it from the console; never type it from memory.

8. **Not every Bedrock model behaves like Claude.** The extractor forces a tool call so the answer is structured; some models refuse a forced
   `toolChoice` (retry with auto and ask for the tool in the prompt), some answer in text (accept a JSON object in the text, then validate), some return
   reasoning blocks (ignore them; allow more output tokens) and text-only models (the OpenAI open-weight models) cannot read images or PDFs, so a deck,
   document or text file is the input. Whatever the model, validate its output the same way.

## CloudFormation and Lambda
8. **Lambda code from a local folder needs the CLI to package it.** For console deployment take the code from S3 parameters (bucket, key).
9. **A Lambda does not re-read a zip when the S3 key is unchanged.** Publish updated code under a new key (`v1`, `v2`...) and change the parameter.
10. Validate parameters in the template (`AllowedPattern` with a message): a pasted `s3://bucket` or ARN as a bucket name failed late and confusingly.
11. Managed policy ids (CloudFront cache policies) are easy to misremember: pin them in a test against the documented values.
12. Break circular references (distribution, Cognito client, Lambda) by passing ids through an SSM parameter read at run time.
13. A custom resource that throws on Delete leaves the stack stuck: make failures name the command and the similar exports, and keep Delete tolerant.
14. **Inline Lambda code (`ZipFile`) is `index.js` loaded as CommonJS.** `export const handler` fails with `Runtime.UserCodeSyntaxError: Unexpected token 'export'` and the Function URL answers **502**. Use `exports.handler`. Test the generated source the way Lambda loads it, not with the keyword stripped. A 502 from a Function URL means the function crashed: read its log group first.
15. Keep a failed first deploy cheap: the rollback should leave nothing behind except shared objects.

## Web hosting
15. Static hosting plus a hash router needs no rewrite rules. A login needs a real check at the edge: CloudFront Function with a signed cookie,
    a Lambda for the sign-in endpoints, Cognito Hosted UI with PKCE. Basic auth is only a demo fallback.
16. Cache: invalidate `/*` after every upload; `index.html` must be `no-cache`, assets immutable.
17. Stale code in CloudShell looks like a missing feature: check the file you deployed from (grep for a known string) before debugging.

## Process
18. One step at a time, with a screenshot or log excerpt after each, found every one of these quickly. Keep doing that.
19. Every first-run failure became: a code fix, a test that would have caught it, and a line here. Do that for the next ones.

## Ideas for the app (from these lessons)
- **Preflight panel** before deploy: SDK commands the provisioner needs exist; referenced workspace objects are in the spec; model access works
  (a tiny Bedrock call); bucket and secret parameters have the right shape.
- **Post-deploy validation**: run the application's Build validation through the SDK (`CreateApplicationBuild`) and show its errors in the app.
- **Source-workspace export**: ask for tags, slot types and knowledge base settings along with the flows.
