// Journey in, deployable implementation out (CloudFormation template + ACXD provisioner spec + Connect flow).
// The older Connect/Lex migration emitters in ./index.ts are a separate input path.
export { emitBundle } from './bundle'
export type { Bundle, BundleOptions } from './bundle'
export { emitContactFlow as emitAgenticContactFlow } from './connect/agenticContactFlow'
export type { ContactFlowInput } from './connect/agenticContactFlow'
export { buildTemplate, attributeName } from './cfn/template'
export { buildAcxdSpec, TOKENS } from './acxd/resources'
export type { AcxdSpec, GuardrailContent, GuardrailDefinition } from './acxd/resources'
export { FLOW_IDS } from './acxd/flows'
