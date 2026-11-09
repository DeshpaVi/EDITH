# Deployer API

Deploys the CloudFormation templates the tool generates into a target AWS account, after the consultant has reviewed
a change set. It is the "deploy from the app" path; the "download and deploy yourself" path still works.

```
browser ──(bearer token)──> Deployer Lambda ──AssumeRole(ExternalId)──> EdithDeployRole (target account)
                                                                              └── CloudFormation ──(passes)──> EdithStackRole
```

## Security model (read this before installing)

This function can create IAM roles, Lambda functions and secrets in customer accounts, so it is deliberately narrow.

- **Only this tool's templates.** Every template is checked against an allowlist (`policy.mjs`): a fixed set of resource
  types, IAM roles that only Lambda can assume with only three allowed actions and no `*` resources, code only from the
  provisioner parameters or inline, custom resources that may only call the template's own provisioner, no macros, no
  exports, no secret (`NoEcho`) parameters. Anything else is refused before AWS is called.
- **Preview, then confirm, enforced on the server.** `/plan` creates a change set and returns what would change plus a signed,
  expiring token bound to that exact change set, stack and target. `/execute` refuses without it. The UI additionally
  requires a ticked review and the stack name typed back.
- **No credentials in the browser.** The deployer assumes a role per target. Targets are configured by the operator
  (`TargetsJson`); the browser only picks one by id.
- **No ACXD API key passes through.** The generated template takes the ARN of a secret the consultant creates in the target
  account; the provisioner reads it there. The deployer rejects templates with any `NoEcho` parameter.
- **Only its own stacks.** Stacks are named `edith-*` and tagged `edith-managed=true`; status, cancel and delete refuse anything
  else. Deleting needs the stack name typed back.
- **No content in logs.** Only route, target id, stack name, status and timing.
- **Weak spot:** callers authenticate with one shared bearer token. That is acceptable for a small team demo, not for wider use.
  Put a real authorizer in front before exposing it, and review the roles in `customer-role.template.json` against your
  own least-privilege standard.

## Set up (console route; the same steps with the CLI work too)

The roles that customers install have fixed names under the path `/edith/`, so their ARNs are known in advance and the deployer
can be installed first, in one pass: `arn:aws:iam::<TARGET_ACCOUNT>:role/edith/EdithDeployRole` and `.../EdithStackRole`.
For a first test the target account can be the same account as the deployer.

1. **Publish the provisioner package** (needs npm and AWS access; CloudShell has both): from the website source folder,
   `BUCKET=<artifacts-bucket> KEY=provisioner/v1.zip ./provisioner/build.sh`. Pin the `amazon-connect-acxd-sdk` version in
   `provisioner/package.json` once you know a version that works. Another account can read it only through a bucket policy such as:
   ```json
   { "Effect": "Allow", "Principal": { "AWS": "arn:aws:iam::<CUSTOMER_ACCOUNT>:role/edith/EdithStackRole" },
     "Action": "s3:GetObject", "Resource": "arn:aws:s3:::<artifacts-bucket>/provisioner/*" }
   ```
   The deployer also stores large templates in this bucket (`templates/`), which the customer's deploy role reads.
2. **Upload the deployer code**: zip `index.mjs`, `cfn.mjs`, `confirm.mjs`, `policy.mjs` and `package.json` (at the zip's root) as
   `deployer.zip` and put it in a bucket in the stack's region.
3. **Create the deployer stack** (CloudFormation console, upload `template.json`, or the CLI) in the tool's account. Parameters:
   `AllowedOrigin` (the site's address, no trailing slash), `AccessToken` (random, 24+ characters), `DeployerCodeBucket`,
   `DeployerCodeKey`, `ArtifactBucket` and `ArtifactKey` (from step 1), `TargetRoleArns` (the deploy role ARN, comma separated for
   several), and `TargetsJson`:
   `[{"id":"mine","label":"My account","roleArn":"arn:aws:iam::<ACCOUNT>:role/edith/EdithDeployRole","externalId":"<random 16+ chars>","region":"us-east-1","stackRoleArn":"arn:aws:iam::<ACCOUNT>:role/edith/EdithStackRole"}]`.
   Acknowledge IAM. Copy the outputs `DeployerUrl` and `DeployerRoleArn`.
4. **In each target account**, an administrator installs `customer-role.template.json` (CloudFormation console; acknowledge that it
   creates named IAM resources). Parameters: `DeployerRoleArn` (from step 3), `ExternalId` (the same value as in `TargetsJson`),
   `ArtifactBucket`. The ACXD key stays in that account: Secrets Manager, Store a new secret, Other type, Plaintext, paste the key;
   copy the secret's ARN for the template's `AcxdApiKeySecretArn` parameter.
5. In the tool's **Deploy** step, paste the `DeployerUrl` and the token, load the targets, and follow the screen.

## Notes

- `npm run test:deployer` runs the tests (Node's built-in runner, no dependencies). `fixtures/managed-template.json` is the
  template the emitter produces; a TypeScript test fails if the emitter and the fixture drift apart.
- Planning waits up to about 80 seconds for CloudFormation to prepare the change set; the function timeout is 180 seconds.
- Templates up to 51,200 bytes go to CloudFormation inline. Larger ones (up to 1 MB) are stored in the artifact bucket as `templates/<sha256>.json` with the deployer's own role (it has `s3:PutObject` on `templates/*` only) and read by URL with the customer's deploy role, which already has `s3:GetObject` on the bucket. The bucket must be in the stack's region (`ARTIFACT_REGION` defaults to the deployer's). Not yet run against real S3/CloudFormation; the bucket has no lifecycle rule, so add one to expire `templates/`.
- **Nothing here has run against a real AWS account.** First-deployment unknowns: the exact IAM permissions CloudFormation
  needs for these resource types (the stack role may need one or two more), `InvokedViaFunctionUrl` on the Lambda permission,
  cross-account read of the provisioner package, and the ACXD SDK calls inside the provisioner.
