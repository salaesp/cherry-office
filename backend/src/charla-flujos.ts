// Flujos desde la charla (docs/plan-recados.md, R1b): cuando la persona le escribe a un agente, este puede arrancar un flujo
// de la oficina (`arrancar_flujo`) en vez de inventar una delegación suelta, seguir lo que está en curso (`en_curso`) y,
// solo por pedido de la persona, aprobar, pedir cambios o dar por hecho el paso de un flujo que la espera.
//
// - Directo o propuesta: `modo: "directo"` solo vale si el último mensaje de la persona nombra el flujo (nombre o id) o usa
//   una de sus frases (`disparadores`); si no, queda como propuesta que ella confirma. Lo directo espera
//   `Delegaciones.ventana` segundos (para «Deshacer») y, con `cuando`, queda programado para esa fecha.
// - Sin un dato obligatorio (`FlujoDef.datos`), no arranca: el agente recibe el error y se lo pregunta.
// - La corrida queda atada a su tarjeta (`datos.corrida`): cuando llega a un paso con aprobación o a un paso de la persona, la
//   tarjeta lo muestra con sus botones, sale un aviso (con notificación) y el agente se entera en el próximo mensaje
//   (`novedad`). Al terminar o trabarse, lo mismo.
// - `aprobar_paso`, `pedir_cambios` y `paso_hecho` solo existen en la charla con la persona (nunca en revisiones de fuentes
//   ni corriendo solos) y solo actúan si hay una sola corrida que encaja; si hay más, devuelven la lista para preguntar.
import { normalizar, mcpDe, sanear } from './consultas.js'
import { corridasAbiertas, resumenPaso, type Corrida } from './corridas-store.js'
import { Delegaciones, delegacionesDe, leerCuando, type Tarjeta } from './delegar.js'
import { ErrorAPI } from './errores.js'
import { motorDe } from './flujos.js'
import { esObjeto, type Obj } from './json.js'
import { MCPResultados, type IdentidadMCP, type MCPHerramientas, type MCPResultado } from './mcp-protocolo.js'
import type { FlujoDef } from './modelo-flujos.js'
import { MotorFlujos } from './motor-flujos.js'
import type { AgenteDef, Oficina } from './oficina.js'
import type { OficinaActiva } from './oficinas.js'
import { entregasRouterDe } from './rutas-entregas.js'
import { registrarModulo, type Servicios } from './servicios.js'
import { largo, plegar, prefijo } from './validar.js'

export const LimitesFlujosCharla = {
  maxArranques: 2,
  maxAcciones: 2,
  maxPorQue: 300,
  maxDato: 500,
}
const L = LimitesFlujosCharla

/** Estados de la tarjeta de flujo que esperan a la persona. */
export const esperanPersonaFlujo = ['propuesta', 'te_espera']

// MARK: - lógica pura

/** ¿El texto de la persona nombra este flujo? Por nombre, id o una de sus frases, sin mayúsculas ni acentos. */
export function nombraFlujo(texto: string, f: FlujoDef): boolean {
  const t = ` ${plegar(texto).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `
  const frases = [f.nombre, f.id.replace(/-/g, ' '), ...(f.disparadores ?? [])]
  return frases.some((x) => {
    const n = plegar(x).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    return n.length >= 3 && t.includes(` ${n} `)
  })
}

/** Los datos obligatorios del flujo que faltan (o vienen vacíos). */
export function datosFaltantes(f: FlujoDef, datos: Record<string, string>): string[] {
  const dados = new Map(Object.entries(datos).map(([k, v]) => [plegar(k).trim(), v.trim()]))
  return (f.datos ?? []).filter((d) => d.obligatorio && !(dados.get(plegar(d.nombre).trim()) ?? '')).map((d) => d.nombre)
}

/** El contexto con el que arranca la corrida: lo que pidió la persona (escrito por el agente) y los datos. */
export function contextoCorrida(contexto: string, datos: Record<string, string>): string {
  let s = contexto.trim()
  const filas = Object.entries(datos).filter(([, v]) => v.trim() !== '').map(([k, v]) => `- ${k}: ${v.trim()}`)
  if (filas.length > 0) s += `${s === '' ? '' : '\n\n'}Datos:\n${filas.join('\n')}`
  return s
}

/** El catálogo de flujos para las instrucciones de la charla. */
export function instruccionesFlujos(o: Oficina, a: AgenteDef): string | undefined {
  const activos = (o.flujos ?? []).filter((f) => f.activo && f.pasos.length > 0)
  const persona = o.duenio.trim() === '' ? 'la persona que dirige la oficina' : o.duenio.trim()
  const nombre = (id: string) => (id === 'persona' ? persona : o.agentes.find((x) => x.id === id)?.nombre ?? id)
  const l = [
    '## Flujos de la oficina',
    'Para seguir lo que está en marcha (delegaciones y flujos: en qué paso está, quién lo tiene, desde cuándo) usá en_curso.',
  ]
  if (activos.length === 0) {
    l.push('No hay flujos activos: no podés arrancar ninguno.')
  } else {
    l.push(
      `Un flujo es un proceso que ${persona} ya definió (pasos, quién hace cada uno, dónde aprueba). Si lo que pide encaja con uno, arrancalo con arrancar_flujo en vez de delegar suelto; ante la duda entre un flujo y una delegación, gana el flujo.`,
      `- modo "directo" solo si ${persona} nombró el flujo o usó una de sus frases; si lo deducís vos, "propuesta" (lo confirma). Para más adelante, usá cuando.`,
      '- El contexto lo lee el primer paso, que NO vio la charla: qué se pide, para qué y con qué datos. Si falta un dato obligatorio (marcado con *), preguntalo antes de arrancar.',
      `- aprobar_paso, pedir_cambios y paso_hecho solo cuando ${persona} te lo pide en este mensaje («aprobale el boceto a Sofía»). Si hay más de una corrida que encaja, preguntale cuál.`,
      '', 'Flujos:',
    )
    for (const f of activos) {
      const datos = (f.datos ?? []).map((d) => d.nombre + (d.obligatorio ? '*' : '')).join(', ')
      l.push(`- ${f.nombre} (id ${f.id})${f.descripcion ? `: ${f.descripcion}` : ''}`)
      l.push(`  Pasos: ${f.pasos.map((p) => `${p.nombre} (${nombre(p.quien)}${p.aprobacion ? ', con aprobación' : ''})`).join(' → ')}`)
      if (f.disparadores?.length) l.push(`  Se nombra: ${f.disparadores.join(', ')}`)
      if (datos) l.push(`  Necesita: ${datos}`)
    }
  }
  void a
  return l.join('\n')
}

// MARK: - servicio

const ahoraSeg = () => Date.now() / 1000

export class FlujosCharla {
  /** El temporizador más largo (los programados a varios días se vuelven a revisar). */
  static readonly maxEspera = 6 * 3600
  private readonly timers = new Map<number, NodeJS.Timeout>()
  private cerrando = false

  constructor(private readonly s: Servicios, private readonly d: Delegaciones) {}

  /** Al cerrar la app: no lanza nada más (lo programado se retoma al volver a abrir). */
  detener() {
    this.cerrando = true
    for (const h of this.timers.values()) clearTimeout(h)
    this.timers.clear()
  }

  private get motor(): MotorFlujos {
    const m = motorDe(this.s)
    if (!m) throw new ErrorAPI(500, 'Los flujos no están disponibles.')
    return m
  }

  /** Registra el arranque: directo (espera la ventana o `cuando`) o propuesta. */
  arrancar(act: OficinaActiva, de: AgenteDef, sid: string, p: { flujo: FlujoDef; nombre: string; contexto: string; datos: Record<string, string>; porQue: string; directo: boolean; cuando?: { fecha: string; hora: string }; citas?: { texto: string; compartido: Obj[] } }): Tarjeta {
    const datos: Obj = {
      flujo: p.flujo.id, flujoNombre: p.flujo.nombre, nombre: p.nombre, contexto: p.contexto, datos: p.datos, por_que: p.porQue,
      pasos: p.flujo.pasos.map((x) => x.nombre), ...(p.cuando ? { cuando: p.cuando } : {}), ...(p.citas ? { citado: p.citas.texto, compartido: p.citas.compartido } : {}),
    }
    const base = { oficina: act.carpeta, agente: de.id, sid, turno: this.d.turno(sid), tipo: 'flujo' as const }
    if (!p.directo) return this.d.store.crear({ ...base, estado: 'propuesta', datos })
    let empieza = ahoraSeg() + Delegaciones.ventana
    if (p.cuando) {
      const [a, m, dd] = p.cuando.fecha.split('-').map(Number) as [number, number, number]
      const [h, mi] = p.cuando.hora.split(':').map(Number) as [number, number]
      empieza = new Date(a, m - 1, dd, h, mi).getTime() / 1000
    }
    const t = this.d.store.crear({ ...base, estado: p.cuando ? 'programada' : 'esperando', datos: { ...datos, empieza } })
    this.agendar(t)
    return this.d.store.una(t.id)!
  }

  private agendar(t: Tarjeta) {
    if (this.cerrando) return
    clearTimeout(this.timers.get(t.id))
    const empieza = typeof t.datos.empieza === 'number' ? t.datos.empieza : 0
    const falta = Math.max(0, empieza - ahoraSeg())
    const h = setTimeout(() => {
      this.timers.delete(t.id)
      if (this.cerrando) return
      let x: Tarjeta | undefined
      try { x = this.d.store.una(t.id) } catch { return }   // la base ya se cerró
      if (!x) return
      if (falta > FlujosCharla.maxEspera) this.agendar(x)
      else this.lanzar(t.id).catch((e) => { if (!this.cerrando) this.s.log.error(`charla-flujos: no pude arrancar la tarjeta ${t.id}: ${e instanceof Error ? e.message : String(e)}`) })
    }, Math.min(falta, FlujosCharla.maxEspera) * 1000)
    h.unref?.()
    this.timers.set(t.id, h)
  }

  /** Arranca la corrida de una tarjeta que espera (o programada que ya llegó). */
  async lanzar(id: number): Promise<Tarjeta | undefined> {
    const t = this.d.store.una(id)
    if (!t || t.tipo !== 'flujo' || (t.estado !== 'esperando' && t.estado !== 'programada')) return t
    const act = this.s.oficinas.activa()
    if (!act || act.carpeta !== t.oficina) return t   // al abrir la oficina se retoma
    const f = act.oficina.flujos?.find((x) => x.id === t.datos.flujo)
    const falla = (error: string) => { this.d.store.poner(id, { estado: 'fallida', datos: { ...t.datos, error } }); return this.d.store.una(id) }
    if (!f) return falla('Ese flujo ya no existe.')
    if (!f.activo) return falla('Ese flujo está pausado.')
    const datos = esObjeto(t.datos.datos) ? Object.fromEntries(Object.entries(t.datos.datos).map(([k, v]) => [k, String(v)])) : {}
    const citado = typeof t.datos.citado === 'string' ? `\n\n${t.datos.citado}` : ''
    const contexto = prefijo(contextoCorrida(String(t.datos.contexto ?? ''), datos) + citado, MotorFlujos.maxContexto)
    try {
      // la tarjeta queda atada antes de iniciar: el primer paso ya puede cambiar la corrida (y avisar a esta tarjeta)
      this.d.store.poner(id, { estado: 'en_curso' })
      const c = await this.motor.iniciar(act, f, prefijo(String(t.datos.nombre), MotorFlujos.maxNombre), contexto)
      const x = this.d.store.una(id)!
      this.d.store.poner(id, { datos: { ...x.datos, corrida: c.id } })
      this.alCambiar(this.motor.store.corrida(act.carpeta, c.id) ?? c)
    } catch (e) {
      return falla(e instanceof ErrorAPI ? e.mensaje : 'No pude arrancarlo.')
    }
    return this.d.store.una(id)
  }

  /** Al abrir la oficina o arrancar: lo que esperaba se vuelve a programar. */
  reanudar(carpeta: string) {
    for (const t of this.d.store.enEstado(carpeta, 'flujo', ['esperando', 'programada'])) this.agendar(t)
  }

  /** La corrida de una tarjeta cambió: la tarjeta lo refleja y, si hace falta, avisa. */
  alCambiar(c: Corrida) {
    const t = this.d.store.porCorrida(c.oficina, c.id)
    if (!t) return
    const p = this.motor.store.pasoVigente(c.id)
    const r = resumenPaso(c)
    const act = this.s.oficinas.activa()
    const o = act?.carpeta === c.oficina ? act.oficina : undefined
    const persona = o?.duenio.trim() || 'vos'
    const quien = (id: string) => (id === 'persona' ? persona : o?.agentes.find((x) => x.id === id)?.nombre ?? id)
    const base: Obj = { ...t.datos, corrida: c.id, paso: c.paso, pasoNombre: r.nombre, quien: r.quien, desde: c.actualizada }
    delete base.espera
    delete base.entrega
    const nombre = String(t.datos.nombre)
    switch (c.estado) {
      case 'en_curso':
        if (t.estado !== 'en_curso' || t.datos.paso !== c.paso) this.d.store.poner(t.id, { estado: 'en_curso', datos: base })
        return
      case 'esperando_aprobacion': {
        if (t.estado === 'te_espera' && t.datos.espera === 'aprobacion' && t.datos.entrega === p?.entrega) return
        this.d.store.poner(t.id, { estado: 'te_espera', datos: { ...base, espera: 'aprobacion', ...(p?.entrega !== undefined ? { entrega: p.entrega } : {}) } })
        this.d.novedad(this.d.store.una(t.id)!, `«${nombre}»: ${quien(r.quien)} terminó «${r.nombre}» y espera la aprobación de ${persona}.`, false)
        const av = this.s.avisos.crear({ oficina: c.oficina, tipo: 'flujo', texto: `«${nombre}» espera tu aprobación: ${r.nombre}`, ref: String(c.id) })
        if (av) this.s.avisos.emitir(av, String(t.datos.flujoNombre ?? 'Flujo'))
        return
      }
      case 'esperando_persona': {
        if (t.estado === 'te_espera' && t.datos.espera === 'persona') return
        this.d.store.poner(t.id, { estado: 'te_espera', datos: { ...base, espera: 'persona' } })
        this.d.novedad(this.d.store.una(t.id)!, `«${nombre}» llegó a «${r.nombre}», que le toca a ${persona}.`, false)
        // el aviso «te necesita» ya lo calcula el módulo de flujos: acá solo la notificación
        this.s.avisos.emitir({ id: `flujo:${c.id}`, tipo: 'flujo', agente: '', texto: `«${nombre}» te necesita: ${r.nombre}`, ref: String(c.id), creado: ahoraSeg() }, String(t.datos.flujoNombre ?? 'Flujo'))
        return
      }
      case 'terminada':
        if (t.estado === 'hecha') return
        this.d.store.poner(t.id, { estado: 'hecha', datos: base })
        // el motor ya avisa que terminó
        this.d.novedad(this.d.store.una(t.id)!, `«${nombre}» (flujo ${String(t.datos.flujoNombre)}) terminó: lo último está en la bandeja.`, false)
        return
      case 'trabada': {
        if (t.estado === 'trabada') return
        const motivo = p?.nota ?? 'un paso falló'
        this.d.store.poner(t.id, { estado: 'trabada', datos: { ...base, error: prefijo(motivo, 300) } })
        this.d.novedad(this.d.store.una(t.id)!, `«${nombre}» quedó trabada en «${r.nombre}»: ${prefijo(motivo, 200)}`)
        return
      }
      case 'cancelada':
        if (t.estado !== 'cancelada') this.d.store.poner(t.id, { estado: 'cancelada', datos: base })
        return
    }
  }

  // MARK: acciones

  private corridaDe(act: OficinaActiva, t: Tarjeta): Corrida {
    const id = typeof t.datos.corrida === 'number' ? t.datos.corrida : undefined
    const c = id === undefined ? undefined : this.motor.store.corrida(act.carpeta, id)
    if (!c) throw new ErrorAPI(409, 'Ese flujo todavía no arrancó.')
    return c
  }

  /** Aprueba la entrega vigente del paso que espera aprobación (como «Listo» en la bandeja). */
  async aprobar(act: OficinaActiva, c: Corrida) {
    const p = this.motor.store.pasoVigente(c.id)
    if (c.estado !== 'esperando_aprobacion' || !p || p.estado !== 'esperando_aprobacion' || p.entrega === undefined) throw new ErrorAPI(409, 'Esa corrida no espera una aprobación.')
    const e = this.s.entregas.una(act.carpeta, p.entrega)
    if (!e) throw new ErrorAPI(409, 'No encuentro la entrega de ese paso.')
    if (e.estado === 'cambios') throw new ErrorAPI(409, 'Esa entrega ya tiene una versión nueva.')
    const n = this.s.entregas.marcar(act.carpeta, e.id, 'revisada')
    if (!n) throw new ErrorAPI(500, 'No pude guardar.')
    for (const f of entregasRouterDe(this.s).alRevisar) await f(n, act)
  }

  /** Pide cambios en el paso que espera aprobación: vuelve a correr con la nota. */
  async cambios(act: OficinaActiva, c: Corrida, nota: string) {
    if (c.estado !== 'esperando_aprobacion') throw new ErrorAPI(409, 'Esa corrida no espera una aprobación.')
    if (nota.trim() === '') throw new ErrorAPI(400, 'Decí qué cambiar.')
    await this.motor.volver(act, c.id, c.paso, nota)
  }

  async hecho(act: OficinaActiva, c: Corrida, nota: string) {
    if (c.estado !== 'esperando_persona') throw new ErrorAPI(409, 'Esa corrida no espera un paso tuyo.')
    await this.motor.hecho(act, c.id, nota.trim() === '' ? undefined : nota, [])
  }

  /** Lo que la persona hace con una tarjeta de flujo. */
  async decidir(act: OficinaActiva, t: Tarjeta, accion: string, cuerpo: Obj): Promise<{ mensaje?: string }> {
    const nota = typeof cuerpo.nota === 'string' ? sanear(cuerpo.nota).trim() : ''
    if (largo(nota) > MotorFlujos.maxNota) throw new ErrorAPI(400, `La nota es demasiado larga (máximo ${MotorFlujos.maxNota} caracteres).`)
    switch (accion) {
      case 'cancelar':
        if (t.estado !== 'esperando' && t.estado !== 'programada') throw new ErrorAPI(409, t.estado === 'propuesta' ? 'Es una propuesta: descartala.' : 'Ya arrancó: cancelá la corrida desde Flujos.')
        clearTimeout(this.timers.get(t.id)); this.timers.delete(t.id)
        this.d.store.poner(t.id, { estado: 'cancelada' })
        return {}
      case 'descartar':
        if (t.estado !== 'propuesta') throw new ErrorAPI(409, 'Ese flujo ya no es una propuesta.')
        this.d.store.poner(t.id, { estado: 'cancelada' })
        return {}
      case 'confirmar':
      case 'ya': {
        if (accion === 'confirmar' && t.estado !== 'propuesta') throw new ErrorAPI(409, 'Ese flujo ya no es una propuesta.')
        if (accion === 'ya' && t.estado !== 'esperando' && t.estado !== 'programada') throw new ErrorAPI(409, 'Ese flujo no está esperando.')
        clearTimeout(this.timers.get(t.id)); this.timers.delete(t.id)
        this.d.store.poner(t.id, { estado: 'esperando', datos: { ...t.datos, empieza: ahoraSeg() } })
        await this.lanzar(t.id)
        return {}
      }
      case 'aprobar': await this.aprobar(act, this.corridaDe(act, t)); return {}
      case 'cambios': await this.cambios(act, this.corridaDe(act, t), nota); return {}
      case 'hecho': await this.hecho(act, this.corridaDe(act, t), nota); return {}
      default: throw new ErrorAPI(400, 'Esa acción no corresponde a esta tarjeta.')
    }
  }
}

export const flujosCharlaDe = (s: Servicios) => s.huecos.flujosCharla as FlujosCharla | undefined

// MARK: - herramientas MCP

const texto = (v: unknown) => sanear(typeof v === 'string' ? v : '').trim()
const fecha = (seg: number) => {
  const d = new Date(seg * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export class HerramientasFlujosCharla implements MCPHerramientas {
  constructor(private readonly s: Servicios, private readonly fc: FlujosCharla, private readonly d: Delegaciones, private readonly token: string, private readonly identidad: IdentidadMCP) {}

  readonly definiciones: Obj[] = [
    {
      name: 'en_curso',
      description: 'Lo que está en marcha en la oficina: delegaciones que esperan o corren y corridas de flujos abiertas (en qué paso, quién lo tiene, desde cuándo). Para contestar «¿cómo va…?».',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'arrancar_flujo',
      description: `Arranca un flujo de la oficina con lo que pidió la persona. modo "directo" (solo si ella nombró el flujo o usó una de sus frases) se lanza en ${Delegaciones.ventana} segundos o en «cuando»; "propuesta" queda para que ella lo confirme. Si falta un dato obligatorio, no arranca: preguntáselo. Máximo ${L.maxArranques} por mensaje.`,
      inputSchema: {
        type: 'object',
        properties: {
          flujo: { type: 'string', description: 'id o nombre del flujo' },
          nombre: { type: 'string', description: `nombre de la corrida, corto (máximo ${MotorFlujos.maxNombre} caracteres), p. ej. «Nivel nuevo de Julio»` },
          modo: { type: 'string', enum: ['directo', 'propuesta'] },
          por_que: { type: 'string', description: 'en una línea, por qué este flujo (lo ve la persona en la tarjeta)' },
          contexto: { type: 'string', description: 'qué se pide, para qué y con qué datos: lo lee el primer paso, que no vio la charla' },
          datos: { type: 'object', description: 'los datos que pide el flujo, nombre → valor', additionalProperties: { type: 'string' } },
          cuando: { type: 'string', description: 'opcional: para más adelante, «AAAA-MM-DDTHH:MM» (hora local)' },
          citas: { type: 'array', items: { type: 'number' }, description: `opcional: mensajes de WhatsApp que el flujo necesita, por su N de [wa:N] (hasta ${Delegaciones.maxCitas}). Va solo eso, no el chat` },
        },
        required: ['flujo', 'nombre', 'modo', 'contexto'],
      },
    },
    {
      name: 'aprobar_paso',
      description: 'Aprueba lo que entregó el paso de un flujo que espera la aprobación de la persona. Solo si ella te lo pide en este mensaje.',
      inputSchema: { type: 'object', properties: { corrida: { type: 'number', description: 'n.º de corrida (opcional si hay una sola esperando)' } } },
    },
    {
      name: 'pedir_cambios',
      description: 'Devuelve el paso de un flujo que espera aprobación, con lo que la persona quiere cambiar. Solo si ella te lo pide en este mensaje.',
      inputSchema: {
        type: 'object',
        properties: { corrida: { type: 'number', description: 'n.º de corrida (opcional si hay una sola esperando)' }, nota: { type: 'string', description: 'qué cambiar, con sus palabras' } },
        required: ['nota'],
      },
    },
    {
      name: 'paso_hecho',
      description: 'Da por hecho el paso de un flujo que le toca a la persona («ya firmé el contrato»). Solo si ella te lo dice en este mensaje.',
      inputSchema: {
        type: 'object',
        properties: { corrida: { type: 'number', description: 'n.º de corrida (opcional si hay una sola esperando)' }, nota: { type: 'string', description: 'lo que contó, si dijo algo más' } },
      },
    },
  ]

  async llamar(nombre: string, a: Obj): Promise<MCPResultado | undefined> {
    switch (nombre) {
      case 'en_curso': return this.enCurso()
      case 'arrancar_flujo': return this.arrancar(a)
      case 'aprobar_paso': return this.accion('aprobar', a)
      case 'pedir_cambios': return this.accion('cambios', a)
      case 'paso_hecho': return this.accion('hecho', a)
      default: return undefined
    }
  }

  private activa(): OficinaActiva | undefined {
    const act = this.s.oficinas.activa()
    return act && act.carpeta === this.identidad.oficina ? act : undefined
  }

  private enCurso(): MCPResultado {
    const act = this.activa()
    if (!act) return MCPResultados.error('La oficina ya no está abierta.')
    const o = act.oficina
    const persona = o.duenio.trim() || 'la persona'
    const nombre = (id: string) => (id === 'persona' ? persona : o.agentes.find((x) => x.id === id)?.nombre ?? id)
    const EST: Record<string, string> = { propuesta: 'propuesta, sin confirmar', esperando: 'por empezar', corriendo: 'trabajando', programada: 'programada' }
    const deleg = this.d.store.enEstado(act.carpeta, 'delegacion', Object.keys(EST))
      .map((t) => `- «${String(t.datos.nombre)}»: ${nombre(t.agente)} se la pasó a ${nombre(String(t.datos.para))}; ${EST[t.estado]}${t.estado === 'programada' && esObjeto(t.datos.cuando) ? ` para el ${String(t.datos.cuando.fecha)} ${String(t.datos.cuando.hora)}` : ''} (desde ${fecha(t.actualizado)}).`)
    const pend = this.d.store.enEstado(act.carpeta, 'flujo', ['propuesta', 'esperando', 'programada'])
      .map((t) => `- «${String(t.datos.nombre)}» (flujo ${String(t.datos.flujoNombre)}): ${t.estado === 'propuesta' ? 'propuesta, sin confirmar' : t.estado === 'programada' ? 'programada' : 'por arrancar'}.`)
    const ESTC: Record<string, string> = { en_curso: 'en curso', esperando_aprobacion: `espera la aprobación de ${persona}`, esperando_persona: `le toca a ${persona}`, trabada: 'trabada' }
    const motor = motorDe(this.s)
    const corridas = (motor?.store.corridas(act.carpeta, { estados: corridasAbiertas, limite: 30 }) ?? []).map((c) => {
      const r = resumenPaso(c)
      const p = motor!.store.pasoVigente(c.id)
      const total = (() => { try { return (JSON.parse(c.definicion) as { pasos?: unknown[] }).pasos?.length ?? 0 } catch { return 0 } })()
      const extra = c.estado === 'trabada' && p?.nota ? `: ${prefijo(p.nota, 160)}` : ''
      return `- Corrida n.º ${c.id} «${c.nombre}»: paso ${c.paso + 1} de ${total}, «${r.nombre}» (${nombre(r.quien)}); ${ESTC[c.estado] ?? c.estado}${extra} (desde ${fecha(c.actualizada)}).`
    })
    const l: string[] = []
    if (deleg.length) l.push('Delegaciones:', ...deleg)
    if (pend.length) l.push('Flujos por arrancar:', ...pend)
    if (corridas.length) l.push('Corridas de flujos abiertas:', ...corridas)
    return MCPResultados.ok(l.length ? l.join('\n') : 'No hay nada en marcha: ni delegaciones abiertas ni corridas de flujos.')
  }

  /** El último mensaje de la persona en esta charla (para decidir si nombró el flujo). */
  private ultimoMensaje(): string {
    const ms = this.s.store.mensajes(this.identidad.sid, 20)
    for (let i = ms.length - 1; i >= 0; i--) if (ms[i]!.r === 'u') return ms[i]!.t
    return ''
  }

  private async arrancar(a: Obj): Promise<MCPResultado> {
    const act = this.activa()
    if (!act) return MCPResultados.error('La oficina ya no está abierta.')
    const de = act.oficina.agentes.find((x) => x.id === this.identidad.agente)
    if (!de) return MCPResultados.error('No te encuentro en la oficina.')
    const q = normalizar(texto(a.flujo))
    const activos = (act.oficina.flujos ?? []).filter((f) => f.activo)
    const f = (act.oficina.flujos ?? []).find((x) => x.id === texto(a.flujo)) ?? (act.oficina.flujos ?? []).find((x) => normalizar(x.nombre) === q)
    if (!f) return MCPResultados.error(`No hay un flujo «${texto(a.flujo)}». Flujos activos: ${activos.map((x) => `${x.id} (${x.nombre})`).join(', ') || 'ninguno'}.`)
    if (!f.activo) return MCPResultados.error(`El flujo «${f.nombre}» está pausado: contale a la persona y no lo arranques.`)
    const nombre = texto(a.nombre).replace(/\s+/g, ' ')
    const contexto = texto(a.contexto)
    if (nombre === '' || contexto === '') return MCPResultados.error('Faltan «nombre» y «contexto».')
    if (a.modo !== 'directo' && a.modo !== 'propuesta') return MCPResultados.error('«modo» tiene que ser "directo" o "propuesta".')
    const datos: Record<string, string> = {}
    if (esObjeto(a.datos)) for (const [k, v] of Object.entries(a.datos)) {
      const kk = sanear(k).trim(), vv = texto(typeof v === 'number' ? String(v) : v)
      if (kk !== '' && vv !== '') datos[prefijo(kk, 60)] = prefijo(vv, L.maxDato)
    }
    const faltan = datosFaltantes(f, datos)
    if (faltan.length > 0) return MCPResultados.error(`Para arrancar «${f.nombre}» falta: ${faltan.join(', ')}. Preguntáselo a la persona (con preguntar) y no lo arranques todavía.`)
    let cuando: { fecha: string; hora: string } | undefined
    if (typeof a.cuando === 'string' && a.cuando.trim() !== '') {
      cuando = leerCuando(a.cuando)
      if (!cuando) return MCPResultados.error('«cuando» tiene que ser una fecha futura con la forma AAAA-MM-DDTHH:MM.')
    }
    const citas = this.d.citas(act.oficina, de, a.citas)
    if (typeof citas === 'string') return MCPResultados.error(citas)
    if (largo(contextoCorrida(contexto, datos) + (citas ? `\n\n${citas.texto}` : '')) > MotorFlujos.maxContexto) return MCPResultados.error(`El contexto con los datos es demasiado largo (máximo ${MotorFlujos.maxContexto} caracteres).`)
    const tokens = mcpDe(this.s)?.tokens
    if (!tokens || !tokens.tomar(this.token, 'arrancar_flujo', L.maxArranques)) return MCPResultados.error(`Ya arrancaste ${L.maxArranques} flujos en este mensaje.`)
    // «directo» solo si la persona nombró el flujo: si no, la tarjeta sale como propuesta
    const nombrado = nombraFlujo(this.ultimoMensaje(), f)
    const directo = a.modo === 'directo' && nombrado
    const t = this.fc.arrancar(act, de, this.identidad.sid, {
      flujo: f, nombre: prefijo(nombre, MotorFlujos.maxNombre), contexto, datos, porQue: prefijo(texto(a.por_que), L.maxPorQue), directo, ...(cuando ? { cuando } : {}), ...(citas ? { citas } : {}),
    })
    const jefe = act.oficina.duenio.trim() || 'la persona'
    const aviso = t.estado === 'propuesta'
      ? (a.modo === 'directo' ? `Quedó como propuesta porque ${jefe} no nombró el flujo: lo confirma o lo descarta.` : `Quedó como propuesta: ${jefe} la confirma o la descarta.`)
      : cuando ? `Queda programado para el ${cuando.fecha} a las ${cuando.hora}.` : `Arranca en ${Delegaciones.ventana} segundos (se puede deshacer hasta entonces).`
    return MCPResultados.ok(JSON.stringify({ ok: true, tarjeta: t.id, flujo: f.id, estado: t.estado, aviso }))
  }

  /** aprobar_paso / pedir_cambios / paso_hecho: sobre la única corrida que encaja (o la indicada). */
  private async accion(cual: 'aprobar' | 'cambios' | 'hecho', a: Obj): Promise<MCPResultado> {
    const act = this.activa()
    if (!act) return MCPResultados.error('La oficina ya no está abierta.')
    const motor = motorDe(this.s)
    if (!motor) return MCPResultados.error('Los flujos no están disponibles.')
    const estado = cual === 'hecho' ? 'esperando_persona' : 'esperando_aprobacion'
    const nota = texto(a.nota)
    if (cual === 'cambios' && nota === '') return MCPResultados.error('Falta «nota»: qué quiere cambiar la persona.')
    if (largo(nota) > MotorFlujos.maxNota) return MCPResultados.error(`La nota es demasiado larga (máximo ${MotorFlujos.maxNota} caracteres).`)
    const candidatas = motor.store.corridas(act.carpeta, { estados: [estado], limite: 50 })
    let c: Corrida | undefined
    if (typeof a.corrida === 'number') {
      c = candidatas.find((x) => x.id === a.corrida)
      if (!c) return MCPResultados.error(`La corrida n.º ${a.corrida} no está ${cual === 'hecho' ? 'esperando un paso de la persona' : 'esperando aprobación'}.`)
    } else if (candidatas.length === 1) {
      c = candidatas[0]
    } else {
      if (candidatas.length === 0) return MCPResultados.error(cual === 'hecho' ? 'No hay ningún flujo esperando un paso de la persona.' : 'No hay ningún flujo esperando aprobación.')
      return MCPResultados.error(`Hay ${candidatas.length} que encajan: ${candidatas.map((x) => `n.º ${x.id} «${x.nombre}» (${resumenPaso(x).nombre})`).join('; ')}. Preguntale a la persona cuál (con preguntar).`)
    }
    const tokens = mcpDe(this.s)?.tokens
    if (!tokens || !tokens.tomar(this.token, 'acciones_flujo', L.maxAcciones)) return MCPResultados.error(`Ya hiciste ${L.maxAcciones} cosas sobre flujos en este mensaje.`)
    try {
      if (cual === 'aprobar') await this.fc.aprobar(act, c!)
      else if (cual === 'cambios') await this.fc.cambios(act, c!, nota)
      else await this.fc.hecho(act, c!, nota)
    } catch (e) {
      return MCPResultados.error(e instanceof ErrorAPI ? e.mensaje : 'No pude hacerlo.')
    }
    const paso = resumenPaso(c!).nombre
    const hecho = cual === 'aprobar' ? `Aprobado «${paso}» de «${c!.nombre}»: el flujo sigue.` : cual === 'cambios' ? `«${paso}» de «${c!.nombre}» vuelve con la nota.` : `«${paso}» de «${c!.nombre}» quedó hecho: el flujo sigue.`
    return MCPResultados.ok(JSON.stringify({ ok: true, corrida: c!.id, aviso: hecho }))
  }
}

/** Solo en una charla con la persona, mientras corre su mensaje. */
export function herramientasFlujosCharla(s: Servicios, token: string, identidad: IdentidadMCP): MCPHerramientas | undefined {
  const d = delegacionesDe(s)
  const fc = flujosCharlaDe(s)
  if (!d || !fc || identidad.perfil === 'creador') return undefined
  if (!d.enCharla(identidad.oficina, identidad.agente, identidad.sid)) return undefined
  return new HerramientasFlujosCharla(s, fc, d, token, identidad)
}

// MARK: - instalación

export function instalar(s: Servicios) {
  const d = delegacionesDe(s)
  const motor = motorDe(s)
  if (!d || !motor) return
  const fc = new FlujosCharla(s, d)
  s.huecos.flujosCharla = fc
  d.extras.push((o, a) => instruccionesFlujos(o, a))
  d.manejadores.set('flujo', (act, t, accion, cuerpo) => fc.decidir(act, t, accion, cuerpo))
  d.esperanPersona.set('flujo', esperanPersonaFlujo)
  motor.alCambiar.push((c) => fc.alCambiar(c))
  mcpDe(s)?.registrarHerramientas(herramientasFlujosCharla)
  s.alArrancar.push(() => { const c = s.oficinas.activa()?.carpeta; if (c) fc.reanudar(c) })
  s.alAbrir.push(async (a) => fc.reanudar(a.carpeta))
  s.alCerrar.unshift(() => fc.detener())
}

registrarModulo('charla-flujos', 81, instalar)
