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

## Set up

1. **Publish the provisioner package** (needs npm and AWS access): `BUCKET=<artifacts-bucket> KEY=provisioner/v1.zip ../provisioner/build.sh`.
   Pin the `amazon-connect-acxd-sdk` version in `provisioner/package.json` first. To let customer accounts read it, add a
   bucket policy such as:
   ```json
   { "Effect": "Allow", "Principal": { "AWS": "arn:aws:iam::<CUSTOMER_ACCOUNT>:role/edith/EdithStackRole" },
     "Action": "s3:GetObject", "Resource": "arn:aws:s3:::<artifacts-bucket>/provisioner/*" }
   ```
2. **Deploy the deployer** in the tool's account:
   ```bash
   aws cloudformation package --template-file template.json --s3-bucket <BUCKET> --output-template-file packaged.json
   aws cloudformation deploy --template-file packaged.json --stack-name edith-deployer --capabilities CAPABILITY_IAM \
     --parameter-overrides AllowedOrigin=<site origin> AccessToken=<random token> ArtifactBucket=<bucket> ArtifactKey=provisioner/v1.zip \
     TargetRoleArns=<role arns, comma separated> TargetsJson='<json>'
   aws cloudformation describe-stacks --stack-name edith-deployer --query "Stacks[0].Outputs"
   ```
   Order matters for the roles: install the customer role first (next step) to know its ARNs, or deploy twice.
3. **In each customer account**, an administrator creates the secret and installs the roles:
   ```bash
   aws secretsmanager create-secret --name acxd-api-key --secret-string "<ACXD API key>"   # the key stays in their account
   aws cloudformation deploy --template-file customer-role.template.json --stack-name edith-deploy-role --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides DeployerRoleArn=<DeployerRoleArn output> ExternalId=<random value> ArtifactBucket=<bucket>
   ```
   Then add the target to `TargetsJson`: `{"id","label","roleArn","externalId","region","stackRoleArn"}` using that stack's outputs.
4. In the tool's **Deploy** step, paste the `DeployerUrl` and the token, load the targets, and follow the screen.

## Notes

- `npm run test:deployer` runs the tests (Node's built-in runner, no dependencies). `fixtures/managed-template.json` is the
  template the emitter produces; a TypeScript test fails if the emitter and the fixture drift apart.
- Planning waits up to about 80 seconds for CloudFormation to prepare the change set; the function timeout is 180 seconds.
- Templates up to 51,200 bytes go to CloudFormation inline. Larger ones (up to 1 MB) are stored in the artifact bucket as `templates/<sha256>.json` with the deployer's own role (it has `s3:PutObject` on `templates/*` only) and read by URL with the customer's deploy role, which already has `s3:GetObject` on the bucket. The bucket must be in the stack's region (`ARTIFACT_REGION` defaults to the deployer's). Not yet run against real S3/CloudFormation; the bucket has no lifecycle rule, so add one to expire `templates/`.
- **Nothing here has run against a real AWS account.** First-deployment unknowns: the exact IAM permissions CloudFormation
  needs for these resource types (the stack role may need one or two more), `InvokedViaFunctionUrl` on the Lambda permission,
  cross-account read of the provisioner package, and the ACXD SDK calls inside the provisioner.
