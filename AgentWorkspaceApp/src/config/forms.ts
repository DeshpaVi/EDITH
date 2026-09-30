import manifestJson from './form-manifest.json'
import type { FormManifest } from '../forms/types'

/** Problems that would make a form unusable, surfaced instead of failing silently. */
export function validateForms(manifest: FormManifest): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const form of manifest.forms) {
    if (ids.has(form.id)) problems.push(`Duplicate form id "${form.id}".`)
    ids.add(form.id)
    if (form.triggers.length === 0) problems.push(`Form "${form.id}" has no triggers, so it can never open.`)
    for (const source of form.triggers) {
      try {
        new RegExp(source, 'i')
      } catch {
        problems.push(`Form "${form.id}" has an invalid trigger pattern: ${source}`)
      }
    }
    const keys = new Set<string>()
    for (const field of form.fields) {
      if (keys.has(field.key)) problems.push(`Form "${form.id}" repeats field "${field.key}".`)
      keys.add(field.key)
      if (field.type === 'select' && !field.options?.length) problems.push(`Field "${form.id}.${field.key}" is a select with no options.`)
    }
  }
  return problems
}

export const formManifest = manifestJson as FormManifest
export const formManifestProblems = validateForms(formManifest)
