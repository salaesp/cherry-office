// WhatsApp, lógica pura (docs/plan-secretaria.md, «Fuente WhatsApp»): ids, filtros y mapeo de los mensajes de Baileys
// al formato de la oficina. Sin red ni Baileys: lo usan la captura (proceso hijo) y el módulo `whatsapp.ts`.
// Viene del spike (`tools/whatsapp-spike/mapeo.mjs`), probado con un WhatsApp real.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/** Un mensaje guardado de un chat elegido. `de` = JID de quien lo mandó (en un chat individual, el del chat). */
export type MensajeWA = {
  id: string
  chat: string
  de: string
  propio: boolean
  ts: number
  tipo: string
  texto?: string
  cita?: { id: string; texto?: string }
  segundos?: number
  /** Edición de otro mensaje: id del editado (el texto nuevo va en `texto`). */
  editado?: string
  /** Borrado para todos: id del borrado. */
  borrado?: string
}

/** Metadatos de un chat para la lista (nunca texto). */
export type MetaChatWA = {
  jid: string
  grupo: boolean
  /** Nombre en la agenda de la persona (el `name` de WhatsApp). */
  agenda?: string
  /** Nombre que eligió el otro para sí (`pushName`/`notify`): solo como pista en la lista. */
  pista?: string
  participantes?: number
  ultimo?: number
}

/** «+54 9 11 5555-1234» -> «5491155551234@s.whatsapp.net». undefined si no parece un número. */
export function jidDeNumero(numero: unknown): string | undefined {
  const d = String(numero ?? '').replace(/[^\d]/g, '')
  if (d.length < 8 || d.length > 15) return undefined
  return d + '@s.whatsapp.net'
}

/** Saca el sufijo de dispositivo («549…:12@s.whatsapp.net» -> «549…@s.whatsapp.net»). */
export function normalizarJid(jid: unknown): string | undefined {
  if (typeof jid !== 'string' || jid === '') return undefined
  const i = jid.indexOf('@')
  if (i <= 0 || i === jid.length - 1) return undefined
  const usuario = jid.slice(0, i).split(':')[0]
  return usuario + '@' + jid.slice(i + 1)
}

export const esGrupo = (jid: unknown): jid is string => typeof jid === 'string' && jid.endsWith('@g.us')
export const esLid = (jid: unknown): jid is string => typeof jid === 'string' && jid.endsWith('@lid')
export const esNumero = (jid: unknown): jid is string => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')

/** Estados, canales, listas de difusión y cualquier cosa que no sea persona o grupo: nunca se leen. */
export function seIgnora(jid: unknown): boolean {
  if (typeof jid !== 'string') return true
  if (jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return true
  return !(esGrupo(jid) || esNumero(jid) || esLid(jid))
}

/** «+5491155551234» para mostrar un JID de número; undefined si no es de número. */
export const numeroVisible = (jid: string) => (esNumero(jid) ? '+' + jid.slice(0, jid.indexOf('@')) : undefined)

/** Chats elegidos con los ids alternativos con los que pueden aparecer (sus `@lid`). */
export class FiltroElegidos {
  /** alias (número o lid) -> id canónico */
  private readonly alias = new Map<string, string>()

  constructor(lista: { jid: string; lids?: string[] }[] = []) {
    for (const c of lista) {
      const id = normalizarJid(c.jid)
      if (!id || seIgnora(id)) continue
      this.alias.set(id, id)
      for (const l of c.lids ?? []) { const n = normalizarJid(l); if (n) this.alias.set(n, id) }
    }
  }

  get vacio() { return this.alias.size === 0 }
  tiene(id: string) { return this.alias.get(id) === id }

  /** Suma un id alternativo a un elegido. true si es nuevo. */
  sumarAlias(canonico: string, otro: unknown): boolean {
    const o = normalizarJid(otro)
    if (!o || !this.tiene(canonico) || this.alias.get(o) === canonico) return false
    this.alias.set(o, canonico)
    return true
  }

  /** El id canónico del elegido que corresponde a alguno de estos jids. */
  resolver(...jids: unknown[]): string | undefined {
    for (const j of jids) {
      const n = normalizarJid(j)
      if (n && this.alias.has(n)) return this.alias.get(n)
    }
    return undefined
  }
}

type Cualquiera = Record<string, any>

/** Desenvuelve los contenedores (efímeros, ver una vez, documento con texto…) hasta el mensaje real. */
function desenvolver(m: Cualquiera | null | undefined): Cualquiera | null | undefined {
  let x = m
  for (let i = 0; i < 5 && x; i++) {
    const dentro = x.ephemeralMessage?.message ?? x.viewOnceMessage?.message ?? x.viewOnceMessageV2?.message
      ?? x.viewOnceMessageV2Extension?.message ?? x.documentWithCaptionMessage?.message ?? x.editedMessage?.message
    if (!dentro) break
    x = dentro
  }
  return x
}

export function segundos(t: unknown): number | undefined {
  if (t === null || t === undefined) return undefined
  if (typeof t === 'number') return Number.isFinite(t) ? t : undefined
  if (typeof t === 'object' && typeof (t as { toNumber?: unknown }).toNumber === 'function') return (t as { toNumber: () => number }).toNumber()
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

type Contenido = {
  tipo: string; texto?: string; cita?: { id: string; texto?: string }; segundos?: number; de?: string; reaccionA?: string
}

/** Texto, tipo y cita de un `message` de Baileys. */
export function contenido(message: unknown): Contenido {
  const m = desenvolver((message ?? {}) as Cualquiera)
  if (!m || typeof m !== 'object') return { tipo: 'vacio' }
  const cita = (x: Cualquiera | undefined) => {
    const c = x?.contextInfo
    if (!c?.stanzaId) return undefined
    const q = c.quotedMessage ? contenido(c.quotedMessage).texto : undefined
    return { id: String(c.stanzaId), ...(q ? { texto: q.slice(0, 200) } : {}) }
  }
  const sinVacio = (s: unknown) => (typeof s === 'string' && s !== '' ? s : undefined)
  if (typeof m.conversation === 'string') return { tipo: 'texto', texto: m.conversation }
  if (m.extendedTextMessage) return { tipo: 'texto', texto: m.extendedTextMessage.text ?? '', cita: cita(m.extendedTextMessage) }
  if (m.imageMessage) return { tipo: 'imagen', texto: sinVacio(m.imageMessage.caption), cita: cita(m.imageMessage) }
  if (m.videoMessage) return { tipo: 'video', texto: sinVacio(m.videoMessage.caption), cita: cita(m.videoMessage) }
  if (m.audioMessage) return { tipo: m.audioMessage.ptt ? 'nota_de_voz' : 'audio', segundos: segundos(m.audioMessage.seconds), cita: cita(m.audioMessage) }
  if (m.documentMessage) return { tipo: 'documento', texto: sinVacio(m.documentMessage.caption) ?? sinVacio(m.documentMessage.fileName) }
  if (m.stickerMessage) return { tipo: 'sticker' }
  if (m.locationMessage) return { tipo: 'ubicacion', texto: sinVacio([m.locationMessage.name, m.locationMessage.address].filter(Boolean).join(', ')) }
  if (m.contactMessage) return { tipo: 'contacto', texto: sinVacio(m.contactMessage.displayName) }
  if (m.pollCreationMessage || m.pollCreationMessageV3) {
    const p = m.pollCreationMessage ?? m.pollCreationMessageV3
    return { tipo: 'encuesta', texto: [p.name, ...((p.options ?? []) as Cualquiera[]).map((o) => '- ' + o.optionName)].join('\n') }
  }
  if (m.reactionMessage) return { tipo: 'reaccion', texto: sinVacio(m.reactionMessage.text), reaccionA: m.reactionMessage.key?.id }
  if (m.protocolMessage) {
    const p = m.protocolMessage
    // 0 = REVOKE (borrado para todos), 14 = MESSAGE_EDIT
    if (p.type === 0 || p.type === 'REVOKE') return { tipo: 'borrado', de: p.key?.id }
    if (p.type === 14 || p.type === 'MESSAGE_EDIT') return { tipo: 'edicion', de: p.key?.id, texto: contenido(p.editedMessage).texto }
    return { tipo: 'protocolo' }
  }
  return { tipo: 'otro' }
}

/**
 * Un WAMessage de Baileys -> el mensaje de la oficina, si es de un chat elegido. undefined si no corresponde guardarlo:
 * chat no elegido o ignorado, mensaje de protocolo o reacción.
 */
export function mapearMensaje(wa: unknown, elegidos: FiltroElegidos): MensajeWA | undefined {
  const w = wa as Cualquiera | undefined
  const k = w?.key as Cualquiera | undefined
  if (!k?.remoteJid || !k.id || seIgnora(k.remoteJid)) return undefined
  const chat = elegidos.resolver(k.remoteJid, k.remoteJidAlt)
  if (!chat) return undefined
  const c = contenido(w!.message)
  if (c.tipo === 'vacio' || c.tipo === 'protocolo' || c.tipo === 'reaccion') return undefined
  const grupo = esGrupo(chat)
  const de = k.fromMe ? 'yo' : grupo ? normalizarJid(k.participantAlt) ?? normalizarJid(k.participant) ?? '' : chat
  const out: MensajeWA = { id: String(k.id), chat, de, propio: !!k.fromMe, ts: segundos(w!.messageTimestamp) ?? Math.floor(Date.now() / 1000), tipo: c.tipo }
  if (c.texto !== undefined) out.texto = c.texto
  if (c.cita) out.cita = c.cita
  if (c.segundos !== undefined) out.segundos = c.segundos
  if (c.tipo === 'edicion') { out.editado = c.de; out.tipo = 'texto' }
  if (c.tipo === 'borrado') out.borrado = c.de
  return out
}

/** Metadatos de un chat para la lista. undefined si es algo que no se lee. */
export function metaChat(jid: unknown, datos: Omit<MetaChatWA, 'jid' | 'grupo'> = {}): MetaChatWA | undefined {
  const id = normalizarJid(jid)
  if (!id || seIgnora(id)) return undefined
  const m: MetaChatWA = { jid: id, grupo: esGrupo(id) }
  if (datos.agenda) m.agenda = datos.agenda
  if (datos.pista) m.pista = datos.pista
  if (datos.participantes !== undefined) m.participantes = datos.participantes
  if (datos.ultimo !== undefined) m.ultimo = datos.ultimo
  return m
}

/** Mensajes entre la captura (proceso hijo) y el backend, por IPC. */
export type DeCaptura =
  | { tipo: 'qr'; qr: string }
  | { tipo: 'estado'; estado: 'conectando' | 'conectado' | 'revocado'; numero?: string; motivo?: string }
  | { tipo: 'sincronizando'; progreso: number | null; listo: boolean }
  | { tipo: 'mensaje'; m: MensajeWA }
  | { tipo: 'chats'; chats: MetaChatWA[] }
  | { tipo: 'alias'; pn: string; lid: string }
  | { tipo: 'cerrada' }
  | { tipo: 'error'; texto: string }

export type ACaptura =
  | { tipo: 'elegidos'; chats: { jid: string; lids: string[] }[] }
  | { tipo: 'cerrar_sesion' }
  | { tipo: 'salir' }

// MARK: - sesión cifrada en disco

/** Con clave: «v1:» + base64(iv 12 | tag 16 | datos), AES-256-GCM. Sin clave, el texto tal cual. */
export function cifrarSesion(texto: string, clave: Buffer | undefined): string {
  if (!clave) return texto
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', clave, iv)
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()])
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), datos]).toString('base64')
}

/** Lanza si el archivo no corresponde a la clave (cifrado sin clave, en claro con clave, o adulterado). */
export function descifrarSesion(contenido: string, clave: Buffer | undefined): string {
  if (!contenido.startsWith('v1:')) {
    if (clave) throw new Error('sesión sin cifrar con clave configurada')
    return contenido
  }
  if (!clave) throw new Error('sesión cifrada sin clave')
  const b = Buffer.from(contenido.slice(3), 'base64')
  const d = createDecipheriv('aes-256-gcm', clave, b.subarray(0, 12))
  d.setAuthTag(b.subarray(12, 28))
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')
}
