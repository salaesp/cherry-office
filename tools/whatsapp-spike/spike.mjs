// Spike S0 de la secretaría (docs/plan-secretaria.md): vincula WhatsApp por QR con Baileys, SOLO LECTURA, guarda los
// mensajes de los chats elegidos y mide. No es parte de la app.
//
// Este archivo nunca llama a sendMessage, readMessages, sendPresenceUpdate ni chatModify: no manda mensajes, no marca
// leído y no aparece «en línea». Si alguna vez hace falta, no va acá.
//
// Uso: node --max-old-space-size=256 spike.mjs [--datos ./datos]
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import makeWASocket, {
  Browsers, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, useMultiFileAuthState,
} from 'baileys'
import pino from 'pino'
import QRCode from 'qrcode'
import qrTerminal from 'qrcode-terminal'
import { Elegidos, esGrupo, mapear, metaChat, normalizar, seIgnora } from './mapeo.mjs'

// MARK: - datos

const arg = (n, def) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : def }
const DATOS = path.resolve(arg('--datos', './datos'))
fs.mkdirSync(DATOS, { recursive: true, mode: 0o700 })
const ruta = (f) => path.join(DATOS, f)

const CONFIG = ruta('config.json')
if (!fs.existsSync(CONFIG)) {
  fs.writeFileSync(CONFIG, JSON.stringify({
    _ayuda: 'chats: lo que se lee. id = número con código de país (+54 9 11 ...) o JID de grupo (...@g.us, sale de chats.json). Al cambiarlo, reiniciá el spike.',
    chats: [],
  }, null, 2) + '\n')
}
const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
const elegidos = new Elegidos(config.chats ?? [])

const ahora = () => new Date().toISOString()
const anexar = (f, o) => fs.appendFileSync(ruta(f), JSON.stringify({ t: ahora(), ...o }) + '\n', { mode: 0o600 })
const evento = (tipo, datos = {}) => { anexar('eventos.jsonl', { tipo, ...datos }); console.log(`[${tipo}]`, Object.keys(datos).length ? JSON.stringify(datos) : '') }

// Lista de chats para elegir: solo metadatos, nunca texto.
const lista = new Map(Object.entries(leerJSON(ruta('chats.json'), {})))
function leerJSON(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return def } }
let guardarLista
function anotarChat(jid, datos) {
  const m = metaChat(jid, datos)
  if (!m) return
  const previo = lista.get(m.jid) ?? {}
  lista.set(m.jid, { ...previo, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)), ...(elegidos.resolver(m.jid) ? { elegido: elegidos.resolver(m.jid) } : {}) })
  clearTimeout(guardarLista)
  guardarLista = setTimeout(() => fs.writeFileSync(ruta('chats.json'), JSON.stringify(Object.fromEntries(lista), null, 2), { mode: 0o600 }), 2000)
}

// MARK: - consumo

let cpuPrevio = process.cpuUsage()
let tPrevio = process.hrtime.bigint()
const contadores = { mensajesGuardados: 0, mensajesIgnorados: 0, reconexiones: 0 }
function medir() {
  const cpu = process.cpuUsage(cpuPrevio)
  const t = process.hrtime.bigint()
  const ms = Number(t - tPrevio) / 1e6
  cpuPrevio = process.cpuUsage(); tPrevio = t
  const mem = process.memoryUsage()
  anexar('consumo.jsonl', {
    rssMB: +(mem.rss / 2 ** 20).toFixed(1), heapMB: +(mem.heapUsed / 2 ** 20).toFixed(1),
    cpuPct: +(((cpu.user + cpu.system) / 1000 / ms) * 100).toFixed(2), ...contadores,
  })
}
setInterval(medir, 60_000).unref()

// MARK: - conexión

const logger = pino({ level: process.env.SPIKE_LOG ?? 'warn' }, pino.destination({ dest: ruta('baileys.log'), mkdir: true, sync: false }))
const esperas = [5, 30, 120, 600]
let fallasSeguidas = 0
let sock

async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState(ruta('auth'))
  let version
  try { ({ version } = await fetchLatestBaileysVersion()) } catch {}
  sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (u) => {
    if (u.qr) {
      qrTerminal.generate(u.qr, { small: true })
      await QRCode.toFile(ruta('qr.png'), u.qr, { margin: 2, width: 360 }).catch(() => {})
      evento('qr', { archivo: ruta('qr.png'), ayuda: 'WhatsApp › Dispositivos vinculados › Vincular un dispositivo' })
    }
    if (u.connection === 'open') {
      fallasSeguidas = 0
      evento('conectado', { numero: normalizar(sock.user?.id), lid: normalizar(sock.user?.lid), elegidos: elegidos.porId.size })
      try { fs.rmSync(ruta('qr.png'), { force: true }) } catch {}
      await alAbrir()
    }
    if (u.connection === 'close') {
      const codigo = u.lastDisconnect?.error?.output?.statusCode
      const motivo = Object.entries(DisconnectReason).find(([, v]) => v === codigo)?.[0] ?? String(codigo)
      if (codigo === DisconnectReason.loggedOut) {
        evento('revocado', { motivo, ayuda: 'La sesión ya no vale: borrá datos/auth y volvé a escanear el QR.' })
        medir()
        process.exit(2)
      }
      const espera = esperas[Math.min(fallasSeguidas, esperas.length - 1)]
      // restartRequired llega justo después de escanear el QR: se reconecta enseguida y no cuenta como falla
      const inmediata = codigo === DisconnectReason.restartRequired
      if (!inmediata) fallasSeguidas++
      contadores.reconexiones++
      evento('desconectado', { motivo, reintentoEnSeg: inmediata ? 0 : espera, fallasSeguidas })
      setTimeout(() => { conectar().catch((e) => evento('error', { donde: 'conectar', error: String(e) })) }, inmediata ? 0 : espera * 1000)
    }
  })

  // Al vincular llega un pedazo de historial aunque syncFullHistory sea false. El plan dice «desde que se elige»: de
  // acá solo se usan los metadatos para la lista y se cuenta qué llegó (para el informe), sin guardar texto.
  sock.ev.on('messaging-history.set', ({ chats, contacts, messages, lidPnMappings, syncType, progress, isLatest }) => {
    for (const c of contacts ?? []) nombreDeContacto(c)
    for (const c of chats ?? []) anotarChat(c.id, { nombre: c.name ?? undefined, ultimo: num(c.conversationTimestamp) })
    for (const p of lidPnMappings ?? []) aliasDeMapeo(p)
    const deElegidos = (messages ?? []).filter((m) => elegidos.resolver(m.key?.remoteJid, m.key?.remoteJidAlt)).length
    evento('historial', {
      syncType, progress, isLatest, chats: chats?.length ?? 0, contactos: contacts?.length ?? 0,
      contactosConNombre: (contacts ?? []).filter((c) => c.name).length, mensajes: messages?.length ?? 0,
      mensajesDeElegidosDescartados: deElegidos, mapeosLid: lidPnMappings?.length ?? 0,
    })
  })

  sock.ev.on('contacts.upsert', (cs) => cs.forEach(nombreDeContacto))
  sock.ev.on('contacts.update', (cs) => cs.forEach(nombreDeContacto))
  sock.ev.on('chats.upsert', (cs) => cs.forEach((c) => anotarChat(c.id, { nombre: c.name ?? undefined, ultimo: num(c.conversationTimestamp) })))
  sock.ev.on('groups.upsert', (gs) => gs.forEach((g) => anotarChat(g.id, { nombre: g.subject, participantes: g.participants?.length })))
  sock.ev.on('groups.update', (gs) => gs.forEach((g) => g.id && anotarChat(g.id, { nombre: g.subject })))
  sock.ev.on('lid-mapping.update', aliasDeMapeo)

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const wa of messages) {
      const k = wa.key ?? {}
      if (seIgnora(k.remoteJid)) continue
      const ts = num(wa.messageTimestamp)
      const m = mapear(wa, elegidos)
      if (!m) {
        contadores.mensajesIgnorados++
        anotarChat(k.remoteJidAlt && !esGrupo(k.remoteJid) ? k.remoteJidAlt : k.remoteJid, { ultimo: ts })
        continue
      }
      // el id alternativo de un elegido se aprende del propio mensaje
      for (const otro of [k.remoteJid, k.remoteJidAlt]) {
        if (otro && elegidos.sumarAlias(m.chat, otro)) evento('alias', { chat: m.chat, alias: normalizar(otro), por: 'mensaje' })
      }
      anotarChat(m.chat, { ultimo: ts })
      anexar('mensajes.jsonl', { upsert: type, ...m })
      contadores.mensajesGuardados++
      const quien = m.propio ? 'yo' : elegidos.porId.get(m.chat)?.nombre
      console.log(`  ${elegidos.porId.get(m.chat)?.nombre} · ${quien}: ${m.texto ?? '[' + m.tipo + ']'}${m.via === 'alternativo' ? '  (por id alternativo)' : ''}`)
    }
  })
}

const num = (t) => (t === null || t === undefined ? undefined : typeof t === 'object' && t.toNumber ? t.toNumber() : Number(t) || undefined)

function nombreDeContacto(c) {
  // `name` es el que la persona puso en su agenda; `notify` lo elige cada uno (solo se anota aparte, para comparar)
  const ids = [c.id, c.phoneNumber, c.lid].map(normalizar).filter(Boolean)
  const pn = ids.find((x) => x.endsWith('@s.whatsapp.net'))
  const lid = ids.find((x) => x.endsWith('@lid'))
  if (pn && lid) aliasDeMapeo({ pn, lid })
  const destino = pn ?? ids[0]
  if (destino) anotarChat(destino, { nombre: c.name ?? undefined, ...(lid && pn ? { lid } : {}) })
}

function aliasDeMapeo(p) {
  const pn = normalizar(p?.pn), lid = normalizar(p?.lid)
  if (!pn || !lid) return
  const chat = elegidos.resolver(pn, lid)
  if (chat && (elegidos.sumarAlias(chat, pn) | elegidos.sumarAlias(chat, lid))) evento('alias', { chat, pn, lid, por: 'mapeo' })
}

async function alAbrir() {
  try {
    const grupos = await sock.groupFetchAllParticipating()
    for (const g of Object.values(grupos)) anotarChat(g.id, { nombre: g.subject, participantes: g.participants?.length })
    evento('grupos', { cantidad: Object.keys(grupos).length })
  } catch (e) { evento('error', { donde: 'grupos', error: String(e) }) }
  // los números elegidos: averiguar su @lid ahora, para reconocer el primer mensaje que llegue con ese id
  for (const c of elegidos.porId.values()) {
    if (c.grupo || !c.id.endsWith('@s.whatsapp.net')) continue
    try {
      const lid = await sock.signalRepository.lidMapping.getLIDForPN(c.id)
      if (lid && elegidos.sumarAlias(c.id, lid)) evento('alias', { chat: c.id, lid: normalizar(lid), por: 'consulta' })
      if (!lid) evento('sin_lid', { chat: c.id, ayuda: 'Todavía no se conoce su @lid; se aprende con el primer mensaje.' })
    } catch (e) { evento('error', { donde: 'lid', chat: c.id, error: String(e) }) }
  }
  evento('elegidos', { chats: [...elegidos.porId.values()].map((c) => ({ id: c.id, nombre: c.nombre, alias: elegidos.aliasDe(c.id) })) })
}

for (const s of ['SIGINT', 'SIGTERM']) {
  process.on(s, () => {
    medir()
    evento('fin', contadores)
    try { sock?.end(undefined) } catch {}
    setTimeout(() => process.exit(0), 300)
  })
}

evento('inicio', { datos: DATOS, elegidos: elegidos.porId.size, node: process.version })
medir()
conectar().catch((e) => { evento('error', { donde: 'conectar', error: String(e) }); process.exit(1) })
