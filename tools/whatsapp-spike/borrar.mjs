// Cierre del spike: guarda un resumen SIN datos personales (solo cantidades y consumo) en `informe-resumen.json`,
// desvincula el dispositivo de WhatsApp (como «Cerrar sesión» en Dispositivos vinculados) y borra `datos/` entero:
// sesión, mensajes, lista de chats, selección y logs.
//
//   npm run borrar               pide confirmación
//   npm run borrar -- --si       sin preguntar
//   npm run borrar -- --resumen  solo escribe el resumen, sin desvincular ni borrar
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'

const DATOS = path.resolve(process.env.SPIKE_DATOS ?? './datos')
const SALIDA = path.resolve('informe-resumen.json')
const lineas = (f) => { try { return fs.readFileSync(path.join(DATOS, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const contar = (xs, f) => xs.reduce((a, x) => { const k = String(f(x)); a[k] = (a[k] ?? 0) + 1; return a }, {})
const mediana = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

function resumen() {
  const consumo = lineas('consumo.jsonl')
  const eventos = lineas('eventos.jsonl')
  const mensajes = lineas('mensajes.jsonl')
  const medidas = consumo.slice(1) // la primera es el arranque
  const t = eventos.map((e) => Date.parse(e.t)).filter(Number.isFinite)
  const historial = eventos.filter((e) => e.tipo === 'historial')
  return {
    generado: new Date().toISOString(),
    horasCorriendo: t.length ? +((Math.max(...t) - Math.min(...t)) / 36e5).toFixed(1) : 0,
    consumo: {
      muestras: medidas.length,
      ramMB: { tipica: mediana(medidas.map((m) => m.rssMB)), maxima: medidas.length ? Math.max(...medidas.map((m) => m.rssMB)) : null },
      cpuPct: { tipica: mediana(medidas.map((m) => m.cpuPct)), maxima: medidas.length ? Math.max(...medidas.map((m) => m.cpuPct)) : null },
    },
    eventos: contar(eventos, (e) => e.tipo),
    desconexiones: contar(eventos.filter((e) => e.tipo === 'desconectado'), (e) => e.motivo),
    historialInicial: {
      mensajesRecibidosYDescartados: historial.reduce((a, h) => a + (h.mensajes ?? 0), 0),
      chats: historial.reduce((a, h) => a + (h.chats ?? 0), 0),
      contactosConNombre: historial.reduce((a, h) => a + (h.contactosConNombre ?? 0), 0),
    },
    alias: contar(eventos.filter((e) => e.tipo === 'alias'), (e) => e.por),
    mensajes: {
      total: mensajes.length,
      porTipo: contar(mensajes, (m) => m.tipo),
      porVia: contar(mensajes, (m) => m.via),
      porUpsert: contar(mensajes, (m) => m.upsert),
      propios: mensajes.filter((m) => m.propio).length,
      ediciones: mensajes.filter((m) => m.editado).length,
      borrados: mensajes.filter((m) => m.borrado).length,
      enGrupos: mensajes.filter((m) => String(m.chat).endsWith('@g.us')).length,
      gruposConRemitenteNumero: mensajes.filter((m) => String(m.chat).endsWith('@g.us') && !m.propio && String(m.de).endsWith('@s.whatsapp.net')).length,
    },
  }
}

async function desvincular() {
  if (!fs.existsSync(path.join(DATOS, 'auth', 'creds.json'))) return 'no había sesión'
  const { default: makeWASocket, makeCacheableSignalKeyStore, useMultiFileAuthState } = await import('baileys')
  const { default: pino } = await import('pino')
  const logger = pino({ level: 'silent' })
  const { state } = await useMultiFileAuthState(path.join(DATOS, 'auth'))
  const sock = makeWASocket({ auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) }, logger, markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false })
  return await new Promise((resolve) => {
    const corte = setTimeout(() => { try { sock.end(undefined) } catch {} resolve('no se pudo conectar: cerrá la sesión a mano desde el teléfono') }, 30_000)
    sock.ev.on('connection.update', async (u) => {
      if (u.connection === 'open') {
        try { await sock.logout() ; clearTimeout(corte); resolve('desvinculado') } catch (e) { clearTimeout(corte); resolve('falló el cierre de sesión (' + e + '): cerralo a mano desde el teléfono') }
      } else if (u.connection === 'close' && u.lastDisconnect?.error?.output?.statusCode === 401) {
        clearTimeout(corte); resolve('la sesión ya estaba cerrada')
      }
    })
  })
}

const r = resumen()
fs.writeFileSync(SALIDA, JSON.stringify(r, null, 2) + '\n')
console.log(`Resumen sin datos personales en ${SALIDA}`)
if (process.argv.includes('--resumen')) process.exit(0)
if (!fs.existsSync(DATOS)) { console.log('No hay datos/ para borrar.'); process.exit(0) }

if (!process.argv.includes('--si')) {
  console.log('Antes, cortá el spike si está corriendo (Ctrl+C): si no, vuelve a escribir en datos/.')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ok = (await rl.question(`Esto desvincula WhatsApp y borra ${DATOS} (sesión, mensajes, chats y selección). ¿Seguir? (s/N) `)).trim().toLowerCase()
  rl.close()
  if (ok !== 's' && ok !== 'si' && ok !== 'sí') { console.log('No se borró nada.'); process.exit(0) }
}
console.log('WhatsApp:', await desvincular())
fs.rmSync(DATOS, { recursive: true, force: true })
console.log(`Borrado ${DATOS}. Fijate en el teléfono, en Dispositivos vinculados, que ya no aparezca.`)
process.exit(0)
