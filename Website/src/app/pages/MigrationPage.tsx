import { useState } from 'react'
import { MigrationReport } from '../../components/MigrationReport'
import { loadFiles, runMigration } from '../../migration/loadFiles'
import type { LoadedFile, MigrationResult } from '../../migration/loadFiles'
import { Button, Panel, Problems } from '../../implementation/ui'
import { color, heading, muted } from '../../implementation/theme'

/**
 * Second input path: an existing Amazon Connect contact flow plus the Lex bot export it references. Both files matter:
 * a bot reference with no export is reported as a coverage gap, never worked around.
 */
export function MigrationPage() {
  const [loaded, setLoaded] = useState<LoadedFile[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MigrationResult | null>(null)

  // Files accumulate rather than replace, so a bot export can be added after the flow.
  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    setBusy(true)
    try {
      const incoming = await loadFiles(Array.from(list))
      const kept = incoming.filter((f) => !f.error)
      const merged = [...loaded.filter((f) => !kept.some((k) => k.name === f.name)), ...kept]
      setLoaded(merged)
      setErrors(incoming.filter((f) => f.error).map((f) => f.error as string))
      setResult(runMigration(merged))
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Could not read those files.'])
    } finally {
      setBusy(false)
    }
  }
  const reset = () => { setLoaded([]); setErrors([]); setResult(null) }
  const hasFlow = loaded.some((f) => f.kind === 'contact-flow')
  const bots = loaded.filter((f) => f.kind === 'lex-bot').length

  return (
    <>
      <h1 className="ax-h1">Connect and Lex import</h1>
      <p className="ax-lead">Read an existing contact flow and the Lex bot export it references. Both files are needed: a missing bot export is reported as a coverage gap.</p>
      <Panel style={{ marginBottom: 16 }}>
        <h2 style={{ ...heading, fontSize: 18, marginBottom: 8 }}>Files</h2>
        <p style={muted}>Connect flow JSON, plus the Lex export (.json or .zip). Read in this browser; nothing is uploaded.</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0' }}>
          <input id="ivr-file-upload" type="file" multiple accept=".json,.zip,application/json,application/zip" hidden onChange={(e) => { void handleFiles(e.target.files); e.target.value = '' }} />
          <label htmlFor="ivr-file-upload" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void handleFiles(e.dataTransfer.files) }}
            style={{ cursor: 'pointer', padding: '10px 20px', borderRadius: 980, border: `1px dashed ${errors.length ? color.bad : hasFlow ? color.good : color.border}`, color: color.text, fontSize: 14 }}>
            {busy ? 'Reading…' : hasFlow ? `${loaded.length} file${loaded.length > 1 ? 's' : ''} loaded` : 'Choose or drop files'}
          </label>
          {loaded.length > 0 && <Button kind="ghost" onClick={reset}>Clear</Button>}
        </div>
        {loaded.length > 0 && <p style={{ ...muted, fontSize: 13 }}>{loaded.map((f) => f.name).join(', ')} · {hasFlow ? `Contact flow${bots ? ` + ${bots} bot export${bots > 1 ? 's' : ''}` : ', no bot export yet'}` : 'no contact flow yet'}</p>}
        <Problems items={errors} />
        {loaded.length > 0 && !hasFlow && <p style={{ color: color.warn, fontSize: 13 }}>A Lex export on its own has nothing to attach to: add the contact flow that calls it.</p>}
      </Panel>
      {result && <MigrationReport model={result.model} plan={result.plan} />}
    </>
  )
}
