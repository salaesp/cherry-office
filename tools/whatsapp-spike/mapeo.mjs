// Lógica pura del spike (sin red): ids, filtros y mapeo de mensajes de Baileys al formato del plan
// (`docs/plan-secretaria.md`, «Mensaje»). Se prueba con `node --test`.

/** «+54 9 11 5555-1234» -> «5491155551234@s.whatsapp.net». undefined si no parece un número. */
export function jidDeNumero(numero) {
  const d = String(numero ?? '').replace(/[^\d]/g, '')
  if (d.length < 8 || d.length > 15) return undefined
  return d + '@s.whatsapp.net'
}

/** Saca el sufijo de dispositivo («549...:12@s.whatsapp.net» -> «549...@s.whatsapp.net»). */
export function normalizar(jid) {
  if (typeof jid !== 'string' || jid === '') return undefined
  const [usuario, servidor] = jid.split('@')
  if (!servidor) return undefined
  return usuario.split(':')[0] + '@' + servidor
}

export const esGrupo = (jid) => typeof jid === 'string' && jid.endsWith('@g.us')
export const esLid = (jid) => typeof jid === 'string' && jid.endsWith('@lid')
export const esPersona = (jid) => typeof jid === 'string' && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'))

/** Estados, canales, listas de difusión y cualquier cosa que no sea persona o grupo: nunca se leen. */
export function seIgnora(jid) {
  if (typeof jid !== 'string') return true
  if (jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return true
  return !(esGrupo(jid) || esPersona(jid))
}

/**
 * Chats elegidos: cada uno con un id canónico (el JID de número o de grupo, como lo eligió la persona) y los otros ids
 * con los que puede aparecer (sus `@lid`).
 */
export class Elegidos {
  constructor(lista = []) {
    /** @type {Map<string, {id: string, nombre: string, nota?: string, grupo: boolean}>} */
    this.porId = new Map()
    /** alias (pn o lid) -> id canónico */
    this.alias = new Map()
    for (const c of lista) this.agregar(c)
  }

  /** `c.id` puede ser un número («+54 9 11…»), un JID de número, un `@lid` o un JID de grupo. */
  agregar(c) {
    const crudo = String(c.id ?? '').trim()
    const id = crudo.includes('@') ? normalizar(crudo) : jidDeNumero(crudo)
    if (!id || seIgnora(id)) throw new Error(`Chat elegido inválido: ${crudo}`)
    if (!c.nombre) throw new Error(`El chat ${crudo} necesita un nombre`)
    this.porId.set(id, { id, nombre: String(c.nombre), nota: c.nota ? String(c.nota) : undefined, grupo: esGrupo(id) })
    this.alias.set(id, id)
    return id
  }

  /** Suma un id alternativo (p. ej. el `@lid` de un número elegido). true si es nuevo. */
  sumarAlias(idCanonico, otro) {
    const o = normalizar(otro)
    if (!o || !this.porId.has(idCanonico) || this.alias.get(o) === idCanonico) return false
    this.alias.set(o, idCanonico)
    return true
  }

  /** El id canónico del chat elegido que corresponde a alguno de estos jids, o undefined. */
  resolver(...jids) {
    for (const j of jids) {
      const n = normalizar(j)
      if (n && this.alias.has(n)) return this.alias.get(n)
    }
    return undefined
  }

  aliasDe(idCanonico) {
    return [...this.alias.entries()].filter(([, v]) => v === idCanonico).map(([k]) => k).filter((k) => k !== idCanonico)
  }
}

/** Desenvuelve los contenedores (efímeros, ver una vez, documento con texto…) hasta el mensaje real. */
function desenvolver(m) {
  let x = m
  for (let i = 0; i < 5 && x; i++) {
    const dentro = x.ephemeralMessage?.message ?? x.viewOnceMessage?.message ?? x.viewOnceMessageV2?.message
      ?? x.viewOnceMessageV2Extension?.message ?? x.documentWithCaptionMessage?.message ?? x.editedMessage?.message
    if (!dentro) break
    x = dentro
  }
  return x
}

const tsSeg = (t) => {
  if (t === null || t === undefined) return undefined
  if (typeof t === 'number') return t
  if (typeof t === 'object' && typeof t.toNumber === 'function') return t.toNumber()
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** Texto, tipo y cita de un `message` de Baileys. */
export function contenido(message) {
  const m = desenvolver(message ?? {})
  if (!m || typeof m !== 'object') return { tipo: 'vacio' }
  const ctx = (x) => x?.contextInfo
  const cita = (x) => {
    const c = ctx(x)
    if (!c?.stanzaId) return undefined
    const q = c.quotedMessage ? contenido(c.quotedMessage).texto : undefined
    return { id: c.stanzaId, texto: q ? q.slice(0, 200) : undefined }
  }
  if (typeof m.conversation === 'string') return { tipo: 'texto', texto: m.conversation }
  if (m.extendedTextMessage) return { tipo: 'texto', texto: m.extendedTextMessage.text ?? '', cita: cita(m.extendedTextMessage) }
  if (m.imageMessage) return { tipo: 'imagen', texto: m.imageMessage.caption || undefined, cita: cita(m.imageMessage) }
  if (m.videoMessage) return { tipo: 'video', texto: m.videoMessage.caption || undefined, cita: cita(m.videoMessage) }
  if (m.audioMessage) return { tipo: m.audioMessage.ptt ? 'nota_de_voz' : 'audio', segundos: m.audioMessage.seconds ?? undefined, cita: cita(m.audioMessage) }
  if (m.documentMessage) return { tipo: 'documento', texto: m.documentMessage.caption || m.documentMessage.fileName || undefined }
  if (m.stickerMessage) return { tipo: 'sticker' }
  if (m.locationMessage) return { tipo: 'ubicacion', texto: [m.locationMessage.name, m.locationMessage.address].filter(Boolean).join(', ') || undefined }
  if (m.contactMessage) return { tipo: 'contacto', texto: m.contactMessage.displayName || undefined }
  if (m.pollCreationMessage || m.pollCreationMessageV3) {
    const p = m.pollCreationMessage ?? m.pollCreationMessageV3
    return { tipo: 'encuesta', texto: [p.name, ...(p.options ?? []).map((o) => '- ' + o.optionName)].join('\n') }
  }
  if (m.reactionMessage) return { tipo: 'reaccion', texto: m.reactionMessage.text || undefined, reaccionA: m.reactionMessage.key?.id }
  if (m.protocolMessage) {
    const p = m.protocolMessage
    // 0 = REVOKE (borrado para todos), 14 = MESSAGE_EDIT
    if (p.type === 0 || p.type === 'REVOKE') return { tipo: 'borrado', de: p.key?.id }
    if (p.type === 14 || p.type === 'MESSAGE_EDIT') return { tipo: 'edicion', de: p.key?.id, texto: contenido(p.editedMessage).texto }
    return { tipo: 'protocolo' }
  }
  return { tipo: 'otro', claves: Object.keys(m).filter((k) => k !== 'messageContextInfo').slice(0, 5) }
}

/**
 * Un WAMessage de Baileys -> el mensaje del plan, si es de un chat elegido. undefined si no corresponde guardarlo
 * (chat no elegido, ignorado o mensaje de protocolo sin contenido).
 */
export function mapear(wa, elegidos) {
  const k = wa?.key
  if (!k?.remoteJid || seIgnora(k.remoteJid)) return undefined
  const chat = elegidos.resolver(k.remoteJid, k.remoteJidAlt)
  if (!chat) return undefined
  const c = contenido(wa.message)
  if (c.tipo === 'vacio' || c.tipo === 'protocolo') return undefined
  const grupo = esGrupo(chat)
  const de = k.fromMe ? 'yo' : grupo ? normalizar(k.participantAlt ?? k.participant) ?? normalizar(k.participant) : chat
  const out = {
    id: k.id,
    chat,
    de,
    propio: !!k.fromMe,
    ts: tsSeg(wa.messageTimestamp),
    tipo: c.tipo,
  }
  if (grupo && !k.fromMe && wa.pushName) out.pushName = wa.pushName // solo diagnóstico del spike; la app no lo usa
  if (c.texto !== undefined) out.texto = c.texto
  if (c.cita) out.cita = c.cita
  if (c.segundos !== undefined) out.segundos = c.segundos
  if (c.tipo === 'edicion') { out.editado = c.de; out.tipo = 'texto' }
  if (c.tipo === 'borrado') out.borrado = c.de
  if (c.reaccionA) out.reaccionA = c.reaccionA
  if (c.claves) out.claves = c.claves
  // cómo se reconoció el chat: por su id directo o por el alternativo (`@lid` <-> número)
  out.via = normalizar(k.remoteJid) === chat ? 'directo' : 'alternativo'
  return out
}

/** Metadatos de un chat no elegido para la lista (sin texto, nunca). */
export function metaChat(jid, { nombre, participantes, ultimo } = {}) {
  const id = normalizar(jid)
  if (!id || seIgnora(id)) return undefined
  const m = { jid: id, grupo: esGrupo(id) }
  if (nombre) m.nombre = nombre
  if (participantes !== undefined) m.participantes = participantes
  if (ultimo !== undefined) m.ultimo = ultimo
  return m
}
