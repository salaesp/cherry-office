// Acciones hacia afuera con aprobación de la persona (Acciones.swift + AccionesStore.swift): un agente PROPONE usar una
// herramienta de actuar de un conector (mandar un mail, crear un evento) y recién cuando la persona la aprueba se ejecuta,
// con el Programador y SOLO esa herramienta habilitada. `Acciones.actuar/herramientasMCP` (nombres) están en permisos.ts.
import { mcpDe, sanear } from './consultas.js'
import { iso } from './entregas.js'
import { ErrorAPI } from './errores.js'
import { jsonCompacto } from './json-swift.js'
import { esObjeto, type Obj } from './json.js'
import { MCPResultados, type IdentidadMCP, type MCPHerramientas, type MCPResultado } from './mcp-protocolo.js'
import { OficinaStore, type AgenteDef, type Oficina } from './oficina.js'
import type { OficinaActiva } from './oficinas.js'
import { Acciones as AccionesPermisos, TodosConectores, cortoHerramienta } from './permisos.js'
import { Programador, type Ejecucion } from './programador.js'
import type { Entrega } from './entregas.js'
import type { Servicios } from './servicios.js'
import { num, txt, type Fila, type SQLValor } from './sqlite.js'
import type { Store } from './store.js'
import { largo, prefijo } from './validar.js'

// MARK: - store

export type AccionPropuesta = {
  id: number
  oficina: string
  agente: string
  sid: string
  entrega?: number
  herramienta: string
  resumen: string
  /** Objeto JSON como texto. */
  detalle: string
  estado: string
  resultado?: string
  ejecucion?: number
  /** De dónde salió (objeto JSON como texto: de, por, cuando, cita), si el agente lo contó. */
  origen?: string
  /** Lo que ya comprobó el agente («miré tu calendario: ese horario está libre»), si lo contó. */
  nota?: string
  creada: number
  actualizada: number
}

export const estadosAccion = ['pendiente', 'ejecutando', 'hecha', 'error', 'descartada']

export function accionJSON(a: AccionPropuesta): Obj {
  let detalle: unknown = {}
  try { const d = JSON.parse(a.detalle); if (esObjeto(d)) detalle = d } catch {}
  let origen: unknown = null
  try { const d = a.origen ? JSON.parse(a.origen) : null; if (esObjeto(d)) origen = d } catch {}
  return {
    id: a.id, agente: a.agente, sid: a.sid, herramienta: a.herramienta, resumen: a.resumen, detalle, estado: a.estado,
    creada: iso(a.creada), actualizada: iso(a.actualizada),
    entrega: a.entrega ?? null, resultado: a.resultado ?? null, ejecucion: a.ejecucion ?? null,
    origen, nota: a.nota ?? null,
  }
}

const columnas = 'id,oficina,agente,sid,entrega,herramienta,resumen,detalle,estado,resultado,ejecucion,origen,nota,creada,actualizada'

function deFila(f: Fila): AccionPropuesta {
  const a: AccionPropuesta = {
    id: num(f.id), oficina: txt(f.oficina), agente: txt(f.agente), sid: txt(f.sid), herramienta: txt(f.herramienta),
    resumen: txt(f.resumen), detalle: txt(f.detalle), estado: txt(f.estado), creada: num(f.creada), actualizada: num(f.actualizada),
  }
  if (f.entrega !== null && f.entrega !== undefined) a.entrega = num(f.entrega)
  if (f.resultado !== null && f.resultado !== undefined) a.resultado = txt(f.resultado)
  if (f.ejecucion !== null && f.ejecucion !== undefined) a.ejecucion = num(f.ejecucion)
  if (f.origen !== null && f.origen !== undefined && txt(f.origen) !== '') a.origen = txt(f.origen)
  if (f.nota !== null && f.nota !== undefined && txt(f.nota) !== '') a.nota = txt(f.nota)
  return a
}

/** Tabla `acciones` (extensión de Store en Swift). */
export class AccionesStore {
  /** Acciones que se están aprobando ahora (evita que dos pedidos aprueben la misma). */
  readonly tomadas = new Set<string>()

  private columnasListas = false

  constructor(private readonly store: Store) { this.preparar() }

  preparar() {
    this.store.db.exec(`
    CREATE TABLE IF NOT EXISTS acciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, oficina TEXT NOT NULL, agente TEXT NOT NULL, sid TEXT NOT NULL,
      entrega INTEGER, herramienta TEXT NOT NULL, resumen TEXT NOT NULL, detalle TEXT NOT NULL DEFAULT '{}',
      estado TEXT NOT NULL,
      resultado TEXT, ejecucion INTEGER, creada REAL NOT NULL, actualizada REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS acciones_entrega ON acciones(entrega);
    `)
    if (this.columnasListas) return
    // origen y nota llegaron después: las bases viejas no las tienen
    const cols = this.store.db.query("SELECT name FROM pragma_table_info('acciones')").map((f) => txt(f.name))
    for (const c of ['origen', 'nota']) if (!cols.includes(c)) this.store.db.exec(`ALTER TABLE acciones ADD COLUMN ${c} TEXT`)
    this.columnasListas = true
  }

  crear(p: { oficina: string; agente: string; sid: string; herramienta: string; resumen: string; detalle: string; entrega?: number; origen?: string; nota?: string }): AccionPropuesta | undefined {
    try {
      this.preparar()
      const ahora = Date.now() / 1000
      this.store.db.run(`
        INSERT INTO acciones(oficina,agente,sid,entrega,herramienta,resumen,detalle,estado,origen,nota,creada,actualizada)
        VALUES(?,?,?,?,?,?,?,'pendiente',?,?,?,?)`,
      [p.oficina, p.agente, p.sid, p.entrega ?? null, p.herramienta, p.resumen, p.detalle, p.origen ?? null, p.nota ?? null, ahora, ahora])
      const id = num(this.store.db.query('SELECT last_insert_rowid() AS id')[0]?.id)
      return this.una(p.oficina, id)
    } catch {
      return undefined
    }
  }

  /** Ata la acción a la entrega que la propone. */
  vincular(id: number, entrega: number) {
    try {
      this.preparar()
      this.store.db.run('UPDATE acciones SET entrega=?, actualizada=? WHERE id=?', [entrega, Date.now() / 1000, id])
    } catch {}
  }

  una(oficina: string, id: number): AccionPropuesta | undefined {
    try {
      this.preparar()
      const f = this.store.db.query(`SELECT ${columnas} FROM acciones WHERE oficina=? AND id=?`, [oficina, id])[0]
      return f ? deFila(f) : undefined
    } catch {
      return undefined
    }
  }

  porEntrega(oficina: string, entrega: number): AccionPropuesta | undefined {
    try {
      this.preparar()
      const f = this.store.db.query(`SELECT ${columnas} FROM acciones WHERE oficina=? AND entrega=? ORDER BY id DESC LIMIT 1`, [oficina, entrega])[0]
      return f ? deFila(f) : undefined
    } catch {
      return undefined
    }
  }

  /** Las que propuso una sesión (por ejemplo, una revisión de la secretaría), en el orden en que las propuso. */
  porSid(oficina: string, sid: string): AccionPropuesta[] {
    try {
      this.preparar()
      return this.store.db.query(`SELECT ${columnas} FROM acciones WHERE oficina=? AND sid=? ORDER BY id`, [oficina, sid]).map(deFila)
    } catch {
      return []
    }
  }

  /** De la más nueva a la más vieja. */
  lista(oficina: string, estados?: string[]): AccionPropuesta[] {
    try {
      this.preparar()
      let sql = `SELECT ${columnas} FROM acciones WHERE oficina=?`
      const p: SQLValor[] = [oficina]
      if (estados) {
        if (estados.length === 0) return []
        sql += ` AND estado IN (${estados.map(() => '?').join(',')})`
        p.push(...estados)
      }
      sql += ' ORDER BY id DESC'
      return this.store.db.query(sql, p).map(deFila)
    } catch {
      return []
    }
  }

  actualizar(id: number, estado: string, resultado?: string, ejecucion?: number) {
    try {
      this.preparar()
      this.store.db.run('UPDATE acciones SET estado=?, resultado=COALESCE(?,resultado), ejecucion=COALESCE(?,ejecucion), actualizada=? WHERE id=?',
        [estado, resultado ?? null, ejecucion ?? null, Date.now() / 1000, id])
    } catch {}
  }
}

export const accionesDe = (s: Servicios) => s.huecos.acciones as AccionesStore

// MARK: - lógica

export const Acciones = {
  ...AccionesPermisos,
  /** Propuestas por corrida. */
  maxPorCorrida: 5,
  maxResumen: 300,
  maxDetalle: 8000,
  maxCita: 400,
  maxNota: 200,
  claveCupo: 'accion',

  /** El origen que cuenta el agente ({de, por, cuando, cita}) como JSON compacto, solo con los campos de texto que
   *  vinieron; undefined si no vino ninguno. */
  origenJSON(v: unknown): string | undefined {
    if (!esObjeto(v)) return undefined
    const o: Obj = {}
    for (const [k, max] of [['de', 80], ['por', 40], ['cuando', 40], ['cita', Acciones.maxCita]] as const) {
      const x = typeof v[k] === 'string' ? sanear(v[k]).trim().replace(/\s+/g, ' ') : ''
      if (x !== '') o[k] = largo(x) > max ? prefijo(x, max) : x
    }
    return Object.keys(o).length ? jsonCompacto(o) : undefined
  },

  /** `accion:<id>` -> id. */
  deAccion(tarea: string): number | undefined {
    if (!tarea.startsWith(Programador.prefijoAccion)) return undefined
    const t = tarea.slice(Programador.prefijoAccion.length)
    return /^[+-]?\d+$/.test(t) ? Number(t) : undefined
  },

  /** Engancha la ejecución de las acciones aprobadas al programador: al terminar bien, la acción queda hecha con su
   *  resultado; si falla, pasa a error. No deja una entrega aparte: la persona ya la pidió al aprobar, y el resultado se
   *  ve en la propia propuesta (y si falla, el programador deja su aviso). */
  instalar(s: Servicios, store: AccionesStore) {
    const prog = s.huecos.programador as Programador | undefined
    prog?.sinEntregar((tarea) => tarea.startsWith(Programador.prefijoAccion))
    prog?.alTerminar((ej) => {
      const id = Acciones.deAccion(ej.tarea)
      const ac = id === undefined ? undefined : store.una(ej.oficina, id)
      if (id === undefined || !ac) return
      if (ej.estado === 'ok') {
        if (ac.estado === 'ejecutando') store.actualizar(id, 'hecha', ej.resultado, ej.id)
      } else if (ac.estado === 'ejecutando' || ac.estado === 'hecha') {
        store.actualizar(id, 'error', ej.error ?? 'error', ej.id)
      }
    })
  },

  /** «Aprobar y ejecutar»: marca la entrega como revisada y la acción como ejecutando, y lanza el encargo con
   *  SOLO esa herramienta de actuar habilitada. */
  async ejecutar(s: Servicios, act: OficinaActiva, entrega: Entrega): Promise<Ejecucion> {
    const store = accionesDe(s)
    const ac = store.porEntrega(act.carpeta, entrega.id)
    if (!ac) throw new ErrorAPI(404, 'Esa entrega no tiene una acción para aprobar.')
    const clave = act.carpeta + '\u001f' + ac.id
    if (store.tomadas.has(clave)) throw new ErrorAPI(409, 'Esa acción ya se está ejecutando.')
    store.tomadas.add(clave)
    try {
      return await Acciones.ejecutarReservada(s, store, act, entrega, ac.id)
    } finally {
      store.tomadas.delete(clave)
    }
  },

  async ejecutarReservada(s: Servicios, store: AccionesStore, act: OficinaActiva, entrega: Entrega, id: number): Promise<Ejecucion> {
    const ac = store.una(act.carpeta, id)
    if (!ac || ac.estado !== 'pendiente') throw new ErrorAPI(409, 'Esa acción ya no está pendiente.')
    const def = act.oficina.agentes.find((a) => a.id === ac.agente)
    if (!def) throw new ErrorAPI(409, 'El agente que la propuso ya no está en la oficina.')
    if (!actuarDe(s, act.oficina, def).includes(ac.herramienta)) throw new ErrorAPI(409, 'El agente ya no tiene asignada esa herramienta para actuar.')
    const jefe = act.oficina.duenio.trim()
    const aprueba = jefe === '' ? 'La persona' : jefe
    // las reglas van como mensaje de sistema; en la charla queda solo la acción aprobada
    const sistema = `# Acción aprobada
${aprueba} aprobó la acción del mensaje. Ejecutá exactamente eso con la herramienta ${ac.herramienta} y esos argumentos, y no hagas nada más. Cuando termine, contá en una o dos frases qué hizo la herramienta.`
    const consigna = `Acción aprobada (${ac.herramienta}):

Resumen: ${ac.resumen}
Argumentos (JSON): ${ac.detalle}`
    const prog = s.huecos.programador as Programador | undefined
    if (!prog) throw new ErrorAPI(500, 'No pude ejecutar la acción.')
    s.entregas.marcar(act.carpeta, entrega.id, 'revisada')
    store.actualizar(id, 'ejecutando')
    try {
      return await prog.encargarLibre(act, def, { id: Programador.prefijoAccion + String(id), nombre: 'Acción aprobada: ' + ac.resumen, consigna, sistema, actuar: [ac.herramienta] })
    } catch (e) {
      store.actualizar(id, 'pendiente')
      s.entregas.marcar(act.carpeta, entrega.id, 'sin_revisar')
      throw e
    }
  },

  /** Objeto JSON como texto (o `{}` si no vino); undefined si no es un objeto o es demasiado grande. */
  detalleJSON(v: unknown): string | undefined {
    if (v === undefined || v === null) return '{}'
    let obj = v
    if (typeof v === 'string') {
      try { obj = JSON.parse(v) } catch { return undefined }
    }
    if (!esObjeto(obj)) return undefined
    const t = jsonCompacto(obj)
    return largo(t) <= Acciones.maxDetalle ? t : undefined
  },

  /** Una línea `clave: valor` por argumento, para leer en la entrega. */
  legible(detalle: string): string {
    let d: unknown
    try { d = JSON.parse(detalle) } catch { d = undefined }
    if (!esObjeto(d) || Object.keys(d).length === 0) return 'Sin argumentos.'
    return Object.keys(d).sort().map((k) => {
      const v = d[k]
      return typeof v === 'string' ? `${k}: ${v}` : `${k}: ${jsonCompacto(v)}`
    }).join('\n')
  },
}

// MARK: - herramienta MCP

/** `proponer_accion` atada a un token. */
export class HerramientasAcciones implements MCPHerramientas {
  constructor(private readonly s: Servicios, private readonly token: string, private readonly identidad: IdentidadMCP) {}

  get definiciones(): Obj[] {
    return [{
      name: 'proponer_accion',
      description: `Propone una acción que sale de la oficina (mandar un mail, crear un evento...) con una herramienta de conector que tenés asignada para actuar. NO la ejecuta: la persona la revisa y, si la aprueba, recién ahí se ejecuta. Máximo ${Acciones.maxPorCorrida} propuestas por mensaje.`,
      inputSchema: {
        type: 'object',
        properties: {
          herramienta: { type: 'string', description: 'nombre completo de la herramienta (mcp__claude_ai_...)' },
          resumen: { type: 'string', description: 'qué querés hacer, en una frase corta (hasta unos 70 caracteres): es el título que ve la persona en su bandeja; los detalles van en «detalle» y «nota»' },
          detalle: { type: 'object', description: 'los argumentos exactos con los que se llamaría a la herramienta' },
          origen: {
            type: 'object',
            description: 'de dónde sale la propuesta, si viene de un mensaje: se muestra citado para que la persona entienda por qué',
            properties: {
              de: { type: 'string', description: 'quién lo dijo o lo mandó («Mamá», «Federico Ríos»)' },
              por: { type: 'string', description: 'por dónde llegó («WhatsApp», «mail»)' },
              cuando: { type: 'string', description: 'cuándo, corto («hoy 9:41», «ayer 18:02»)' },
              cita: { type: 'string', description: 'la frase textual que lo motiva, corta' },
            },
          },
          nota: { type: 'string', description: 'lo que ya comprobaste, en una frase corta (por ejemplo «Miré tu calendario: ese horario está libre.»)' },
        },
        required: ['herramienta', 'resumen'],
      },
    }]
  }

  async llamar(nombre: string, argumentos: Obj): Promise<MCPResultado | undefined> {
    if (nombre !== 'proponer_accion') return undefined
    return this.proponer(argumentos)
  }

  private proponer(args: Obj): MCPResultado {
    const s = this.s
    let o
    try { o = OficinaStore.leer(this.identidad.oficina) } catch { return MCPResultados.error('No pude leer la oficina.') }
    const ag = o.agentes.find((a) => a.id === this.identidad.agente)
    if (!ag) return MCPResultados.error('No pude leer la oficina.')
    const h = (typeof args.herramienta === 'string' ? args.herramienta : '').trim()
    const asignadas = actuarDe(s, o, ag)
    if (h === '' || !asignadas.includes(h)) {
      return MCPResultados.error(`No tenés esa herramienta asignada para actuar. Las que podés proponer son: ${asignadas.join(', ')}.`)
    }
    let resumen = sanear(typeof args.resumen === 'string' ? args.resumen : '').trim()
    if (resumen === '') return MCPResultados.error('Falta «resumen»: contá en una frase qué querés hacer.')
    if (largo(resumen) > Acciones.maxResumen) resumen = prefijo(resumen, Acciones.maxResumen)
    const detalle = Acciones.detalleJSON(args.detalle)
    if (detalle === undefined) {
      return MCPResultados.error(`«detalle» tiene que ser un objeto con los argumentos de la herramienta (hasta ${Acciones.maxDetalle} caracteres).`)
    }
    const tokens = mcpDe(s)?.tokens
    if (tokens && !tokens.tomar(this.token, Acciones.claveCupo, Acciones.maxPorCorrida)) {
      return MCPResultados.error(`Ya propusiste ${Acciones.maxPorCorrida} acciones en este mensaje y no podés proponer más.`)
    }
    const origen = Acciones.origenJSON(args.origen)
    let nota = typeof args.nota === 'string' ? sanear(args.nota).trim() : ''
    if (largo(nota) > Acciones.maxNota) nota = prefijo(nota, Acciones.maxNota)
    const jefe = o.duenio.trim()
    const texto = resumen + `\n\nHerramienta: ${cortoHerramienta(h)}\n` + Acciones.legible(detalle)
    const e = s.entregas.registrar({
      oficina: this.identidad.oficina, agente: ag.id, nombre: ag.nombre, origen: 'propuesta', ref: this.identidad.sid,
      titulo: 'Propuesta: ' + resumen, texto, sid: this.identidad.sid,
    })
    if (!e) return MCPResultados.error('No pude guardar la propuesta.')
    const ac = accionesDe(s).crear({ oficina: this.identidad.oficina, agente: ag.id, sid: this.identidad.sid, herramienta: h, resumen, detalle, entrega: e.id, ...(origen ? { origen } : {}), ...(nota ? { nota } : {}) })
    if (!ac) return MCPResultados.error('No pude guardar la acción.')
    return MCPResultados.ok(`Propuesta #${ac.id} guardada: ${jefe === '' ? 'la persona' : jefe} la revisa y, si la aprueba, se ejecuta. Todavía no se hizo nada.`)
  }
}

/** Herramientas de actuar de un agente: las asignadas, o las de todos los conectores en modo «todos»; solo de los
 *  conectores que habilita la oficina. */
const actuarDe = (s: Servicios, o: Oficina, a: AgenteDef) => AccionesPermisos.actuar(TodosConectores.agente(s.config, a, s.catalogo?.(), o))

/** Solo si el agente del token tiene herramientas de actuar asignadas. */
export function herramientasAcciones(s: Servicios, token: string, identidad: IdentidadMCP): MCPHerramientas | undefined {
  let o
  try { o = OficinaStore.leer(identidad.oficina) } catch { return undefined }
  const a: AgenteDef | undefined = o.agentes.find((x) => x.id === identidad.agente)
  if (!a || actuarDe(s, o, a).length === 0) return undefined
  return new HerramientasAcciones(s, token, identidad)
}
