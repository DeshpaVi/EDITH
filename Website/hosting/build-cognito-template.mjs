// Generates site-cognito.template.json (committed, and checked against this file by a test).
// Run: node hosting/build-cognito-template.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const J = (...parts) => ({ 'Fn::Join': ['', parts] })
const Sub = (s) => ({ 'Fn::Sub': s })
const Ref = (n) => ({ Ref: n })
const Att = (n, a) => ({ 'Fn::GetAtt': [n, a] })

export function buildCognitoTemplate() {
  const sessionCheck = readFileSync(join(here, 'session-check.js'), 'utf8')
  const siteUrl = Sub('https://${SiteDistribution.DomainName}')
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Private static hosting for JourneyForge: S3 (not public) behind CloudFront, with sign-in through Amazon Cognito (Hosted UI, authorization code with PKCE). A CloudFront Function checks a signed session cookie on every request; a small Lambda handles /auth/*. See hosting/README.md.',
    Parameters: {
      AdminEmail: { Type: 'String', AllowedPattern: '[^@\\s]+@[^@\\s]+\\.[^@\\s]+', Description: 'First user. Cognito emails this address a temporary password.' },
      DomainPrefix: { Type: 'String', AllowedPattern: '[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?', Description: 'Prefix of the Cognito sign-in address (<prefix>.auth.<region>.amazoncognito.com). Must be unique in the region and must not contain "aws", "amazon" or "cognito".' },
      SessionKey: { Type: 'String', NoEcho: true, AllowedPattern: '[A-Za-z0-9]{32,64}', Description: 'Random secret (32 to 64 letters and digits) that signs session cookies. The deploy script generates one.' },
      AuthCodeBucket: { Type: 'String', AllowedPattern: '[0-9A-Za-z._-]*[0-9A-Za-z_-]', ConstraintDescription: 'Only the bucket name: no s3://, no ARN, no slash, no spaces, no trailing dot.', Description: 'Bucket NAME only (same region as this stack) holding auth.zip, the zipped contents of hosting/auth-lambda.' },
      AuthCodeKey: { Type: 'String', Default: 'auth.zip', AllowedPattern: '[^\\s]+', ConstraintDescription: 'The object key, no spaces (auth.zip).', Description: 'S3 key of the zip.' },
      SessionHours: { Type: 'Number', Default: 8, MinValue: 1, MaxValue: 72, Description: 'How long a sign-in lasts.' },
    },
    Resources: {
      SiteBucket: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
          BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
          OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
        },
      },
      SiteOac: {
        Type: 'AWS::CloudFront::OriginAccessControl',
        Properties: { OriginAccessControlConfig: { Name: Sub('${AWS::StackName}-oac'), OriginAccessControlOriginType: 's3', SigningBehavior: 'always', SigningProtocol: 'sigv4' } },
      },
      SessionCheck: {
        Type: 'AWS::CloudFront::Function',
        Properties: {
          Name: Sub('${AWS::StackName}-session'),
          AutoPublish: true,
          FunctionConfig: { Comment: 'Requires a valid session cookie', Runtime: 'cloudfront-js-2.0' },
          FunctionCode: J("var KEY = '", Ref('SessionKey'), "';\n", sessionCheck),
        },
      },

      UserPool: {
        Type: 'AWS::Cognito::UserPool',
        Properties: {
          UserPoolName: Sub('${AWS::StackName}-users'),
          UsernameAttributes: ['email'],
          AutoVerifiedAttributes: ['email'],
          AdminCreateUserConfig: {
            AllowAdminCreateUserOnly: true,
            InviteMessageTemplate: { EmailSubject: 'Your JourneyForge sign-in', EmailMessage: 'Your user name is {username} and your temporary password is {####}. You will be asked to choose a new password the first time you sign in.' },
          },
          Policies: { PasswordPolicy: { MinimumLength: 12, RequireLowercase: true, RequireUppercase: true, RequireNumbers: true, RequireSymbols: true, TemporaryPasswordValidityDays: 7 } },
          MfaConfiguration: 'OPTIONAL',
          EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
          AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }] },
        },
      },
      UserPoolDomain: { Type: 'AWS::Cognito::UserPoolDomain', Properties: { Domain: Ref('DomainPrefix'), UserPoolId: Ref('UserPool') } },
      FirstUser: {
        Type: 'AWS::Cognito::UserPoolUser',
        Properties: {
          UserPoolId: Ref('UserPool'),
          Username: Ref('AdminEmail'),
          DesiredDeliveryMediums: ['EMAIL'],
          UserAttributes: [{ Name: 'email', Value: Ref('AdminEmail') }, { Name: 'email_verified', Value: 'true' }],
        },
      },
      UserPoolClient: {
        Type: 'AWS::Cognito::UserPoolClient',
        Properties: {
          ClientName: Sub('${AWS::StackName}-site'),
          UserPoolId: Ref('UserPool'),
          GenerateSecret: false,
          AllowedOAuthFlowsUserPoolClient: true,
          AllowedOAuthFlows: ['code'],
          AllowedOAuthScopes: ['openid', 'email'],
          SupportedIdentityProviders: ['COGNITO'],
          CallbackURLs: [Sub('https://${SiteDistribution.DomainName}/auth/callback')],
          LogoutURLs: [Sub('https://${SiteDistribution.DomainName}/auth/signed-out')],
          PreventUserExistenceErrors: 'ENABLED',
        },
      },
      // The auth Lambda reads these at run time, so it does not depend on the client (which depends on the distribution, which depends on the Lambda).
      AuthConfig: {
        Type: 'AWS::SSM::Parameter',
        Properties: {
          Name: Sub('/${AWS::StackName}/auth'),
          Type: 'String',
          Value: J('{"region":"', Ref('AWS::Region'), '","userPoolId":"', Ref('UserPool'), '","clientId":"', Ref('UserPoolClient'), '","domain":"', Ref('DomainPrefix'), '.auth.', Ref('AWS::Region'), '.amazoncognito.com","siteUrl":"', siteUrl, '"}'),
        },
      },

      AuthRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
          ManagedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
          Policies: [{
            PolicyName: 'ReadAuthConfig',
            PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'ssm:GetParameter', Resource: Sub('arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter/${AWS::StackName}/auth') }] },
          }],
        },
      },
      AuthFunction: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          Runtime: 'nodejs22.x',
          Handler: 'index.handler',
          Timeout: 10,
          Role: Att('AuthRole', 'Arn'),
          // index.mjs zipped at the root of auth.zip (hosting/deploy-site.sh builds and uploads it; in the console you upload it yourself).
          Code: { S3Bucket: Ref('AuthCodeBucket'), S3Key: Ref('AuthCodeKey') },
          Environment: { Variables: { CONFIG_PARAMETER: Sub('/${AWS::StackName}/auth'), SESSION_KEY: Ref('SessionKey'), SESSION_HOURS: Ref('SessionHours') } },
        },
      },
      AuthUrl: { Type: 'AWS::Lambda::Url', Properties: { AuthType: 'NONE', TargetFunctionArn: Att('AuthFunction', 'Arn') } },
      AuthUrlPermission: { Type: 'AWS::Lambda::Permission', Properties: { Action: 'lambda:InvokeFunctionUrl', FunctionName: Ref('AuthFunction'), Principal: '*', FunctionUrlAuthType: 'NONE' } },
      // TODO(aws-schema): InvokedViaFunctionUrl is not verified against a real deployment; confirm on first deploy.
      AuthInvokePermission: { Type: 'AWS::Lambda::Permission', Properties: { Action: 'lambda:InvokeFunction', FunctionName: Ref('AuthFunction'), Principal: '*', InvokedViaFunctionUrl: true } },

      SiteDistribution: {
        Type: 'AWS::CloudFront::Distribution',
        Properties: {
          DistributionConfig: {
            Enabled: true,
            Comment: Sub('${AWS::StackName}'),
            DefaultRootObject: 'index.html',
            HttpVersion: 'http2and3',
            PriceClass: 'PriceClass_100',
            Origins: [
              { Id: 'site-bucket', DomainName: Att('SiteBucket', 'RegionalDomainName'), OriginAccessControlId: Att('SiteOac', 'Id'), S3OriginConfig: { OriginAccessIdentity: '' } },
              { Id: 'auth', DomainName: { 'Fn::Select': [2, { 'Fn::Split': ['/', Att('AuthUrl', 'FunctionUrl')] }] }, CustomOriginConfig: { OriginProtocolPolicy: 'https-only', HTTPSPort: 443 } },
            ],
            DefaultCacheBehavior: {
              TargetOriginId: 'site-bucket',
              ViewerProtocolPolicy: 'redirect-to-https',
              AllowedMethods: ['GET', 'HEAD'],
              Compress: true,
              CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
              ResponseHeadersPolicyId: '67f7725c-6f97-4210-82d7-5512b31e9d03',
              FunctionAssociations: [{ EventType: 'viewer-request', FunctionARN: Att('SessionCheck', 'FunctionARN') }],
            },
            CacheBehaviors: [{
              PathPattern: '/auth/*',
              TargetOriginId: 'auth',
              ViewerProtocolPolicy: 'redirect-to-https',
              AllowedMethods: ['GET', 'HEAD'],
              CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // CachingDisabled
              OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac', // AllViewerExceptHostHeader: forwards cookies and query strings
              ResponseHeadersPolicyId: '67f7725c-6f97-4210-82d7-5512b31e9d03',
            }],
          },
        },
      },
      SiteBucketPolicy: {
        Type: 'AWS::S3::BucketPolicy',
        Properties: {
          Bucket: Ref('SiteBucket'),
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [{
              Sid: 'AllowCloudFrontRead', Effect: 'Allow', Principal: { Service: 'cloudfront.amazonaws.com' }, Action: 's3:GetObject',
              Resource: Sub('${SiteBucket.Arn}/*'),
              Condition: { StringEquals: { 'AWS:SourceArn': Sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${SiteDistribution}') } },
            }],
          },
        },
      },
    },
    Outputs: {
      SiteUrl: { Description: 'Open this address; you are sent to the sign-in page.', Value: siteUrl },
      SiteBucketName: { Description: 'Upload the built site (dist/) here.', Value: Ref('SiteBucket') },
      DistributionId: { Description: 'Invalidate this after each upload.', Value: Ref('SiteDistribution') },
      UserPoolId: { Description: 'Add more users here (console, or aws cognito-idp admin-create-user).', Value: Ref('UserPool') },
    },
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(here, 'site-cognito.template.json'), JSON.stringify(buildCognitoTemplate(), null, 2) + '\n')
  console.log('wrote hosting/site-cognito.template.json')
}
