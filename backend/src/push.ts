// Avisos push al celular (docs/plan-celular.md, fase 3): con la oficina instalada en el teléfono, avisa con el teléfono
// bloqueado cuando algo te espera (un permiso, una pregunta, te toca en un flujo, una entrega, una respuesta).
// - Web Push estándar: el navegador del celular da una suscripción (endpoint + claves) y acá se le manda el aviso cifrado
//   (RFC 8291, aes128gcm) y firmado con las claves VAPID de esta instalación (RFC 8292). Todo con node:crypto.
// - Qué avisar sale de lo mismo que mira la app (`GET /api/actividad`): cada pocos segundos, si hay suscripciones, se
//   compara con lo anterior y se manda solo lo nuevo. La primera mirada no avisa (lo que ya estaba, ya estaba).
// - Las claves y las suscripciones quedan en la carpeta de datos (push.json, push-suscripciones.json).
// API: GET /api/push · POST /api/push/suscribir · POST /api/push/desuscribir · POST /api/push/probar · PUT /api/push/silencio
import { createCipheriv, createECDH, createHash, createHmac, createPrivateKey, randomBytes, sign, type ECDH, type KeyObject } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ErrorAPI } from './errores.js'
import type { Obj } from './json.js'
import { atrapar, no404, no405, type APIHandler, type Query, type SubRouter } from './router.js'
import { registrarModulo, type Servicios } from './servicios.js'

const b64u = (b: Buffer) => b.toString('base64url')
const desdeB64u = (s: string) => Buffer.from(s, 'base64url')

/** HKDF-SHA256 de un solo bloque (alcanza para 32 bytes o menos). */
function hkdf(sal: Buffer, ikm: Buffer, info: Buffer, largo: number): Buffer {
  const prk = createHmac('sha256', sal).update(ikm).digest()
  return createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, largo)
}

export type Suscripcion = { endpoint: string; p256dh: string; auth: string }

/** Cifra un aviso para una suscripción (RFC 8291, «aes128gcm»): devuelve el cuerpo listo para mandar. */
export function cifrar(texto: Buffer, sus: Suscripcion, efimera?: ECDH, sal = randomBytes(16)): Buffer {
  const uaPublica = desdeB64u(sus.p256dh)
  const auth = desdeB64u(sus.auth)
  if (uaPublica.length !== 65 || auth.length < 16) throw new Error('suscripción inválida')
  if (!efimera) { efimera = createECDH('prime256v1'); efimera.generateKeys() }
  const asPublica = efimera.getPublicKey()
  const secreto = efimera.computeSecret(uaPublica)
  const ikm = hkdf(auth, secreto, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublica, asPublica]), 32)
  const cek = hkdf(sal, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(sal, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
  const c = createCipheriv('aes-128-gcm', cek, nonce)
  const cifrado = Buffer.concat([c.update(Buffer.concat([texto, Buffer.from([2])])), c.final(), c.getAuthTag()])
  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(4096)
  return Buffer.concat([sal, rs, Buffer.from([asPublica.length]), asPublica, cifrado])
}

/** Claves VAPID de esta instalación (P-256): la pública va al navegador; con la privada se firma cada envío. */
export class ClavesVapid {
  readonly publica: Buffer
  private readonly privada: KeyObject

  constructor(d: Buffer, publica: Buffer) {
    this.publica = publica
    this.privada = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(publica.subarray(1, 33)), y: b64u(publica.subarray(33, 65)) } })
  }

  static nuevas(): { d: Buffer; publica: Buffer } {
    const e = createECDH('prime256v1')
    e.generateKeys()
    return { d: e.getPrivateKey(), publica: e.getPublicKey() }
  }

  /** `Authorization: vapid t=<jwt>, k=<clave>` para el servicio de push del endpoint. */
  autorizacion(endpoint: string, sujeto: string, ahora = Date.now()): string {
    const aud = new URL(endpoint).origin
    const cab = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
    const cuerpo = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(ahora / 1000) + 12 * 3600, sub: sujeto })))
    const firma = sign('sha256', Buffer.from(`${cab}.${cuerpo}`), { key: this.privada, dsaEncoding: 'ieee-p1363' })
    return `vapid t=${cab}.${cuerpo}.${b64u(firma)}, k=${b64u(this.publica)}`
  }
}

/** Lo que se le manda al celular (el service worker lo muestra como notificación). */
export type Mensaje = { titulo: string; texto: string; url: string; tag: string; permiso?: string; acciones?: boolean }

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: Uint8Array; signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>

type Guardada = Suscripcion & { nombre: string; creada: number; silencio?: { desde: number; hasta: number } }

const hhmm = (h: number) => `${String(Math.floor(h / 60)).padStart(2, '0')}:${String(h % 60).padStart(2, '0')}`
const minutos = (s: unknown): number | undefined => {
  const m = typeof s === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(s) : null
  if (!m || +m[1]! > 23 || +m[2]! > 59) return undefined
  return +m[1]! * 60 + +m[2]!
}
/** ¿Está en su horario de no molestar? (puede cruzar la medianoche: 23:00 → 08:00) */
export function enSilencio(s: { desde: number; hasta: number } | undefined, ahora: Date): boolean {
  if (!s || s.desde === s.hasta) return false
  const m = ahora.getHours() * 60 + ahora.getMinutes()
  return s.desde < s.hasta ? m >= s.desde && m < s.hasta : m >= s.desde || m < s.hasta
}

/** Actividad (lo que devuelve /api/actividad) → lo que merece aviso, con una clave estable para no repetirlo. */
export function queAvisar(act: Obj, nombre: (id: string) => string): Map<string, Mensaje> {
  const out = new Map<string, Mensaje>()
  const base = '/?movil=1#'
  for (const a of (Array.isArray(act.avisos) ? act.avisos : []) as Obj[]) {
    const id = String(a.id ?? ''), tipo = String(a.tipo ?? ''), ag = String(a.agente ?? ''), texto = String(a.texto ?? '').slice(0, 300)
    const quien = ag ? nombre(ag) : 'Un agente'
    let m: Omit<Mensaje, 'tag'> | undefined
    if (tipo === 'respuesta') m = { titulo: `${quien} te respondió`, texto, url: `${base}/equipo/${encodeURIComponent(ag)}` }
    else if (tipo === 'error') m = { titulo: `${quien} no pudo responder`, texto, url: `${base}/equipo/${encodeURIComponent(ag)}` }
    else if (tipo === 'tarea') m = { titulo: `${quien} terminó una tarea`, texto, url: `${base}/trabajo/tareas` }
    else if (tipo === 'reunion') m = { titulo: 'Una reunión te espera', texto, url: `${base}/reuniones/${encodeURIComponent(String(a.ref ?? ''))}` }
    else if (tipo === 'flujo') m = { titulo: 'Te toca en un flujo', texto, url: `${base}/bandeja/hoy` }
    else if (tipo === 'skill') m = { titulo: `${quien} propone una skill`, texto, url: `${base}/bandeja/hoy` }
    else if (tipo === 'propuestas' || tipo === 'pendiente') m = { titulo: 'Pendientes para vos', texto, url: `${base}/bandeja/hoy` }
    // «espera» (entre agentes) no se avisa al celular: no te toca a vos
    if (m) out.set(`aviso:${id}:${texto}`, { ...m, tag: `aviso-${id}` })
  }
  for (const p of (Array.isArray(act.permisos) ? act.permisos : []) as Obj[]) {
    const id = String(p.id ?? '')
    if (!id) continue
    const que = String(p.descripcion ?? '') || [p.herramienta, p.detalle].filter((x) => typeof x === 'string' && x).join(' · ')
    out.set(`permiso:${id}`, { titulo: `${p.agente ? nombre(String(p.agente)) : 'Un agente'} necesita tu permiso`, texto: que.slice(0, 300),
      url: `${base}/bandeja/hoy`, tag: `permiso-${id}`, permiso: id, acciones: true })
  }
  const esperan = Number(act.teEsperan) || 0
  if (esperan > 0) out.set(`esperan:${esperan}`, { titulo: 'Te esperan en la Bandeja', texto: esperan === 1 ? 'Una pregunta o propuesta para contestar.' : `${esperan} preguntas o propuestas para contestar.`, url: `${base}/bandeja/hoy`, tag: 'esperan' })
  const entregas = Number(act.entregasSinRevisar) || 0
  if (entregas > 0) out.set(`entregas:${entregas}`, { titulo: entregas === 1 ? 'Una entrega para revisar' : `${entregas} entregas para revisar`, texto: 'Tocá para verla en la Bandeja.', url: `${base}/bandeja/hoy`, tag: 'entregas' })
  return out
}

export class AvisosPush {
  private claves?: ClavesVapid
  private subs: Guardada[] = []
  private visto?: Set<string>
  private timer?: NodeJS.Timeout
  private mirando = false
  /** Sujeto del JWT (lo piden los servicios de push, Apple incluido: tiene que ser mailto: o https:). Es el del proyecto, no
   *  el de la persona; HQ_PUSH_SUJETO lo cambia. */
  sujeto = 'https://github.com/salaesp/cherry-office'

  constructor(private readonly op: {
    dir: string
    router: () => APIHandler
    nombre: (id: string) => string
    log?: { info(m: string): void; error(m: string): void }
    fetch?: Fetch
    cadaMs?: number
  }) {
    this.subs = this.leerSubs()
  }

  clavePublica(): string { return b64u(this.vapid().publica) }
  suscripciones(): { endpoint: string; nombre: string; creada: number; silencio?: { desde: string; hasta: string } }[] {
    return this.subs.map((s) => ({ endpoint: s.endpoint, nombre: s.nombre, creada: s.creada, ...(s.silencio ? { silencio: { desde: hhmm(s.silencio.desde), hasta: hhmm(s.silencio.hasta) } } : {}) }))
  }

  suscribir(b: Obj): Obj {
    const s = (b.suscripcion && typeof b.suscripcion === 'object' ? b.suscripcion : {}) as Obj
    const keys = (s.keys && typeof s.keys === 'object' ? s.keys : {}) as Obj
    const endpoint = typeof s.endpoint === 'string' ? s.endpoint : ''
    let url: URL
    try { url = new URL(endpoint) } catch { throw new ErrorAPI(400, 'Falta la suscripción del navegador (endpoint).') }
    if (url.protocol !== 'https:') throw new ErrorAPI(400, 'El endpoint de push tiene que ser https.')
    const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '', auth = typeof keys.auth === 'string' ? keys.auth : ''
    if (desdeB64u(p256dh).length !== 65 || desdeB64u(auth).length < 16) throw new ErrorAPI(400, 'Las claves de la suscripción no son válidas.')
    const nombre = typeof b.nombre === 'string' && b.nombre.trim() ? b.nombre.trim().slice(0, 60) : 'Celular'
    const previa = this.subs.find((x) => x.endpoint === endpoint)
    this.subs = this.subs.filter((x) => x.endpoint !== endpoint)
    this.subs.push({ endpoint, p256dh, auth, nombre, creada: previa?.creada ?? Date.now(), ...(previa?.silencio ? { silencio: previa.silencio } : {}) })
    this.guardarSubs()
    this.vigilar()
    return { ok: true }
  }

  desuscribir(endpoint: unknown): Obj {
    const antes = this.subs.length
    this.subs = this.subs.filter((x) => x.endpoint !== endpoint)
    if (this.subs.length !== antes) this.guardarSubs()
    if (!this.subs.length) this.parar()
    return { ok: true }
  }

  silencio(b: Obj): Obj {
    const s = this.subs.find((x) => x.endpoint === b.endpoint)
    if (!s) throw new ErrorAPI(404, 'Este teléfono no está anotado para avisos.')
    if (b.desde === null || b.desde === undefined) delete s.silencio
    else {
      const desde = minutos(b.desde), hasta = minutos(b.hasta)
      if (desde === undefined || hasta === undefined) throw new ErrorAPI(400, '«desde» y «hasta» van como HH:MM.')
      s.silencio = { desde, hasta }
    }
    this.guardarSubs()
    return { ok: true }
  }

  async probar(endpoint: unknown): Promise<Obj> {
    const s = this.subs.find((x) => x.endpoint === endpoint)
    if (!s) throw new ErrorAPI(404, 'Este teléfono no está anotado para avisos.')
    const r = await this.enviar(s, { titulo: 'Avisos prendidos', texto: 'Así te va a avisar la Oficina cuando algo te espere.', url: '/?movil=1#/bandeja/hoy', tag: 'prueba' })
    if (r !== true) throw new ErrorAPI(502, `El servicio de avisos del teléfono no lo aceptó (${r}).`)
    return { ok: true }
  }

  /** Arranca a mirar la actividad si hay a quién avisar. */
  vigilar() {
    if (this.timer || !this.subs.length) return
    this.timer = setInterval(() => void this.mirar(), this.op.cadaMs ?? 8000)
    this.timer.unref?.()
    void this.mirar()
  }

  parar() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.visto = undefined
  }

  /** Una mirada: lo nuevo desde la anterior se manda a cada suscripción (salvo en su horario de no molestar). */
  async mirar(): Promise<number> {
    if (this.mirando || !this.subs.length) return 0
    this.mirando = true
    try {
      const r = await this.op.router().handle('GET', '/api/actividad', {})
      if (r.status !== 200) return 0
      const items = queAvisar(JSON.parse(r.json.toString('utf8')) as Obj, this.op.nombre)
      const antes = this.visto
      this.visto = new Set(items.keys())
      if (!antes) return 0
      const nuevos = [...items].filter(([k]) => !antes.has(k)).map(([, m]) => m)
      if (!nuevos.length) return 0
      const ahora = new Date()
      for (const s of [...this.subs]) {
        if (enSilencio(s.silencio, ahora)) continue
        // de a uno; varios juntos se agrupan en uno solo para no llenar la pantalla
        const lista = nuevos.length > 3 ? [{ titulo: `${nuevos.length} cosas te esperan`, texto: nuevos.map((m) => m.titulo).slice(0, 4).join(' · '), url: '/?movil=1#/bandeja/hoy', tag: 'varios' }] : nuevos
        for (const m of lista) await this.enviar(s, m)
      }
      return nuevos.length
    } catch (e) {
      this.op.log?.error(`push: ${e instanceof Error ? e.message : e}`)
      return 0
    } finally {
      this.mirando = false
    }
  }

  /** true si el servicio lo aceptó; si no, el estado HTTP (404/410: la suscripción ya no existe y se borra). */
  async enviar(s: Guardada, m: Mensaje): Promise<true | number | string> {
    const cuerpo = cifrar(Buffer.from(JSON.stringify(m).slice(0, 3500)), s)
    const f = this.op.fetch ?? (globalThis.fetch as unknown as Fetch)
    try {
      const r = await f(s.endpoint, {
        method: 'POST', body: new Uint8Array(cuerpo), signal: AbortSignal.timeout(15_000),
        headers: {
          'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400',
          Urgency: m.permiso ? 'high' : 'normal', Topic: createHash('sha256').update(m.tag).digest('base64url').slice(0, 32),
          Authorization: this.vapid().autorizacion(s.endpoint, this.sujeto),
        },
      })
      if (r.status >= 200 && r.status < 300) return true
      if (r.status === 404 || r.status === 410) this.desuscribir(s.endpoint)
      this.op.log?.info(`push: ${new URL(s.endpoint).host} respondió ${r.status}`)
      return r.status
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  private vapid(): ClavesVapid {
    if (this.claves) return this.claves
    const f = path.join(this.op.dir, 'push.json')
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { d?: string; publica?: string }
      if (j.d && j.publica) return (this.claves = new ClavesVapid(desdeB64u(j.d), desdeB64u(j.publica)))
    } catch {}
    const n = ClavesVapid.nuevas()
    fs.mkdirSync(this.op.dir, { recursive: true })
    fs.writeFileSync(f, JSON.stringify({ d: b64u(n.d), publica: b64u(n.publica) }), { mode: 0o600 })
    return (this.claves = new ClavesVapid(n.d, n.publica))
  }

  private archivoSubs() { return path.join(this.op.dir, 'push-suscripciones.json') }
  private leerSubs(): Guardada[] {
    try {
      const j = JSON.parse(fs.readFileSync(this.archivoSubs(), 'utf8'))
      return Array.isArray(j) ? j.filter((x) => x && typeof x.endpoint === 'string') : []
    } catch { return [] }
  }
  private guardarSubs() {
    fs.mkdirSync(this.op.dir, { recursive: true })
    const tmp = this.archivoSubs() + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.subs, null, 1), { mode: 0o600 })
    fs.renameSync(tmp, this.archivoSubs())
  }
}

export class PushRouter implements SubRouter {
  constructor(private readonly push: AvisosPush) {}

  async handle(method: string, ruta: string, _q: Query, body?: Buffer) {
    if (ruta !== '/api/push' && !ruta.startsWith('/api/push/')) return null
    return atrapar(async () => {
      const b = body && body.length ? (JSON.parse(body.toString('utf8')) as Obj) : {}
      if (ruta === '/api/push') return method === 'GET' ? [200, { clave: this.push.clavePublica(), suscripciones: this.push.suscripciones() }] : no405
      if (ruta === '/api/push/suscribir') return method === 'POST' ? [200, this.push.suscribir(b)] : no405
      if (ruta === '/api/push/desuscribir') return method === 'POST' ? [200, this.push.desuscribir(b.endpoint)] : no405
      if (ruta === '/api/push/probar') return method === 'POST' ? [200, await this.push.probar(b.endpoint)] : no405
      if (ruta === '/api/push/silencio') return method === 'PUT' ? [200, this.push.silencio(b)] : no405
      return no404
    })
  }
}

registrarModulo('push', 90, (s: Servicios) => {
  const push = new AvisosPush({
    dir: s.config.datosDir, router: () => s.router, log: s.log,
    nombre: (id) => s.oficinas.activa()?.oficina.agentes.find((a) => a.id === id)?.nombre ?? id,
  })
  if (s.env.HQ_PUSH_SUJETO) push.sujeto = s.env.HQ_PUSH_SUJETO
  s.huecos.push = push
  s.router.registrarExtra(new PushRouter(push))
  s.alArrancar.push(() => push.vigilar())
  s.alCerrar.push(() => push.parar())
})
