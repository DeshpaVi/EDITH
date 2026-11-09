import type { Journey } from '../journey/model'
import { stepsOfKind } from '../journey/model'
import { buildChecklist, resolveSelection } from '../checklist/build'
import type { RequiresReview } from '../checklist/model'
import { buildAcxdSpec } from './acxd/resources'
import type { AcxdSpec, SpecOptions, Skipped } from './acxd/resources'
import { buildTemplate, attributeName } from './cfn/template'
import type { CfnTemplate } from './cfn/template'
import { renderReadme } from './readme'

export interface BundleOptions extends SpecOptions {
  tableName?: string
  /** Attribute names for the identifiers, in journey order. Defaults to a camelCase of each identifier. */
  identifierFields?: string[]
  /** Source of the static provisioner (`index.mjs`, `package.json`), supplied by the caller (read at build time). */
  provisionerFiles?: Record<string, string>
  /** 'managed' templates are deployed by the tool's backend; see `buildTemplate`. */
  mode?: 'cli' | 'managed'
}

export interface Bundle {
  /** Path to content. */
  files: Record<string, string>
  template: CfnTemplate
  spec: AcxdSpec
  /** Selected items that were NOT generated, with the reason. Never silently dropped. */
  skipped: Skipped[]
  warnings: string[]
  /** Blockers from the checklist that still need a human decision. */
  blockers: RequiresReview[]
  consoleSteps: string[]
  selected: string[]
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`

/**
 * Journey and selection in; deployable bundle out. Deterministic. Generates only items whose schema is
 * confirmed; everything else is reported in `skipped`, `warnings` and `blockers`.
 */
export function emitBundle(journey: Journey, selection: Iterable<string>, opts: BundleOptions): Bundle {
  const checklist = buildChecklist(journey)
  const resolved = resolveSelection(checklist, selection)
  const selected = new Set(resolved.selected)
  const auth = stepsOfKind(journey, 'authentication')[0]

  const { spec, warnings, skipped, consoleSteps } = buildAcxdSpec(journey, selected, opts)
  const identifierFields = opts.identifierFields ?? auth?.identifiers.map(attributeName)
  const template = buildTemplate({ journeyTitle: journey.title, selected, spec, auth, identifierFields, tableName: opts.tableName, mode: opts.mode })
  const blockers = checklist.reviews.filter((r) => r.severity === 'blocker')

  const files: Record<string, string> = {
    'template.json': json(template),
    'acxd-spec.json': json(spec),
    'README.md': renderReadme({ journey, template, spec, skipped, warnings, blockers, consoleSteps, identifierFields, tableName: opts.tableName, managed: opts.mode === 'managed' }),
  }
  if (opts.mode !== 'managed') {
    for (const [name, content] of Object.entries(opts.provisionerFiles ?? {})) files[`provisioner/${name}`] = content
    if (!opts.provisionerFiles) warnings.push('The provisioner source was not supplied; copy Website/provisioner into the bundle before packaging.')
  }

  return { files, template, spec, skipped, warnings, blockers, consoleSteps, selected: resolved.selected }
}
