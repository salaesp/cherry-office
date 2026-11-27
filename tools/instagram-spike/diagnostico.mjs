// Diagnóstico con Node (fetch de Node). Uso: node diagnostico.mjs <cuenta> [variante...] [--datos ./datos]
// Las variantes son pagina, api-i, api-www y api-www-cookies (sin nombrar ninguna, corren todas).
import path from 'node:path'
import process from 'node:process'
import { limpiarCuenta } from './mapeo.mjs'
import { correrDiagnostico } from './variantes.mjs'

const args = process.argv.slice(2)
const i = args.indexOf('--datos')
const datos = path.resolve(i >= 0 ? args.splice(i, 2)[1] : './datos')
const cuenta = limpiarCuenta(args.shift())
if (!cuenta) { console.error('Uso: node diagnostico.mjs <cuenta> [variante...]'); process.exit(2) }

async function pedir(url, headers) {
  const r = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20000) })
  const cookies = {}
  for (const c of r.headers.getSetCookie()) {
    const [par] = c.split(';')
    const k = par.indexOf('=')
    if (k > 0) cookies[par.slice(0, k).trim()] = par.slice(k + 1).trim()
  }
  return { status: r.status, location: r.headers.get('location') ?? undefined, cuerpo: await r.text(), cookies }
}

await correrDiagnostico({ cuenta, pedir, motor: 'node', datos, soloEstas: args })
