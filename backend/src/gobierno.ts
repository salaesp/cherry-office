// Rutas de reglas, conectores y acciones (GobiernoRouter.swift):
//   GET  /api/reglas · PUT /api/reglas                        → {reglas}
//   GET  /api/conectores · POST /api/conectores/actualizar    → {detectado, detectando, servidores}
//   GET  /api/acciones?entrega= | ?sid= | ?estado=            → {accion} | {acciones}
//   POST /api/entregas/:id/ejecutar | /descartar-accion       → {ejecucion} | {accion}
// Es un router «extra»: atiende antes que el de entregas (que sigue siendo dueño del resto de /api/entregas/*).
import { Acciones, accionJSON, accionesDe, AccionesStore, estadosAccion, herramientasAcciones } from './acciones.js'
import { CatalogoConectores, Conectores } from './conectores.js'
import { mcpDe } from './consultas.js'
import { ClaudeError } from './claude-runner.js'
import { ErrorAPI } from './errores.js'
import { esObjeto, objeto, type Obj } from './json.js'
import { ValidarReglas, reglaDesde, reglaJSON, type Regla } from './modelo-flujos.js'
import { ejecucionJSON } from './programador.js'
import { atrapar, no405, type Query, type Resp, type SubRouter } from './router.js'
import { registrarModulo, type Servicios } from './servicios.js'
import { Programacion } from './tareas.js'

export const maxBody = 200_000

/** Como `Int64(String)` de Swift: signo opcional y solo dígitos. */
function entero(t: string): number | undefined {
  if (!/^[+-]?\d+$/.test(t)) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

export class GobiernoRouter implements SubRouter {
  constructor(private readonly s: Servicios, private readonly catalogo: CatalogoConectores) {}

  async handle(method: string, path: string, query: Query, body?: Buffer) {
    const partes = path.split('/').slice(1)
    if (partes.length < 2 || partes[0] !== 'api' || partes.includes('')) return null
    return atrapar(async (): Promise<Resp | null> => {
      switch (partes[1]) {
        case 'reglas': return partes.length === 2 ? this.reglas(method, body) : null
        case 'conectores':
          if (partes.length === 2) return this.conectores(method)
          if (partes.length === 3 && partes[2] === 'actualizar') return this.actualizar(method)
          return null
        case 'acciones': return partes.length === 2 ? this.acciones(method, query) : null
        case 'entregas': {
          if (partes.length !== 4 || (partes[3] !== 'ejecutar' && partes[3] !== 'descartar-accion')) return null
          const id = entero(partes[2]!)
          if (id === undefined || id <= 0) return [404, { error: 'no' }]
          return this.entregaAccion(method, id, partes[3])
        }
        default: return null
      }
    })
  }

  // MARK: reglas

  private reglas(method: string, body?: Buffer): Resp {
    const { oficinas } = this.s
    switch (method) {
      case 'GET': {
        const a = oficinas.requerirActiva()
        return [200, { reglas: (a.oficina.reglas ?? []).map(reglaJSON) }]
      }
      case 'PUT': {
        const d = objeto(body, maxBody)
        if (!Array.isArray(d.reglas)) throw new ErrorAPI(400, '«reglas» tiene que ser una lista.')
        if (d.reglas.length > ValidarReglas.maxReglas) throw new ErrorAPI(400, `Máximo ${ValidarReglas.maxReglas} reglas.`)
        const nuevas = GobiernoRouter.armar(d.reglas)
        const [, a] = oficinas.modificar((o) => {
          if (nuevas.length === 0) delete o.reglas
          else o.reglas = nuevas
        })
        return [200, { reglas: (a.oficina.reglas ?? []).map(reglaJSON) }]
      }
      default:
        return no405
    }
  }

  /** Reglas desde el JSON: primero las que traen id (para que un id automático no choque con uno pedido más abajo),
   *  después las demás. */
  static armar(crudas: unknown[]): Regla[] {
    const dicts: Obj[] = []
    for (const x of crudas) {
      if (!esObjeto(x)) throw new ErrorAPI(400, 'Cada regla tiene que ser un objeto con «texto».')
      dicts.push(x)
    }
    const resultado: (Regla | undefined)[] = dicts.map(() => undefined)
    const usados = new Set<string>()
    dicts.forEach((d, i) => {
      if (typeof d.id === 'string' && d.id.trim() !== '') {
        const r = reglaDesde(d, usados)
        usados.add(r.id)
        resultado[i] = r
      }
    })
    dicts.forEach((d, i) => {
      if (resultado[i] === undefined) {
        const r = reglaDesde(d, usados)
        usados.add(r.id)
        resultado[i] = r
      }
    })
    return resultado.filter((r): r is Regla => r !== undefined)
  }

  // MARK: conectores

  private vistaConectores(error?: string): Obj {
    const lista = this.catalogo.servidores() ?? []
    const det = this.catalogo.detectado()
    const o: Obj = {
      detectado: det ? Programacion.iso(det) : null,
      detectando: this.catalogo.detectando,
      servidores: lista.map((s) => ({
        nombre: s.nombre, prefijo: s.prefijo, estado: s.estado, disponible: s.estado === 'connected',
        herramientas: s.herramientas.map((h) => {
          const c = Conectores.corto(h)
          return { nombre: h, corto: c, tipo: Conectores.clasificar(c) }
        }),
      })),
    }
    if (error !== undefined) o.error = error
    return o
  }

  private conectores(method: string): Resp {
    if (method !== 'GET') return no405
    // la primera vez que alguien mira, se detecta una vez en segundo plano (nunca al arrancar el backend)
    if (this.catalogo.pedirDeteccionInicial()) {
      const c = this.catalogo
      void Conectores.detectar(this.s, c).catch(() => {}).finally(() => c.terminarDeteccion())
    }
    return [200, this.vistaConectores()]
  }

  private async actualizar(method: string): Promise<Resp> {
    if (method !== 'POST') return no405
    if (!this.catalogo.empezarDeteccion()) return [200, this.vistaConectores()]
    let fallo: string | undefined
    try {
      await Conectores.detectar(this.s, this.catalogo)
    } catch (e) {
      fallo = e instanceof ClaudeError ? e.mensaje : 'No pude detectar los conectores.'
    }
    this.catalogo.terminarDeteccion()
    return [200, this.vistaConectores(fallo)]
  }

  // MARK: acciones

  private acciones(method: string, q: Query): Resp {
    if (method !== 'GET') return no405
    const a = this.s.oficinas.requerirActiva()
    const store = accionesDe(this.s)
    if (q.entrega !== undefined && q.entrega !== '') {
      const id = entero(q.entrega)
      if (id === undefined || id <= 0) throw new ErrorAPI(400, '«entrega» tiene que ser un número.')
      const ac = store.porEntrega(a.carpeta, id)
      return [200, { accion: ac ? accionJSON(ac) : null }]
    }
    if (q.sid !== undefined && q.sid !== '') return [200, { acciones: store.porSid(a.carpeta, q.sid).map(accionJSON) }]
    let estados: string[] | undefined
    if (q.estado !== undefined && q.estado !== '' && q.estado !== 'todas') {
      const l = q.estado.split(',').filter((x) => x !== '').map((x) => x.trim())
      if (l.length === 0 || !l.every((x) => estadosAccion.includes(x))) throw new ErrorAPI(400, `«estado» tiene que ser ${estadosAccion.join(', ')}.`)
      estados = l
    }
    return [200, { acciones: store.lista(a.carpeta, estados).map(accionJSON) }]
  }

  // MARK: ejecutar y descartar

  private async entregaAccion(method: string, id: number, que: string): Promise<Resp> {
    if (method !== 'POST') return no405
    const a = this.s.oficinas.requerirActiva()
    const e = this.s.entregas.una(a.carpeta, id)
    if (!e) throw new ErrorAPI(404, 'No existe esa entrega.')
    if (que === 'ejecutar') {
      const ej = await Acciones.ejecutar(this.s, a, e)
      return [202, { ejecucion: ejecucionJSON(ej) }]
    }
    const store = accionesDe(this.s)
    const ac = store.porEntrega(a.carpeta, id)
    if (!ac) throw new ErrorAPI(404, 'Esa entrega no tiene una acción.')
    if (ac.estado !== 'pendiente') throw new ErrorAPI(409, 'Esa acción ya no está pendiente.')
    store.actualizar(ac.id, 'descartada')
    this.s.entregas.marcar(a.carpeta, id, 'revisada')
    const n = store.una(a.carpeta, ac.id)
    if (!n) throw new ErrorAPI(500, 'No pude guardar.')
    return [200, { accion: accionJSON(n) }]
  }
}

// MARK: - módulo

export function instalar(s: Servicios) {
  const catalogo = new CatalogoConectores()
  s.huecos.catalogo = catalogo
  s.catalogo = () => {
    // en modo «todos los conectores» la primera corrida que lo necesita dispara la detección (en segundo plano)
    if (s.config.conectoresAgentes === 'todos' && catalogo.pedirDeteccionInicial()) {
      void Conectores.detectar(s, catalogo).catch(() => {}).finally(() => catalogo.terminarDeteccion())
    }
    return catalogo.servidores()
  }
  const store = new AccionesStore(s.store)
  s.huecos.acciones = store
  Acciones.instalar(s, store)
  mcpDe(s)?.registrarHerramientas(herramientasAcciones)
  s.router.registrarExtra(new GobiernoRouter(s, catalogo))
}

registrarModulo('gobierno', 72, instalar)
