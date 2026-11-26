// La lista de chats como la mostraría la app (sin duplicados número/@lid, primero los que tienen actividad) y una forma
// de elegir sin editar JSON a mano.
//
//   npm run lista                       muestra la lista numerada y un resumen
//   npm run lista -- --todos            incluye contactos sin actividad
//   npm run elegir -- 3 12=Mamá         elige los chats 3 y 12 (a 12 le pone «Mamá»); reiniciá el spike después
import fs from 'node:fs'
import path from 'node:path'

const DATOS = path.resolve(process.env.SPIKE_DATOS ?? './datos')
const leer = (f, def) => { try { return JSON.parse(fs.readFileSync(path.join(DATOS, f), 'utf8')) } catch { return def } }

/** Junta las entradas `@lid` con la de su número cuando se conoce la relación. */
export function unificar(chats) {
  const porJid = new Map(chats.map((c) => [c.jid, { ...c }]))
  const lidANumero = new Map()
  for (const c of porJid.values()) if (c.jid.endsWith('@s.whatsapp.net') && c.lid) lidANumero.set(c.lid, c.jid)
  for (const [jid, c] of [...porJid]) {
    const num = lidANumero.get(jid)
    if (!num) continue
    const n = porJid.get(num)
    n.nombre ??= c.nombre
    n.ultimo = Math.max(n.ultimo ?? 0, c.ultimo ?? 0) || undefined
    porJid.delete(jid)
  }
  return [...porJid.values()].sort((a, b) => (b.ultimo ?? 0) - (a.ultimo ?? 0) || (a.nombre ?? '~').localeCompare(b.nombre ?? '~'))
}

const hace = (ts) => {
  if (!ts) return ''
  const s = Date.now() / 1000 - ts
  return s < 3600 ? `hace ${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} días`
}
const numero = (jid) => (jid.endsWith('@s.whatsapp.net') ? '+' + jid.split('@')[0] : jid.endsWith('@lid') ? '(número desconocido)' : '')

const todos = unificar(Object.values(leer('chats.json', {})))
if (todos.length === 0) { console.log('Todavía no hay lista: corré `npm start`, vinculá y esperá unos minutos.'); process.exit(0) }
const conActividad = todos.filter((c) => c.ultimo || c.grupo)
const mostrar = process.argv.includes('--todos') ? todos : conActividad
const config = leer('config.json', { chats: [] })
const elegidos = new Set((config.chats ?? []).map((c) => String(c.id)))

const elegir = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (elegir.length > 0) {
  for (const a of elegir) {
    const [i, ...resto] = a.split('=')
    const c = mostrar[Number(i) - 1]
    if (!c) { console.log(`No hay chat ${i} en la lista.`); continue }
    if (c.jid.endsWith('@lid')) { console.log(`${i}: no se sabe su número; elegilo cuando te escriba o agregalo por número en config.json.`); continue }
    const nombre = resto.join('=') || c.nombre
    if (!nombre) { console.log(`${i} (${numero(c.jid)}) no tiene nombre: elegilo como ${i}=Nombre`); continue }
    if (elegidos.has(c.jid)) { console.log(`${nombre} ya estaba elegido.`); continue }
    config.chats = [...(config.chats ?? []), { id: c.jid, nombre }]
    elegidos.add(c.jid)
    console.log(`Elegido: ${nombre}${c.grupo ? ' (grupo)' : ''}`)
  }
  fs.writeFileSync(path.join(DATOS, 'config.json'), JSON.stringify(config, null, 2) + '\n')
  console.log('Reiniciá el spike (Ctrl+C y `npm start`) para que tome los cambios.')
  process.exit(0)
}

mostrar.forEach((c, i) => {
  const marca = elegidos.has(c.jid) ? '✓' : ' '
  const quien = c.nombre ?? '(sin nombre)'
  const detalle = c.grupo ? `grupo${c.participantes ? ` · ${c.participantes} participantes` : ''}` : numero(c.jid)
  console.log(`${marca} ${String(i + 1).padStart(3)}  ${quien.padEnd(28).slice(0, 28)} ${detalle.padEnd(24)} ${hace(c.ultimo)}`)
})
const personas = todos.filter((c) => !c.grupo)
const act = todos.filter((c) => !c.grupo && c.ultimo)
console.log(`\nResumen: ${act.length} chats con actividad (${act.filter((c) => c.nombre).length} con nombre), ` +
  `${todos.filter((c) => c.grupo).length} grupos, ${personas.length - act.length} contactos sin actividad, ` +
  `${personas.filter((c) => c.jid.endsWith('@lid')).length} sin número conocido.`)
if (!process.argv.includes('--todos')) console.log('Para elegir: npm run elegir -- <número de la lista>[=Nombre] …')
