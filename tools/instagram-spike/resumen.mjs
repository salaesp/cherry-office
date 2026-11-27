// Resume lo que juntó el spike: cómo fueron los pedidos (cuántos anduvieron, cuándo empezó a frenar) y, por cuenta, el
// resumen que le serviría a un agente. Escribe `informe-resumen.json` sin textos de publicaciones.
//
// Uso: node resumen.mjs [--datos ./datos]
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { resumir } from './mapeo.mjs'

const i = process.argv.indexOf('--datos')
const DATOS = path.resolve(i > 0 ? process.argv[i + 1] : './datos')
const archivo = path.join(DATOS, 'pedidos.jsonl')
if (!fs.existsSync(archivo)) { console.error(`No hay ${archivo}: corré primero npm start -- <cuenta>`); process.exit(1) }

const pedidos = fs.readFileSync(archivo, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const porResultado = {}
for (const p of pedidos) porResultado[p.resultado] = (porResultado[p.resultado] ?? 0) + 1
const primerFreno = pedidos.find((p) => p.resultado === 'bloqueo' || p.resultado === 'login')
const okAntes = primerFreno ? pedidos.filter((p) => p.t < primerFreno.t && p.resultado === 'ok').length : null
const ms = pedidos.filter((p) => p.resultado === 'ok').map((p) => p.ms).sort((a, b) => a - b)

const informe = {
  pedidos: pedidos.length,
  desde: pedidos[0]?.t,
  hasta: pedidos.at(-1)?.t,
  porResultado,
  primerFreno: primerFreno ? { t: primerFreno.t, resultado: primerFreno.resultado, status: primerFreno.status, okAntes } : null,
  msTipico: ms.length ? ms[Math.floor(ms.length / 2)] : null,
  cuentas: {},
}
for (const c of fs.readdirSync(DATOS)) {
  const ultimo = path.join(DATOS, c, 'ultimo.json')
  if (!fs.existsSync(ultimo)) continue
  const perfil = JSON.parse(fs.readFileSync(ultimo, 'utf8'))
  if (!perfil.privada) informe.cuentas[c] = resumir(perfil)
}

fs.writeFileSync(path.join(DATOS, '..', 'informe-resumen.json'), JSON.stringify(informe, null, 2) + '\n')
console.log(JSON.stringify(informe, null, 2))
console.log('\nGuardado en informe-resumen.json')
