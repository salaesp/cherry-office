// Rutas del Creador (CreadorRouter.swift): `/api/creador/chat|estado|borrador|tarjetas/:id|aplicar`.
// El chat corre en segundo plano (el modo dev corta a los 120 s): responde 202 y el front sondea `estado` y `borrador`.
// Router «extra»: atiende antes que el núcleo. Este archivo también instala el módulo `creador` (orden 71).
import fs from 'node:fs'
import { ClaudeError } from './claude-runner.js'
import {
  AplicarBloqueado, Creador, CorridasCreador, TarjetasStore, VersionCreador, creadorDe, herramientasCreador, listaDe, mensajesConFecha,
  tarjetaJSON, type Estado,
} from './creador.js'
import { mcpDe } from './consultas.js'
import { iso } from './entregas.js'
import { ErrorAPI } from './errores.js'
import { esObjeto, maxBody, objeto, type Obj } from './json.js'
import { oficinaJSON, escribirAtomico } from './oficina.js'
import { argumentos, variableTokenMCP, type ContextoOficina } from './permisos.js'
import { creadorMD } from './plantillas.js'
import { aplicarEleccion, eleccionCharla } from './agentes.js'
import { atrapar, no405, type Query, type Resp, type SubRouter } from './router.js'
import { maxMensaje } from './rutas-chat.js'
import { agenteDeCharla } from './secretaria-creadora.js'
import { registrarModulo, type Servicios } from './servicios.js'
import { CajaCosto } from './stream.js'
import { largo, uuidValido } from './validar.js'

const esRuta = (p: string) => p === '/api/creador' || p.startsWith('/api/creador/')

/** El Creador solo lee (Read, Glob, Grep), no escribe en la oficina y no ve los conectores de la cuenta. */
export function contextoCreador(carpeta: string, mcpUrl: string | undefined): ContextoOficina {
  return {
    carpeta, escritura: [], dirsExtra: [], mcpUrl, herramientasBase: 'Read,Glob,Grep', herramientasMCP: Creador.nombresMCP,
    permitidas: [], vedadas: ['mcp__claude_ai_*'], perfilMCP: 'creador',
    // sus herramientas son las propias del Creador: la memoria y los colegas de la oficina no aplican
    memoria: 'completa', colegas: true,
  }
}

export class CreadorRouter implements SubRouter {
  /** Corridas de fondo en curso (para esperarlas al cerrar). */
  readonly enCurso = new Set<Promise<void>>()

  constructor(private readonly s: Servicios) {}

  async handle(method: string, path: string, query: Query, body?: Buffer) {
    if (!esRuta(path)) return null
    return atrapar(async () => this.despachar(method, path, query, body))
  }

  private async despachar(method: string, path: string, query: Query, body?: Buffer): Promise<Resp> {
    const partes = path.split('/').slice(1) // api, creador, ...
    if (partes.length < 3 || partes.includes('')) return [404, { error: 'no' }]
    switch (partes[2]) {
      case 'chat': return partes.length === 3 ? (method === 'POST' ? this.chat(body) : no405) : [404, { error: 'no' }]
      case 'estado': return partes.length === 3 ? (method === 'GET' ? this.estado(query) : no405) : [404, { error: 'no' }]
      case 'borrador': return partes.length === 3 ? (method === 'GET' ? this.borrador() : no405) : [404, { error: 'no' }]
      case 'aplicar': return partes.length === 3 ? (method === 'POST' ? this.aplicar(body) : no405) : [404, { error: 'no' }]
      case 'tarjetas':
        if (partes.length !== 4) return [404, { error: 'no' }]
        switch (method) {
          case 'PATCH': return this.editar(partes[3]!, body)
          case 'DELETE': return this.descartar(partes[3]!)
          default: return no405
        }
      default: return [404, { error: 'no' }]
    }
  }

  // MARK: chat

  private async chat(body?: Buffer): Promise<Resp> {
    const s = this.s
    const act = s.oficinas.requerirActiva()
    if (body && body.length > maxBody) throw new ErrorAPI(413, 'pedido demasiado grande')
    const d = objeto(body)
    if (typeof d.message !== 'string' || typeof d.session !== 'string') throw new ErrorAPI(400, 'pedido inválido')
    const msg = d.message.trim()
    if (msg === '' || largo(msg) > maxMensaje || !uuidValido(d.session)) throw new ErrorAPI(400, 'pedido inválido')
    const sid = d.session.toLowerCase()
    const carpeta = act.carpeta
    const eleccion = eleccionCharla(d)

    try {
      s.runner.verificar(carpeta)
    } catch (e) {
      if (e instanceof ClaudeError) {
        s.log.error(`creador tipo=${e.tipo}`)
        throw new ErrorAPI(500, e.mensaje)
      }
      throw e
    }
    const dueno = s.store.agenteDe(sid)
    if (dueno !== undefined && dueno !== Creador.idAgente) throw new ErrorAPI(400, 'pedido inválido')
    const of = s.store.oficinaDe(sid)
    if (of !== undefined && of !== carpeta) throw new ErrorAPI(400, 'pedido inválido')
    const { corridas } = creadorDe(s)
    if (!corridas.empezar(carpeta, sid)) throw new ErrorAPI(409, 'El Creador todavía está trabajando en tu mensaje anterior.')

    // el agente se regenera antes de cada corrida; el mensaje de la persona queda guardado antes de responder
    // (las herramientas comprueban las citas contra él)
    try {
      fs.mkdirSync(act.ruta('.claude/agents'), { recursive: true })
      escribirAtomico(creadorMD(act.oficina, s.config.modelo('creador')), act.ruta(`.claude/agents/${Creador.idAgente}.md`))
      s.store.asegurarSesion(sid, Creador.idAgente, carpeta)
      s.store.agregar(sid, 'u', msg)
    } catch {
      corridas.terminar(carpeta, sid)
      throw new ErrorAPI(500, 'No pude guardar la conversación.')
    }
    const mcpUrl = await s.mcp?.()?.url()
    const ctx = contextoCreador(carpeta, mcpUrl)
    aplicarEleccion(ctx, { modelo: eleccion.modelo, esfuerzo: eleccion.esfuerzo })
    const p: Promise<void> = this.correr(carpeta, sid, msg, ctx).catch(() => {}).finally(() => this.enCurso.delete(p))
    this.enCurso.add(p)
    s.log.info(`creador chat sid=${sid.slice(0, 8)} en segundo plano`)
    return [202, { ok: true, session: sid }]
  }

  /** La corrida de fondo: carril (oficina, creador), token de perfil creador, actividad «armando» y respuesta guardada como `a`. */
  private async correr(carpeta: string, sid: string, msg: string, ctx: ContextoOficina): Promise<void> {
    const s = this.s
    const { corridas, version } = creadorDe(s)
    const { store, runner, config } = s
    const mcp = s.mcp?.()
    const caja = new CajaCosto()
    try {
      const resultado = await runner.conCarrilDe(carpeta, Creador.idAgente, async (): Promise<{ texto?: string; error?: string }> => {
        const envExtra: Record<string, string> = {}
        if (ctx.mcpUrl !== undefined && mcp) envExtra[variableTokenMCP] = mcp.emitir({ oficina: carpeta, agente: Creador.idAgente, sid, perfil: 'creador' })
        try {
          if (ctx.mcpUrl === undefined) return { error: 'El servidor interno de la oficina no está disponible: el Creador no puede armar tarjetas.' }
          try {
            const activa = store.estaActiva(sid)
            const texto = await runner.actividad.seguir({ oficina: carpeta, agente: Creador.idAgente, origen: 'creador', tarea: 'Armando la oficina', extra: caja.observador() },
              (obs) => runner.ejecutarChat({ agente: Creador.idAgente, mensaje: msg, sid, activa, carpeta, obs, envExtra, armar: (p) => argumentos(config, ctx, p) }))
            try { store.marcarActiva(sid) } catch {}
            return { texto: texto === '' ? '(sin respuesta)' : texto }
          } catch (e) {
            if (e instanceof ClaudeError) return { error: e.mensaje }
            return { error: 'No pude responder.' }
          }
        } finally {
          const t = envExtra[variableTokenMCP]
          if (t !== undefined) mcp?.revocar(t)
        }
      })
      try {
        if (resultado.texto !== undefined) store.agregar(sid, 'a', resultado.texto)
        else store.agregar(sid, 'a', 'No pude responder: ' + (resultado.error ?? 'error'), true)
      } catch {}
      store.registrarCosto({ oficina: carpeta, agente: Creador.idAgente, origen: 'creador', ref: sid, costo: caja.valor })
    } finally {
      corridas.terminar(carpeta, sid)
      version.subir(carpeta)
    }
  }

  // MARK: estado y borrador

  private estado(query: Query): Resp {
    const act = this.s.oficinas.requerirActiva()
    const sidRaw = query.session
    if (sidRaw === undefined || !uuidValido(sidRaw)) throw new ErrorAPI(400, 'pedido inválido')
    const sid = sidRaw.toLowerCase()
    const { store } = this.s
    const { corridas, version } = creadorDe(this.s)
    let mensajes: Obj[] = []
    if (store.agenteDe(sid) === Creador.idAgente && store.oficinaDe(sid) === act.carpeta) {
      mensajes = mensajesConFecha(store, sid).map((m) => {
        const x: Obj = { rol: m.rol, texto: m.texto, ts: iso(m.ts) }
        if (m.error) x.error = true
        return x
      })
    }
    return [200, { corriendo: corridas.corriendo(act.carpeta, sid), mensajes, version: version.valor(act.carpeta) }]
  }

  private borrador(): Resp {
    const act = this.s.oficinas.requerirActiva()
    const { tarjetas, version } = creadorDe(this.s)
    const ts = tarjetas.lista(act.carpeta, ['borrador', 'lista', 'creada', 'error'])
    // las que propuso quien atiende la secretaría en una charla llevan de qué charla vienen (secretaria-creadora.ts)
    const json = ts.map((t) => {
      const x = tarjetaJSON(t)
      const agente = agenteDeCharla(this.s, t)
      if (agente !== undefined) { x.deCharla = agente; x.charla = t.sid }
      return x
    })
    return [200, { version: version.valor(act.carpeta), tarjetas: json, resumen: Creador.resumen(ts) }]
  }

  // MARK: tarjetas

  /** `{datos}`: se suman a los de la tarjeta (un `null` borra un campo), se revalida y se recalculan los faltantes.
   *  No comprueba la cita: la edición la hace la persona. */
  private editar(id: string, body?: Buffer): Resp {
    const act = this.s.oficinas.requerirActiva()
    const d = objeto(body)
    if (!esObjeto(d.datos)) throw new ErrorAPI(400, 'Falta «datos».')
    const t = creadorDe(this.s).tarjetas.una(act.carpeta, id)
    if (!t) throw new ErrorAPI(404, 'No existe esa tarjeta.')
    const nueva = Creador.armar(this.s, { carpeta: act.carpeta, sid: t.sid, tipo: t.tipo, ref: id, datos: d.datos })
    return [200, { tarjeta: tarjetaJSON(nueva) }]
  }

  private descartar(id: string): Resp {
    const act = this.s.oficinas.requerirActiva()
    const { tarjetas, version } = creadorDe(this.s)
    const t = tarjetas.una(act.carpeta, id)
    if (!t) throw new ErrorAPI(404, 'No existe esa tarjeta.')
    if (t.estado === 'creada') throw new ErrorAPI(409, 'Esa tarjeta ya se creó: no se puede descartar.')
    const g = tarjetas.estado(act.carpeta, id, 'descartada')
    if (!g) throw new ErrorAPI(500, 'No pude descartar la tarjeta.')
    version.subir(act.carpeta)
    return [200, { tarjeta: tarjetaJSON(g) }]
  }

  // MARK: aplicar

  private aplicar(body?: Buffer): Resp {
    const act = this.s.oficinas.requerirActiva()
    const d: Obj = !body || body.length === 0 ? {} : objeto(body)
    let ids: string[] | undefined
    if (d.ids !== undefined && d.ids !== null) {
      if (!Array.isArray(d.ids) || !d.ids.every((x) => typeof x === 'string')) throw new ErrorAPI(400, '«ids» tiene que ser una lista de ids de tarjetas.')
      ids = d.ids as string[]
    }
    const confirmar = d.confirmarQuitar === true
    try {
      const resultados = Creador.aplicar(this.s, act, ids, confirmar)
      const o = this.s.oficinas.activa()?.oficina
      return [200, { resultados, oficina: o ? oficinaJSON(o) : {} }]
    } catch (e) {
      if (!(e instanceof AplicarBloqueado)) throw e
      const faltan = e.tarjetas.map((t) => ({ id: t.id, tipo: t.tipo, faltantes: listaDe(t.faltantes) }))
      return [409, { error: 'Hay tarjetas en borrador: completá lo que falta antes de crearlas.', borradores: faltan }]
    }
  }
}

// MARK: - módulo

export function instalar(s: Servicios) {
  const est: Estado = { tarjetas: new TarjetasStore(s.store), version: new VersionCreador(), corridas: new CorridasCreador() }
  s.huecos.creador = est
  const router = new CreadorRouter(s)
  s.router.registrarExtra(router)
  mcpDe(s)?.registrarHerramientas(herramientasCreador, 'creador')
  s.creadorVersion = (oficina) => est.version.valor(oficina)
  s.despuesDeProcesos.push(async () => { await Promise.allSettled([...router.enCurso]) })
}

registrarModulo('creador', 71, instalar)
