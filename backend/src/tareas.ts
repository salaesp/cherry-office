// Tareas programadas por agente (Tareas.swift): modelo de `oficina.json` (`tareas`), validación y lógica pura de
// horarios (Programacion). Sin estado ni reloj: `ahora` y la zona del sistema entran por parámetro.
//
// Zonas horarias con `Intl` (sin Temporal): misma regla que Calendar de Swift: una hora que no existe ese día
// (salto de DST hacia adelante) se corre hacia adelante; una que existe dos veces toma la primera.
import { Adjuntos } from './adjuntos.js'
import { ErrorAPI } from './errores.js'
import { esObjeto, type Obj } from './json.js'
import type { Oficina } from './oficina.js'
import { Slug, largo, uuidValido } from './validar.js'

// MARK: - modelo

/** De dónde salió una tarea: de un pendiente de reunión («Convertir en tarea»: id de la reunión y posición del
 *  pendiente) o de una charla con un agente («Sacar tareas»: id de la sesión). */
export type OrigenReunion = { reunion: string; pendiente: number }
export type OrigenChat = { chat: string }
export type OrigenTarea = OrigenReunion | OrigenChat

export const deReunion = (o: OrigenTarea | undefined): OrigenReunion | undefined => (o !== undefined && 'reunion' in o ? o : undefined)
export const deChat = (o: OrigenTarea | undefined): OrigenChat | undefined => (o !== undefined && 'chat' in o ? o : undefined)

/** Una consigna que un agente corre solo. Dos tipos:
 *  - repetida: en ciertos días (`dias`) a cierta hora, en la zona de la tarea;
 *  - única (`fecha` presente): una sola vez, ese día a esa hora; al terminar bien deja su entrega y queda `hecha` (y en pausa). */
export type TareaProgramada = {
  id: string
  agente: string
  nombre: string
  consigna: string
  /** 1 = lunes … 7 = domingo (ISO). */
  dias: number[]
  /** "HH:MM" (24 h). */
  hora: string
  /** Zona IANA. undefined = la del sistema. */
  zona?: string
  activa: boolean
  /** Fecha de creación (ISO 8601, UTC). */
  creada?: string
  /** «A partir de»: una corrida anterior a esta fecha no se pone al día (ISO 8601, UTC). */
  desde?: string
  origen?: OrigenTarea
  /** Solo las únicas: el día en que corre, "AAAA-MM-DD" (en la zona de la tarea). */
  fecha?: string
  /** Solo las únicas: cuándo terminó bien y dejó su entrega (ISO 8601, UTC). */
  hecha?: string
  /** Archivos adjuntos (rutas relativas a la oficina, dentro de `archivos/adjuntos/`): el agente los recibe con la consigna. */
  archivos?: string[]
  /** Solo en memoria (no va a `oficina.json`): instrucciones de esta corrida que van como mensaje de sistema, sumadas a las
   *  del agente (`--append-system-prompt`), en vez de quedar en la charla. Las arman la secretaría (revisión y reporte) y
   *  el programador (lo que entregó la vez anterior). */
  sistema?: string
}

/** Lo que recibe el agente: la consigna y, si tiene, la lista de adjuntos. */
export const mensajeTarea = (t: TareaProgramada): string => t.consigna + Adjuntos.texto(t.archivos ?? [])

export const esUnica = (t: TareaProgramada) => t.fecha !== undefined

// Decodificación como Codable: tipos estrictos en lo que viene; opcionales ausentes (o null) = undefined.
const falla = (): never => { throw new Error('formato inválido') }
const str = (v: unknown): string => (typeof v === 'string' ? v : falla())
const optStr = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : str(v))
const entero = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) ? v : falla())

/** JSON (ya parseado) → TareaProgramada. Lanza Error si no respeta los tipos (oficina.json inválido). */
export function decodificarTarea(v: unknown): TareaProgramada {
  if (!esObjeto(v)) return falla()
  const o: Obj = v
  const t: TareaProgramada = {
    id: str(o.id),
    agente: str(o.agente),
    nombre: optStr(o.nombre) ?? '',
    consigna: optStr(o.consigna) ?? '',
    dias: o.dias === undefined || o.dias === null ? [] : Array.isArray(o.dias) ? o.dias.map(entero) : falla(),
    hora: optStr(o.hora) ?? '',
    activa: o.activa === undefined || o.activa === null ? true : typeof o.activa === 'boolean' ? o.activa : falla(),
  }
  const zona = optStr(o.zona)
  const creada = optStr(o.creada)
  const desde = optStr(o.desde)
  const fecha = optStr(o.fecha)
  const hecha = optStr(o.hecha)
  if (zona !== undefined) t.zona = zona
  if (creada !== undefined) t.creada = creada
  if (desde !== undefined) t.desde = desde
  if (o.origen !== undefined && o.origen !== null) {
    if (!esObjeto(o.origen)) falla()
    const x = o.origen as Obj
    t.origen = x.chat !== undefined ? { chat: str(x.chat) } : { reunion: str(x.reunion), pendiente: entero(x.pendiente) }
  }
  if (fecha !== undefined) t.fecha = fecha
  if (hecha !== undefined) t.hecha = hecha
  if (o.archivos !== undefined && o.archivos !== null) t.archivos = Array.isArray(o.archivos) ? o.archivos.map(str) : falla()
  return t
}

/** Zona efectiva: la de la tarea, o la del sistema si no tiene (o no se reconoce). */
export const zonaEfectiva = (t: TareaProgramada, sistema: string = zonaDelSistema()): string =>
  t.zona !== undefined && ValidarTareas.zonaValida(t.zona) ? t.zona : sistema

export const zonaDelSistema = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

/** Instante a partir del cual cuenta la tarea (el más reciente entre `creada` y `desde`). */
export function fechaInicio(t: TareaProgramada): Date | undefined {
  const fs = [t.creada, t.desde].flatMap((s) => (s === undefined ? [] : [Programacion.fecha(s)])).filter((d): d is Date => d !== undefined)
  return fs.length === 0 ? undefined : new Date(Math.max(...fs.map((d) => d.getTime())))
}

/** JSON de la API (la zona siempre viene resuelta). */
export function tareaJSON(t: TareaProgramada, sistema: string = zonaDelSistema()): Obj {
  const o: Obj = { id: t.id, agente: t.agente, nombre: t.nombre, consigna: t.consigna, dias: t.dias, hora: t.hora, zona: t.zona ?? sistema, activa: t.activa }
  if (t.creada !== undefined) o.creada = t.creada
  if (t.origen !== undefined) o.origen = 'chat' in t.origen ? { chat: t.origen.chat } : { reunion: t.origen.reunion, pendiente: t.origen.pendiente }
  o.tipo = esUnica(t) ? 'unica' : 'repetida'
  if (t.fecha !== undefined) o.fecha = t.fecha
  if (esUnica(t)) o.hecha = t.hecha ?? null
  if (t.archivos !== undefined && t.archivos.length > 0) o.archivos = t.archivos
  return o
}

// MARK: - validación

export const ValidarTareas = {
  /** Tope de tareas que todavía pueden correr (repetidas y únicas sin hacer). Las únicas hechas son historial: no cuentan. */
  maxTareas: 50,
  /** Tope de todo lo guardado en `oficina.json`, hechas incluidas, para que el historial no crezca sin fin. */
  maxGuardadas: 500,
  maxConsigna: 4000,
  maxNombre: 80,
  maxPendientes: 200,

  /** "HH:MM" estricto (dos dígitos y dos dígitos, 00:00–23:59) -> [hora, minuto]. */
  hora(s: string): [number, number] | undefined { return Programacion.horaMinuto(s) },

  zonaValida(s: string): boolean {
    if (s === '' || s.startsWith('+') || s.startsWith('-')) return false
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: s })
      return true
    } catch {
      return false
    }
  },

  origenValido(o: OrigenTarea): boolean {
    if ('chat' in o) return uuidValido(o.chat) && o.chat === o.chat.toLowerCase()
    return uuidValido(o.reunion) && o.reunion === o.reunion.toLowerCase() && Number.isInteger(o.pendiente) && o.pendiente >= 0 && o.pendiente < ValidarTareas.maxPendientes
  },

  /** Reglas de `tareas` dentro de una oficina: id slug único, agente existente (solo exigido a las activas: al despedir a un
   *  agente sus tareas quedan desactivadas y se conservan), días 1…7 sin repetir y no vacíos, hora, zona, consigna y nombre. */
  /** Cuántas cuentan para `maxTareas`: todas menos las únicas ya hechas. */
  vivas(ts: TareaProgramada[]): number { return ts.filter((t) => !(esUnica(t) && t.hecha !== undefined)).length },

  /** Lanza 400 si sumar `nuevas` tareas por hacer pasa alguno de los dos topes. */
  hayLugar(ts: TareaProgramada[], nuevas = 1): void {
    if (ValidarTareas.vivas(ts) + nuevas > ValidarTareas.maxTareas) throw new ErrorAPI(400, ValidarTareas.mensajeTope)
    if (ts.length + nuevas > ValidarTareas.maxGuardadas) throw new ErrorAPI(400, ValidarTareas.mensajeGuardadas)
  },

  get mensajeTope() { return `Máximo ${ValidarTareas.maxTareas} tareas por hacer (las de una sola vez que ya se hicieron no cuentan).` },
  get mensajeGuardadas() { return `Hay ${ValidarTareas.maxGuardadas} tareas guardadas contando las ya hechas: borrá algunas hechas para hacer lugar.` },

  validar(o: Oficina): void {
    const ts = o.tareas ?? []
    ValidarTareas.hayLugar(ts, 0)
    const ids = new Set<string>()
    for (const t of ts) {
      if (!Slug.valido(t.id) || ids.has(t.id)) throw new ErrorAPI(400, `Tarea con id inválido o repetido: ${t.id}.`)
      ids.add(t.id)
      if (!Slug.valido(t.agente)) throw new ErrorAPI(400, `La tarea ${t.id} tiene un agente inválido.`)
      if (t.activa && !o.agentes.some((a) => a.id === t.agente)) throw new ErrorAPI(400, `La tarea ${t.id} es de un agente que no existe (${t.agente}).`)
      const n = t.nombre.trim()
      if (n === '' || largo(n) > ValidarTareas.maxNombre) throw new ErrorAPI(400, `La tarea ${t.id} necesita un nombre (hasta ${ValidarTareas.maxNombre} caracteres).`)
      const c = t.consigna.trim()
      if (c === '' || largo(c) > ValidarTareas.maxConsigna) {
        throw new ErrorAPI(400, `La consigna de la tarea ${t.id} tiene que tener entre 1 y ${ValidarTareas.maxConsigna} caracteres.`)
      }
      if (t.fecha !== undefined) {
        if (Programacion.diaCalendario(t.fecha) === undefined) throw new ErrorAPI(400, `La fecha de la tarea ${t.id} tiene que ser AAAA-MM-DD (por ejemplo 2026-11-20).`)
        if (t.hecha !== undefined && Programacion.fecha(t.hecha) === undefined) throw new ErrorAPI(400, `La tarea ${t.id} tiene una marca de hecha inválida.`)
      } else {
        if (t.dias.length === 0 || !t.dias.every((d) => d >= 1 && d <= 7) || new Set(t.dias).size !== t.dias.length) {
          throw new ErrorAPI(400, `Los días de la tarea ${t.id} tienen que ser números del 1 (lunes) al 7 (domingo), sin repetir y al menos uno.`)
        }
        if (t.hecha !== undefined) throw new ErrorAPI(400, `Solo una tarea de una sola vez puede estar hecha (${t.id}).`)
      }
      if (ValidarTareas.hora(t.hora) === undefined) throw new ErrorAPI(400, `La hora de la tarea ${t.id} tiene que ser HH:MM (por ejemplo 08:00).`)
      if (t.zona !== undefined && !ValidarTareas.zonaValida(t.zona)) throw new ErrorAPI(400, `La zona horaria de la tarea ${t.id} no existe: ${t.zona}.`)
      if (t.origen !== undefined && !ValidarTareas.origenValido(t.origen)) throw new ErrorAPI(400, `El origen de la tarea ${t.id} no es válido.`)
      if (t.archivos !== undefined && (t.archivos.length > Adjuntos.maxArchivos || !t.archivos.every(Adjuntos.rutaValida))) {
        throw new ErrorAPI(400, `Los archivos adjuntos de la tarea ${t.id} no son válidos.`)
      }
    }
  },
}

// MARK: - zonas horarias

const formatos = new Map<string, Intl.DateTimeFormat>()
function formato(zona: string): Intl.DateTimeFormat {
  let f = formatos.get(zona)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    })
    formatos.set(zona, f)
  }
  return f
}

type Pared = { a: number; m: number; d: number; h: number; mi: number; s: number }

/** Fecha y hora de pared de `ms` en `zona`. */
export function paredEn(ms: number, zona: string): Pared {
  const p: Record<string, number> = {}
  for (const x of formato(zona).formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value)
  return { a: p.year!, m: p.month!, d: p.day!, h: p.hour! % 24, mi: p.minute!, s: p.second! }
}

/** Desfase de `zona` respecto de UTC en `ms` (milisegundos; + al este). */
export function desfase(ms: number, zona: string): number {
  const p = paredEn(ms, zona)
  return Date.UTC(p.a, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000
}

/** El instante de una hora de pared en `zona`. Si no existe (salto de DST) se corre hacia adelante; si existe dos veces, la primera. */
export function instanteLocal(a: number, m: number, d: number, h: number, mi: number, zona: string): number {
  const pared = Date.UTC(a, m - 1, d, h, mi, 0)
  const antes = desfase(pared - 86_400_000, zona)
  const despues = desfase(pared + 86_400_000, zona)
  const validos = [...new Set([antes, despues])].map((o) => ({ o, t: pared - o })).filter((x) => desfase(x.t, zona) === x.o)
  if (validos.length > 0) return Math.min(...validos.map((x) => x.t))
  return pared - antes
}

// MARK: - lógica pura de horarios

/** Cuándo le toca correr a una tarea. */
export const Programacion = {
  /** Una corrida perdida (app cerrada o dormida) se pone al día si pasaron menos de esto desde su horario (segundos). */
  ventanaPuestaAlDia: 12 * 3600,

  horaMinuto(s: string): [number, number] | undefined {
    const m = /^(\d)(\d):(\d)(\d)$/.exec(s)
    if (!m) return undefined
    const h = Number(m[1]) * 10 + Number(m[2])
    const mi = Number(m[3]) * 10 + Number(m[4])
    return h < 24 && mi < 60 ? [h, mi] : undefined
  },

  /** ISO 8601 en UTC con segundos (`2026-11-13T11:00:00Z`). */
  iso(d: Date): string { return new Date(Math.floor(d.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z') },

  /** ISO 8601 con zona (Z o ±HH:MM) y fracción opcional; undefined si no es válido. */
  fecha(s: string): Date | undefined {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(s)
    if (!m) return undefined
    const [, a, mes, d, h, mi, se] = m
    if (Number(mes) < 1 || Number(mes) > 12 || Number(d) < 1 || Number(d) > 31 || Number(h) > 23 || Number(mi) > 59 || Number(se) > 59) return undefined
    const dia = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)))
    if (dia.getUTCMonth() !== Number(mes) - 1 || dia.getUTCDate() !== Number(d)) return undefined
    const t = Date.parse(s)
    return Number.isNaN(t) ? undefined : new Date(t)
  },

  /** "AAAA-MM-DD" estricto y existente (no 2026-02-30) -> [año, mes, día]. */
  diaCalendario(s: string): [number, number, number] | undefined {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    if (!m) return undefined
    const a = Number(m[1]), mes = Number(m[2]), d = Number(m[3])
    if (a < 2000 || mes < 1 || mes > 12 || d < 1 || d > 31) return undefined
    const f = new Date(Date.UTC(a, mes - 1, d))
    if (f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return undefined
    return [a, mes, d]
  },

  /** "AAAA-MM-DD" de `d` en la zona `zona`. */
  textoDia(d: Date, zona: string): string {
    const p = paredEn(d.getTime(), zona)
    return `${String(p.a).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
  },

  /** "HH:MM" de `d` en la zona `zona`. */
  textoHora(d: Date, zona: string): string {
    const p = paredEn(d.getTime(), zona)
    return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`
  },

  /** El instante de una tarea única (su fecha a su hora, en su zona). undefined si no es única o no se puede armar. */
  instanteUnica(t: TareaProgramada, sistema: string = zonaDelSistema()): Date | undefined {
    if (t.fecha === undefined) return undefined
    const dia = Programacion.diaCalendario(t.fecha)
    const hm = Programacion.horaMinuto(t.hora)
    if (!dia || !hm) return undefined
    return new Date(instanteLocal(dia[0], dia[1], dia[2], hm[0], hm[1], zonaEfectiva(t, sistema)))
  },

  /** Lunes = 1 … domingo = 7 del día calendario (a, m, d). */
  diaISO(a: number, m: number, d: number): number { return (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7 + 1 },

  /** El día calendario `offset` días después de `ref` (en `zona`). */
  dia(ref: Date, offset: number, zona: string): [number, number, number] {
    const p = paredEn(ref.getTime(), zona)
    const f = new Date(Date.UTC(p.a, p.m - 1, p.d + offset))
    return [f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()]
  },

  /** El horario de la tarea en el día calendario dado, sin mirar si ese día está marcado. */
  horario(t: TareaProgramada, [a, m, d]: [number, number, number], zona: string): Date | undefined {
    const hm = Programacion.horaMinuto(t.hora)
    return hm ? new Date(instanteLocal(a, m, d, hm[0], hm[1], zona)) : undefined
  },

  /** Próxima corrida estrictamente posterior a `desde`, o undefined si no hay (sin días válidos; única ya hecha o vencida). */
  proxima(t: TareaProgramada, desde: Date, sistema: string = zonaDelSistema()): Date | undefined {
    if (esUnica(t)) {
      const i = t.hecha === undefined ? Programacion.instanteUnica(t, sistema) : undefined
      return i !== undefined && i > desde ? i : undefined
    }
    const zona = zonaEfectiva(t, sistema)
    for (let i = 0; i <= 8; i++) {
      const d = Programacion.dia(desde, i, zona)
      if (!t.dias.includes(Programacion.diaISO(...d))) continue
      const c = Programacion.horario(t, d, zona)
      if (c !== undefined && c > desde) return c
    }
    return undefined
  },

  /** Último horario marcado que ya pasó (≤ `hasta`), buscando hasta una semana atrás. */
  anterior(t: TareaProgramada, hasta: Date, sistema: string = zonaDelSistema()): Date | undefined {
    if (esUnica(t)) {
      const i = Programacion.instanteUnica(t, sistema)
      return i !== undefined && i <= hasta ? i : undefined
    }
    const zona = zonaEfectiva(t, sistema)
    for (let i = 0; i <= 8; i++) {
      const d = Programacion.dia(hasta, -i, zona)
      if (!t.dias.includes(Programacion.diaISO(...d))) continue
      const c = Programacion.horario(t, d, zona)
      if (c !== undefined && c <= hasta) return c
    }
    return undefined
  },

  /** ¿Corre ahora? Devuelve el horario programado que hay que correr, o undefined.
   *  - Corre el último horario marcado que ya pasó (en la zona de la tarea, en los días marcados);
   *  - nunca dos veces el mismo: si `ultimaProgramada` es igual o posterior, no;
   *  - si la app estuvo cerrada o dormida, se pone al día UNA vez si pasaron menos de 12 h desde ese horario;
   *  - una corrida anterior a la creación de la tarea (o a su último cambio de horario) no cuenta.
   *  Una única es distinta: corre una vez cuando llega (o ya pasó) su fecha y hora, sin ventana de 12 h, salvo que ya esté
   *  hecha o que ya haya tenido su corrida programada desde el último cambio de horario (`ultimaProgramada`). */
  debeCorrer(t: TareaProgramada, ahora: Date, ultimaProgramada: Date | undefined, sistema: string = zonaDelSistema()): Date | undefined {
    if (esUnica(t)) {
      if (!t.activa || t.hecha !== undefined || ultimaProgramada !== undefined) return undefined
      return Programacion.anterior(t, ahora, sistema)
    }
    if (!t.activa) return undefined
    const p = Programacion.anterior(t, ahora, sistema)
    if (p === undefined) return undefined
    if (ultimaProgramada !== undefined && ultimaProgramada >= p) return undefined
    if ((ahora.getTime() - p.getTime()) / 1000 >= Programacion.ventanaPuestaAlDia) return undefined
    const inicio = fechaInicio(t)
    if (inicio !== undefined && inicio > p) return undefined
    return p
  },
}
