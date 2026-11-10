// Build the browser half into the closure-factory artifact the dsh client
// module loader registers: window.__ModuleLoader__.load({ id, factory }).
import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'

const id = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name

// Modules the Web shell seeds into its shared module table.
const PLATFORM = [
  'react', 'react/jsx-runtime', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots',
]

const result = await build({
  entryPoints: [new URL('../src/client/index.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM,
  legalComments: 'none',
})

const body = result.outputFiles[0].text
const artifact = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(id)},`,
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  body,
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')
writeFileSync(new URL('../lib/client.js', import.meta.url), artifact)
