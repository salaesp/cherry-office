// Rutas del núcleo para el chat (Router.swift): historial, chat, actividad, avisos y costos.
import type { GanchosCharla } from './delegar.js'
import { SkillsPropias } from './skills-propias.js'
import { Adjuntos, type Adjunto } from './adjuntos.js'
import type { Avisos } from './avisos.js'
import { TextoAviso, avisoJSON } from './avisos.js'
import { Cancelacion, ClaudeError, type ClaudeRunner } from './claude-runner.js'
import { ErrorAPI } from './errores.js'
import type { Config } from './config.js'
import { ArchivosEntrega, TextoEntrega, type Entregas } from './entregas.js'
import { esObjeto, maxBody, objeto, type Obj } from './json.js'
import type { HQLog } from './log.js'
import type { Oficinas } from './oficinas.js'
import type { PermisosVivos } from './permisos-vivos.js'
import { pedidoJSON, decisionesPermiso, type DecisionPermiso } from './permisos-vivos.js'
import { argumentos, contexto, entorno, variableTokenMCP, type FuenteCatalogo } from './permisos.js'
import { aplicarEleccion, eleccionCharla, type EleccionCharla } from './agentes.js'
import { no405, type Resp, type RutaNucleo } from './router.js'
import type { InfoClaude } from './rutas-oficinas.js'
import type { Store } from './store.js'
import path from 'node:path'
import { CajaArchivos, CajaContexto, CajaCosto, CajaVivo, type PasoVivo } from './stream.js'
import { parsearContexto } from './contexto.js'
import { enCarpetaTrabajo } from './trabajo.js'
import type { Oficina } from './oficina.js'
import { largo, uuidValido } from './validar.js'

export const maxMensaje = 100_000

/** Servidor MCP propio (consultas entre agentes): lo enchufa ese módulo. Sin él, el chat corre sin consultas. */
export interface MCPChat {
  url(): Promise<string | undefined>
  emitir(p: { oficina: string; agente: string; sid: string; perfil: string; interactivo?: boolean }): string
  revocar(token: string): void
  /** Rechaza los pedidos de permiso pendientes de ese token. */
  cancelarPermisos?(token: string): void
  /** Pedidos de permiso pendientes de una oficina. */
  permisos?: PermisosVivos
}

/** Pedidos de permiso de las corridas sin la persona (tareas): los pone el módulo de tareas (permisos-tareas.ts). */
export interface PermisosTareasChat {
  pendientes(oficina: string): Obj[]
  /** undefined si no existe o ya se respondió. Lanza ErrorAPI si «siempre» no se puede guardar. */
  responder(oficina: string, id: string, decision: DecisionPermiso): { reglas?: string[]; retoma?: boolean } | undefined
}

export type DepsChat = {
  config: Config
  store: Store
  runner: ClaudeRunner
  oficinas: Oficinas
  avisos: Avisos
  entregas: Entregas
  log: HQLog
  mcp?: () => MCPChat | undefined
  permisosTareas?: () => PermisosTareasChat | undefined
  catalogo?: FuenteCatalogo
  /** Resumen de corridas de flujos para /api/actividad (motor de flujos). */
  corridas?: (oficina: string) => Obj[]
  /** Versión del Creador para /api/actividad. */
  creadorVersion?: (oficina: string) => number
  /** Delegar y preguntar en la charla (delegar.ts): instrucciones, cuándo existen las herramientas y lo que espera a la persona. */
  charla?: () => GanchosCharla | undefined
}

/** `claude auth status` cacheado unos segundos (la UI de onboarding consulta /api/estado seguido). */
export class AuthCache {
  private valorCache?: boolean
  private cuando = 0
  private enCurso?: Promise<boolean | undefined>
  constructor(private readonly runner: ClaudeRunner, private readonly ttl = 5000) {}
  async valor(): Promise<boolean | undefined> {
    if (Date.now() - this.cuando < this.ttl) return this.valorCache
    if (this.enCurso) return this.enCurso
    this.enCurso = this.runner.authStatus(8)
    const v = await this.enCurso
    this.enCurso = undefined
    this.valorCache = v
    this.cuando = Date.now()
    return v
  }
}

export function infoClaude(runner: ClaudeRunner): InfoClaude {
  const cache = new AuthCache(runner)
  return { claudePath: () => runner.claudePath, auth: () => cache.valor() }
}

/** Un paso en vivo para el front: los archivos van relativos a la oficina (`rel`), absolutos si caen en una carpeta de
 *  trabajo (trabajo.ts; el front los pide igual) o, si caen afuera, con su nombre y su `ruta` absoluta (sin `rel`). */
export function pasoJSON(p: PasoVivo, carpeta: string, oficina?: Oficina): Obj {
  if (p.t !== 'archivo') return { ...p }
  const rel = ArchivosEntrega.relativos([p.ruta], carpeta)[0]
  if (rel !== undefined) return { t: 'archivo', rel, nombre: path.posix.basename(rel) }
  const t = path.isAbsolute(p.ruta) ? enCarpetaTrabajo(oficina, p.ruta) : undefined
  if (t && t.partes.length > 0) return { t: 'archivo', rel: path.join(t.base, ...t.partes).split(path.sep).join('/'), nombre: t.partes[t.partes.length - 1]! }
  // afuera: va su ruta absoluta para que el front ofrezca sumar su carpeta como de trabajo
  const abs = path.isAbsolute(p.ruta) ? { ruta: p.ruta.replace(/\\/g, '/') } : {}
  return { t: 'archivo', nombre: path.basename(p.ruta.replace(/\\/g, '/')), ...abs }
}

export function rutasChat(d: DepsChat): RutaNucleo {
  const { config, store, runner, oficinas, avisos, entregas, log } = d
  const invalido: Resp = [400, { error: 'pedido inválido' }]
  /** Chats en curso (oficina + agente): lo que el agente va escribiendo y haciendo, para `GET /api/chat/vivo`. */
  const vivos = new Map<string, { sid: string; caja: CajaVivo; cancelacion: Cancelacion }>()
  const claveVivo = (oficina: string, agente: string) => oficina + '\u001f' + agente

  /** `GET /api/chat/vivo?agent=<id>`: la respuesta que se está escribiendo. `{activo:false}` si no hay chat en curso. */
  function vivo(q: Record<string, string>): Resp {
    const act = oficinas.requerirActiva()
    const agente = q.agent
    if (agente === undefined || !act.oficina.agentes.some((a) => a.id === agente)) return invalido
    const v = vivos.get(claveVivo(act.carpeta, agente))
    if (!v) return [200, { activo: false }]
    return [200, { activo: true, session: v.sid, version: v.caja.version, pasos: v.caja.valor.map((p) => pasoJSON(p, act.carpeta, act.oficina)) }]
  }

  /** `POST /api/chat/cancelar` `{agent}`: corta lo que el agente está haciendo en su chat (termina el proceso de claude y,
   *  con él, las herramientas que lanzó). El `POST /api/chat` que estaba esperando responde `{cancelado:true, reply, pasos}`.
   *  409 si no hay un chat en curso con ese agente (por ejemplo, terminó justo antes). */
  function cancelar(body?: Buffer): Resp {
    const act = oficinas.requerirActiva()
    const b = objeto(body)
    if (typeof b.agent !== 'string' || !act.oficina.agentes.some((a) => a.id === b.agent)) return invalido
    const v = vivos.get(claveVivo(act.carpeta, b.agent))
    if (!v) return [409, { error: 'Ese agente no está respondiendo ahora.' }]
    v.cancelacion.cancelar()
    log.info(`chat cancelado agente=${b.agent} sid=${v.sid.slice(0, 8)}`)
    return [200, { ok: true }]
  }

  function historial(q: Record<string, string>): Resp {
    const act = oficinas.requerirActiva()
    const agente = q.agent
    if (agente === undefined || !act.oficina.agentes.some((a) => a.id === agente)) return invalido
    const lista = (ms: { r: string; t: string; e: boolean }[]) => ms.map((m) => (m.e ? { r: m.r, t: m.t, e: true } : { r: m.r, t: m.t }))
    const sidRaw = q.session
    if (sidRaw === undefined) {
      const ult = store.ultimaSesion(agente, act.carpeta)
      const c = ult ? store.contexto(ult) : undefined
      return [200, { session: ult ?? null, msgs: lista(ult ? store.mensajes(ult) : []), ...(c ? { contexto: c } : {}) }]
    }
    if (!uuidValido(sidRaw)) return invalido
    const sid = sidRaw.toLowerCase()
    const dueno = store.agenteDe(sid)
    if (dueno !== undefined && dueno !== agente) return [200, { msgs: [] }]
    const of = store.oficinaDe(sid)
    if (of !== undefined && of !== act.carpeta) return [200, { msgs: [] }]
    const c = store.contexto(sid)
    return [200, { msgs: lista(store.mensajes(sid)), ...(c ? { contexto: c } : {}) }]
  }

  /** `GET /api/sesiones?agent=`: las charlas guardadas de la oficina (todas o las de un agente), la más reciente
   *  primero: `{sesiones:[{session, agente, titulo, ultimo, de:'u'|'a', ts, n}]}`. `titulo` es el primer mensaje del
   *  usuario y `ultimo` el último mensaje, recortados. Los agentes que ya no están en la oficina no aparecen. */
  function sesiones(q: Record<string, string>): Resp {
    const act = oficinas.requerirActiva()
    const agente = q.agent
    if (agente !== undefined && !act.oficina.agentes.some((a) => a.id === agente)) return invalido
    const ids = new Set(act.oficina.agentes.map((a) => a.id))
    const recortar = (t: string, n: number) => { const s = t.replace(/\s+/g, ' ').trim(); return largo(s) > n ? Array.from(s).slice(0, n).join('') + '…' : s }
    return [200, {
      sesiones: store.sesiones(act.carpeta, agente).filter((s) => ids.has(s.agente)).map((s) => ({
        session: s.sid, agente: s.agente, titulo: recortar(s.primero, 400), ultimo: recortar(s.ultimo, 400), de: s.rol, ts: s.ts, n: s.n,
      })),
    }]
  }

  async function chat(body?: Buffer): Promise<Resp> {
    const act = oficinas.requerirActiva()
    if (!body) return invalido
    // con archivos adjuntos el cuerpo puede ser grande (base64); sin ellos, el tope de siempre
    if (body.length > Adjuntos.maxBody) return [413, { error: 'pedido demasiado grande' }]
    let b: unknown
    try {
      b = JSON.parse(body.toString('utf8'))
    } catch {
      b = undefined
    }
    if (body.length > maxBody && (!esObjeto(b) || b.archivos === undefined)) return [413, { error: 'pedido demasiado grande' }]
    if (!esObjeto(b) || typeof b.agent !== 'string' || typeof b.message !== 'string' || typeof b.session !== 'string') return invalido
    let adjuntos: Adjunto[]
    try {
      adjuntos = Adjuntos.leer(b.archivos)
    } catch (e) {
      if (e instanceof ErrorAPI) return [e.status, { error: e.mensaje }]
      throw e
    }
    const agente = b.agent
    const escrito = b.message.trim()
    // solo archivos, sin texto: se los pasa igual
    const msg = escrito === '' && adjuntos.length > 0 ? 'Te paso estos archivos.' : escrito
    const def = act.oficina.agentes.find((a) => a.id === agente)
    if (!def || msg === '' || largo(msg) > maxMensaje || !uuidValido(b.session)) return invalido
    const sid = b.session.toLowerCase()
    // modelo y esfuerzo elegidos en la charla (pisan los del agente solo en este mensaje)
    let eleccion: EleccionCharla
    try {
      eleccion = eleccionCharla(b)
    } catch (e) {
      if (e instanceof ErrorAPI) return [e.status, { error: e.mensaje }]
      throw e
    }

    try {
      runner.verificar(act.carpeta)
    } catch (e) {
      if (e instanceof ClaudeError) {
        log.error(`chat agente=${agente} tipo=${e.tipo}`)
        return [500, { error: e.mensaje }]
      }
      return [500, { error: 'error interno' }]
    }

    const dueno = store.agenteDe(sid)
    if (dueno !== undefined && dueno !== agente) return invalido
    const of = store.oficinaDe(sid)
    if (of !== undefined && of !== act.carpeta) return invalido
    // los adjuntos se guardan en la oficina y el agente recibe sus rutas al final del mensaje
    let mensaje: string
    try {
      mensaje = msg + Adjuntos.texto(Adjuntos.guardar(act, `chat/${agente}`, adjuntos))
    } catch (e) {
      if (e instanceof ErrorAPI) return [e.status, { error: e.mensaje }]
      throw e
    }
    const t0 = Date.now()
    const carpeta = act.carpeta
    const caja = new CajaCosto()
    const escritos = new CajaArchivos()
    const enVivo = new CajaVivo()
    const uso = new CajaContexto()
    const cancelacion = new Cancelacion()
    const ctx = contexto(act, def, { dirsExtra: config.oficinaDirsExtra, catalogo: d.catalogo?.(), config })
    // consultas a colegas: el token vive lo que dura este chat. Si el servidor MCP no arrancó, el chat sale igual.
    const mcp = d.mcp?.()
    const mcpUrl = mcp ? await mcp.url() : undefined
    if (mcpUrl !== undefined) ctx.mcpUrl = mcpUrl
    // la persona está en el chat: lo que el agente no tiene permitido se le pregunta (tarjeta en la oficina)
    ctx.preguntar = true
    aplicarEleccion(ctx, eleccion)
    // pasar trabajo a un colega y preguntarle a la persona: instrucciones como mensaje de sistema, con las demás
    const ganchos = d.charla?.()
    const extra = ganchos?.instrucciones(act.oficina, def)
    if (extra) ctx.instrucciones = ctx.instrucciones ? `${ctx.instrucciones}\n\n${extra}` : extra

    let resultado: Resp
    try {
      resultado = await runner.conCarrilDe(carpeta, agente, async (): Promise<Resp> => {
        vivos.set(claveVivo(carpeta, agente), { sid, caja: enVivo, cancelacion })
        const envExtra: Record<string, string> = { ...entorno(ctx) }
        if (mcpUrl !== undefined && mcp) envExtra[variableTokenMCP] = mcp.emitir({ oficina: carpeta, agente, sid, perfil: ctx.perfilMCP, interactivo: true })
        try {
          store.asegurarSesion(sid, agente, carpeta)
          store.agregar(sid, 'u', mensaje)
          ganchos?.empezar(carpeta, agente, sid)
          const activa = store.estaActiva(sid)
          // el cartel: fijo arriba («Respondiéndote») y abajo lo que va haciendo en vivo (sin IA)
          const texto = await runner.actividad.seguir({ oficina: carpeta, agente, origen: 'chat', tarea: 'Respondiéndote', extra: caja.observador(escritos.observador(uso.observador(enVivo.observador()))) },
            (obs) => runner.ejecutarChat({ agente, mensaje, sid, activa, carpeta, obs, envExtra, cancelacion, armar: (p) => argumentos(config, ctx, p) }))
          store.marcarActiva(sid)
          const guardado = texto === '' ? '(sin respuesta)' : texto
          store.agregar(sid, 'a', guardado)
          const av = avisos.crear({ oficina: carpeta, tipo: 'respuesta', agente, texto: TextoAviso.respuesta(guardado), ref: sid })
          if (av) avisos.emitir(av, def.nombre)
          // un chat que dejó archivos en archivos/entregables/ cuenta como entrega para revisar
          const archivos = ArchivosEntrega.enEntregables(ArchivosEntrega.relativos(escritos.valor, carpeta))
          const r: Obj = { reply: texto }
          // cuánto ocupa ahora la charla (el chip de contexto); si claude no dijo la ventana, queda la que ya se sabía
          if (uso.valor) {
            try { store.fijarContexto(sid, uso.valor) } catch {}
            const c = store.contexto(sid)
            if (c) r.contexto = c
          }
          // los pasos (textos intermedios, herramientas y archivos) para mostrarlos plegados arriba de la respuesta; los
          // textos después de la última herramienta son la respuesta misma (reply), así que no se repiten
          const todos = enVivo.valor
          let fin = todos.length
          while (fin > 0 && todos[fin - 1]!.t === 'texto') fin--
          const pasos = todos.slice(0, fin).map((p) => pasoJSON(p, carpeta, act.oficina))
          if (pasos.length > 0) r.pasos = pasos
          if (archivos.length > 0) {
            const e = entregas.registrar({ oficina: carpeta, agente, nombre: def.nombre, origen: 'chat', ref: sid, titulo: TextoEntrega.titulo(msg),
              texto, sid, archivos, costo: caja.valor })
            if (e) r.entrega = String(e.id)
          }
          return [200, r]
        } catch (e) {
          if (e instanceof ClaudeError && e.tipo === 'cancelado') {
            // la persona lo cortó: queda dicho en la charla (sin error ni aviso) y lo que alcanzó a hacer, para mostrarlo
            try { store.agregar(sid, 'a', e.mensaje) } catch {}
            const todos = enVivo.valor
            let fin = todos.length
            while (fin > 0 && todos[fin - 1]!.t === 'texto') fin--
            const r: Obj = { cancelado: true, reply: e.mensaje }
            const pasos = todos.slice(0, fin).map((p) => pasoJSON(p, carpeta, act.oficina))
            if (pasos.length > 0) r.pasos = pasos
            return [200, r]
          }
          if (e instanceof ClaudeError) {
            try { store.agregar(sid, 'a', 'No pude responder: ' + e.mensaje, true) } catch {}
            const av = avisos.crear({ oficina: carpeta, tipo: 'error', agente, texto: 'No pudo responder: ' + e.mensaje, ref: sid })
            if (av) avisos.emitir(av, def.nombre)
            return [e.status, { error: e.mensaje }]
          }
          const t = 'No pude guardar la conversación.'
          try { store.agregar(sid, 'a', 'No pude responder: ' + t, true) } catch {}
          return [500, { error: t }]
        } finally {
          ganchos?.terminar(carpeta, agente, sid)
          const k = claveVivo(carpeta, agente)
          if (vivos.get(k)?.caja === enVivo) vivos.delete(k)
          const tok = envExtra[variableTokenMCP]
          if (tok !== undefined) { mcp?.revocar(tok); mcp?.cancelarPermisos?.(tok) }
        }
      })
    } finally {
      store.registrarCosto({ oficina: carpeta, agente, origen: 'chat', ref: sid, costo: caja.valor })
    }
    log.info(`chat agente=${agente} sid=${sid.slice(0, 8)} estado=${resultado[0]} seg=${((Date.now() - t0) / 1000).toFixed(1)}`
      + (ctx.modelo !== undefined ? ` modelo=${ctx.modelo}` : '') + (ctx.esfuerzo !== undefined ? ` esfuerzo=${ctx.esfuerzo}` : '') + caja.tokensLog())
    return resultado
  }

  /** `POST /api/chat/contexto` `{agent, session, modelo?, esfuerzo?, …}` (lo mismo que se elige en la charla): el
   *  desglose de `/context` de esa charla → `{modelo, usados, ventana, grupos:{mensajes, herramientas, instrucciones,
   *  skills, otros}, libre, reserva}`. Corre claude con los argumentos del chat pero sin llamar a la API (~1 s). */
  async function desgloseContexto(body?: Buffer): Promise<Resp> {
    const act = oficinas.requerirActiva()
    const b = objeto(body)
    if (typeof b.agent !== 'string' || typeof b.session !== 'string' || !uuidValido(b.session)) return invalido
    const agente = b.agent
    const def = act.oficina.agentes.find((a) => a.id === agente)
    if (!def) return invalido
    const sid = b.session.toLowerCase()
    if (store.agenteDe(sid) !== agente || store.oficinaDe(sid) !== act.carpeta) return [404, { error: 'Esa charla no está.' }]
    if (!store.estaActiva(sid)) return [409, { error: 'La charla todavía no empezó.' }]
    let eleccion: EleccionCharla
    try {
      eleccion = eleccionCharla(b)
    } catch (e) {
      if (e instanceof ErrorAPI) return [e.status, { error: e.mensaje }]
      throw e
    }
    const carpeta = act.carpeta
    const ctx = contexto(act, def, { dirsExtra: config.oficinaDirsExtra, catalogo: d.catalogo?.(), config })
    const mcp = d.mcp?.()
    const mcpUrl = mcp ? await mcp.url() : undefined
    if (mcpUrl !== undefined) ctx.mcpUrl = mcpUrl
    ctx.preguntar = true
    aplicarEleccion(ctx, eleccion)
    const envExtra: Record<string, string> = { ...entorno(ctx) }
    if (mcpUrl !== undefined && mcp) envExtra[variableTokenMCP] = mcp.emitir({ oficina: carpeta, agente, sid, perfil: ctx.perfilMCP, interactivo: true })
    try {
      const md = await runner.contextoChat({ agente, sid, carpeta, envExtra, armar: (p) => argumentos(config, ctx, p) })
      const r = parsearContexto(md)
      if (!r) {
        log.warn(`contexto agente=${agente} sid=${sid.slice(0, 8)}: no se pudo leer el informe`)
        return [502, { error: 'Claude Code no devolvió el uso del contexto.' }]
      }
      return [200, r]
    } catch (e) {
      if (e instanceof ClaudeError) return [e.status, { error: e.mensaje }]
      throw e
    } finally {
      const tok = envExtra[variableTokenMCP]
      if (tok !== undefined) mcp?.revocar(tok)
    }
  }

  /** `POST /api/permisos/<id>` `{decision: una_vez|siempre|rechazar}`: responde un pedido de permiso de un chat o de una
   *  tarea que espera.
   *  «siempre» guarda las reglas del pedido en el agente (oficina.json) antes de dejarlo pasar. */
  function responderPermiso(id: string, body?: Buffer): Resp {
    const act = oficinas.requerirActiva()
    const b = objeto(body)
    const dec = typeof b.decision === 'string' && (decisionesPermiso as string[]).includes(b.decision) ? (b.decision as DecisionPermiso) : undefined
    if (dec === undefined) return [400, { error: '«decision» tiene que ser una_vez, siempre o rechazar.' }]
    const vivos = d.mcp?.()?.permisos
    const p = vivos?.pedido(act.carpeta, id.toLowerCase())
    if (!vivos || !p) {
      // ¿un pedido de una tarea que espera? (esos no vencen: la tarea retoma cuando se responden todos)
      const t = d.permisosTareas?.()?.responder(act.carpeta, id.toLowerCase(), dec)
      if (!t) return [404, { error: 'Ese pedido de permiso ya no está (venció o el chat terminó).' }]
      const r: Obj = { ok: true }
      if (t.reglas) r.reglas = t.reglas
      if (t.retoma) r.retoma = true
      return [200, r]
    }
    let reglas: string[] | undefined
    if (dec === 'siempre') {
      if (p.reglas.length === 0) return [400, { error: 'Esto solo se puede permitir una vez.' }]
      reglas = oficinas.agregarReglas(p.agente, p.reglas)
    }
    if (!vivos.responder(act.carpeta, p.id, dec)) return [404, { error: 'Ese pedido de permiso ya no está (venció o el chat terminó).' }]
    log.info(`permiso agente=${p.agente} herramienta=${p.herramienta} respuesta=${dec}`)
    const r: Obj = { ok: true }
    if (reglas) r.reglas = reglas
    return [200, r]
  }

  return async ({ method, partes, query, body }) => {
    const [, seccion, a2] = partes
    const n = partes.length
    if (seccion === 'historial' && n === 2) return method === 'GET' ? historial(query) : no405
    if (seccion === 'sesiones' && n === 2) return method === 'GET' ? sesiones(query) : no405
    if (seccion === 'chat' && n === 2) return method === 'POST' ? chat(body) : no405
    if (seccion === 'chat' && n === 3 && a2 === 'vivo') return method === 'GET' ? vivo(query) : no405
    if (seccion === 'chat' && n === 3 && a2 === 'cancelar') return method === 'POST' ? cancelar(body) : no405
    if (seccion === 'chat' && n === 3 && a2 === 'contexto') return method === 'POST' ? desgloseContexto(body) : no405
    if (seccion === 'actividad' && n === 2) {
      if (method !== 'GET') return no405
      const act = oficinas.activa()
      if (!act) return [200, { agentes: {}, version: 0, avisos: [], entregasSinRevisar: 0, corridas: [], creadorVersion: 0, permisos: [] }]
      const r = runner.actividad.json(act.carpeta)
      r.avisos = avisos.pendientes(act.carpeta).map(avisoJSON)
      r.entregasSinRevisar = entregas.sinRevisar(act.carpeta)
      r.corridas = d.corridas?.(act.carpeta) ?? []
      r.creadorVersion = d.creadorVersion?.(act.carpeta) ?? 0
      r.teEsperan = d.charla?.()?.teEsperan(act.carpeta) ?? 0
      r.permisos = [...(d.mcp?.()?.permisos?.pendientes(act.carpeta) ?? []).map(pedidoJSON), ...(d.permisosTareas?.()?.pendientes(act.carpeta) ?? [])]
      return [200, r]
    }
    if (seccion === 'skills' && n === 2) {
      if (method !== 'GET') return no405
      // `GET /api/skills?actualizar=1` → {skills, mcp}: las skills instaladas (las que vio la última corrida); sin datos o con actualizar,
      // corre un claude mínimo para averiguarlas
      const act = oficinas.activa()
      let lista = runner.skills.lista
      if (lista === undefined || query.actualizar === '1') {
        try { lista = await runner.sondearSkills(act?.carpeta) } catch (e) {
          if (e instanceof ClaudeError) return [e.status, { error: e.mensaje }]
          throw e
        }
      }
      // los servidores MCP de Claude Code salen del mismo sondeo (y de cualquier corrida sin --strict-mcp-config)
      // las skills propias de los agentes (skills-propias.ts) no se eligen acá: van solas con su agente
      const propias = new Set(act ? SkillsPropias.listar(act.carpeta).map((x) => x.nombre) : [])
      return [200, { skills: (lista ?? []).filter((x) => !propias.has(x)), mcp: runner.mcpLocales.lista ?? [] }]
    }
    if (seccion === 'permisos' && n === 3) return method === 'POST' ? responderPermiso(a2!, body) : no405
    if (seccion === 'avisos' && n === 2) {
      if (method !== 'GET') return no405
      const act = oficinas.requerirActiva()
      return [200, { avisos: avisos.pendientes(act.carpeta).map(avisoJSON) }]
    }
    if (seccion === 'avisos' && n === 3 && a2 === 'visto') {
      if (method !== 'POST') return no405
      const act = oficinas.requerirActiva()
      const b = objeto(body)
      const n2 = avisos.vistos(act.carpeta, {
        id: typeof b.id === 'string' ? b.id : undefined,
        agente: b.todos === true ? undefined : typeof b.agente === 'string' ? b.agente : undefined,
      })
      return [200, { vistos: n2 }]
    }
    if (seccion === 'costos' && n === 2) {
      if (method !== 'GET') return no405
      const act = oficinas.requerirActiva()
      const desde = Number(query.desde)
      return [200, store.costos(act.carpeta, Number.isFinite(desde) ? desde : 0)]
    }
    return null
  }
}
