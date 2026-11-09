// What this backend is willing to deploy. It exists to deploy the templates THIS tool generates, nothing else:
// a backend that could deploy arbitrary templates into customer accounts would be a remote-administration
// hole. So every template is checked against an allowlist of resource types and IAM actions, and anything
// outside it is refused.

export const MANAGED_TAG = 'edith-managed'
export const ROLE_PATH = '/edith/'
export const MAX_TEMPLATE_BYTES = 51_200

const ALLOWED_TYPES = new Set([
  'AWS::SecretsManager::Secret',
  'AWS::DynamoDB::Table',
  'AWS::IAM::Role',
  'AWS::Lambda::Function',
  'AWS::Lambda::Url',
  'AWS::Lambda::Permission',
  'Custom::AcxdProvision',
])
const ALLOWED_ROLE_ACTIONS = new Set(['dynamodb:GetItem', 'dynamodb:Query', 'secretsmanager:GetSecretValue'])
const ALLOWED_MANAGED_POLICIES = new Set(['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'])
/** Parameters the backend fills in itself; the browser must not supply them. */
export const RESERVED_PARAMETERS = ['ProvisionerCodeBucket', 'ProvisionerCodeKey']

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const asArray = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v])

/** Returns a list of problems; empty means the template is one this tool may deploy. */
export function templateProblems(template) {
  const problems = []
  if (!isObj(template) || !isObj(template.Resources)) return ['The template must be a JSON object with Resources.']
  if ('Transform' in template) problems.push('Templates with a Transform (macros) are not allowed.')

  for (const [name, p] of Object.entries(template.Parameters ?? {})) {
    if (isObj(p) && p.NoEcho === true) problems.push(`Parameter ${name} is NoEcho: secrets must not pass through the deploy tool (use a secret ARN instead).`)
  }
  for (const [name, o] of Object.entries(template.Outputs ?? {})) {
    if (isObj(o) && 'Export' in o) problems.push(`Output ${name} has an Export; exports are not allowed.`)
  }

  for (const [name, r] of Object.entries(template.Resources)) {
    if (!isObj(r) || typeof r.Type !== 'string') {
      problems.push(`Resource ${name} has no Type.`)
      continue
    }
    if (!ALLOWED_TYPES.has(r.Type)) {
      problems.push(`Resource ${name} has type ${r.Type}, which this tool does not deploy.`)
      continue
    }
    const props = isObj(r.Properties) ? r.Properties : {}

    if (r.Type === 'AWS::IAM::Role') {
      if (props.Path !== ROLE_PATH) problems.push(`Role ${name} must have Path ${ROLE_PATH}.`)
      for (const arn of asArray(props.ManagedPolicyArns)) if (!ALLOWED_MANAGED_POLICIES.has(arn)) problems.push(`Role ${name} attaches a managed policy that is not allowed.`)
      const trust = asArray(props.AssumeRolePolicyDocument?.Statement)
      const trustOk = trust.length === 1 && trust[0].Effect === 'Allow' && trust[0].Action === 'sts:AssumeRole' && isObj(trust[0].Principal) && Object.keys(trust[0].Principal).join() === 'Service' && trust[0].Principal.Service === 'lambda.amazonaws.com'
      if (!trustOk) problems.push(`Role ${name} may only be assumed by lambda.amazonaws.com.`)
      for (const policy of asArray(props.Policies)) {
        for (const st of asArray(policy?.PolicyDocument?.Statement)) {
          if (st.Effect !== 'Allow') problems.push(`Role ${name}: only Allow statements are permitted.`)
          for (const action of asArray(st.Action)) if (!ALLOWED_ROLE_ACTIONS.has(action)) problems.push(`Role ${name}: action ${action} is not allowed.`)
          if (st.Resource === '*' || asArray(st.Resource).includes('*')) problems.push(`Role ${name}: Resource "*" is not allowed.`)
          if (st.Resource === undefined) problems.push(`Role ${name}: a statement has no Resource.`)
        }
      }
    }

    if (r.Type === 'AWS::Lambda::Function') {
      if (typeof props.Runtime !== 'string' || !props.Runtime.startsWith('nodejs')) problems.push(`Function ${name} must use a Node.js runtime.`)
      const code = props.Code
      const fromParams = isObj(code) && isObj(code.S3Bucket) && code.S3Bucket.Ref === 'ProvisionerCodeBucket' && isObj(code.S3Key) && code.S3Key.Ref === 'ProvisionerCodeKey'
      const inline = isObj(code) && typeof code.ZipFile === 'string'
      if (!fromParams && !inline) problems.push(`Function ${name}: code must be inline or come from the provisioner parameters.`)
    }

    if (r.Type === 'AWS::Lambda::Permission') {
      const publicUrl = props.Principal === '*' && (props.Action === 'lambda:InvokeFunctionUrl' || (props.Action === 'lambda:InvokeFunction' && props.InvokedViaFunctionUrl === true))
      if (props.Principal === '*' && !publicUrl) problems.push(`Permission ${name}: a public principal is only allowed for Function URLs.`)
    }

    if (r.Type === 'Custom::AcxdProvision') {
      const token = props.ServiceToken
      const ok = isObj(token) && Array.isArray(token['Fn::GetAtt']) && token['Fn::GetAtt'][0] === 'ProvisionerFunction' && token['Fn::GetAtt'][1] === 'Arn'
      if (!ok) problems.push(`Custom resource ${name} may only call the ProvisionerFunction in this template.`)
    }
  }
  return problems
}

export function templateHashInput(templateBody) {
  return typeof templateBody === 'string' ? templateBody : JSON.stringify(templateBody)
}

/** Stack names this tool creates: edith- plus lowercase letters, digits and hyphens (CloudFormation allows 128). */
export function validStackName(name) {
  return typeof name === 'string' && /^edith-[a-z0-9]([a-z0-9-]{0,100}[a-z0-9])?$/.test(name)
}

/** Checks the supplied parameter values against the template's declared parameters. Returns problems. */
export function parameterProblems(templateParameters, supplied) {
  const problems = []
  const declared = isObj(templateParameters) ? templateParameters : {}
  if (!isObj(supplied)) return ['parameters must be an object of text values.']
  for (const key of Object.keys(supplied)) {
    if (RESERVED_PARAMETERS.includes(key)) problems.push(`${key} is set by the deploy tool and cannot be supplied.`)
    else if (!(key in declared)) problems.push(`${key} is not a parameter of this template.`)
    else if (typeof supplied[key] !== 'string' || supplied[key].length > 1024) problems.push(`${key} must be text up to 1024 characters.`)
  }
  for (const [key, def] of Object.entries(declared)) {
    if (RESERVED_PARAMETERS.includes(key)) continue
    const value = supplied[key]
    if (value === undefined) {
      if (!isObj(def) || def.Default === undefined) problems.push(`${key} is required.`)
      continue
    }
    if (isObj(def) && typeof def.AllowedPattern === 'string' && typeof value === 'string' && !new RegExp(`^(?:${def.AllowedPattern})$`).test(value)) {
      problems.push(`${key} does not match the required format.`)
    }
  }
  return problems
}
