// Programador de tareas (Programador.swift) y rutas /api/tareas* (TareasRouter.swift).
//
// Cada 30 s mira las tareas de la oficina activa y corre las que tocan, cada una como un chat del agente (carril, permisos
// y costo normales) en una sesión nueva. El estado vive en SQLite (`ejecuciones`). También corre los «encargos» (pendientes
// de reunión, pasos de flujo, acciones, coordinador, parte) y los «pedir cambios» de las entregas.
import { randomUUID } from 'node:crypto'
import { Adjuntos, type Adjunto } from './adjuntos.js'
import { aplicarEleccion, eleccionCharla } from './agentes.js'
import { ClaudeError } from './claude-runner.js'
import { ErrorAPI } from './errores.js'
import { ArchivosEntrega, iso, type Entrega } from './entregas.js'
import { esObjeto, objeto, type Obj } from './json.js'
import type { AgenteDef } from './oficina.js'
import type { OficinaActiva } from './oficinas.js'
import { argumentos, contexto, entorno, variableTokenMCP } from './permisos.js'
import {
  PermisosTareasDB, mensajeContinuar, pedidoTareaJSON, pedidosDe, reglasUnaVez, type EsperaPermiso, type PedidoTarea,
} from './permisos-tareas.js'
import type { DecisionPermiso } from './permisos-vivos.js'
import type { Denegacion } from './claude-runner.js'
import type { ProgramadorEntregas } from './rutas-entregas.js'
import { atrapar, no404, no405, type Query, type Resp, type SubRouter } from './router.js'
import { registrarModulo, type Servicios } from './servicios.js'
import { num, txt, type Fila, type SQLiteDB } from './sqlite.js'
import { CajaArchivos, CajaCosto } from './stream.js'
import {
  Programacion, ValidarTareas, esUnica, type IATarea, fechaInicio, mensajeTarea, tareaJSON, zonaDelSistema, type OrigenTarea, type TareaProgramada,
} from './tareas.js'
import { Slug, Validar, largo, prefijo } from './validar.js'

// MARK: - ejecución (una corrida de una tarea)

/** Lo que entregó la ejecución anterior de una tarea repetida, recortado, para las instrucciones de la siguiente. */
export const maxVezAnterior = 1500
export function vezAnterior(e: Ejecucion): string {
  const cuando = new Date((e.fin ?? e.inicio) * 1000).toISOString().slice(0, 16).replace('T', ' ')
  const r = e.resultado.trim()
  return `# La vez anterior\nEsta tarea ya corrió (${cuando} UTC) y respondiste esto${largo(r) > maxVezAnterior ? ' (recortado)' : ''}. Usalo para seguir desde ahí y no repetir; no hace falta rehacer lo que ya estaba:\n${prefijo(r, maxVezAnterior)}`
}

export type Ejecucion = {
  id: number
  oficina: string
  tarea: string
  agente: string
  /** Horario programado que se cumple (epoch en segundos). En una corrida manual es el instante de inicio. */
  programada: number
  inicio: number
  fin?: number
  /** corriendo | esperando_permiso | ok | error */
  estado: string
  /** Sesión de chat donde quedó el pedido y la respuesta. */
  sid: string
  /** Respuesta del agente, recortada. */
  resultado: string
  error?: string
  costo?: number
  /** «Probar ahora»: no cuenta como la corrida programada de ese día. */
  manual: boolean
}

export function ejecucionJSON(e: Ejecucion): Obj {
  return {
    id: e.id, tarea: e.tarea, agente: e.agente, programada: iso(e.programada), inicio: iso(e.inicio), estado: e.estado, sid: e.sid,
    resultado: e.resultado, manual: e.manual, fin: e.fin === undefined ? null : iso(e.fin), error: e.error ?? null, costo: e.costo ?? null,
  }
}

// MARK: - SQLite (tabla `ejecuciones`, con clave de oficina)

export const maxResultado = 2000
const columnas = 'id,oficina,tarea,agente,programada,inicio,fin,estado,sid,resultado,error,costo,manual'

function deFila(f: Fila): Ejecucion {
  const e: Ejecucion = {
    id: num(f.id), oficina: txt(f.oficina), tarea: txt(f.tarea), agente: txt(f.agente), programada: num(f.programada), inicio: num(f.inicio),
    estado: txt(f.estado), sid: txt(f.sid), resultado: txt(f.resultado), manual: num(f.manual) !== 0,
  }
  if (f.fin !== null && f.fin !== undefined) e.fin = num(f.fin)
  if (f.error !== null && f.error !== undefined) e.error = txt(f.error)
  if (f.costo !== null && f.costo !== undefined) e.costo = num(f.costo)
  return e
}

/** Acceso a la tabla `ejecuciones` (extensión de Store en Swift). */
export class Ejecuciones {
  constructor(private readonly db: SQLiteDB) {}

  /** Crea la tabla si falta y pasa a `error` las ejecuciones que quedaron «corriendo» (la app se cerró en el medio). */
  preparar() {
    this.db.exec(`
    CREATE TABLE IF NOT EXISTS ejecuciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        oficina TEXT NOT NULL,
        tarea TEXT NOT NULL,
        agente TEXT NOT NULL,
        programada REAL NOT NULL,
        inicio REAL NOT NULL,
        fin REAL,
        estado TEXT NOT NULL,
        sid TEXT NOT NULL DEFAULT '',
        resultado TEXT NOT NULL DEFAULT '',
        error TEXT,
        costo REAL,
        manual INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS ejecuciones_tarea ON ejecuciones(oficina, tarea, id);
    CREATE INDEX IF NOT EXISTS ejecuciones_sid ON ejecuciones(sid);
    `)
    this.db.run("UPDATE ejecuciones SET estado='error', error=?, fin=? WHERE estado='corriendo'",
      ['Interrumpida: la app se cerró mientras corría.', Date.now() / 1000])
  }

  nueva(p: { oficina: string; tarea: string; agente: string; programada: number; inicio: number; sid: string; manual: boolean }): number {
    this.db.run("INSERT INTO ejecuciones(oficina,tarea,agente,programada,inicio,estado,sid,manual) VALUES(?,?,?,?,?,'corriendo',?,?)",
      [p.oficina, p.tarea, p.agente, p.programada, p.inicio, p.sid, p.manual ? 1 : 0])
    return num(this.db.query('SELECT last_insert_rowid() AS id')[0]?.id)
  }

  terminar(id: number, estado: string, resultado: string, error: string | undefined, costo: number | undefined) {
    this.db.run('UPDATE ejecuciones SET estado=?, fin=?, resultado=?, error=?, costo=? WHERE id=?',
      [estado, Date.now() / 1000, prefijo(resultado, maxResultado), error ?? null, costo ?? null, id])
  }

  /** La corrida se frenó esperando permisos: guarda lo que respondió hasta ahora y el costo acumulado. */
  esperando(id: number, resultado: string, costo: number) {
    this.db.run("UPDATE ejecuciones SET estado='esperando_permiso', fin=NULL, resultado=?, error=NULL, costo=? WHERE id=?",
      [prefijo(resultado, maxResultado), costo, id])
  }

  /** Retoma una corrida que esperaba permisos. */
  reanudar(id: number) { this.db.run("UPDATE ejecuciones SET estado='corriendo' WHERE id=?", [id]) }

  una(id: number): Ejecucion | undefined {
    try {
      const f = this.db.query(`SELECT ${columnas} FROM ejecuciones WHERE id=?`, [id])[0]
      return f ? deFila(f) : undefined
    } catch {
      return undefined
    }
  }

  /** Últimas `limite` ejecuciones de una tarea, de la más nueva a la más vieja. */
  lista(oficina: string, tarea: string, limite = 20): Ejecucion[] {
    try {
      return this.db.query(`SELECT ${columnas} FROM ejecuciones WHERE oficina=? AND tarea=? ORDER BY id DESC LIMIT ?`, [oficina, tarea, limite]).map(deFila)
    } catch {
      return []
    }
  }

  ultima(oficina: string, tarea: string): Ejecucion | undefined { return this.lista(oficina, tarea, 1)[0] }

  /** La corrida que usa (o usó) esa sesión. */
  porSid(sid: string): Ejecucion | undefined {
    if (sid === '') return undefined
    try {
      const f = this.db.query(`SELECT ${columnas} FROM ejecuciones WHERE sid=? ORDER BY id DESC LIMIT 1`, [sid])[0]
      return f ? deFila(f) : undefined
    } catch {
      return undefined
    }
  }

  /** Última corrida programada (no manual) de la tarea, en cualquier estado: con ella no se repite la misma programada. */
  ultimaProgramada(oficina: string, tarea: string): number | undefined {
    try {
      const v = this.db.query('SELECT MAX(programada) AS m FROM ejecuciones WHERE oficina=? AND tarea=? AND manual=0', [oficina, tarea])[0]?.m
      return v === null || v === undefined ? undefined : num(v)
    } catch {
      return undefined
    }
  }

  /** Última corrida programada (no manual) que arrancó desde `inicio` (epoch): para una tarea única, la que ya tuvo desde
   *  su último cambio de horario. */
  ultimaProgramadaDesde(oficina: string, tarea: string, inicio: number): number | undefined {
    try {
      const v = this.db.query('SELECT MAX(programada) AS m FROM ejecuciones WHERE oficina=? AND tarea=? AND manual=0 AND inicio>=?', [oficina, tarea, inicio])[0]?.m
      return v === null || v === undefined ? undefined : num(v)
    } catch {
      return undefined
    }
  }

  borrar(oficina: string, tarea: string) {
    this.db.run('DELETE FROM ejecuciones WHERE oficina=? AND tarea=?', [oficina, tarea])
  }
}

// MARK: - programador

export type GanchoTerminar = (e: Ejecucion) => Promise<void> | void
export type GanchoEntregar = (e: Entrega, ej: Ejecucion | undefined) => Promise<void> | void

/** Qué retoma `Programador.retomar`: la sesión, el pedido que se le suma, y cómo se llama lo que sale. */
export type ParamsRetomar = {
  sid: string
  /** Mensaje que se le manda al agente. */
  pedido: string
  /** cambios | espera */
  origen: string
  actividad: string
  titulo: string
  /** Ref de la entrega nueva. */
  ref: string
  /** Clave de reserva (evita dos retomadas a la vez de lo mismo). */
  clave: string
}

export type OpcionesProgramador = {
  /** Reloj inyectable (tests). */
  reloj?: () => Date
  /** Zona del sistema (id IANA). */
  sistema?: string
}

export class Programador implements ProgramadorEntregas {
  /** Cada cuánto revisa las tareas (HQ_PROGRAMADOR_INTERVALO en segundos, para pruebas). */
  static readonly intervaloPorDefecto = 30
  /** Las corridas únicas que salen de un pendiente de reunión («Hacelo ahora») usan `encargo:<reunión>:<n>` como tarea. */
  static readonly prefijoEncargo = 'encargo:'
  static readonly prefijoFlujo = 'flujo:'
  static readonly prefijoAccion = 'accion:'
  static readonly prefijoCoordinador = 'coord:'
  static readonly prefijoParte = 'parte:'
  static readonly prefijoPedido = 'pedido:'
  static readonly prefijoEspera = 'espera:'
  static readonly prefijoSecretaria = 'secretaria:'
  /** Una tanda de la importación de notas a la memoria de la secretaría: `secretaria-importar:<importación>:<tanda>`. */
  static readonly prefijoImportar = 'secretaria-importar:'
  /** La pasada diaria que ordena la memoria de la secretaría (secretaria-orden.ts): `secretaria-orden:<orden>`. */
  static readonly prefijoOrden = 'secretaria-orden:'
  /** Algo que un agente le pasó a un colega desde una charla (o el coordinador en una corrida): `delegar:<tarjeta>` (delegar.ts). */
  static readonly prefijoDelegar = 'delegar:'

  readonly ejecuciones: Ejecuciones
  /** Pedidos de permiso de las corridas que esperan a la persona (permisos-tareas.ts). */
  readonly permisos: PermisosTareasDB
  readonly sistema: string
  private reloj: () => Date
  private readonly intervalo: number
  private readonly automatico: boolean
  private readonly ganchosTerminar: GanchoTerminar[] = []
  private readonly ganchosEntregar: GanchoEntregar[] = []
  /** Deciden si la entrega de una corrida va sin notificación (p. ej. una revisión de la secretaría sin novedades). */
  private readonly silenciadores: ((tarea: string, texto: string) => boolean)[] = []
  /** Las corridas cuyo id dice que no dejan entrega (p. ej. las tandas de una importación: la entrega es una sola, al final). */
  private readonly sinEntrega: ((tarea: string) => boolean)[] = []
  private preparado = false
  private cerrado = false
  private revisando = false
  private bucle?: { parar(): void }
  /** `oficina \u001f tarea` de las que corren (o están por correr) ahora: evita dos corridas de la misma tarea a la vez. */
  private readonly reservadas = new Set<string>()
  private readonly corridas = new Map<number, Promise<void>>()
  private contadorRetomadas = 0

  /** `env.HQ_PROGRAMADOR === '0'` deja el bucle apagado (los tests llaman a `revisar()` a mano). */
  constructor(private readonly s: Servicios, op: OpcionesProgramador = {}) {
    this.ejecuciones = new Ejecuciones(s.store.db)
    this.permisos = new PermisosTareasDB(s.store.db)
    this.reloj = op.reloj ?? (() => new Date())
    this.sistema = op.sistema ?? zonaDelSistema()
    this.automatico = s.env.HQ_PROGRAMADOR !== '0'
    const t = Number((s.env.HQ_PROGRAMADOR_INTERVALO ?? '').trim())
    this.intervalo = (s.env.HQ_PROGRAMADOR_INTERVALO ?? '').trim() !== '' && Number.isFinite(t) && t > 0 ? t : Programador.intervaloPorDefecto
  }

  /** Hook para avisos y notificaciones: se llama cuando una ejecución termina (ok o error), con la fila ya guardada.
   *  Cada llamada AGREGA un gancho. Se llama también para las corridas de «Probar ahora». */
  alTerminar(f: GanchoTerminar) { this.ganchosTerminar.push(f) }

  /** Hook para cuando se crea una entrega: con la ejecución que la produjo (`correr`) o con undefined (cambios). */
  alEntregar(f: GanchoEntregar) { this.ganchosEntregar.push(f) }

  /** La entrega de una corrida va sin notificación si algún silenciador lo dice. */
  silenciar(f: (tarea: string, texto: string) => boolean) { this.silenciadores.push(f) }

  /** Una corrida sin entrega: termina, queda guardada y sale en la actividad y el costo, pero no deja nada en la bandeja. */
  sinEntregar(f: (tarea: string) => boolean) { this.sinEntrega.push(f) }

  /** Reloj inyectable (tests). */
  fijarReloj(r: () => Date) { this.reloj = r }

  /** La hora según el reloj del programador. */
  ahora(): Date { return this.reloj() }

  // MARK: ciclo de vida

  /** Arranca el bucle de revisión. Idempotente. */
  iniciar() {
    if (!this.automatico || this.bucle || this.cerrado) return
    let parar = false
    let timer: NodeJS.Timeout | undefined
    let despertar: (() => void) | undefined
    this.bucle = {
      parar: () => {
        parar = true
        if (timer) clearTimeout(timer)
        despertar?.()
      },
    }
    void (async () => {
      while (!parar) {
        await this.revisar()
        if (parar) break
        await new Promise<void>((r) => {
          despertar = r
          timer = setTimeout(r, this.intervalo * 1000)
          timer.unref()
        })
      }
    })()
  }

  /** Deja de revisar y de aceptar corridas nuevas (las en curso terminan solas; ver `esperar`). */
  detener() {
    this.cerrado = true
    this.bucle?.parar()
    this.bucle = undefined
  }

  /** Espera (hasta `limite` segundos) a que terminen las corridas en curso, para que guarden su estado antes de cerrar la base. */
  async esperar(limite = 5) {
    const en = [...this.corridas.values()]
    if (en.length === 0) return
    let timer: NodeJS.Timeout | undefined
    await Promise.race([Promise.all(en), new Promise<void>((r) => { timer = setTimeout(r, limite * 1000) })])
    clearTimeout(timer)
  }

  /** Crea la tabla y marca las interrumpidas, una sola vez por proceso y antes de cualquier corrida. */
  preparar() {
    if (this.preparado) return
    try {
      this.ejecuciones.preparar()
      this.permisos.preparar()
      // esperas de ejecuciones que ya no esperan (la app se cerró mientras retomaban)
      for (const f of this.s.store.db.query("SELECT ejecucion FROM esperas_permiso WHERE ejecucion NOT IN (SELECT id FROM ejecuciones WHERE estado='esperando_permiso')")) {
        this.permisos.borrar(num(f.ejecucion))
      }
      this.preparado = true
    } catch {
      this.s.log.error('tareas: no pude preparar la tabla de ejecuciones')
    }
  }

  // MARK: revisión

  static clave(oficina: string, tarea: string) { return oficina + '\u001f' + tarea }

  estaCorriendo(oficina: string, tarea: string): boolean { return this.reservadas.has(Programador.clave(oficina, tarea)) }

  /** Una vuelta: corre las tareas activas de la oficina activa que tocan según `Programacion.debeCorrer`. */
  async revisar() {
    if (this.cerrado || this.revisando) return
    this.revisando = true
    try {
      this.preparar()
      const act = this.preparado ? this.s.oficinas.activa() : undefined
      if (!act) return
      const ahora = this.reloj()
      for (const t of act.oficina.tareas ?? []) {
        if (!t.activa) continue
        const def = act.oficina.agentes.find((a) => a.id === t.agente)
        if (!def || this.estaCorriendo(act.carpeta, t.id)) continue
        const u = esUnica(t)
          ? this.ejecuciones.ultimaProgramadaDesde(act.carpeta, t.id, (fechaInicio(t)?.getTime() ?? 0) / 1000)
          : this.ejecuciones.ultimaProgramada(act.carpeta, t.id)
        const p = Programacion.debeCorrer(t, ahora, u === undefined ? undefined : new Date(u * 1000), this.sistema)
        if (p === undefined) continue
        try {
          this.lanzar(act, t, def, p, false)
          this.s.log.info(`tarea ${t.id} agente=${def.id} programada=${Programacion.iso(p)}`)
        } catch {}
      }
    } finally {
      this.revisando = false
    }
  }

  /** «Probar ahora»: crea la ejecución y devuelve enseguida (la corrida sigue en segundo plano). */
  async correrAhora(act: OficinaActiva, t: TareaProgramada, def: AgenteDef, actuar: string[] = [], sid?: string): Promise<Ejecucion> {
    this.verificar(act.carpeta)
    this.preparar()
    return this.lanzar(act, t, def, new Date(), true, actuar, sid)
  }

  /** Una tarea única que se crea «para ahora» (o con la hora ya pasada): corre enseguida como su corrida programada (no
   *  manual), así el programador no la vuelve a lanzar. */
  async correrUnica(act: OficinaActiva, t: TareaProgramada, def: AgenteDef): Promise<Ejecucion> {
    const p = esUnica(t) ? Programacion.instanteUnica(t, this.sistema) : undefined
    if (!p) throw new ErrorAPI(400, 'No es una tarea de una sola vez.')
    this.verificar(act.carpeta)
    this.preparar()
    return this.lanzar(act, t, def, p, false)
  }

  private verificar(carpeta: string) {
    try {
      this.s.runner.verificar(carpeta)
    } catch (e) {
      if (e instanceof ClaudeError) throw new ErrorAPI(500, e.mensaje)
      throw e
    }
  }

  /** Marca hecha (y en pausa) una tarea única que terminó bien, si sigue en la oficina abierta y no le cambiaron la fecha. */
  private marcarHecha(carpeta: string, t: TareaProgramada) {
    if (!esUnica(t) || this.s.oficinas.activa()?.carpeta !== carpeta) return
    const ahora = Programacion.iso(this.reloj())
    try {
      this.s.oficinas.modificar((o) => {
        const x = o.tareas?.find((y) => y.id === t.id)
        if (!x || x.fecha !== t.fecha || x.hora !== t.hora) return
        x.hecha = ahora
        x.activa = false
      })
    } catch {}
  }

  /** «Hacelo ahora» de un pendiente de reunión: una corrida única (no queda en `oficina.json`) con id de tarea
   *  `encargo:<reunión>:<n>`. */
  encargar(act: OficinaActiva, def: AgenteDef, p: { reunion: string; pendiente: number; nombre: string; consigna: string }): Promise<Ejecucion> {
    return this.encargarLibre(act, def, { id: Programador.idEncargo(p.reunion, p.pendiente), nombre: p.nombre, consigna: p.consigna, sistema: Programador.sistemaPendiente })
  }

  /** Lo que recibe como mensaje de sistema un pendiente de reunión (el mensaje es el pendiente, `consignaEncargo`). */
  static readonly sistemaPendiente = '# Pendiente de reunión\nEl mensaje es un pendiente que salió de una reunión. Hacelo ahora. Si producís un documento, guardalo en `archivos/entregables/` y decí al final qué archivo dejaste.'

  /** Una corrida única con un id de tarea cualquiera (`encargo:`, `flujo:`, `accion:`, `coord:`, `parte:`): misma maquinaria
   *  que una tarea. `actuar`: herramientas de conectores de actuar que esta corrida puede usar. `sistema`: instrucciones que
   *  van como mensaje de sistema (no quedan en la charla); `consigna` es entonces solo el material. */
  encargarLibre(act: OficinaActiva, def: AgenteDef, p: { id: string; nombre: string; consigna: string; sistema?: string; actuar?: string[]; sid?: string }): Promise<Ejecucion> {
    const t: TareaProgramada = { id: p.id, agente: def.id, nombre: p.nombre, consigna: p.consigna, dias: [1], hora: '00:00', activa: false, ...(p.sistema ? { sistema: p.sistema } : {}) }
    return this.correrAhora(act, t, def, p.actuar ?? [], p.sid)
  }

  // MARK: pedir cambios (E4)

  static claveCambios(entrega: number) { return `cambios:${entrega}` }

  /** «Pedir cambios» sobre una entrega: retoma su conversación en el carril del agente con el pedido de la persona. Al
   *  terminar bien crea la entrega nueva (`padre` = la anterior, origen `cambios`) y la anterior pasa a `cambios`. Si falla,
   *  la anterior queda como estaba y se deja un aviso de error. Devuelve enseguida. */
  async pedirCambios(act: OficinaActiva, def: AgenteDef, e: Entrega, texto: string): Promise<void> {
    const duenio = act.oficina.duenio === '' ? 'la persona' : act.oficina.duenio
    await this.retomarEnSegundoPlano(act, def, e, {
      sid: e.sid, pedido: `Cambios que te pide ${duenio} sobre lo que entregaste («${e.titulo}»):\n\n${texto}`, origen: 'cambios',
      actividad: 'Cambios: ' + e.titulo, titulo: e.titulo, ref: e.sid, clave: Programador.claveCambios(e.id),
    })
  }

  /** Reserva `p.clave` y retoma la sesión en segundo plano (409 si la app se cierra o la clave ya está en uso). */
  async retomarEnSegundoPlano(act: OficinaActiva, def: AgenteDef, e: Entrega | undefined, p: ParamsRetomar, alFin?: (r: { entrega?: Entrega; error?: string }) => void): Promise<void> {
    if (this.cerrado) throw new ErrorAPI(409, 'La app se está cerrando.')
    this.verificar(act.carpeta)
    const clave = Programador.clave(act.carpeta, p.clave)
    if (this.reservadas.has(clave)) throw new ErrorAPI(409, p.origen === 'cambios' ? 'Ya le estás pidiendo cambios a esta entrega.' : 'Ya hay una corrida en curso para esto.')
    this.reservadas.add(clave)
    const id = -(++this.contadorRetomadas) // las corridas retomadas se guardan con id negativo (no chocan con las ejecuciones)
    this.corridas.set(id, this.retomar(act, def, e, p).then(
      (r) => { try { alFin?.(r) } catch {} },
      () => { try { alFin?.({ error: 'No pude retomar la conversación.' }) } catch {} },
    ).finally(() => this.termino(id, clave)))
  }

  /** ¿Hay una retomada en curso con esa clave de reserva (`cambios:<entrega>` o `espera:<id>`)? */
  estaRetomando(oficina: string, clave: string): boolean { return this.reservadas.has(Programador.clave(oficina, clave)) }

  cambiandoEntrega(oficina: string, id: number): boolean { return this.reservadas.has(Programador.clave(oficina, Programador.claveCambios(id))) }

  /** Retoma la conversación `p.sid` (la de la entrega `e`, si hay) con `p.pedido`. Al terminar bien registra la entrega
   *  nueva (`padre` = `e`); si falla deja un aviso de error. */
  async retomar(act: OficinaActiva, def: AgenteDef, e: Entrega | undefined, p: ParamsRetomar): Promise<{ entrega?: Entrega; error?: string }> {
    const { store, runner, config, avisos, entregas } = this.s
    const ctx = contexto(act, def, { dirsExtra: config.oficinaDirsExtra, catalogo: this.s.catalogo?.(), config })
    const mcp = this.s.mcp?.()
    const mcpUrl = mcp ? await mcp.url() : undefined
    if (mcpUrl !== undefined) ctx.mcpUrl = mcpUrl
    const carpeta = act.carpeta, agente = def.id, sid = p.sid
    const caja = new CajaCosto(), escritos = new CajaArchivos()
    const pedido = p.pedido
    const r = await runner.conCarrilDe(carpeta, agente, async (): Promise<{ texto?: string; error?: string }> => {
      const envExtra: Record<string, string> = { ...entorno(ctx) }
      if (mcpUrl !== undefined && mcp) envExtra[variableTokenMCP] = mcp.emitir({ oficina: carpeta, agente, sid, perfil: ctx.perfilMCP })
      try {
        store.asegurarSesion(sid, agente, carpeta, true)
        store.agregar(sid, 'u', pedido)
        const activa = store.estaActiva(sid)
        const t = await runner.actividad.seguir({ oficina: carpeta, agente, origen: p.origen, tarea: p.actividad, extra: caja.observador(escritos.observador()) },
          (obs) => runner.ejecutarChat({ agente, mensaje: pedido, sid, activa, carpeta, obs, envExtra, armar: (x) => argumentos(config, ctx, x) }))
        store.marcarActiva(sid)
        const guardado = t === '' ? '(sin respuesta)' : t
        store.agregar(sid, 'a', guardado)
        return { texto: guardado }
      } catch (err) {
        if (err instanceof ClaudeError) {
          try { store.agregar(sid, 'a', 'No pude responder: ' + err.mensaje, true) } catch {}
          return { error: err.mensaje }
        }
        return { error: 'No pude guardar la conversación.' }
      } finally {
        const tok = envExtra[variableTokenMCP]
        if (tok !== undefined) mcp?.revocar(tok)
      }
    })
    store.registrarCosto({ oficina: carpeta, agente, origen: p.origen, ref: p.origen === 'cambios' && e ? String(e.id) : p.ref, costo: caja.valor })
    if (r.texto !== undefined) {
      const nuevos = ArchivosEntrega.relativos(escritos.valor, carpeta)
      const previos = e?.archivos ?? []
      const arch = nuevos.length === 0 ? previos : [...nuevos, ...previos.filter((x) => !nuevos.includes(x))]
      const nueva = entregas.registrar({ oficina: carpeta, agente, nombre: def.nombre, origen: p.origen, ref: p.ref, titulo: p.titulo, texto: r.texto, sid, archivos: arch, padre: e?.id, costo: caja.valor })
      if (nueva) {
        // con «espera», una versión que la persona ya revisó se queda revisada
        if (e && (p.origen === 'cambios' || e.estado === 'sin_revisar')) entregas.marcar(carpeta, e.id, 'cambios')
        for (const g of this.ganchosEntregar) await this.llamar(() => g(nueva, undefined))
      }
      this.s.log.info(`${p.origen} entrega=${e?.id ?? '-'} agente=${agente} estado=ok`)
      return nueva ? { entrega: nueva } : {}
    }
    const error = r.error ?? 'error'
    const que = p.origen === 'cambios' ? 'los cambios' : 'la versión completa'
    const av = avisos.crear({ oficina: carpeta, tipo: 'error', agente, texto: `No pudo hacer ${que} de «${p.titulo}»: ` + error, ref: sid })
    if (av) avisos.emitir(av, def.nombre)
    this.s.log.info(`${p.origen} entrega=${e?.id ?? '-'} agente=${agente} estado=error`)
    return { error }
  }

  // MARK: ids de corridas

  /** Origen de la entrega, la actividad y el costo de una corrida, según el prefijo de su id de tarea. */
  static origenEntrega(id: string): string {
    if (id.startsWith(Programador.prefijoEncargo) || id.startsWith(Programador.prefijoCoordinador) || id.startsWith(Programador.prefijoDelegar)) return 'encargo'
    if (id.startsWith(Programador.prefijoFlujo)) return 'flujo'
    if (id.startsWith(Programador.prefijoAccion)) return 'accion'
    if (id.startsWith(Programador.prefijoParte)) return 'parte'
    if (id.startsWith(Programador.prefijoPedido)) return 'pedido'
    if (id.startsWith(Programador.prefijoEspera)) return 'espera'
    if (id.startsWith(Programador.prefijoSecretaria)) return 'secretaria'
    if (id.startsWith(Programador.prefijoImportar)) return 'importacion'
    if (id.startsWith(Programador.prefijoOrden)) return 'secretaria'
    return 'tarea'
  }

  /** Id de tarea de un paso de flujo: `flujo:<corrida>:<paso>:<intento>`. */
  static idFlujo(p: { corrida: number; paso: number; intento: number }): string { return `${Programador.prefijoFlujo}${p.corrida}:${p.paso}:${p.intento}` }

  /** (corrida, paso, intento) de un id de paso de flujo; undefined si no lo es. */
  static deFlujo(id: string): [number, number, number] | undefined {
    if (!id.startsWith(Programador.prefijoFlujo)) return undefined
    const p = id.slice(Programador.prefijoFlujo.length).split(':')
    if (p.length !== 3 || !p.every((x) => /^[+-]?\d+$/.test(x))) return undefined
    return [Number(p[0]), Number(p[1]), Number(p[2])]
  }

  static idEncargo(reunion: string, pendiente: number): string { return `${Programador.prefijoEncargo}${reunion}:${pendiente}` }

  /** (reunión, pendiente) de un id de encargo; undefined si no lo es. */
  static deEncargo(id: string): [string, number] | undefined {
    if (!id.startsWith(Programador.prefijoEncargo)) return undefined
    const p = id.slice(Programador.prefijoEncargo.length).split(':').filter((x) => x !== '')
    if (p.length !== 2 || !/^[+-]?\d+$/.test(p[1]!)) return undefined
    return [p[0]!, Number(p[1])]
  }

  // MARK: corrida

  private lanzar(act: OficinaActiva, t: TareaProgramada, def: AgenteDef, programada: Date, manual: boolean, actuar: string[] = [], sidPedido?: string): Ejecucion {
    if (this.cerrado) throw new ErrorAPI(409, 'La app se está cerrando.')
    const clave = Programador.clave(act.carpeta, t.id)
    if (this.reservadas.has(clave)) throw new ErrorAPI(409, 'Esa tarea ya se está corriendo.')
    if (this.preparado && this.ejecuciones.ultima(act.carpeta, t.id)?.estado === 'esperando_permiso') {
      throw new ErrorAPI(409, 'Esa tarea está esperando tu permiso para seguir.')
    }
    this.reservadas.add(clave)
    const sid = sidPedido ?? randomUUID().toLowerCase()
    const inicio = Date.now() / 1000
    let id: number
    try {
      id = this.ejecuciones.nueva({ oficina: act.carpeta, tarea: t.id, agente: def.id, programada: programada.getTime() / 1000, inicio, sid, manual })
    } catch {
      this.reservadas.delete(clave)
      throw new ErrorAPI(500, 'No pude guardar la ejecución.')
    }
    const ej: Ejecucion = { id, oficina: act.carpeta, tarea: t.id, agente: def.id, programada: programada.getTime() / 1000, inicio, estado: 'corriendo', sid, resultado: '', manual }
    this.corridas.set(id, this.correr(ej, act, t, def, actuar).catch((e) => {
      this.s.log.error(`tarea ${t.id}: ${e instanceof Error ? e.message : e}`)
    }).finally(() => this.termino(id, clave)))
    return ej
  }

  private termino(id: number, clave: string) {
    this.corridas.delete(id)
    this.reservadas.delete(clave)
  }

  private async llamar(f: () => Promise<void> | void) {
    try {
      await f()
    } catch (e) {
      this.s.log.error(`programador: gancho: ${e instanceof Error ? e.message : e}`)
    }
  }

  /** Lo mismo que el chat: carril del agente, permisos de la oficina, actividad (origen «tarea») y costo (origen «tarea»,
   *  ref = id de la tarea), en una sesión nueva donde quedan el pedido y la respuesta como un chat más. */
  private async correr(ej: Ejecucion, act: OficinaActiva, t: TareaProgramada, def: AgenteDef, actuar: string[]) {
    // una tarea repetida corre cada horas o días: retomar su conversación saldría más caro (la caché de claude ya venció
    // y habría que reescribir toda la historia). Arranca de cero, con lo que entregó la vez anterior para seguir desde ahí.
    // Va como mensaje de sistema (con la tarea, así lo retoma igual si se frena por permisos): en la charla queda solo la consigna.
    const previa = esUnica(t) ? undefined : this.ejecuciones.lista(act.carpeta, t.id, 5).find((x) => x.id !== ej.id && x.estado === 'ok' && x.resultado.trim() !== '')
    const tc: TareaProgramada = previa ? { ...t, sistema: [t.sistema, vezAnterior(previa)].filter(Boolean).join('\n\n') } : t
    await this.vuelta(ej, act, tc, def, actuar, { mensaje: mensajeTarea(t), activa: false, reglasExtra: [] })
  }

  /** Una vuelta de una corrida: la primera (la consigna, en una sesión nueva) o la que retoma la conversación después de
   *  que la persona respondió los permisos (`previo`). Si el agente quiso hacer algo que no tiene permitido (Bash, Edit,
   *  Write), la ejecución queda «esperando_permiso» con los pedidos guardados y sin entrega; si no, termina como siempre. */
  private async vuelta(ej: Ejecucion, act: OficinaActiva, t: TareaProgramada, def: AgenteDef, actuar: string[],
    v: { mensaje: string; activa: boolean; reglasExtra: string[]; previo?: EsperaPermiso }) {
    const { store, runner, config, entregas } = this.s
    const ctx = contexto(act, def, { dirsExtra: config.oficinaDirsExtra, actuar, catalogo: this.s.catalogo?.(), config })
    ctx.anotarRechazos = true
    // modelo, esfuerzo y ahorro propios de la tarea: pisan los del agente solo en esta corrida
    if (t.ia) aplicarEleccion(ctx, t.ia)
    if (t.sistema) ctx.instrucciones = ctx.instrucciones ? `${ctx.instrucciones}\n\n${t.sistema}` : t.sistema
    for (const r of v.reglasExtra) if (!(ctx.reglas ?? []).includes(r)) ctx.reglas = [...(ctx.reglas ?? []), r]
    // MCP también fuera del chat: token con el perfil del agente, que vive lo que dura la corrida
    const mcp = this.s.mcp?.()
    const mcpUrl = mcp ? await mcp.url() : undefined
    if (mcpUrl !== undefined) ctx.mcpUrl = mcpUrl
    const origen = Programador.origenEntrega(ej.tarea)
    const carpeta = act.carpeta, agente = def.id, sid = ej.sid, nombre = t.nombre
    const caja = new CajaCosto()
    const escritos = new CajaArchivos()
    const r = await runner.conCarrilDe(carpeta, agente, async (): Promise<{ texto: string; error?: string; denegados: Denegacion[] }> => {
      const envExtra: Record<string, string> = { ...entorno(ctx) }
      if (mcpUrl !== undefined && mcp) envExtra[variableTokenMCP] = mcp.emitir({ oficina: carpeta, agente, sid, perfil: ctx.perfilMCP })
      try {
        store.asegurarSesion(sid, agente, carpeta, true)
        store.agregar(sid, 'u', v.mensaje)
        const res = await runner.actividad.seguir({ oficina: carpeta, agente, origen, tarea: nombre, extra: caja.observador(escritos.observador()) },
          (obs) => runner.ejecutarChatDetalle({ agente, mensaje: v.mensaje, sid, activa: v.activa, carpeta, obs, envExtra, armar: (p) => argumentos(config, ctx, p) }))
        store.marcarActiva(sid)
        const guardado = res.texto === '' ? '(sin respuesta)' : res.texto
        store.agregar(sid, 'a', guardado)
        return { texto: guardado, denegados: res.denegados }
      } catch (e) {
        const m = e instanceof ClaudeError ? e.mensaje : 'No pude guardar la conversación.'
        try { store.agregar(sid, 'a', 'No pude responder: ' + m, true) } catch {}
        return { texto: '', error: m, denegados: [] }
      } finally {
        const tok = envExtra[variableTokenMCP]
        if (tok !== undefined) mcp?.revocar(tok)
      }
    })
    store.registrarCosto({ oficina: carpeta, agente, origen, ref: ej.tarea, costo: caja.valor })
    const costo = v.previo === undefined ? caja.valor : v.previo.costo + (caja.valor ?? 0)
    const archivos = [...(v.previo?.archivos ?? [])]
    for (const a of escritos.valor) if (!archivos.includes(a)) archivos.push(a)

    if (r.error === undefined) {
      const pedidos = pedidosDe(r.denegados, { ejecucion: ej.id, oficina: carpeta, agente })
      if (pedidos.length > 0) {
        this.esperarPermisos({ ejecucion: ej.id, oficina: carpeta, tarea: t, actuar, archivos, costo: costo ?? 0, texto: r.texto }, pedidos, def)
        return
      }
    }
    if (v.previo) { try { this.permisos.borrar(ej.id) } catch {} }
    try {
      this.ejecuciones.terminar(ej.id, r.error === undefined ? 'ok' : 'error', r.texto, r.error, costo)
    } catch {}
    this.s.log.info(`tarea ${ej.tarea} agente=${agente} estado=${r.error === undefined ? 'ok' : 'error'}`)
    if (r.error === undefined && !this.sinEntrega.some((f) => { try { return f(ej.tarea) } catch { return false } })) {
      const entrega = entregas.registrar({
        oficina: carpeta, agente, nombre: def.nombre, origen, ref: ej.tarea, titulo: nombre, texto: r.texto, sid,
        archivos: ArchivosEntrega.relativos(archivos, carpeta), costo,
        silenciosa: this.silenciadores.some((f) => { try { return f(ej.tarea, r.texto) } catch { return false } }),
      })
      this.marcarHecha(carpeta, t)
      const fin = this.ejecuciones.una(ej.id)
      if (entrega && fin) for (const g of this.ganchosEntregar) await this.llamar(() => g(entrega, fin))
    }
    const fin = this.ejecuciones.una(ej.id)
    if (fin) for (const g of this.ganchosTerminar) await this.llamar(() => g(fin))
  }

  // MARK: permisos pendientes de las corridas (permisos-tareas.ts)

  /** Frena la ejecución: guarda los pedidos, la deja «esperando_permiso» y avisa a la persona. */
  private esperarPermisos(e: EsperaPermiso, pedidos: PedidoTarea[], def: AgenteDef) {
    try {
      this.permisos.guardar(e, pedidos)
      this.ejecuciones.esperando(e.ejecucion, e.texto, e.costo)
    } catch {
      this.s.log.error(`tarea ejecucion=${e.ejecucion}: no pude guardar los pedidos de permiso`)
      try { this.ejecuciones.terminar(e.ejecucion, 'error', e.texto, 'No pude guardar los pedidos de permiso.', e.costo) } catch {}
      return
    }
    this.s.log.info(`tarea ejecucion=${e.ejecucion} agente=${def.id} estado=esperando_permiso pedidos=${pedidos.length}`)
    this.s.runner.actividad.tocar()
    const n = pedidos.length
    const texto = `«${e.tarea.nombre}» necesita tu permiso para seguir (${n === 1 ? '1 pedido' : `${n} pedidos`}).`
    const av = this.s.avisos.crear({ oficina: e.oficina, tipo: 'permiso', agente: def.id, texto, ref: String(e.ejecucion) })
    if (av) this.s.avisos.emitir(av, def.nombre)
  }

  /** Pedidos de permiso sin responder de las corridas de una oficina (JSON de la tarjeta). */
  pendientesPermiso(oficina: string): Obj[] {
    if (!this.preparado) return []
    try {
      const nombres = new Map(this.permisos.esperas(oficina).map((e) => [e.ejecucion, e.tarea.nombre]))
      return this.permisos.pendientes(oficina).map((p) => pedidoTareaJSON(p, nombres.get(p.ejecucion) ?? nombreCorrida('')))
    } catch {
      return []
    }
  }

  /** La persona respondió un pedido de una corrida. undefined si no existe (o ya se respondió). «Siempre» guarda las
   *  reglas en el agente. Cuando ya respondió todos los de esa ejecución, la tarea retoma en segundo plano. */
  responderPermiso(oficina: string, id: string, decision: DecisionPermiso): { reglas?: string[]; retoma?: boolean } | undefined {
    if (!this.preparado) return undefined
    const p = this.permisos.pedido(oficina, id)
    if (!p || p.decision !== undefined) return undefined
    let reglas: string[] | undefined
    if (decision === 'siempre') {
      if (p.reglas.length === 0) throw new ErrorAPI(400, 'Esto solo se puede permitir una vez.')
      reglas = this.s.oficinas.agregarReglas(p.agente, p.reglas)
    }
    this.permisos.decidir(p.id, decision)
    this.s.log.info(`permiso tarea ejecucion=${p.ejecucion} agente=${p.agente} herramienta=${p.herramienta} respuesta=${decision}`)
    this.s.runner.actividad.tocar()
    let retoma = false
    if (this.permisos.pedidosDe(p.ejecucion).every((x) => x.decision !== undefined)) {
      try { retoma = this.continuar(p.ejecucion) } catch (e) { this.s.log.error(`tarea ejecucion=${p.ejecucion}: no pude retomar: ${e instanceof Error ? e.message : e}`) }
    }
    const r: { reglas?: string[]; retoma?: boolean } = {}
    if (reglas) r.reglas = reglas
    if (retoma) r.retoma = true
    return r
  }

  /** Retoma las ejecuciones de `oficina` que ya tienen todos sus pedidos respondidos (se respondieron con otra oficina
   *  abierta, o la app se cerró antes de retomar). */
  retomarRespondidas(oficina: string) {
    if (!this.preparado) return
    try {
      for (const e of this.permisos.esperas(oficina)) {
        const ps = this.permisos.pedidosDe(e.ejecucion)
        if (ps.length > 0 && ps.every((p) => p.decision !== undefined)) this.continuar(e.ejecucion)
      }
    } catch {}
  }

  /** Retoma una ejecución que esperaba permisos: la misma conversación, con lo permitido «una vez» sumado a sus reglas solo
   *  para esta vuelta (lo de «Siempre» ya quedó en el agente). Si la oficina no es la abierta, sigue esperando. */
  private continuar(ejecucion: number): boolean {
    if (this.cerrado) return false
    const e = this.permisos.espera(ejecucion)
    const ej = this.ejecuciones.una(ejecucion)
    if (!e || !ej || ej.estado !== 'esperando_permiso') return false
    const act = this.s.oficinas.activa()
    if (!act || act.carpeta !== e.oficina) return false
    const def = act.oficina.agentes.find((a) => a.id === ej.agente)
    if (!def) {
      this.permisos.borrar(ejecucion)
      this.ejecuciones.terminar(ejecucion, 'error', e.texto, 'El agente ya no está en la oficina.', e.costo)
      return false
    }
    const pedidos = this.permisos.pedidosDe(ejecucion)
    const extra: string[] = []
    for (const p of pedidos) if (p.decision === 'una_vez') for (const r of reglasUnaVez(p)) if (!extra.includes(r)) extra.push(r)
    const clave = Programador.clave(act.carpeta, `permiso:${ejecucion}`)
    if (this.reservadas.has(clave)) return false
    this.reservadas.add(clave)
    this.ejecuciones.reanudar(ejecucion)
    const corriendo: Ejecucion = { ...ej, estado: 'corriendo' }
    const mensaje = mensajeContinuar(pedidos, act.oficina.duenio)
    this.corridas.set(ejecucion, this.vuelta(corriendo, act, e.tarea, def, e.actuar, { mensaje, activa: true, reglasExtra: extra, previo: e })
      .catch((err) => { this.s.log.error(`tarea ${ej.tarea}: ${err instanceof Error ? err.message : err}`) })
      .finally(() => this.termino(ejecucion, clave)))
    return true
  }
}

/** Nombre para el aviso de una corrida que no es una tarea de `oficina.json`, según el prefijo de su id (Backend.nombreCorrida). */
export function nombreCorrida(id: string): string {
  if (Programador.deEncargo(id) !== undefined) return 'Pendiente de reunión'
  if (id.startsWith(Programador.prefijoFlujo)) return 'Paso de flujo'
  if (id.startsWith(Programador.prefijoAccion)) return 'Acción aprobada'
  if (id.startsWith(Programador.prefijoCoordinador)) return 'Encargo del coordinador'
  if (id.startsWith(Programador.prefijoParte)) return 'Parte del día'
  if (id.startsWith(Programador.prefijoPedido)) return 'Pedido de un colega'
  if (id.startsWith(Programador.prefijoEspera)) return 'Versión completa'
  if (/^secretaria:r\d+$/.test(id)) return 'Reporte de la secretaría'
  if (id.startsWith(Programador.prefijoSecretaria)) return 'Revisión de la secretaría'
  if (id.startsWith(Programador.prefijoImportar)) return 'Importación a la memoria de la secretaría'
  if (id.startsWith(Programador.prefijoOrden)) return 'Orden de la memoria de la secretaría'
  if (id.startsWith(Programador.prefijoDelegar)) return 'Encargo desde una charla'
  return id
}

// MARK: - rutas /api/tareas*

const maxBody = 200_000

export class TareasRouter implements SubRouter {
  constructor(private readonly s: Servicios, private readonly programador: Programador, private readonly reloj: () => Date = () => new Date()) {}

  static esRuta = (p: string) => p === '/api/tareas' || p.startsWith('/api/tareas/')

  private get sistema() { return this.programador.sistema }

  async handle(method: string, path: string, _query: Query, body?: Buffer) {
    if (!TareasRouter.esRuta(path)) return null
    return atrapar(async () => this.despachar(method, path, body))
  }

  private async despachar(method: string, path: string, body?: Buffer): Promise<Resp> {
    const partes = path.split('/').slice(1)
    if (partes.length < 2 || partes.length > 4 || partes.includes('')) return no404
    this.programador.preparar()
    if (partes.length === 2) {
      switch (method) {
        case 'GET': return this.listar()
        case 'POST': return this.crear(body)
        default: return no405
      }
    }
    const id = partes[2]!
    if (!Slug.valido(id)) return no404
    if (partes.length === 3) {
      switch (method) {
        case 'GET': return this.ver(id)
        case 'PATCH': return this.editar(id, body)
        case 'DELETE': return this.borrar(id)
        default: return no405
      }
    }
    switch (partes[3]) {
      case 'correr': return method === 'POST' ? this.correr(id) : no405
      case 'ejecuciones': return method === 'GET' ? this.ejecucionesDe(id) : no405
      default: return no404
    }
  }

  // MARK: vistas

  private vista(t: TareaProgramada, a: OficinaActiva, ahora: Date): Obj {
    const o = tareaJSON(t, this.sistema)
    const ult = this.programador.ejecuciones.ultima(a.carpeta, t.id)
    const sigue = t.activa && a.oficina.agentes.some((x) => x.id === t.agente)
    const prox = sigue ? Programacion.proxima(t, ahora, this.sistema) : undefined
    o.proxima = prox ? Programacion.iso(prox) : null
    o.ultima = ult ? ejecucionJSON(ult) : null
    o.corriendo = this.programador.estaCorriendo(a.carpeta, t.id)
    // única: el instante en que le toca (aunque ya haya pasado), para mostrarlo en la zona que sea
    if (esUnica(t)) {
      const c = Programacion.instanteUnica(t, this.sistema)
      o.cuando = c ? Programacion.iso(c) : null
    }
    // salió de una charla: con quién era (para «Salió de un chat con…» y abrir esa charla)
    const de = charlaDe(t, a, this.s.store)
    if (de) o.charla = { agente: de.id, nombre: de.nombre }
    return o
  }

  private buscar(id: string, a: OficinaActiva): TareaProgramada {
    const t = a.oficina.tareas?.find((x) => x.id === id)
    if (!t) throw new ErrorAPI(404, 'No existe esa tarea.')
    return t
  }

  private listar(): Resp {
    const a = this.s.oficinas.requerirActiva()
    const ahora = this.reloj()
    return [200, { tareas: (a.oficina.tareas ?? []).map((t) => this.vista(t, a, ahora)) }]
  }

  private ver(id: string): Resp {
    const a = this.s.oficinas.requerirActiva()
    return [200, { tarea: this.vista(this.buscar(id, a), a, this.reloj()) }]
  }

  // MARK: cuerpo

  private static dias(v: unknown): number[] {
    if (!Array.isArray(v) || v.length === 0) throw new ErrorAPI(400, 'Elegí al menos un día (números del 1, lunes, al 7, domingo).')
    const out: number[] = []
    for (const x of v) {
      if (typeof x !== 'number' || !Number.isInteger(x) || x < 1 || x > 7 || out.includes(x)) {
        throw new ErrorAPI(400, 'Los días tienen que ser números del 1 (lunes) al 7 (domingo), sin repetir.')
      }
      out.push(x)
    }
    return out.sort((a, b) => a - b)
  }

  private static hora(v: unknown): string {
    const h = Validar.texto(v, 'hora', 5)!
    if (ValidarTareas.hora(h) === undefined) throw new ErrorAPI(400, 'La hora tiene que ser HH:MM (por ejemplo 08:00).')
    return h
  }

  private static zona(v: unknown): string | undefined {
    const z = Validar.texto(v, 'zona', 64, false)
    if (z === undefined) return undefined
    if (!ValidarTareas.zonaValida(z)) throw new ErrorAPI(400, 'No conozco esa zona horaria (usá, por ejemplo, America/Argentina/Buenos_Aires).')
    return z
  }

  /** «ia»: {modelo, esfuerzo, skills, memoria, colegas, mcpLocales} de las corridas de la tarea (como en una charla).
   *  undefined = no vino (no cambia); null o {} = sin elección propia (los del agente). */
  private static ia(v: unknown): IATarea | null | undefined {
    if (v === undefined) return undefined
    if (v === null) return null
    if (!esObjeto(v)) throw new ErrorAPI(400, '«ia» tiene que ser un objeto con modelo, esfuerzo, skills, memoria, colegas o mcpLocales.')
    const e = eleccionCharla(v)
    return Object.keys(e).length > 0 ? e : null
  }

  /** «tipo»: "repetida" | "unica" (undefined si no vino). Devuelve si es única. */
  private static tipo(v: unknown): boolean | undefined {
    if (v === undefined || v === null) return undefined
    if (v === 'unica') return true
    if (v === 'repetida') return false
    throw new ErrorAPI(400, '«tipo» tiene que ser "repetida" o "unica".')
  }

  private static fecha(v: unknown): string {
    const f = Validar.texto(v, 'fecha', 10)!
    if (Programacion.diaCalendario(f) === undefined) throw new ErrorAPI(400, 'La fecha tiene que ser AAAA-MM-DD (por ejemplo 2026-11-20).')
    return f
  }

  private static booleano(v: unknown, campo: string): boolean | undefined {
    if (v === undefined || v === null) return undefined
    if (typeof v !== 'boolean') throw new ErrorAPI(400, `«${campo}» tiene que ser verdadero o falso.`)
    return v
  }

  /** Opcional: `{reunion, pendiente}` («Convertir en tarea» desde el acta) o `{chat}` («Sacar tareas» de una charla de la
   *  oficina activa). */
  private origen(v: unknown): OrigenTarea | undefined {
    if (v === undefined || v === null) return undefined
    const malo = () => new ErrorAPI(400, '«origen» tiene que ser {reunion, pendiente} o {chat}.')
    if (!esObjeto(v)) throw malo()
    let o: OrigenTarea
    if (v.chat !== undefined) {
      if (typeof v.chat !== 'string') throw malo()
      o = { chat: v.chat.toLowerCase() }
      if (!ValidarTareas.origenValido(o)) throw malo()
      const act = this.s.oficinas.requerirActiva()
      if (this.s.store.oficinaDe(o.chat) !== act.carpeta) throw new ErrorAPI(400, 'Esa charla no es de esta oficina.')
      return o
    }
    if (typeof v.reunion !== 'string' || typeof v.pendiente !== 'number' || !Number.isInteger(v.pendiente)) throw malo()
    o = { reunion: v.reunion.toLowerCase(), pendiente: v.pendiente }
    if (!ValidarTareas.origenValido(o)) throw malo()
    return o
  }

  // MARK: altas, cambios y bajas

  /** Cuerpo de tareas: con archivos adjuntos (base64) puede ser más grande. */
  private cuerpo(body?: Buffer): Obj {
    if (body && body.length > maxBody) {
      // grande solo si trae adjuntos: si no es JSON o no los trae, 413 como siempre
      let d: unknown
      try { d = JSON.parse(body.toString('utf8')) } catch {}
      if (!esObjeto(d) || d.archivos === undefined) throw new ErrorAPI(413, 'pedido demasiado grande')
    }
    return objeto(body, Adjuntos.maxBody)
  }

  /** «quitarArchivos»: rutas de adjuntos que la tarea deja de llevar (los archivos quedan en la carpeta). */
  private static quitar(v: unknown): string[] {
    if (v === undefined || v === null) return []
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new ErrorAPI(400, '«quitarArchivos» tiene que ser una lista de rutas.')
    return v as string[]
  }

  /** Guarda los adjuntos nuevos de una tarea del agente (que tiene que existir en la oficina activa). */
  private guardarAdjuntos(archivos: Adjunto[], agente: string): string[] {
    if (archivos.length === 0) return []
    const a = this.s.oficinas.requerirActiva()
    if (!a.oficina.agentes.some((x) => x.id === agente)) throw new ErrorAPI(404, 'No existe ese agente.')
    return Adjuntos.guardar(a, `tareas/${agente}`, archivos)
  }

  private async crear(body?: Buffer): Promise<Resp> {
    const d = this.cuerpo(body)
    const agente = Validar.texto(d.agente, 'agente', 41)!
    const nombre = Validar.texto(d.nombre, 'nombre', ValidarTareas.maxNombre)!
    const consigna = Validar.texto(d.consigna, 'consigna', ValidarTareas.maxConsigna)!
    // única: {tipo: "unica", fecha, hora} o {tipo: "unica", ahora: true}; repetida (por defecto): {dias, hora}
    if (d.fecha !== undefined && d.dias !== undefined) throw new ErrorAPI(400, 'Elegí días (si se repite) o una fecha (si es una sola vez), no las dos cosas.')
    const ahoraPedido = TareasRouter.booleano(d.ahora, 'ahora') ?? false
    const unica = TareasRouter.tipo(d.tipo) ?? (d.fecha !== undefined || ahoraPedido)
    if (ahoraPedido && !unica) throw new ErrorAPI(400, '«ahora» es solo para tareas de una sola vez.')
    const zona = TareasRouter.zona(d.zona) ?? this.sistema
    let dias: number[], hora: string, fecha: string | undefined
    if (unica) {
      dias = []
      if (ahoraPedido) {
        fecha = Programacion.textoDia(this.reloj(), zona)
        hora = Programacion.textoHora(this.reloj(), zona)
      } else {
        fecha = TareasRouter.fecha(d.fecha)
        hora = TareasRouter.hora(d.hora)
      }
    } else {
      dias = TareasRouter.dias(d.dias)
      hora = TareasRouter.hora(d.hora)
    }
    const activa = TareasRouter.booleano(d.activa, 'activa') ?? true
    const origen = this.origen(d.origen)
    const ia = TareasRouter.ia(d.ia)
    const pedidoId = Validar.texto(d.id, 'id', 41, false)
    if (pedidoId !== undefined && !Slug.valido(pedidoId)) throw new ErrorAPI(400, 'Id de tarea inválido (usá minúsculas, números y guiones).')
    const adjuntos = this.guardarAdjuntos(Adjuntos.leer(d.archivos), agente)
    const ahora = Programacion.iso(this.reloj())
    const [t, a] = this.s.oficinas.modificar((o) => {
      if (!o.agentes.some((x) => x.id === agente)) throw new ErrorAPI(404, 'No existe ese agente.')
      const ts = o.tareas ?? []
      ValidarTareas.hayLugar(ts)
      const usados = new Set(ts.map((x) => x.id))
      if (pedidoId !== undefined && usados.has(pedidoId)) throw new ErrorAPI(409, 'Ya hay una tarea con ese id.')
      const id = pedidoId ?? Slug.unico(nombre, usados, 'tarea')
      const t: TareaProgramada = { id, agente, nombre, consigna, dias, hora, zona, activa, creada: ahora, desde: ahora }
      if (origen) t.origen = origen
      if (fecha !== undefined) t.fecha = fecha
      if (adjuntos.length > 0) t.archivos = adjuntos
      if (ia) t.ia = ia
      ts.push(t)
      o.tareas = ts
      return t
    })
    // una única cuya hora ya llegó («ahora» o una hora pasada) arranca enseguida, sin esperar la vuelta del programador
    if (esUnica(t) && t.activa) {
      const i = Programacion.instanteUnica(t, this.sistema)
      const def = a.oficina.agentes.find((x) => x.id === t.agente)
      if (i !== undefined && i <= this.reloj() && def) {
        try { await this.programador.correrUnica(a, t, def) } catch {}
      }
    }
    return [200, { tarea: this.vista(t, a, this.reloj()) }]
  }

  private editar(id: string, body?: Buffer): Resp {
    const d = this.cuerpo(body)
    const nombre = Validar.texto(d.nombre, 'nombre', ValidarTareas.maxNombre, false)
    const consigna = Validar.texto(d.consigna, 'consigna', ValidarTareas.maxConsigna, false)
    const dias = d.dias === undefined ? undefined : TareasRouter.dias(d.dias)
    const hora = d.hora === undefined ? undefined : TareasRouter.hora(d.hora)
    const zona = TareasRouter.zona(d.zona)
    const activa = TareasRouter.booleano(d.activa, 'activa')
    const tipo = TareasRouter.tipo(d.tipo)
    if (d.fecha !== undefined && d.dias !== undefined) throw new ErrorAPI(400, 'Elegí días (si se repite) o una fecha (si es una sola vez), no las dos cosas.')
    const fecha = d.fecha === undefined ? undefined : TareasRouter.fecha(d.fecha)
    const ia = TareasRouter.ia(d.ia)
    const quitar = TareasRouter.quitar(d.quitarArchivos)
    const nuevos = Adjuntos.leer(d.archivos)
    let adjuntos: string[] = []
    if (nuevos.length > 0) {
      const t0 = this.buscar(id, this.s.oficinas.requerirActiva())
      const quedan = (t0.archivos ?? []).filter((r) => !quitar.includes(r)).length
      if (quedan + nuevos.length > Adjuntos.maxArchivos) throw new ErrorAPI(400, `Una tarea puede llevar hasta ${Adjuntos.maxArchivos} archivos.`)
      adjuntos = this.guardarAdjuntos(nuevos, t0.agente)
    }
    const ahora = Programacion.iso(this.reloj())
    const [t, a] = this.s.oficinas.modificar((o) => {
      const i = o.tareas?.findIndex((x) => x.id === id) ?? -1
      if (i < 0) throw new ErrorAPI(404, 'No existe esa tarea.')
      const t: TareaProgramada = { ...o.tareas![i]! }
      let cambioHorario = false
      if (quitar.length > 0 || adjuntos.length > 0) {
        const lista = (t.archivos ?? []).filter((r) => !quitar.includes(r)).concat(adjuntos)
        if (lista.length > Adjuntos.maxArchivos) throw new ErrorAPI(400, `Una tarea puede llevar hasta ${Adjuntos.maxArchivos} archivos.`)
        if (lista.length > 0) t.archivos = lista
        else delete t.archivos
      }
      if (nombre !== undefined) t.nombre = nombre
      if (consigna !== undefined) t.consigna = consigna
      if (ia === null) delete t.ia
      else if (ia !== undefined) t.ia = ia
      // pasar de un tipo al otro
      const unica = tipo ?? (fecha !== undefined ? true : dias !== undefined ? false : esUnica(t))
      if (unica && !esUnica(t)) {
        if (fecha === undefined) throw new ErrorAPI(400, 'Para que se haga una sola vez, elegí la fecha.')
        t.fecha = fecha
        t.dias = []
        cambioHorario = true
      } else if (!unica && esUnica(t)) {
        if (dias === undefined) throw new ErrorAPI(400, 'Para que se repita, elegí los días.')
        delete t.fecha
        delete t.hecha
        t.dias = dias
        cambioHorario = true
      } else if (unica) {
        if (dias !== undefined) throw new ErrorAPI(400, 'Una tarea de una sola vez no lleva días: cambiale la fecha.')
        if (fecha !== undefined && fecha !== t.fecha) {
          t.fecha = fecha
          cambioHorario = true
        }
      } else {
        if (fecha !== undefined) throw new ErrorAPI(400, 'Una tarea que se repite no lleva fecha: cambiale los días.')
        if (dias !== undefined && JSON.stringify(dias) !== JSON.stringify(t.dias)) {
          t.dias = dias
          cambioHorario = true
        }
      }
      if (hora !== undefined && hora !== t.hora) {
        t.hora = hora
        cambioHorario = true
      }
      if (zona !== undefined && zona !== t.zona) {
        t.zona = zona
        cambioHorario = true
      }
      // una única hecha a la que le cambian el horario vuelve a estar pendiente (y activa, salvo que la pausen)
      if (esUnica(t) && t.hecha !== undefined && cambioHorario) {
        delete t.hecha
        if (activa === undefined) t.activa = true
      }
      if (activa !== undefined) {
        if (activa && !t.activa) {
          if (!o.agentes.some((x) => x.id === t.agente)) throw new ErrorAPI(409, 'El agente de esta tarea ya no está en la oficina.')
          if (esUnica(t) && t.hecha !== undefined) {
            throw new ErrorAPI(409, 'Esta tarea ya se hizo. Cambiale la fecha o la hora para que se haga de nuevo, o usá «Hacer ahora».')
          }
          cambioHorario = true
        }
        t.activa = activa
      }
      if (esUnica(t) && t.activa && !o.agentes.some((x) => x.id === t.agente)) {
        throw new ErrorAPI(409, 'El agente de esta tarea ya no está en la oficina.')
      }
      // una tarea movida o reactivada no se pone al día con el horario que ya pasó hoy
      if (cambioHorario) t.desde = ahora
      o.tareas![i] = t
      return t
    })
    return [200, { tarea: this.vista(t, a, this.reloj()) }]
  }

  private borrar(id: string): Resp {
    const a = this.s.oficinas.requerirActiva()
    this.buscar(id, a)
    if (this.programador.estaCorriendo(a.carpeta, id)) throw new ErrorAPI(409, 'La tarea está corriendo ahora. Esperá a que termine para borrarla.')
    this.s.oficinas.modificar((o) => {
      if (!o.tareas?.some((x) => x.id === id)) throw new ErrorAPI(404, 'No existe esa tarea.')
      o.tareas = o.tareas.filter((x) => x.id !== id)
      if (o.tareas.length === 0) delete o.tareas
    })
    try { this.programador.ejecuciones.borrar(a.carpeta, id) } catch {}
    return [200, { ok: true }]
  }

  // MARK: corridas

  private async correr(id: string): Promise<Resp> {
    const a = this.s.oficinas.requerirActiva()
    const t = this.buscar(id, a)
    const def = a.oficina.agentes.find((x) => x.id === t.agente)
    if (!def) throw new ErrorAPI(409, 'El agente de esta tarea ya no está en la oficina.')
    const ej = await this.programador.correrAhora(a, t, def)
    return [202, { ejecucion: ejecucionJSON(ej) }]
  }

  private ejecucionesDe(id: string): Resp {
    const a = this.s.oficinas.requerirActiva()
    this.buscar(id, a)
    return [200, { ejecuciones: this.programador.ejecuciones.lista(a.carpeta, id, 20).map(ejecucionJSON) }]
  }
}

// MARK: - módulo

/** El programador (undefined hasta que se instala el módulo de tareas). */
export const programadorDe = (s: Servicios) => s.huecos.programador as Programador | undefined

export function instalar(s: Servicios) {
  const prog = new Programador(s)
  prog.preparar()
  s.huecos.programador = prog
  s.permisosTareas = () => ({
    pendientes: (o) => prog.pendientesPermiso(o),
    responder: (o, id, d) => prog.responderPermiso(o, id, d),
  })
  s.router.tareas = new TareasRouter(s, prog)
  s.validaciones.push((o) => ValidarTareas.validar(o))

  // una tarea que falla deja un aviso «te necesita» (y la notificación nativa, vía el canal). Las que terminan bien dejan
  // una entrega (la crea el programador), que la reemplaza en la bandeja.
  prog.alTerminar((e) => {
    if (e.estado === 'ok') return
    const of = s.oficinas.activa()?.oficina
    const t = of?.tareas?.find((x) => x.id === e.tarea)
    const tarea = t?.nombre ?? nombreCorrida(e.tarea)
    const act = s.oficinas.activa()
    const de = t && act ? charlaDe(t, act, s.store) : undefined
    const texto = `«${tarea}» falló: ` + (e.error ?? 'error') + (de ? ` (salió de un chat con ${de.nombre})` : '')
    const av = s.avisos.crear({ oficina: e.oficina, tipo: 'error', agente: e.agente, texto, ref: e.sid })
    if (av) s.avisos.emitir(av, of?.agentes.find((a) => a.id === e.agente)?.nombre ?? e.agente)
  })

  s.alAbrir.push(async (a) => { prog.retomarRespondidas(a.carpeta) })
  s.alArrancar.push(() => { prog.iniciar(); const a = s.oficinas.activa(); if (a) prog.retomarRespondidas(a.carpeta) })
  // Swift: programador.detener → mcp.cerrar → runner.shutdown → programador.esperar
  s.alCerrar.unshift(() => prog.detener())
  s.despuesDeProcesos.push(() => prog.esperar())
}

/** Si la tarea salió de una charla de la oficina: el agente de esa charla (si todavía está). */
function charlaDe(t: TareaProgramada, a: OficinaActiva, store: Servicios['store']): AgenteDef | undefined {
  if (!t.origen || !('chat' in t.origen)) return undefined
  const id = store.agenteDe(t.origen.chat)
  return id === undefined ? undefined : a.oficina.agentes.find((x) => x.id === id)
}

registrarModulo('tareas', 40, instalar)
