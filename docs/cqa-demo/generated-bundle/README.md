# 2030 Census Questionnaire Assistance (CQA) demo: deployment bundle

Generated from the customer journey. It creates AWS resources and the ACXD resources in one CloudFormation stack.
The ACXD resources are created by a Lambda-backed custom resource (the provisioner) using your ACXD API key.

## Before you start

- AWS CLI with credentials for the target account and region, and permission to create IAM roles, Lambda, DynamoDB and Secrets Manager resources.
- The ACXD workspace id, and an ACXD API key (`acxd_live_...`) for a programmatic user with access to that workspace.
- An S3 bucket you can write to, for packaging the provisioner.

## Deploy

1. Install the provisioner dependencies:
   ```bash
   cd provisioner && npm install --omit=dev && cd ..
   ```
   TODO(acxd-schema): `provisioner/package.json` depends on `amazon-connect-acxd-sdk@latest`; pin the version you tested.
2. Package the template (uploads the provisioner and rewrites its path):
   ```bash
   aws cloudformation package --template-file template.json --s3-bucket <YOUR_BUCKET> --output-template-file packaged.json
   ```
3. Deploy. Put the API key in an environment variable first so it does not land in shell history:
   ```bash
   read -rs ACXD_API_KEY   # paste the key, press Enter
   aws cloudformation deploy --template-file packaged.json --stack-name <STACK_NAME> --capabilities CAPABILITY_IAM \
     --parameter-overrides AcxdWorkspaceId=<WORKSPACE_ID> AcxdApiKey="$ACXD_API_KEY"
   ```
4. Read the outputs (the ACXD application id is needed for the Connect contact flow):
   ```bash
   aws cloudformation describe-stacks --stack-name <STACK_NAME> --query "Stacks[0].Outputs"
   ```

5. Seed the respondent table with real or demo records (one item per respondent; every identifier is a string attribute):
   ```bash
   aws dynamodb put-item --table-name CensusIds --item '{"censusId":{"S":"<censusId>"},"zipCode":{"S":"<zipCode>"},"ssnLastFour":{"S":"<ssnLastFour>"}}'
   ```

6. Application > Design > Manage default behavior: set **Incomprehension** to the flow Escalation (the SDK key for this default is not documented, so the provisioner does not set it).
7. Application > Deploy: build, fix any validation errors, then deploy to your environment and note the deployment alias.
8. Generate the Amazon Connect contact flow once you have the application id and the deployment alias id (it needs both), import it in the Connect console, add the Set voice block for voice channels, publish, and attach a phone number.

## What was NOT generated

- `acxd.languages`: Language settings, voices and translations are unconfirmed; configure them in the console.

## Warnings

- Escalation summary uses the generic default prompt; review it with the customer.
- Safety message is the US Census default (911/988). Replace it with the customer's own emergency wording, especially outside the US.
- Authentication retry: the flow plays "I'm sorry, I didn't quite get that." and then replays the original prompt. The journey's single failure message ("I'm sorry, I didn't quite get that. Can you please provide your Census ID and either your home zip code or the last four digits of your SSN?") is not played as one piece.
- Main conversation prompt is a neutral baseline; supply the customer's own persona and rules.

## Blockers that still need a human decision

- **Language detection and switching in ACXD is unverified**: The journey detects the caller's language (en-US, es-US; via Lambda (orange decision)). How ACXD detects and switches language in an ACXD-only design has not been verified.

## First-deployment checks

- The provisioner and the template have not run against a live account in this repository yet: the first deployment is the real test. Read the CloudFormation events and the provisioner log group if the custom resource fails.
- Deleting the stack deletes the ACXD resources it created (application, flows, data requests, guardrails, context variables, secret).
- Do not rename the application by updating the stack; create a new stack instead.
