// Captura de WhatsApp (docs/plan-secretaria.md, «Fuente WhatsApp»): proceso hijo que lanza y supervisa `whatsapp.ts`.
// Mantiene la sesión de dispositivo vinculado con Baileys, filtra por los chats elegidos y le pasa al backend, por IPC,
// solo los mensajes de esos chats y los metadatos de los demás para la lista (nunca su texto). En un grupo con filtro de
// personas, los mensajes de quienes quedaron afuera tampoco salen de este proceso (`FiltroElegidos`). Con «leer todos los
// chats individuales» prendido, también salen los de cualquier chat individual desde que la otra persona escribe.
//
// SOLO LECTURA: este archivo nunca llama a sendMessage, readMessages, sendPresenceUpdate ni chatModify. No manda
// mensajes, no marca leído y no aparece «en línea». Si algún día hace falta mandar algo, no va acá.
//
// Entorno: HQ_WA_DIR (carpeta de la sesión), HQ_WA_CLAVE (opcional: 64 hex, cifra la sesión en disco con AES-256-GCM).
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import makeWASocket, {
  Browsers, BufferJSON, DisconnectReason, downloadMediaMessage, initAuthCreds, makeCacheableSignalKeyStore, proto,
  type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap, type WASocket,
} from 'baileys'
import {
  FiltroElegidos, cifrarBytes, mapearMiembros, cifrarSesion, descifrarSesion, esGrupo, maxBytesMedia, mediaQueSeBaja, nombreMedia, mapearMensaje, metaChat, normalizarJid, seIgnora, segundos,
  type ACaptura, type DeCaptura, type MensajeWA, type MetaChatWA,
} from './whatsapp-mapeo.js'

const DIR = process.env.HQ_WA_DIR ?? ''
const CLAVE = /^[0-9a-f]{64}$/i.test(process.env.HQ_WA_CLAVE ?? '') ? Buffer.from(process.env.HQ_WA_CLAVE!, 'hex') : undefined
if (!DIR || !process.send) {
  console.error('whatsapp-captura: se lanza desde el backend (HQ_WA_DIR y canal IPC)')
  process.exit(1)
}
const AUTH = path.join(DIR, 'auth')
fs.mkdirSync(AUTH, { recursive: true, mode: 0o700 })
const MEDIA = path.join(DIR, 'media')

const enviar = (m: DeCaptura) => { try { process.send?.(m) } catch {} }

// MARK: - log (a un archivo propio; nunca contenido de mensajes)

const LOG = path.join(DIR, 'captura.log')
function escribirLog(nivel: string, a: unknown, b?: unknown) {
  const texto = typeof a === 'string' ? a : typeof b === 'string' ? b : ''
  const err = a && typeof a === 'object' && 'err' in a ? String((a as { err: unknown }).err) : ''
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${nivel} ${texto} ${err}`.trim() + '\n', { mode: 0o600 }) } catch {}
}
type Logger = { level: string; child: () => Logger; trace: () => void; debug: () => void; info: () => void; warn: (a: unknown, b?: unknown) => void; error: (a: unknown, b?: unknown) => void }
const logger: Logger = {
  level: 'warn',
  child: () => logger,
  trace: () => {}, debug: () => {}, info: () => {},
  warn: (a, b) => escribirLog('warn', a, b),
  error: (a, b) => escribirLog('error', a, b),
}

// MARK: - sesión en disco, cifrada si hay clave

const cifrar = (texto: string) => cifrarSesion(texto, CLAVE)
const descifrar = (contenido: string) => descifrarSesion(contenido, CLAVE)
const archivo = (n: string) => path.join(AUTH, n.replace(/\//g, '__').replace(/:/g, '-'))
function leer(n: string): any {
  try { return JSON.parse(descifrar(fs.readFileSync(archivo(n), 'utf8')), BufferJSON.reviver) } catch { return null }
}
function escribir(n: string, v: unknown) {
  const f = archivo(n)
  const tmp = f + '.tmp'
  fs.writeFileSync(tmp, cifrar(JSON.stringify(v, BufferJSON.replacer)), { mode: 0o600 })
  fs.renameSync(tmp, f)
}
function borrar(n: string) { try { fs.unlinkSync(archivo(n)) } catch {} }

function estadoAuth(): { state: AuthenticationState; guardar: () => void } {
  const creds: AuthenticationCreds = leer('creds.json') ?? initAuthCreds()
  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(tipo: T, ids: string[]) => {
          const out: { [id: string]: SignalDataTypeMap[T] } = {}
          for (const id of ids) {
            let v = leer(`${tipo}-${id}.json`)
            if (tipo === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v)
            out[id] = v
          }
          return out
        },
        set: async (datos: any) => {
          for (const cat of Object.keys(datos)) {
            for (const id of Object.keys(datos[cat])) {
              const v = datos[cat][id]
              if (v) escribir(`${cat}-${id}.json`, v)
              else borrar(`${cat}-${id}.json`)
            }
          }
        },
      },
    },
    guardar: () => escribir('creds.json', creds),
  }
}

// MARK: - lista de chats (por tandas, sin texto)

let elegidos = new FiltroElegidos()
const pendientes = new Map<string, MetaChatWA>()
let tandaChats: NodeJS.Timeout | undefined
function anotarChat(jid: unknown, datos: Omit<MetaChatWA, 'jid' | 'grupo'> = {}) {
  const m = metaChat(jid, datos)
  if (!m) return
  const previo = pendientes.get(m.jid)
  pendientes.set(m.jid, previo ? { ...previo, ...m, ultimo: Math.max(previo.ultimo ?? 0, m.ultimo ?? 0) || undefined } : m)
  if (!tandaChats) {
    tandaChats = setTimeout(() => {
      tandaChats = undefined
      const chats = [...pendientes.values()]
      pendientes.clear()
      for (let i = 0; i < chats.length; i += 500) enviar({ tipo: 'chats', chats: chats.slice(i, i + 500) })
    }, 1500)
  }
}

// MARK: - actividad del teléfono (por tandas; solo el momento, nunca el contenido)

let telefonoMax = 0
let telefonoEnviado = 0
let tandaTelefono: NodeJS.Timeout | undefined
/** Hubo actividad propia a esta hora (un mensaje propio en cualquier chat): indicio de que el teléfono está conectado. */
function telefonoVisto(ts: number | undefined) {
  const ahora = Math.floor(Date.now() / 1000)
  if (!ts || ts > ahora + 60) return
  telefonoMax = Math.max(telefonoMax, ts)
  if (tandaTelefono || telefonoMax <= telefonoEnviado) return
  tandaTelefono = setTimeout(() => {
    tandaTelefono = undefined
    if (telefonoMax <= telefonoEnviado) return
    telefonoEnviado = telefonoMax
    enviar({ tipo: 'telefono', ts: telefonoEnviado })
  }, 30_000)
}

// MARK: - integrantes de los grupos (sin texto)

function miembros(grupo: unknown, participantes: unknown, modo?: 'sumar' | 'quitar') {
  const g = normalizarJid(grupo)
  if (!g || !esGrupo(g)) return
  const lista = mapearMiembros(participantes)
  for (const m of lista) if (m.pn && m.lid) alias(m.pn, m.lid)
  if (lista.length === 0 && modo) return
  enviar({ tipo: 'miembros', grupo: g, miembros: lista, ...(modo ? { modo } : {}) })
}

const mapeosEnviados = new Set<string>()
function alias(pn: unknown, lid: unknown) {
  const p = normalizarJid(pn), l = normalizarJid(lid)
  if (!p || !l || !p.endsWith('@s.whatsapp.net') || !l.endsWith('@lid')) return
  const chat = elegidos.resolver(p, l)
  if (chat) { elegidos.sumarAlias(chat, p); elegidos.sumarAlias(chat, l) }
  elegidos.sumarPersona(p, l)
  const k = p + '|' + l
  if (mapeosEnviados.has(k)) return
  mapeosEnviados.add(k)
  enviar({ tipo: 'alias', pn: p, lid: l })
}

function contacto(c: { id?: string; lid?: string; phoneNumber?: string; name?: string; notify?: string }) {
  const ids = [c.id, c.phoneNumber, c.lid].map(normalizarJid).filter((x): x is string => !!x)
  const pn = ids.find((x) => x.endsWith('@s.whatsapp.net'))
  const lid = ids.find((x) => x.endsWith('@lid'))
  if (pn && lid) alias(pn, lid)
  const destino = pn ?? ids[0]
  if (destino && (c.name || c.notify)) anotarChat(destino, { agenda: c.name || undefined, pista: c.notify || undefined })
}

// MARK: - conexión

const esperas = [5, 30, 120, 600]
let fallas = 0
let sock: WASocket | undefined
let saliendo = false
let cerrandoSesion = false

async function conectar() {
  const { state, guardar } = estadoAuth()
  sock = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger as any) },
    logger: logger as any,
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined,
  })
  const s = sock
  s.ev.on('creds.update', guardar)

  s.ev.on('connection.update', async (u) => {
    if (u.qr) enviar({ tipo: 'qr', qr: u.qr })
    if (u.connection === 'connecting') enviar({ tipo: 'estado', estado: 'conectando' })
    if (u.connection === 'open') {
      fallas = 0
      enviar({ tipo: 'estado', estado: 'conectado', numero: normalizarJid(s.user?.id) })
      void alAbrir(s)
    }
    if (u.connection === 'close') {
      if (s !== sock) return
      const codigo = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
      const motivo = Object.entries(DisconnectReason).find(([, v]) => v === codigo)?.[0] ?? String(codigo)
      if (codigo === DisconnectReason.loggedOut) {
        enviar({ tipo: 'estado', estado: cerrandoSesion ? 'conectando' : 'revocado', motivo })
        fs.rmSync(AUTH, { recursive: true, force: true })
        enviar({ tipo: 'cerrada' })
        setTimeout(() => process.exit(2), 100)
        return
      }
      if (saliendo) return
      // restartRequired llega justo después de escanear el QR: se reconecta enseguida
      const inmediata = codigo === DisconnectReason.restartRequired
      const espera = inmediata ? 0 : esperas[Math.min(fallas, esperas.length - 1)]!
      if (!inmediata) fallas++
      enviar({ tipo: 'estado', estado: 'conectando', motivo })
      setTimeout(() => { conectar().catch((e) => enviar({ tipo: 'error', texto: String(e) })) }, espera * 1000)
    }
  })

  // Al vincular llega un pedazo de historial aunque syncFullHistory sea false. Se lee «desde que se elige»: de acá
  // solo salen los metadatos para la lista (nombres, últimos mensajes, ids). El texto se descarta sin guardarse.
  s.ev.on('messaging-history.set', ({ chats, contacts, lidPnMappings, progress, isLatest }) => {
    for (const c of contacts ?? []) contacto(c)
    for (const c of chats ?? []) anotarChat(c.id, { agenda: c.name ?? undefined, ultimo: segundos(c.conversationTimestamp) })
    for (const p of lidPnMappings ?? []) alias(p.pn, p.lid)
    enviar({ tipo: 'sincronizando', progreso: typeof progress === 'number' ? progress : null, listo: progress === 100 || !!isLatest && progress == null })
  })
  s.ev.on('contacts.upsert', (cs) => cs.forEach(contacto))
  s.ev.on('contacts.update', (cs) => cs.forEach((c) => contacto(c as any)))
  s.ev.on('chats.upsert', (cs) => cs.forEach((c) => anotarChat(c.id, { agenda: c.name ?? undefined, ultimo: segundos(c.conversationTimestamp) })))
  s.ev.on('groups.upsert', (gs) => gs.forEach((g) => {
    anotarChat(g.id, { agenda: g.subject, participantes: g.participants?.length })
    miembros(g.id, g.participants)
  }))
  s.ev.on('group-participants.update', (u) => {
    if (u.action === 'add') miembros(u.id, u.participants, 'sumar')
    else if (u.action === 'remove') miembros(u.id, u.participants, 'quitar')
  })
  s.ev.on('groups.update', (gs) => gs.forEach((g) => g.id && g.subject && anotarChat(g.id, { agenda: g.subject })))
  s.ev.on('lid-mapping.update', (p) => alias(p.pn, p.lid))

  s.ev.on('messages.upsert', ({ messages }) => {
    for (const wa of messages) {
      const k = wa.key ?? {}
      if (seIgnora(k.remoteJid)) continue
      const ts = segundos(wa.messageTimestamp)
      // un mensaje propio, de cualquier chat, muestra que el teléfono estuvo conectado (solo se manda la hora)
      if (k.fromMe) telefonoVisto(ts)
      // el número y el @lid de quien escribe (para no repetir a nadie en la lista)
      if (!esGrupo(k.remoteJid)) alias(k.remoteJidAlt ?? k.remoteJid, k.remoteJid)
      else if (k.participant && k.participantAlt) alias(k.participantAlt, k.participant)
      const m = mapearMensaje(wa, elegidos)
      if (!m) {
        const jid = !esGrupo(k.remoteJid) && k.remoteJidAlt?.endsWith('@s.whatsapp.net') ? k.remoteJidAlt : k.remoteJid
        anotarChat(jid, { ultimo: ts, ...(!k.fromMe && !esGrupo(k.remoteJid) && wa.pushName ? { pista: wa.pushName } : {}) })
        continue
      }
      for (const otro of [k.remoteJid, k.remoteJidAlt]) if (elegidos.sumarAlias(m.chat, otro) && otro) {
        const o = normalizarJid(otro)!
        if (o.endsWith('@lid')) alias(m.chat, o)
      }
      anotarChat(m.chat, { ultimo: ts })
      if (mediaQueSeBaja(m.tipo)) void bajarMedia(s, wa, m).finally(() => enviar({ tipo: 'mensaje', m }))
      else enviar({ tipo: 'mensaje', m })
    }
  })
}

/** Baja el audio o la imagen de un mensaje de un chat elegido y lo guarda cifrado. Si no se puede, el mensaje va igual
 *  (sin `media`). */
async function bajarMedia(s: WASocket, wa: Parameters<typeof downloadMediaMessage>[0], m: MensajeWA) {
  try {
    const cont = wa.message?.audioMessage ?? wa.message?.imageMessage
      ?? wa.message?.ephemeralMessage?.message?.audioMessage ?? wa.message?.ephemeralMessage?.message?.imageMessage
      ?? wa.message?.viewOnceMessageV2?.message?.imageMessage ?? wa.message?.viewOnceMessage?.message?.imageMessage
    const tope = m.tipo === 'imagen' ? maxBytesMedia.imagen : maxBytesMedia.audio
    const largo = Number(cont?.fileLength ?? 0)
    if (largo > tope) return
    const datos = await downloadMediaMessage(wa, 'buffer', {}, { logger: logger as any, reuploadRequest: s.updateMediaMessage })
    if (datos.length > tope) return
    fs.mkdirSync(MEDIA, { recursive: true, mode: 0o700 })
    const archivo = nombreMedia(m.chat, m.id)
    fs.writeFileSync(path.join(MEDIA, archivo), cifrarBytes(datos, CLAVE), { mode: 0o600 })
    m.media = { archivo, mime: String(cont?.mimetype ?? (m.tipo === 'imagen' ? 'image/jpeg' : 'audio/ogg')).split(';')[0]!.trim(), bytes: datos.length }
  } catch (e) {
    logger.warn(String(e), 'media')
  }
}

async function alAbrir(s: WASocket) {
  try {
    const grupos = await s.groupFetchAllParticipating()
    for (const g of Object.values(grupos)) {
      anotarChat(g.id, { agenda: g.subject, participantes: g.participants?.length })
      miembros(g.id, g.participants)
    }
  } catch (e) { logger.warn(String(e), 'grupos') }
  await resolverLids(s)
}

/** Para los números elegidos, averigua su @lid ahora: así se reconoce el primer mensaje que llegue con ese id. */
async function resolverLids(s: WASocket) {
  for (const id of elegidosNumeros) {
    try {
      const lid = await s.signalRepository.lidMapping.getLIDForPN(id)
      if (lid) alias(id, lid)
    } catch (e) { logger.warn(String(e), 'lid') }
  }
}
let elegidosNumeros: string[] = []

process.on('message', (msg: ACaptura) => {
  if (msg?.tipo === 'elegidos') {
    elegidos = new FiltroElegidos(msg.chats, msg.todos)
    elegidosNumeros = msg.chats.map((c) => c.jid).filter((j) => j.endsWith('@s.whatsapp.net'))
    if (sock?.user) void resolverLids(sock)
  } else if (msg?.tipo === 'cerrar_sesion') {
    cerrandoSesion = true
    const s = sock
    if (!s?.user) { fs.rmSync(AUTH, { recursive: true, force: true }); enviar({ tipo: 'cerrada' }); setTimeout(() => process.exit(0), 100); return }
    s.logout().catch(() => {}).finally(() => {
      fs.rmSync(AUTH, { recursive: true, force: true })
      enviar({ tipo: 'cerrada' })
      setTimeout(() => process.exit(0), 100)
    })
  } else if (msg?.tipo === 'salir') {
    saliendo = true
    try { sock?.end(undefined) } catch {}
    setTimeout(() => process.exit(0), 200)
  }
})
process.on('disconnect', () => { saliendo = true; try { sock?.end(undefined) } catch {} ; process.exit(0) })
process.on('uncaughtException', (e) => { escribirLog('error', String(e?.stack ?? e)); enviar({ tipo: 'error', texto: String(e) }) })
process.on('unhandledRejection', (e) => { escribirLog('error', String(e)) })

conectar().catch((e) => { enviar({ tipo: 'error', texto: String(e) }); process.exit(1) })
