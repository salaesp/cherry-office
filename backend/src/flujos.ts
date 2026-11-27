// Flujos (FlujosRouter.swift + el cableado de Backend.swift): rutas /api/flujos*, motor de corridas, avisos «te necesita»
// y resumen para /api/actividad.
//   GET/POST   /api/flujos                                 → {flujos:[… + sinAsignar]} · {flujo}
//   GET/PATCH/DELETE /api/flujos/:id                       → {flujo} · {flujo} · {ok}
//   POST       /api/flujos/:id/correr                      → {corrida}
//   GET        /api/flujos/corridas?estado=&flujo=&entrega=&limite=
//   GET        /api/flujos/corridas/:id                    → {corrida, pasos}
//   POST       /api/flujos/corridas/:id/hecho|reintentar|saltar|cancelar|volver → {corrida}
// `siguiente` (id de otro flujo, en POST/PATCH; `null` lo saca): al terminar una corrida, arranca una del otro flujo con la
// última entrega como contexto y sus archivos como adjuntos. Cancelada o trabada no sigue; si el otro está pausado o ya no
// existe, deja un aviso. Se valida que exista, que no sea el mismo y que no haya círculos.
import './coordinador.js'
import { consultasDe } from './consultas.js'
import {
  CorridasStore, corridaJSON, corridasAbiertas, pasoJSON, resumenPaso, type Corrida,
} from './corridas-store.js'
import { Adjuntos } from './adjuntos.js'
import { ErrorAPI } from './errores.js'
import { entregasRouterDe } from './rutas-entregas.js'
import { esObjeto, type Obj } from './json.js'
import { LecturaAPI, ValidarFlujos, ValidarReglas, flujoDesde, flujoJSON, pasoJSON as defPasoJSON, type FlujoDef, type PasoFlujo } from './modelo-flujos.js'
import { MotorFlujos, defDeCorrida } from './motor-flujos.js'
import type { Oficina } from './oficina.js'
import type { OficinaActiva } from './oficinas.js'
import { programadorDe, Programador } from './programador.js'
import { atrapar, no404, no405, type Query, type Resp, type SubRouter } from './router.js'
import { registrarModulo, type Servicios } from './servicios.js'
import { Programacion } from './tareas.js'
import { Validar, prefijo } from './validar.js'

export const maxBody = 200_000
export const maxArchivos = 10
/** Un archivo de 25 MB en base64 pesa 4/3; el resto es la nota y el armazón. */
export const maxBodyHecho = (Math.floor((MotorFlujos.maxArchivo * 4) / 3) + 1000) * maxArchivos + 100_000
const ocupados = new Set(['corridas'])

/** Como `Int64(String)` de Swift: signo opcional y solo dígitos. */
function entero(t: string): number | undefined {
  if (!/^[+-]?\d+$/.test(t)) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** Cuerpo JSON objeto; todo problema es 400 «pedido inválido». */
function objeto(body: Buffer | undefined, max = maxBody): Obj {
  if (!body || body.length === 0 || body.length > max) throw new ErrorAPI(400, 'pedido inválido')
  let d: unknown
  try { d = JSON.parse(body.toString('utf8')) } catch { throw new ErrorAPI(400, 'pedido inválido') }
  if (!esObjeto(d)) throw new ErrorAPI(400, 'pedido inválido')
  return d
}

/** Base64 como `Data(base64Encoded:options:.ignoreUnknownCharacters)`: salta lo que no es del alfabeto y exige el relleno. */
function base64(t: string): Buffer | undefined {
  const limpio = t.replace(/[^A-Za-z0-9+/=]/g, '')
  if (limpio.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(limpio)) return undefined
  return Buffer.from(limpio, 'base64')
}

/** Ids de pasos cuyo agente ya no está en la oficina. */
const sinAsignar = (pasos: PasoFlujo[], o: Oficina) => pasos.filter((p) => p.quien !== 'persona' && !o.agentes.some((a) => a.id === p.quien)).map((p) => p.id)

/** Al crear o editar, el flujo con el que sigue tiene que existir (después puede dejar de existir: el motor avisa). */
function existeSiguiente(f: FlujoDef, o: Oficina) {
  if (f.siguiente !== undefined && !(o.flujos ?? []).some((x) => x.id === f.siguiente)) {
    throw new ErrorAPI(400, `No existe el flujo «${f.siguiente}» con el que seguir.`)
  }
}

function vista(f: FlujoDef, o: Oficina): Obj {
  const j = flujoJSON(f)
  j.sinAsignar = sinAsignar(f.pasos, o)
  return j
}

export class FlujosRouter implements SubRouter {
  constructor(private readonly s: Servicios, readonly motor: MotorFlujos) {}

  private get store(): CorridasStore { return this.motor.store }

  static esRuta = (p: string) => p === '/api/flujos' || p.startsWith('/api/flujos/')

  async handle(method: string, path: string, query: Query, body?: Buffer) {
    if (!FlujosRouter.esRuta(path)) return null
    return atrapar(() => this.despachar(method, path, query, body))
  }

  private async despachar(method: string, path: string, query: Query, body?: Buffer): Promise<Resp> {
    const partes = path.split('/').slice(1)
    if (partes.length < 2 || partes.length > 5 || partes.includes('')) return no404
    const act = this.s.oficinas.requerirActiva()
    if (partes.length === 2) {
      switch (method) {
        case 'GET': return [200, { flujos: (act.oficina.flujos ?? []).map((f) => vista(f, act.oficina)) }]
        case 'POST': return this.crear(body)
        default: return no405
      }
    }
    if (partes[2] === 'corridas') {
      switch (partes.length) {
        case 3: return method === 'GET' ? this.listarCorridas(act, query) : no405
        case 4: {
          if (method !== 'GET') return no405
          return this.detalle(act, idCorrida(partes[3]!))
        }
        default: {
          if (method !== 'POST') return no405
          return this.accion(act, idCorrida(partes[3]!), partes[4]!, body)
        }
      }
    }
    const id = partes[2]!
    if (partes.length === 3) {
      switch (method) {
        case 'GET': {
          const f = act.oficina.flujos?.find((x) => x.id === id)
          if (!f) throw new ErrorAPI(404, 'No existe ese flujo.')
          return [200, { flujo: vista(f, act.oficina) }]
        }
        case 'PATCH': return this.editar(id, body)
        case 'DELETE': return this.borrar(id)
        default: return no405
      }
    }
    if (partes.length === 4 && partes[3] === 'correr') return method === 'POST' ? this.correr(act, id, body) : no405
    return no404
  }

  // MARK: lectura

  private listarCorridas(act: OficinaActiva, q: Query): Resp {
    const filtro = (k: string) => (q[k] === undefined || q[k] === '' ? undefined : q[k])
    let estados: string[] | undefined
    switch (filtro('estado') ?? 'abiertas') {
      case 'abiertas': estados = corridasAbiertas; break
      case 'terminadas': estados = ['terminada', 'cancelada']; break
      case 'todas': estados = undefined; break
      default: throw new ErrorAPI(400, '«estado» tiene que ser abiertas, terminadas o todas.')
    }
    const limite = q.limite === undefined ? 100 : (entero(q.limite) ?? 100)
    let lista: Corrida[]
    const e = filtro('entrega')
    if (e !== undefined) {
      const id = entero(e)
      if (id === undefined) throw new ErrorAPI(400, '«entrega» tiene que ser un número.')
      lista = []
      const cid = this.corridaDeEntrega(act, id)
      const c = cid === undefined ? undefined : this.store.corrida(act.carpeta, cid)
      if (c && (estados?.includes(c.estado) ?? true) && (filtro('flujo') === undefined || filtro('flujo') === c.flujo)) lista = [c]
    } else {
      lista = this.store.corridas(act.carpeta, { estados, flujo: filtro('flujo'), limite })
    }
    return [200, {
      corridas: lista.map((c) => {
        const j = corridaJSON(c)
        const p = this.store.pasoVigente(c.id)
        j.pasoEstado = p?.estado ?? null
        j.entrega = p?.entrega ?? null
        return j
      }),
    }]
  }

  /** La corrida de una entrega: la vigente de un paso, o una versión anterior (se sube por `padre` hasta la original). */
  private corridaDeEntrega(act: OficinaActiva, id: number): number | undefined {
    let actual: number | undefined = id
    for (let vueltas = 0; actual !== undefined && vueltas < 20; vueltas++) {
      const p = this.store.pasoPorEntrega(actual)
      if (p) return p.corrida
      const e = this.s.entregas.una(act.carpeta, actual)
      if (!e) return undefined
      const d = Programador.deFlujo(e.ref)
      if (d) return d[0]
      actual = e.padre
    }
    return undefined
  }

  private detalle(act: OficinaActiva, id: number): Resp {
    const c = this.store.corrida(act.carpeta, id)
    if (!c) throw new ErrorAPI(404, 'No existe esa corrida.')
    const intentos = this.store.pasosDe(id)
    const defPasos = defDeCorrida(c)?.pasos ?? []
    const prog = programadorDe(this.s)
    const nombre = (x: string) => act.oficina.agentes.find((a) => a.id === x)?.nombre ?? x
    const pasos = defPasos.map((pf, i) => {
      const lista = intentos.filter((p) => p.paso === i).map((p) => {
        const j = pasoJSON(p)
        const e = p.entrega === undefined ? undefined : this.s.entregas.una(act.carpeta, p.entrega)
        j.entrega = e ? { id: e.id, titulo: e.titulo, estado: e.estado } : null
        // la conversación del intento (está desde que arranca: el pedido se guarda antes de correr) y sus consultas a colegas
        const ej = p.ejecucion === undefined ? undefined : prog?.ejecuciones.una(p.ejecucion)
        if (ej) {
          j.sid = ej.sid
          j.agente = ej.agente
          j.ejecucionEstado = ej.estado
          if (ej.costo !== undefined) j.costoEjecucion = ej.costo
          const cons = consultasDe(this.s.store, act.carpeta, ej.sid)
          if (cons.length > 0) {
            j.consultas = cons.map((f) => {
              const d: Obj = { a: f.a, aNombre: nombre(f.a), pregunta: prefijo(f.pregunta, 400), ts: f.ts }
              if (f.respuesta !== undefined) d.respuesta = prefijo(f.respuesta, 600)
              if (f.error !== undefined) d.error = f.error
              return d
            })
          }
        }
        return j
      })
      return {
        indice: i, def: defPasoJSON(pf), sinAsignar: pf.quien !== 'persona' && !act.oficina.agentes.some((a) => a.id === pf.quien),
        intentos: lista,
      }
    })
    return [200, { corrida: corridaJSON(c), pasos }]
  }

  // MARK: definiciones

  private crear(body?: Buffer): Resp {
    const d = objeto(body)
    const [f] = this.s.oficinas.modificar((o) => {
      const usados = new Set([...(o.flujos ?? []).map((x) => x.id), ...ocupados])
      const f = flujoDesde(d, usados)
      existeSiguiente(f, o)
      f.creado = f.creado ?? Programacion.iso(new Date())
      o.flujos = [...(o.flujos ?? []), f]
      return f
    })
    return [200, { flujo: flujoJSON(f) }]
  }

  private editar(id: string, body?: Buffer): Resp {
    const d = objeto(body)
    const [f, act] = this.s.oficinas.modificar((o) => {
      const i = o.flujos?.findIndex((x) => x.id === id) ?? -1
      if (i < 0) throw new ErrorAPI(404, 'No existe ese flujo.')
      const mezcla = flujoJSON(o.flujos![i]!)
      for (const k of ['nombre', 'descripcion', 'pasos', 'activo', 'origen', 'siguiente', 'disparadores', 'datos']) if (d[k] !== undefined) mezcla[k] = d[k]
      mezcla.id = id
      const otros = new Set(o.flujos!.map((x) => x.id))
      otros.delete(id)
      const nuevo = flujoDesde(mezcla, otros)
      existeSiguiente(nuevo, o)
      o.flujos![i] = nuevo
      return nuevo
    })
    return [200, { flujo: vista(f, act.oficina) }]
  }

  private borrar(id: string): Resp {
    this.s.oficinas.modificar((o) => {
      const i = o.flujos?.findIndex((x) => x.id === id) ?? -1
      if (i < 0) throw new ErrorAPI(404, 'No existe ese flujo.')
      o.flujos!.splice(i, 1)
      // los que seguían con este quedan sin siguiente (si no, la oficina dejaría de validar)
      for (const x of o.flujos!) if (x.siguiente === id) delete x.siguiente
      if (o.flujos!.length === 0) delete o.flujos
    })
    return [200, { ok: true }]
  }

  // MARK: corridas

  private async correr(act: OficinaActiva, id: string, body?: Buffer): Promise<Resp> {
    const f = act.oficina.flujos?.find((x) => x.id === id)
    if (!f) throw new ErrorAPI(404, 'No existe ese flujo.')
    if (!f.activo) throw new ErrorAPI(409, 'Ese flujo está pausado.')
    const d = objeto(body, Adjuntos.maxBody)
    if ((body?.length ?? 0) > maxBody && d.archivos === undefined) throw new ErrorAPI(400, 'pedido inválido')
    const nombre = Validar.texto(d.nombre, 'nombre', MotorFlujos.maxNombre)!
    const contexto = Validar.texto(d.contexto, 'contexto', MotorFlujos.maxContexto, false) ?? ''
    const archivos = Adjuntos.leer(d.archivos)
    const adjuntos = Adjuntos.guardar(act, `flujos/${f.id}`, archivos)
    const c = await this.motor.iniciar(act, f, nombre, contexto, adjuntos)
    return [200, { corrida: corridaJSON(c) }]
  }

  private async accion(act: OficinaActiva, id: number, nombre: string, body?: Buffer): Promise<Resp> {
    switch (nombre) {
      case 'hecho': {
        const d = body === undefined || body.length === 0 ? {} : objeto(body, maxBodyHecho)
        const nota = Validar.texto(d.nota, 'nota', MotorFlujos.maxNota, false)
        const archivos: { nombre: string; datos: Buffer }[] = []
        const crudos = d.archivos
        if (crudos !== undefined && crudos !== null) {
          if (!Array.isArray(crudos) || !crudos.every(esObjeto)) throw new ErrorAPI(400, '«archivos» tiene que ser una lista.')
          if (crudos.length > maxArchivos) throw new ErrorAPI(400, `Máximo ${maxArchivos} archivos por vez.`)
          for (const a of crudos as Obj[]) {
            const n = Validar.texto(a.nombre, 'nombre del archivo', MotorFlujos.maxNombreArchivo)!
            let b64 = typeof a.base64 === 'string' ? a.base64 : ''
            if (b64 === '') throw new ErrorAPI(400, `Falta el contenido de «${n}» (base64).`)
            if (b64.startsWith('data:')) {
              const i = b64.indexOf(',')
              if (i >= 0) b64 = b64.slice(i + 1)
            }
            if (Buffer.byteLength(b64) > Math.floor((MotorFlujos.maxArchivo * 4) / 3) + 8) {
              throw new ErrorAPI(413, `«${n}» es demasiado grande (el máximo es ${MotorFlujos.maxArchivo / 1_048_576} MB).`)
            }
            const datos = base64(b64)
            if (!datos) throw new ErrorAPI(400, `El contenido de «${n}» no es base64 válido.`)
            archivos.push({ nombre: n, datos })
          }
        }
        return [200, { corrida: corridaJSON(await this.motor.hecho(act, id, nota, archivos)) }]
      }
      case 'reintentar': return [200, { corrida: corridaJSON(await this.motor.reintentar(act, id)) }]
      case 'saltar': return [200, { corrida: corridaJSON(await this.motor.saltar(act, id)) }]
      case 'cancelar': return [200, { corrida: corridaJSON(this.motor.cancelar(act, id)) }]
      case 'volver': {
        const d = objeto(body)
        const paso = LecturaAPI.entero(d.paso, 'paso')
        if (paso === undefined) throw new ErrorAPI(400, 'Falta «paso».')
        const nota = Validar.texto(d.nota, 'nota', MotorFlujos.maxNota, false)
        return [200, { corrida: corridaJSON(await this.motor.volver(act, id, paso, nota)) }]
      }
      default:
        return no404
    }
  }
}

function idCorrida(s: string): number {
  const n = entero(s)
  if (n === undefined || n <= 0) throw new ErrorAPI(404, 'No existe esa corrida.')
  return n
}

// MARK: - módulo

/** El motor de flujos (undefined hasta que se instala el módulo). */
export const motorDe = (s: Servicios) => s.huecos.motor as MotorFlujos | undefined

export function instalar(s: Servicios) {
  const store = new CorridasStore(s.store.db)
  const motor = new MotorFlujos(s, store)
  s.huecos.corridasStore = store
  s.huecos.motor = motor
  s.router.registrarExtra(new FlujosRouter(s, motor))
  s.validaciones.push((o) => ValidarFlujos.validar(o), (o) => ValidarReglas.validar(o))

  // corridas de flujos que esperan a la persona y todavía no vio («te necesita»)
  s.avisos.fuentes.push((_st, oficina) => store.corridasEsperandoPersona(oficina).map((c) => ({
    id: `flujo:${c.id}`, tipo: 'flujo', agente: '', texto: `«${c.nombre}» te necesita: ${resumenPaso(c).nombre}`, ref: String(c.id), creado: c.actualizada,
  })))
  s.avisos.marcarCorridaVista = (oficina, id) => store.corridaVista(oficina, id)
  s.corridas = (oficina) => motor.resumenActividad(oficina)

  // revisar la entrega vigente de un paso con aprobación hace avanzar la corrida
  entregasRouterDe(s).alRevisar.push((e, act) => motor.revisada(e, act))
  const prog = programadorDe(s)
  prog?.alTerminar((ej) => motor.alTerminar(ej))
  prog?.alEntregar((e, ej) => motor.alEntregar(e, ej))

  s.alArrancar.push(() => motor.preparar())
  s.alCerrar.unshift(() => motor.detener())
}

registrarModulo('flujos', 70, instalar)
