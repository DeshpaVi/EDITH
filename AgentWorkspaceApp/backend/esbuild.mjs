// Bundles the Lambda into a single file, dependencies included.
//
// The AWS-provided Node runtime bundles *some* v3 clients, but which ones is an
// implementation detail that has changed between runtime versions. Bundling
// removes that question: what is tested locally is byte-for-byte what runs.
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'

await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })

await build({
  entryPoints: ['src/handler.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.mjs',
  sourcemap: false,
  minify: true,
  // esbuild's ESM output uses these Node globals; without the shim the bundle
  // throws on any dependency that references __dirname.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
})

console.log('built backend/dist/index.mjs')
