import type { Journey } from '../journey/model'
import type { RequiresReview } from '../checklist/model'
import type { AcxdSpec, Skipped } from './acxd/resources'
import type { CfnTemplate } from './cfn/template'

export interface ReadmeInput {
  journey: Journey
  template: CfnTemplate
  spec: AcxdSpec
  skipped: Skipped[]
  warnings: string[]
  blockers: RequiresReview[]
  consoleSteps: string[]
  identifierFields?: string[]
  tableName?: string
  /** Deployed by the tool: the CLI deploy steps do not apply. */
  managed?: boolean
}

/** Deterministic deploy guide shipped with the bundle. Contains no secrets. */
export function renderReadme(i: ReadmeInput): string {
  const hasTable = 'RespondentsTable' in i.template.Resources
  const L: string[] = [`# ${i.journey.title}: deployment bundle`, '']
  L.push(
    'Generated from the customer journey. It creates AWS resources and the ACXD resources in one CloudFormation stack.',
    'The ACXD resources are created by a Lambda-backed custom resource (the provisioner) using your ACXD API key.',
    '',
    ...(i.managed
      ? [
          '## Deploy',
          '',
          'This bundle is deployed from the tool: review the change set it shows, confirm, and follow the progress. The ACXD API key is never passed',
          'to the tool; you create a Secrets Manager secret in the target account and give its ARN.',
          '',
          'After the deployment finishes:',
          '',
        ]
      : [
    '## Before you start',
    '',
    '- AWS CLI with credentials for the target account and region, and permission to create IAM roles, Lambda, DynamoDB and Secrets Manager resources.',
    '- The ACXD workspace id, and an ACXD API key (`acxd_live_...`) for a programmatic user with access to that workspace.',
    '- An S3 bucket you can write to, for packaging the provisioner.',
    '',
    '## Deploy',
    '',
    '1. Install the provisioner dependencies:',
    '   ```bash',
    '   cd provisioner && npm install --omit=dev && cd ..',
    '   ```',
    '   TODO(acxd-schema): `provisioner/package.json` depends on `amazon-connect-acxd-sdk@latest`; pin the version you tested.',
    '2. Package the template (uploads the provisioner and rewrites its path):',
    '   ```bash',
    '   aws cloudformation package --template-file template.json --s3-bucket <YOUR_BUCKET> --output-template-file packaged.json',
    '   ```',
    '3. Deploy. Put the API key in an environment variable first so it does not land in shell history:',
    '   ```bash',
    '   read -rs ACXD_API_KEY   # paste the key, press Enter',
    '   aws cloudformation deploy --template-file packaged.json --stack-name <STACK_NAME> --capabilities CAPABILITY_IAM \\',
    '     --parameter-overrides AcxdWorkspaceId=<WORKSPACE_ID> AcxdApiKey="$ACXD_API_KEY"',
    '   ```',
    '4. Read the outputs (the ACXD application id is needed for the Connect contact flow):',
    '   ```bash',
    '   aws cloudformation describe-stacks --stack-name <STACK_NAME> --query "Stacks[0].Outputs"',
    '   ```',
    '',
        ]),
  )
  let step = i.managed ? 1 : 5
  if (hasTable) {
    const fields = i.identifierFields ?? []
    const item = Object.fromEntries(fields.map((f) => [f, { S: `<${f}>` }]))
    L.push(
      `${step++}. Seed the respondent table with real or demo records (one item per respondent; every identifier is a string attribute):`,
      '   ```bash',
      `   aws dynamodb put-item --table-name ${i.tableName ?? 'RespondentRecords'} --item '${JSON.stringify(item)}'`,
      '   ```',
      '',
    )
  }
  for (const s of i.consoleSteps) L.push(`${step++}. ${s}`)
  L.push(
    `${step++}. Generate the Amazon Connect contact flow once you have the application id and the deployment alias id (it needs both), import it in the Connect console, add the Set voice block for voice channels, publish, and attach a phone number.`,
    '',
    '## What was NOT generated',
    '',
  )
  if (i.skipped.length === 0) L.push('Nothing was skipped.')
  for (const s of i.skipped) L.push(`- \`${s.id}\`: ${s.reason}`)
  if (i.warnings.length > 0) {
    L.push('', '## Warnings', '')
    for (const w of i.warnings) L.push(`- ${w}`)
  }
  if (i.blockers.length > 0) {
    L.push('', '## Blockers that still need a human decision', '')
    for (const b of i.blockers) L.push(`- **${b.title}**: ${b.detail}`)
  }
  L.push(
    '',
    '## First-deployment checks',
    '',
    '- The provisioner and the template have not run against a live account in this repository yet: the first deployment is the real test. Read the CloudFormation events and the provisioner log group if the custom resource fails.',
    '- Deleting the stack deletes the ACXD resources it created (application, flows, data requests, guardrails, context variables, secret).',
    '- Do not rename the application by updating the stack; create a new stack instead.',
    '',
  )
  return L.join('\n')
}
