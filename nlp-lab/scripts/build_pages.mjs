import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
await access('public/runtime/nlp-runtime.zip').catch(() => { throw new Error('Run npm run build:runtime before building Pages') })
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_NLP_RUNTIME: 'browser', VITE_NLP_BASE: '/GDPProject/nlp/' },
})
process.exit(result.status ?? 1)
