import type { AuthenticationStep } from '../../journey/model'
import { IDS } from '../../checklist/rules'
import type { AcxdSpec } from '../acxd/resources'
import { TOKENS } from '../acxd/resources'
import { VERIFY_LAMBDA_SOURCE } from './verifyLambda'

type Json = Record<string, unknown>

export interface CfnTemplate {
  AWSTemplateFormatVersion: '2010-09-09'
  Description: string
  Parameters: Record<string, Json>
  Resources: Record<string, Json>
  Outputs: Record<string, Json>
}

export interface TemplateInput {
  journeyTitle: string
  selected: ReadonlySet<string>
  spec: AcxdSpec
  auth?: AuthenticationStep
  /** Attribute names for the identifiers, in the same order as `auth.identifiers`. First is the table key. */
  identifierFields?: string[]
  tableName?: string
  /**
   * 'cli' (default): the consultant deploys with the AWS CLI. The ACXD key is a NoEcho parameter stored in
   * Secrets Manager and the provisioner code is packaged from a local folder.
   * 'managed': deployed by this tool's backend. The ACXD key is NEVER a parameter: the consultant creates the
   * secret in the target account and passes its ARN, so the key never passes through the app. The provisioner code
   * comes from an artifacts bucket (S3 bucket and key parameters, filled in by the backend).
   */
  mode?: 'cli' | 'managed'
}

/** IAM roles created by this tool live under one path so a deploy role can be limited to them. */
export const ROLE_PATH = '/edith/'

/** 'Census ID' -> 'censusId'. Used when the consultant gives no explicit attribute names. */
export function attributeName(identifier: string): string {
  const words = identifier.split(/[^A-Za-z0-9]+/).filter(Boolean)
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('')
}

const ref = (name: string): Json => ({ Ref: name })
const getAtt = (name: string, attr: string): Json => ({ 'Fn::GetAtt': [name, attr] })

/**
 * Builds the CloudFormation template. Native resources (DynamoDB, IAM, Lambda, Secrets Manager) are
 * written directly; every ACXD resource is created by one Lambda-backed custom resource that receives the
 * spec. The ACXD API key is a NoEcho parameter that lands in Secrets Manager and is never written into
 * the template (CLAUDE.md constraint 1).
 */
export function buildTemplate(input: TemplateInput): CfnTemplate {
  const { selected, spec } = input
  const withVerifyBackend = [IDS.table, IDS.verifyLambda, IDS.verifyRole].every((id) => selected.has(id)) && input.auth !== undefined
  const fields = input.identifierFields ?? input.auth?.identifiers.map(attributeName) ?? []
  const managed = input.mode === 'managed'

  const parameters: Template['Parameters'] = {
    AcxdWorkspaceId: { Type: 'String', Description: 'ACXD workspace id the resources are created in.', AllowedPattern: '.+' },
  }
  if (managed) {
    parameters.AcxdApiKeySecretArn = {
      Type: 'String',
      Description: 'ARN of a Secrets Manager secret in this account whose value is the ACXD API key. Create it yourself; the key is never passed to the deploy tool.',
      AllowedPattern: 'arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:.+',
    }
    parameters.ProvisionerCodeBucket = { Type: 'String', Description: 'S3 bucket holding the provisioner package (set by the deploy tool).', AllowedPattern: '.+' }
    parameters.ProvisionerCodeKey = { Type: 'String', Description: 'S3 key of the provisioner package (set by the deploy tool).', AllowedPattern: '.+' }
  } else {
    parameters.AcxdApiKey = {
      Type: 'String',
      NoEcho: true,
      Description: 'ACXD API key (acxd_live_...). Stored in Secrets Manager; never written to the template.',
      AllowedPattern: '.+',
    }
  }
  const resources: Template['Resources'] = {}
  const outputs: Template['Outputs'] = {}

  // ---- verification backend (DynamoDB + Lambda) ---------------------------------------------------
  if (withVerifyBackend) {
    if (fields.length === 0) throw new Error('Verification backend needs at least one identifier field')
    parameters.TableName = { Type: 'String', Default: input.tableName ?? 'RespondentRecords', Description: 'DynamoDB table of respondent records.' }

    resources.VerifyKeySecret = {
      Type: 'AWS::SecretsManager::Secret',
      Properties: {
        Description: 'Shared key between ACXD and the verification Lambda (x-api-key header).',
        GenerateSecretString: { PasswordLength: 32, ExcludePunctuation: true },
      },
    }
    resources.RespondentsTable = {
      Type: 'AWS::DynamoDB::Table',
      Properties: {
        TableName: ref('TableName'),
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: fields.map((f) => ({ AttributeName: f, AttributeType: 'S' })),
        KeySchema: [{ AttributeName: fields[0], KeyType: 'HASH' }],
        ...(fields.length > 1
          ? {
              GlobalSecondaryIndexes: fields.slice(1).map((f) => ({
                IndexName: `${f}-index`,
                KeySchema: [{ AttributeName: f, KeyType: 'HASH' }],
                Projection: { ProjectionType: 'KEYS_ONLY' },
              })),
            }
          : {}),
      },
    }
    resources.VerifyAuthRole = {
      Type: 'AWS::IAM::Role',
      Properties: {
        Path: ROLE_PATH,
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
        },
        ManagedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
        Policies: [
          {
            PolicyName: 'ReadRespondents',
            PolicyDocument: {
              Version: '2012-10-17',
              Statement: [
                { Effect: 'Allow', Action: 'dynamodb:GetItem', Resource: getAtt('RespondentsTable', 'Arn') },
                { Effect: 'Allow', Action: 'dynamodb:Query', Resource: { 'Fn::Sub': '${RespondentsTable.Arn}/index/*' } },
              ],
            },
          },
        ],
      },
    }
    resources.VerifyAuthFunction = {
      Type: 'AWS::Lambda::Function',
      Properties: {
        Runtime: 'nodejs22.x',
        Handler: 'index.handler',
        Timeout: 10,
        Role: getAtt('VerifyAuthRole', 'Arn'),
        Code: { ZipFile: VERIFY_LAMBDA_SOURCE },
        Environment: {
          Variables: {
            TABLE_NAME: ref('RespondentsTable'),
            IDENTIFIER_FIELDS: fields.join(','),
            API_KEY: { 'Fn::Sub': '{{resolve:secretsmanager:${VerifyKeySecret}:SecretString}}' },
          },
        },
      },
    }
    resources.VerifyAuthUrl = {
      Type: 'AWS::Lambda::Url',
      Properties: { AuthType: 'NONE', TargetFunctionArn: getAtt('VerifyAuthFunction', 'Arn') },
    }
    resources.VerifyAuthUrlPermission = {
      Type: 'AWS::Lambda::Permission',
      Properties: { Action: 'lambda:InvokeFunctionUrl', FunctionName: ref('VerifyAuthFunction'), Principal: '*', FunctionUrlAuthType: 'NONE' },
    }
    // AWS now requires both permissions for a public Function URL. TODO(aws-schema): InvokedViaFunctionUrl is
    // not verified against a real deployment of this template; confirm on first deploy.
    resources.VerifyAuthInvokePermission = {
      Type: 'AWS::Lambda::Permission',
      Properties: { Action: 'lambda:InvokeFunction', FunctionName: ref('VerifyAuthFunction'), Principal: '*', InvokedViaFunctionUrl: true },
    }
    outputs.VerifyFunctionUrl = { Description: 'Verification Lambda URL (called by the ACXD data request).', Value: getAtt('VerifyAuthUrl', 'FunctionUrl') }
    outputs.RespondentsTableName = { Description: 'Seed this table with respondent records.', Value: ref('RespondentsTable') }
  }

  // ---- ACXD provisioner ----------------------------------------------------------------------------
  if (!managed) {
    resources.AcxdApiKeySecret = {
      Type: 'AWS::SecretsManager::Secret',
      Properties: { Description: 'ACXD API key used by the provisioner.', SecretString: ref('AcxdApiKey') },
    }
  }
  const apiKeySecret = managed ? ref('AcxdApiKeySecretArn') : ref('AcxdApiKeySecret')
  const readable = [apiKeySecret, ...(withVerifyBackend ? [ref('VerifyKeySecret')] : [])]
  resources.ProvisionerRole = {
    Type: 'AWS::IAM::Role',
    Properties: {
      Path: ROLE_PATH,
      AssumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      },
      ManagedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      Policies: [
        {
          PolicyName: 'ReadProvisionerSecrets',
          PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: readable }] },
        },
      ],
    },
  }
  resources.ProvisionerFunction = {
    Type: 'AWS::Lambda::Function',
    Properties: {
      Runtime: 'nodejs22.x',
      Handler: 'index.handler',
      Timeout: 900,
      MemorySize: 512,
      Role: getAtt('ProvisionerRole', 'Arn'),
      // CLI mode: a local path, which `aws cloudformation package` uploads and rewrites to an S3 location.
      Code: managed ? { S3Bucket: ref('ProvisionerCodeBucket'), S3Key: ref('ProvisionerCodeKey') } : './provisioner',
    },
  }

  // The spec travels as ONE JSON string: custom-resource properties are stringified by CloudFormation,
  // which would turn numbers and booleans into text.
  const specText = JSON.stringify(spec)
  const hasTokens = specText.includes(TOKENS.verifyUrl) || specText.includes(TOKENS.verifyKeySecretArn)
  let specValue: unknown = specText
  if (hasTokens) {
    if (!withVerifyBackend) throw new Error('The spec refers to the verification backend, but it is not part of the selection')
    const escaped = specText.split('${').join('${!')
    specValue = {
      'Fn::Sub': [
        escaped.split(TOKENS.verifyUrl).join('${VerifyUrl}').split(TOKENS.verifyKeySecretArn).join('${VerifyKeyArn}'),
        { VerifyUrl: getAtt('VerifyAuthUrl', 'FunctionUrl'), VerifyKeyArn: ref('VerifyKeySecret') },
      ],
    }
  }
  resources.AcxdProvision = {
    Type: 'Custom::AcxdProvision',
    Properties: {
      ServiceToken: getAtt('ProvisionerFunction', 'Arn'),
      ServiceTimeout: 900,
      WorkspaceId: ref('AcxdWorkspaceId'),
      ApiKeySecretArn: apiKeySecret,
      Spec: specValue,
    },
  }
  outputs.AcxdApplicationId = { Description: 'ACXD application id (needed for the Connect contact flow).', Value: getAtt('AcxdProvision', 'ApplicationId') }
  outputs.AcxdWorkspaceId = { Description: 'ACXD workspace id.', Value: ref('AcxdWorkspaceId') }

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: `Implementation of the journey "${input.journeyTitle}": ACXD resources via a custom resource, plus the AWS resources they need.`,
    Parameters: parameters,
    Resources: resources,
    Outputs: outputs,
  }
}

type Template = CfnTemplate
