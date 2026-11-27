// Corre diagnostico-electron.mjs con el Electron de desktop/, y si no está instalado dice cómo instalarlo.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const cli = path.join(aqui, '..', '..', 'desktop', 'node_modules', 'electron', 'cli.js')
if (!fs.existsSync(cli)) {
  console.error('Falta el Electron de desktop/. Instalalo una vez con:\n\n  npm ci --prefix ../../desktop\n')
  process.exit(1)
}
const r = spawnSync(process.execPath, [cli, path.join(aqui, 'diagnostico-electron.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(r.status ?? 1)
