# First end-to-end test: the Census CQA journey

Goal: from the website, produce a bundle, deploy it into an AWS account, and see the ACXD application and the Connect flow work.
Everything is done in the AWS console and CloudShell; nothing needs to be installed on your laptop. Use one region throughout
(the same as your website stack, for example us-east-1). The Bedrock part (reading a deck with the model) is last and optional:
the test below loads the Census example journey instead.

## 0. What you need
- The website (already hosted) and its address, e.g. `https://dxxxx.cloudfront.net`.
- Your ACXD **workspace id** and an **API key** (`acxd_live_...`) for a programmatic user with access to that workspace.
- An S3 bucket for packages, in the region (e.g. the `journeyforge-code-<account>` bucket).
- An Amazon Connect instance, a queue in it, and a phone number or the test chat window (for the last step).
- A knowledge base created in the ACXD console (its id goes into the bundle form). Optional but the FAQ part needs it.

## 1. Update the website (once, whenever the code changes)
CloudShell: upload `journeyforge-website.zip`, then
```bash
unzip -qo journeyforge-website.zip && cd Website && npm ci && VITE_AUTH=cognito npm run build
BUCKET=<SiteBucketName>; aws s3 sync dist s3://$BUCKET --delete --exclude index.html --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html s3://$BUCKET/index.html --cache-control no-cache --content-type text/html
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*"
```

## 2. Build the provisioner package (once)
Same CloudShell session, in the `Website` folder:
```bash
BUCKET=<package bucket> KEY=provisioner/v1.zip ./provisioner/build.sh
```
Note the SDK version it prints.

## 3. Put the ACXD API key in Secrets Manager (once)
Secrets Manager, Store a new secret, Other type of secret, **Plaintext**, paste the key, name `acxd-api-key`. Copy the secret's **ARN**.

## 4. Generate the bundle
On the site: Journey, **Load the Census CQA example**, Checklist (review), **Continue**, Bundle:
- Application name: `CQA Demo`. Table name: `CensusIds`. Attribute names: `censusId, zipCode, ssnLastFour`.
- Knowledge base id: yours. Click **Use the Census example wording** for the three guardrails.
- Deploy mode: **CloudFormation console**. **Generate bundle**, download the zip, unzip it.

## 5. Deploy the stack
CloudFormation, Create stack, upload `template.json` from the bundle. Parameters: `AcxdWorkspaceId`, `AcxdApiKeySecretArn` (step 3),
`ProvisionerCodeBucket` and `ProvisionerCodeKey` (step 2), `TableName`. Acknowledge IAM, Submit. Wait for CREATE_COMPLETE.
If `AcxdProvision` fails: Events shows the reason; the provisioner's CloudWatch log group shows the ACXD call that failed. Send me that text.
Copy the outputs `AcxdApplicationId` and `VerifyFunctionUrl`.

## 6. Seed the table
DynamoDB, table `CensusIds`, Explore table items, Create item: `censusId` = `12345`, `zipCode` = `411018`, `ssnLastFour` = a demo value (all strings).

## 7. ACXD console steps
Follow the "Console steps after deploying" list in the bundle README (build and deploy the application, create the deployment alias, and
anything the tool could not generate). Note the **deployment alias id**.

## 8. Connect contact flow
On the site: Connect flow. Fill the workspace id, application id (step 5), alias id (step 7), flow name, queue name, and either the queue ARN or
region, account id, **Connect instance id** and queue id. Generate and download, import it in the Connect console (the instance whose id you used),
add the Set voice block for voice, publish, attach a number.

## 9. Test
Call or chat. Expected: greeting, authentication with any one of Census id / zip / last four of SSN (retries up to 3), FAQ answers from the
knowledge base, escalation to the queue with the hand-back attributes. Anything that differs: send me the stack events, the provisioner log
lines, or a screenshot.

## 10. Clean up
Delete the stack: the provisioner removes the ACXD resources it created. Empty nothing else.

## Later: Bedrock (reading a deck)
Enable model access, deploy `journeyforge extractor` (see `Website/extractor-api/README.md`), paste its URL and token on the Journey page.
