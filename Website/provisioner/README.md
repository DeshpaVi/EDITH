# ACXD provisioner

The Lambda behind the `Custom::AcxdProvision` resource in every generated template. It reads the ACXD API key from a Secrets
Manager secret in the target account and creates the ACXD resources in order (secrets, context variables, data requests, flows,
guardrails, application), create-or-update by name, and deletes them again when the stack is deleted.

## Build the package (once, and again whenever `index.mjs` changes)

Needs npm, zip and AWS access: **AWS CloudShell has all three.** From the website source folder:

```bash
BUCKET=<a bucket in the same region as the stack> KEY=provisioner/v1.zip ./provisioner/build.sh
```

It installs the ACXD SDK (`amazon-connect-acxd-sdk`), zips `index.mjs`, `package.json` and `node_modules`, uploads the zip and prints the
SDK version it included. Give the bucket name and key to the stack (`ProvisionerCodeBucket`, `ProvisionerCodeKey`). Once a version works,
pin it in `package.json` (it is `latest` now) and rebuild.

## If a deployment fails here

CloudFormation Events, the `AcxdProvision` row: the reason names the ACXD resource and error (never a secret). The Lambda's CloudWatch
log group has the step-by-step log. Every ACXD command shape in `index.mjs` is taken from the skill's references but has not run against a
real workspace: an `UnknownOperation`, `ValidationException` or a resource-not-found on `Get...` in the log is the first place to look.
