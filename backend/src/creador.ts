// El Creador de oficinas (Creador.swift + TarjetasStore.swift): un agente especial de la recepción que arma y cambia la
// oficina charlando. Propone tarjetas (departamento, agente, flujo, regla, conector, tarea) por el servidor MCP propio y la
// persona las aprueba con un botón (`Creador.aplicar`). Nunca crea nada solo: las herramientas `proponer_*` solo escriben
// tarjetas en SQLite. Las rutas (/api/creador/*) están en rutas-creador.ts.
import { tiposTarjeta } from './actividad.js'
import { cambiosAgenteDesde, conectoresValidos, contratar, despedir, editarAgente, nuevoAgenteDesde, ahoraISO } from './agentes.js'
import { catalogoDe, disponible } from './conectores.js'
import { mcpDe, normalizar, sanear } from './consultas.js'
import { iso } from './entregas.js'
import { ErrorAPI } from './errores.js'
import { jsonCompacto } from './json-swift.js'
import { esObjeto, type Obj } from './json.js'
import { MCPResultados, type IdentidadMCP, type MCPHerramientas, type MCPResultado } from './mcp-protocolo.js'
import {
  LecturaAPI, ValidarFlujos, ValidarReglas, flujoDesde, flujoJSON, reglaDesde, type PasoFlujo,
} from './modelo-flujos.js'
import { OficinaStore, ValidarAgenteExtra, type ConectorAsignado, type Oficina } from './oficina.js'
import type { OficinaActiva } from './oficinas.js'
import { armarDepartamento, borrarDepartamento, crearDepartamento, editarDepartamento } from './departamentos.js'
import { esCoordinador, type ServidorConector } from './permisos.js'
import type { Servicios } from './servicios.js'
import { num, txt, type Fila, type SQLValor } from './sqlite.js'
import type { Store, Mensaje } from './store.js'
import { Programacion, ValidarTareas, zonaDelSistema, type TareaProgramada } from './tareas.js'
import { Slug, Validar, largo, prefijo } from './validar.js'

// MARK: - tarjetas

export const tiposDeTarjeta = tiposTarjeta
export const estadosTarjeta = ['borrador', 'lista', 'creada', 'descartada', 'error']

export type Tarjeta = {
  id: string
  oficina: string
  sid: string
  tipo: string
  /** crear | modificar | quitar */
  accion: string
  /** Id existente (modificar / quitar). */
  objetivo?: string
  /** Objeto JSON como texto. */
  datos: string
  /** Lista JSON como texto. */
  faltantes: string
  origen: string
  estado: string
  error?: string
  creadaId?: string
  creada: number
  actualizada: number
}

export function nuevaTarjeta(p: { oficina: string; sid?: string; tipo: string; accion: string; objetivo?: string; datos?: string; faltantes?: string; origen?: string; estado?: string }): Tarjeta {
  return {
    id: '', oficina: p.oficina, sid: p.sid ?? '', tipo: p.tipo, accion: p.accion, objetivo: p.objetivo, datos: p.datos ?? '{}',
    faltantes: p.faltantes ?? '[]', origen: p.origen ?? '', estado: p.estado ?? 'borrador', creada: 0, actualizada: 0,
  }
}

/** Como `as? [String: Any]` de Swift sobre un texto JSON. */
export function objetoDe(s: string): Obj {
  try { const o = JSON.parse(s); return esObjeto(o) ? o : {} } catch { return {} }
}

/** Como `as? [[String: Any]]`: toda la lista tiene que ser de objetos. */
export function listaDe(s: string): Obj[] {
  try {
    const o = JSON.parse(s)
    return Array.isArray(o) && o.every(esObjeto) ? (o as Obj[]) : []
  } catch {
    return []
  }
}

export function tarjetaJSON(t: Tarjeta): Obj {
  let faltantes: unknown[] = []
  try { const f = JSON.parse(t.faltantes); if (Array.isArray(f)) faltantes = f } catch {}
  return {
    id: t.id, sid: t.sid, tipo: t.tipo, accion: t.accion, origen: t.origen, estado: t.estado,
    datos: objetoDe(t.datos), faltantes, creada: iso(t.creada), actualizada: iso(t.actualizada),
    objetivo: t.objetivo ?? null, error: t.error ?? null, creadaId: t.creadaId ?? null,
  }
}

const columnas = 'id,oficina,sid,tipo,accion,objetivo,datos,faltantes,origen,estado,error,creada_id,creada,actualizada'

function deFila(f: Fila): Tarjeta {
  const t: Tarjeta = {
    id: txt(f.id), oficina: txt(f.oficina), sid: txt(f.sid), tipo: txt(f.tipo), accion: txt(f.accion), datos: txt(f.datos),
    faltantes: txt(f.faltantes), origen: txt(f.origen), estado: txt(f.estado), creada: num(f.creada), actualizada: num(f.actualizada),
  }
  if (f.objetivo !== null && f.objetivo !== undefined) t.objetivo = txt(f.objetivo)
  if (f.error !== null && f.error !== undefined) t.error = txt(f.error)
  if (f.creada_id !== null && f.creada_id !== undefined) t.creadaId = txt(f.creada_id)
  return t
}

/** Tabla `creador_tarjetas`. */
export class TarjetasStore {
  constructor(private readonly store: Store) { this.preparar() }

  preparar() {
    this.store.db.exec(`
    CREATE TABLE IF NOT EXISTS creador_tarjetas (
      id TEXT NOT NULL, oficina TEXT NOT NULL, sid TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL,
      accion TEXT NOT NULL,
      objetivo TEXT,
      datos TEXT NOT NULL, faltantes TEXT NOT NULL DEFAULT '[]', origen TEXT NOT NULL,
      estado TEXT NOT NULL,
      error TEXT, creada_id TEXT, creada REAL NOT NULL, actualizada REAL NOT NULL,
      PRIMARY KEY (oficina, id));
    CREATE INDEX IF NOT EXISTS creador_oficina ON creador_tarjetas(oficina, estado);
    `)
  }

  /** Upsert por (oficina, id). Conserva la `creada` original; `actualizada` pasa a ser ahora. */
  guardar(t: Tarjeta): boolean {
    try {
      this.preparar()
      const ahora = Date.now() / 1000
      this.store.db.run(`
        INSERT INTO creador_tarjetas(id,oficina,sid,tipo,accion,objetivo,datos,faltantes,origen,estado,error,creada_id,creada,actualizada)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(oficina,id) DO UPDATE SET sid=excluded.sid, tipo=excluded.tipo, accion=excluded.accion,
          objetivo=excluded.objetivo, datos=excluded.datos, faltantes=excluded.faltantes, origen=excluded.origen,
          estado=excluded.estado, error=excluded.error, creada_id=excluded.creada_id, actualizada=excluded.actualizada`,
      [t.id, t.oficina, t.sid, t.tipo, t.accion, t.objetivo ?? null, t.datos, t.faltantes, t.origen, t.estado, t.error ?? null, t.creadaId ?? null, ahora, ahora])
      return true
    } catch {
      return false
    }
  }

  una(oficina: string, id: string): Tarjeta | undefined {
    try {
      this.preparar()
      const f = this.store.db.query(`SELECT ${columnas} FROM creador_tarjetas WHERE oficina=? AND id=?`, [oficina, id])[0]
      return f ? deFila(f) : undefined
    } catch {
      return undefined
    }
  }

  /** Por fecha de creación (la más vieja primero). */
  lista(oficina: string, estados?: string[]): Tarjeta[] {
    try {
      this.preparar()
      let sql = `SELECT ${columnas} FROM creador_tarjetas WHERE oficina=?`
      const p: SQLValor[] = [oficina]
      if (estados) {
        if (estados.length === 0) return []
        sql += ` AND estado IN (${estados.map(() => '?').join(',')})`
        p.push(...estados)
      }
      sql += ' ORDER BY creada, rowid'
      return this.store.db.query(sql, p).map(deFila)
    } catch {
      return []
    }
  }

  estado(oficina: string, id: string, estado: string, error?: string, creadaId?: string): Tarjeta | undefined {
    try {
      this.preparar()
      this.store.db.run('UPDATE creador_tarjetas SET estado=?, error=?, creada_id=COALESCE(?,creada_id), actualizada=? WHERE oficina=? AND id=?',
        [estado, error ?? null, creadaId ?? null, Date.now() / 1000, oficina, id])
    } catch {}
    return this.una(oficina, id)
  }

  /** `t1`, `t2`, …: el siguiente número libre en esa oficina. */
  nuevoId(oficina: string): string {
    let ids: string[] = []
    try {
      this.preparar()
      ids = this.store.db.query('SELECT id FROM creador_tarjetas WHERE oficina=?', [oficina]).map((f) => txt(f.id))
    } catch {}
    const usados = ids.flatMap((i) => (i.startsWith('t') && /^[+-]?\d+$/.test(i.slice(1)) ? [Number(i.slice(1))] : []))
    return `t${(usados.length === 0 ? 0 : Math.max(...usados)) + 1}`
  }

  /** Le asigna el siguiente `tN` libre y la guarda. */
  guardarNueva(t: Tarjeta): Tarjeta | undefined {
    const n = { ...t, id: this.nuevoId(t.oficina) }
    if (!this.guardar(n)) return undefined
    return this.una(n.oficina, n.id)
  }
}

/** Mensajes de una sesión con su fecha (para `GET /api/creador/estado`). */
export function mensajesConFecha(store: Store, sid: string, limite = 500): { rol: string; texto: string; error: boolean; ts: number }[] {
  try {
    return store.db.query(
      'SELECT rol,texto,error,ts FROM (SELECT id,rol,texto,error,ts FROM mensajes WHERE sid=? ORDER BY id DESC LIMIT ?) ORDER BY id', [sid, limite])
      .map((f) => ({ rol: txt(f.rol), texto: txt(f.texto), error: num(f.error) !== 0, ts: num(f.ts) }))
  } catch {
    return []
  }
}

/** Versión del borrador del Creador por oficina: sube con cada cambio y el front la sondea (`/api/actividad`). */
export class VersionCreador {
  private readonly versiones = new Map<string, number>()
  valor(oficina: string): number { return this.versiones.get(oficina) ?? 0 }
  subir(oficina: string): number {
    const n = (this.versiones.get(oficina) ?? 0) + 1
    this.versiones.set(oficina, n)
    return n
  }
}

/** Las sesiones del Creador que están corriendo ahora (en memoria): una por vez en cada sesión. */
export class CorridasCreador {
  private readonly activas = new Set<string>()
  private clave(c: string, sid: string) { return c + '\u001f' + sid }
  /** false si esa sesión ya está corriendo. */
  empezar(c: string, sid: string): boolean {
    const k = this.clave(c, sid)
    if (this.activas.has(k)) return false
    this.activas.add(k)
    return true
  }
  terminar(c: string, sid: string) { this.activas.delete(this.clave(c, sid)) }
  corriendo(c: string, sid: string): boolean { return this.activas.has(this.clave(c, sid)) }
}

/** Una o más tarjetas en `borrador` impiden aplicar (409). Lleva las tarjetas para que el router devuelva sus faltantes. */
export class AplicarBloqueado extends Error {
  constructor(readonly tarjetas: Tarjeta[]) { super('aplicar bloqueado') }
}

/** Pide confirmación: una tarjeta `quitar` sin `confirmarQuitar`. */
class SinConfirmar extends Error {}

export type Estado = { tarjetas: TarjetasStore; version: VersionCreador; corridas: CorridasCreador }
export const creadorDe = (s: Servicios) => s.huecos.creador as Estado

// MARK: - utilidades

export const Creador = {
  idAgente: 'creador',
  prefijoMCP: 'mcp__hq__',
  /** Nombres cortos, en el orden de la tabla de §6. */
  nombresCortos: ['ver_oficina', 'listar_conectores', ...tiposTarjeta.map((t) => 'proponer_' + t), 'marcar_faltante', 'descartar_tarjeta'],
  get nombresMCP(): string[] { return Creador.nombresCortos.map((n) => Creador.prefijoMCP + n) },
  /** Escrituras (proponer, marcar, descartar) por mensaje de la persona. */
  maxEscrituras: 80,
  claveCupo: 'creador',
  maxOrigen: 600,
  maxDatos: 200_000,
  /** Orden en que se aplican los tipos: lo que otro necesita va antes. */
  ordenTipos: ['departamento', 'agente', 'regla', 'conector', 'flujo', 'tarea'],
  acciones: ['crear', 'modificar', 'quitar'],

  sanear(v: unknown): unknown {
    if (typeof v === 'string') return sanear(v)
    if (Array.isArray(v)) return v.map((x) => Creador.sanear(x))
    if (esObjeto(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Creador.sanear(x)]))
    return v
  },

  /** Sin los `null` (un null es «sin valor»). */
  sinNulos(v: unknown): unknown {
    if (Array.isArray(v)) return v.filter((x) => x !== null).map((x) => Creador.sinNulos(x))
    if (esObjeto(v)) return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, Creador.sinNulos(x)]))
    return v
  },

  texto(v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined
    const t = v.trim()
    return t === '' ? undefined : t
  },

  json(o: unknown, ordenado = true): string { return ordenado ? jsonCompacto(o) : JSON.stringify(o) },

  objeto: objetoDe,
  lista: listaDe,

  /** Minúsculas, sin acentos y con los blancos colapsados, para comparar citas. */
  compactar(s: string): string { return normalizar(s).split(/\s+/).filter((x) => x !== '').join(' ') },

  /** Anti-invento: la cita (sin comillas alrededor) tiene que estar en algún mensaje `u` de la sesión. */
  citaValida(origen: string, mensajes: Mensaje[]): boolean {
    const o = Creador.compactar(origen.replace(/^[«»"'“”‘’\s]+|[«»"'“”‘’\s]+$/g, ''))
    if (o === '') return false
    return mensajes.some((m) => m.r === 'u' && Creador.compactar(m.t).includes(o))
  },

  faltante(campo: string, pregunta: string): Obj { return { campo, pregunta } },

  clave(s: string): string { return normalizar(s).replaceAll('_', ' ') },

  /** Busca el servidor del catálogo que corresponde al nombre pedido. */
  servidor(nombre: string, catalogo: ServidorConector[] | undefined): ServidorConector | undefined {
    const n = Creador.clave(nombre)
    if (n === '') return undefined
    for (const s of catalogo ?? []) {
      const a = Creador.clave(s.nombre), p = Creador.clave(s.prefijo)
      if (a === n || p === n || (a !== '' && (a.includes(n) || n.includes(a)))) return s
    }
    return undefined
  },

  /** «Conectá X en claude.ai» si el conector no está disponible. */
  faltanteConector(nombre: string, catalogo: ServidorConector[] | undefined, campo: string): Obj | undefined {
    const s = Creador.servidor(nombre, catalogo)
    if (s) {
      if (disponible(s)) return undefined
      return Creador.faltante(campo, `Conectá ${nombre} en claude.ai: está en tu cuenta pero necesita que lo autorices.`)
    }
    if (catalogo === undefined) {
      return Creador.faltante(campo, `Conectá ${nombre} en claude.ai y actualizá los conectores: todavía no pude comprobar si está disponible.`)
    }
    return Creador.faltante(campo, `Conectá ${nombre} en claude.ai: no está entre los conectores de tu cuenta.`)
  },

  // MARK: evaluación de una tarjeta

  /** Qué pasa con una tarjeta: sus datos limpios y lo que le falta. Lanza `ErrorAPI` si hay un error de formato.
   *  `tarjetas`: las demás tarjetas no descartadas (para resolver `tarjeta:<id>`). */
  evaluar(p: { tipo: string; accion: string; datos: Obj; oficina: Oficina; tarjetas: Tarjeta[]; catalogo: ServidorConector[] | undefined }): { datos: Obj; faltantes: Obj[] } {
    const { tipo, accion, oficina: o, tarjetas, catalogo } = p
    const limpio = Creador.sinNulos(Creador.sanear(p.datos))
    if (!esObjeto(limpio)) return { datos: {}, faltantes: [] }
    const d: Obj = limpio
    const texto = Creador.texto
    if (accion === 'quitar') {
      const q: Obj = {}
      for (const k of ['moverA', 'servidor']) { const v = texto(d[k]); if (v !== undefined) q[k] = v }
      return { datos: q, faltantes: [] }
    }
    const crear = accion === 'crear'
    if (!crear) delete d.id
    const f: Obj[] = []

    const falta = (campo: string, pregunta: string) => { f.push(Creador.faltante(campo, pregunta)) }
    const vacio = (k: string) => texto(d[k]) === undefined
    const refOk = (v: unknown, t: string, existentes: Set<string>, persona = false): [string, boolean] | undefined => {
      if (v === undefined) return undefined
      if (typeof v !== 'string') throw new ErrorAPI(400, `Una referencia a ${t} tiene que ser texto (un id o «tarjeta:<id>»).`)
      const r = v.trim()
      if (persona && r === 'persona') return [r, true]
      if (existentes.has(r)) return [r, true]
      if (r.startsWith('tarjeta:')) {
        const id = r.slice('tarjeta:'.length)
        return [r, tarjetas.some((x) => x.id === id && x.tipo === t && x.estado !== 'descartada')]
      }
      return [r, false]
    }
    const agentesIds = new Set(o.agentes.map((a) => a.id))

    switch (tipo) {
      case 'departamento': {
        if (crear && vacio('nombre')) falta('nombre', '¿Cómo se llama el departamento?')
        const usados = crear ? new Set(o.departamentos.map((x) => x.id)) : new Set<string>()
        armarDepartamento(
          { id: texto(d.id), nombre: texto(d.nombre) ?? 'x', color: texto(d.color), mision: typeof d.mision === 'string' ? d.mision : undefined }, 0, usados)
        break
      }

      case 'agente': {
        if (crear) {
          if (vacio('nombre')) falta('nombre', '¿Cómo se llama?')
          if (vacio('rol')) falta('rol', '¿Cuál es su rol?')
          if (vacio('prompt')) falta('prompt', '¿Qué hace y cómo trabaja? Falta lo que dice el texto para armarle las instrucciones.')
          if (vacio('departamento')) falta('departamento', '¿En qué departamento va?')
        }
        const v: Obj = { ...d }
        if (crear) for (const k of ['nombre', 'rol', 'prompt', 'departamento']) if (vacio(k)) v[k] = 'x'
        if (crear) {
          nuevoAgenteDesde(v)
          const id = texto(d.id)
          if (id !== undefined) {
            if (Validar.reservados.has(id)) throw new ErrorAPI(400, 'Ese id está reservado: elegí otro para el agente.')
            if (agentesIds.has(id)) throw new ErrorAPI(409, `Ya hay un agente con el id «${id}»: usá accion «modificar» con objetivo.`)
          }
        } else {
          cambiosAgenteDesde(v)
        }
        const dep = refOk(d.departamento, 'departamento', new Set(o.departamentos.map((x) => x.id)))
        if (dep && !dep[1]) falta('departamento', `«${dep[0]}» no es un departamento de la oficina ni hay una tarjeta para crearlo: ¿en cuál va?`)
        for (const c of conectoresValidos(d.conectores) ?? []) {
          const x = Creador.faltanteConector(c.servidor, catalogo, 'conectores')
          if (x) f.push(x)
        }
        break
      }

      case 'flujo': {
        const v: Obj = { ...d }
        if (d.pasos !== undefined) {
          if (!Array.isArray(d.pasos)) throw new ErrorAPI(400, '«pasos» tiene que ser una lista de pasos.')
          const nuevos: Obj[] = []
          d.pasos.forEach((x, i) => {
            if (!esObjeto(x)) throw new ErrorAPI(400, 'Cada paso del flujo tiene que ser un objeto.')
            const pa: Obj = { ...x }
            const nombre = texto(pa.nombre) ?? `el paso ${i + 1}`
            if (texto(pa.nombre) === undefined) { falta(`pasos[${i}].nombre`, `¿Cómo se llama el paso ${i + 1}?`); pa.nombre = 'x' }
            const tieneQuien = texto(pa.quien) !== undefined
            if (!tieneQuien) { falta(`pasos[${i}].quien`, `¿Quién hace «${nombre}»: un agente o vos?`); pa.quien = 'persona' }
            if (texto(pa.entrega) === undefined) { falta(`pasos[${i}].entrega`, `¿Qué entrega «${nombre}»?`); pa.entrega = 'x' }
            if (pa.aprobacion === undefined) {
              falta(`pasos[${i}].aprobacion`, `¿«${nombre}» necesita tu aprobación antes de que siga el flujo?`)
            } else if (typeof pa.aprobacion !== 'boolean') {
              throw new ErrorAPI(400, `«aprobacion» del paso «${nombre}» tiene que ser verdadero o falso.`)
            }
            if (tieneQuien) {
              const q = refOk(pa.quien, 'agente', agentesIds, true)
              if (q && !q[1]) falta(`pasos[${i}].quien`, `«${q[0]}» no es un agente de la oficina ni hay una tarjeta para crearlo: ¿quién hace «${nombre}»?`)
            }
            if (typeof pa.quien === 'string' && pa.quien.startsWith('tarjeta:')) pa.quien = 'tarjeta-' + pa.quien.slice('tarjeta:'.length)
            nuevos.push(pa)
          })
          v.pasos = nuevos
          if (crear && nuevos.length === 0) falta('pasos', '¿Cuáles son los pasos del flujo?')
        } else if (crear) {
          falta('pasos', '¿Cuáles son los pasos del flujo?')
        }
        if (crear && vacio('nombre')) falta('nombre', '¿Cómo se llama el flujo?')
        if (texto(v.nombre) === undefined) v.nombre = 'x'
        if (!Array.isArray(v.pasos) || v.pasos.length === 0) v.pasos = [{ nombre: 'x', quien: 'persona', entrega: 'x' }]
        const usados = new Set((o.flujos ?? []).map((x) => x.id))
        flujoDesde(v, crear ? usados : new Set())
        break
      }

      case 'regla': {
        if (crear && vacio('texto')) falta('texto', '¿Qué dice la regla?')
        const v: Obj = { ...d }
        if (texto(v.texto) === undefined) v.texto = 'x'
        reglaDesde(v, crear ? new Set((o.reglas ?? []).map((x) => x.id)) : new Set())
        break
      }

      case 'conector': {
        if (crear) {
          if (vacio('agente')) falta('agente', '¿A qué agente le damos el conector?')
          if (vacio('servidor')) falta('servidor', '¿Qué conector es?')
        }
        const leer = LecturaAPI.lista(d.leer, 'leer'), actuar = LecturaAPI.lista(d.actuar, 'actuar')
        const nombre = texto(d.servidor)
        if (nombre !== undefined && largo(nombre) > ValidarAgenteExtra.maxLargoServidor) {
          throw new ErrorAPI(400, `El nombre del conector es demasiado largo (máximo ${ValidarAgenteExtra.maxLargoServidor} caracteres).`)
        }
        ValidarAgenteExtra.conectores([{ servidor: nombre ?? 'x', leer: leer ?? [], actuar: actuar ?? [] }])
        const ag = refOk(d.agente, 'agente', agentesIds)
        if (ag && !ag[1]) falta('agente', `«${ag[0]}» no es un agente de la oficina ni hay una tarjeta para crearlo: ¿a quién se lo damos?`)
        if (nombre !== undefined) {
          const x = Creador.faltanteConector(nombre, catalogo, 'servidor')
          if (x) f.push(x)
        }
        if (crear && (leer ?? []).length === 0 && (actuar ?? []).length === 0 && nombre !== undefined) {
          falta('leer', `¿Qué tiene que poder hacer con ${nombre}: solo leer o también actuar? Elegí las herramientas.`)
        }
        break
      }

      case 'tarea': {
        if (crear) {
          if (vacio('agente')) falta('agente', '¿Qué agente hace la tarea?')
          if (vacio('nombre')) falta('nombre', '¿Cómo se llama la tarea?')
          if (vacio('consigna')) falta('consigna', '¿Qué tiene que hacer cada vez?')
          if (vacio('hora')) falta('hora', '¿A qué hora (HH:MM)?')
          if (d.dias === undefined && vacio('fecha')) falta('dias', '¿Qué días de la semana se repite?')
        }
        const per = texto(d.periodicidad)
        if (per !== undefined) {
          const ok = new Set(['semanal', 'semanales', 'cada semana', 'diaria', 'diario', 'todos los dias', 'unica', 'una vez', 'unico'])
          if (!ok.has(normalizar(per))) {
            falta('periodicidad', `Por ahora las tareas se repiten por días de la semana, no ${per}: ¿la hacemos cada semana o la dejás como recordatorio tuyo?`)
          }
        }
        const n = texto(d.nombre)
        if (n !== undefined && largo(n) > ValidarTareas.maxNombre) throw new ErrorAPI(400, `El nombre de la tarea es demasiado largo (máximo ${ValidarTareas.maxNombre} caracteres).`)
        const c = texto(d.consigna)
        if (c !== undefined && largo(c) > ValidarTareas.maxConsigna) throw new ErrorAPI(400, `La consigna de la tarea es demasiado larga (máximo ${ValidarTareas.maxConsigna} caracteres).`)
        const h = texto(d.hora)
        if (h !== undefined && ValidarTareas.hora(h) === undefined) throw new ErrorAPI(400, 'La hora tiene que ser HH:MM (por ejemplo 08:00).')
        const z = texto(d.zona)
        if (z !== undefined && !ValidarTareas.zonaValida(z)) throw new ErrorAPI(400, 'No conozco esa zona horaria (usá, por ejemplo, America/Argentina/Buenos_Aires).')
        const fe = texto(d.fecha)
        if (fe !== undefined && Programacion.diaCalendario(fe) === undefined) throw new ErrorAPI(400, 'La fecha tiene que ser AAAA-MM-DD (por ejemplo 2026-11-20).')
        if (d.dias !== undefined) {
          if (d.fecha !== undefined) throw new ErrorAPI(400, 'Elegí días (si se repite) o una fecha (si es una sola vez), no las dos cosas.')
          Creador.diasValidos(d.dias)
        }
        const id = texto(d.id)
        if (id !== undefined && !Slug.valido(id)) throw new ErrorAPI(400, 'Id de tarea inválido (usá minúsculas, números y guiones).')
        const ag = refOk(d.agente, 'agente', agentesIds)
        if (ag && !ag[1]) falta('agente', `«${ag[0]}» no es un agente de la oficina ni hay una tarjeta para crearlo: ¿quién hace la tarea?`)
        break
      }

      default:
        throw new ErrorAPI(400, `Tipo de tarjeta desconocido: ${tipo}.`)
    }
    return { datos: d, faltantes: f }
  },

  /** `[1...7]` sin repetir y no vacío. */
  diasValidos(v: unknown): number[] {
    if (!Array.isArray(v) || v.length === 0) throw new ErrorAPI(400, 'Elegí al menos un día (números del 1, lunes, al 7, domingo).')
    const out: number[] = []
    for (const x of v) {
      if (typeof x !== 'number' || !Number.isInteger(x) || x < 1 || x > 7 || out.includes(x)) {
        throw new ErrorAPI(400, 'Los días tienen que ser números del 1 (lunes) al 7 (domingo), sin repetir.')
      }
      out.push(x)
    }
    return out.sort((a, b) => a - b)
  },

  /** Que el objetivo de un `modificar` o `quitar` exista en la oficina. */
  existeObjetivo(tipo: string, id: string, o: Oficina): boolean {
    switch (tipo) {
      case 'departamento': return o.departamentos.some((d) => d.id === id)
      case 'agente': case 'conector': return o.agentes.some((a) => a.id === id)
      case 'flujo': return (o.flujos ?? []).some((f) => f.id === id)
      case 'regla': return (o.reglas ?? []).some((r) => r.id === id)
      case 'tarea': return (o.tareas ?? []).some((t) => t.id === id)
      default: return false
    }
  },

  /** Los faltantes puestos a mano (`marcar_faltante`) siguen mientras el campo no se complete. */
  manualesVigentes(viejos: Obj[], datos: Obj): Obj[] {
    return viejos.filter((v) => {
      if (v.manual !== true) return false
      const campo = typeof v.campo === 'string' ? v.campo : ''
      const x = datos[campo]
      return Creador.texto(x) === undefined && !(Array.isArray(x) && x.length > 0)
    })
  },

  // MARK: guardar una tarjeta (proponer y PATCH)

  /** Arma, valida y guarda una tarjeta. Con `ref` (o una tarjeta existente) actualiza: los `datos` nuevos se suman a los viejos
   *  (un `null` borra un campo). Lanza `ErrorAPI` con un mensaje para el modelo o para la persona. */
  armar(s: Servicios, p: { carpeta: string; sid: string; tipo: string; accion?: string; objetivo?: string; ref?: string; origen?: string; datos: Obj }): Tarjeta {
    const { carpeta, sid, tipo, ref, origen, datos } = p
    const { tarjetas, version } = creadorDe(s)
    let existente: Tarjeta | undefined
    if (ref !== undefined) {
      const t = tarjetas.una(carpeta, ref)
      if (!t) throw new ErrorAPI(404, `No existe la tarjeta «${ref}».`)
      if (t.tipo !== tipo) throw new ErrorAPI(400, `La tarjeta «${ref}» es de tipo ${t.tipo}, no ${tipo}.`)
      if (!['borrador', 'lista', 'error'].includes(t.estado)) {
        throw new ErrorAPI(409, `La tarjeta «${ref}» ya está ${t.estado === 'creada' ? 'creada' : 'descartada'} y no se puede cambiar.`)
      }
      existente = t
    }
    const accionF = p.accion ?? existente?.accion ?? 'crear'
    if (!Creador.acciones.includes(accionF)) throw new ErrorAPI(400, '«accion» tiene que ser crear, modificar o quitar.')
    const o = OficinaStore.leer(carpeta)
    let objetivoF: string | undefined = accionF === 'crear' ? undefined : (Creador.texto(p.objetivo) ?? existente?.objetivo)
    if (accionF !== 'crear') {
      if (objetivoF === undefined) throw new ErrorAPI(400, `Para ${accionF} hace falta «objetivo»: el id de lo que ya existe (miralo con ver_oficina).`)
      if (!Creador.existeObjetivo(tipo, objetivoF, o)) {
        throw new ErrorAPI(400, `No hay ${tipo === 'conector' ? 'un agente' : `un ${tipo}`} con el id «${objetivoF}» en la oficina: miralo con ver_oficina.`)
      }
    } else {
      objetivoF = undefined
    }

    const base: Obj = existente ? objetoDe(existente.datos) : {}
    for (const [k, v] of Object.entries(datos)) base[k] = v
    const otras = tarjetas.lista(carpeta, ['borrador', 'lista', 'creada', 'error']).filter((x) => x.id !== existente?.id)
    const { datos: limpios, faltantes: calculados } = Creador.evaluar({
      tipo, accion: accionF, datos: base, oficina: o, tarjetas: otras, catalogo: catalogoDe(s)?.servidores(),
    })
    const faltantes = [...calculados]
    if (existente) {
      for (const m of Creador.manualesVigentes(listaDe(existente.faltantes), limpios)) {
        if (!faltantes.some((x) => x.campo === m.campo)) faltantes.push(m)
      }
    }
    const datosTexto = Creador.json(limpios)
    if (Buffer.byteLength(datosTexto, 'utf8') > Creador.maxDatos) throw new ErrorAPI(413, 'La tarjeta es demasiado grande.')
    const t: Tarjeta = existente ? { ...existente } : nuevaTarjeta({ oficina: carpeta, sid, tipo, accion: accionF })
    t.accion = accionF
    t.objetivo = objetivoF
    t.datos = datosTexto
    t.faltantes = Creador.json(faltantes, false)
    if (origen !== undefined) t.origen = prefijo(origen, Creador.maxOrigen)
    t.estado = faltantes.length === 0 ? 'lista' : 'borrador'
    t.error = undefined
    if (t.sid === '') t.sid = sid
    let guardada: Tarjeta | undefined
    if (existente) {
      tarjetas.guardar(t)
      guardada = tarjetas.una(carpeta, t.id)
    } else {
      guardada = tarjetas.guardarNueva(t)
    }
    if (!guardada) throw new ErrorAPI(500, 'No pude guardar la tarjeta.')
    version.subir(carpeta)
    return guardada
  },

  // MARK: aplicar (§11)

  aplicar(s: Servicios, act: OficinaActiva, ids: string[] | undefined, confirmarQuitar: boolean): Obj[] {
    const carpeta = act.carpeta
    const { tarjetas, version } = creadorDe(s)
    const todas = tarjetas.lista(carpeta)
    let elegidas: Tarjeta[] = []
    if (ids && ids.length > 0) {
      for (const id of ids) {
        const t = todas.find((x) => x.id === id)
        if (!t) throw new ErrorAPI(404, `No existe la tarjeta «${id}».`)
        if (!elegidas.some((x) => x.id === id)) elegidas.push(t)
      }
    } else {
      elegidas = todas.filter((t) => t.estado === 'lista')
    }
    const borradores = elegidas.filter((t) => t.estado === 'borrador')
    if (borradores.length > 0) throw new AplicarBloqueado(borradores)

    const mapa: Record<string, string> = {}
    for (const t of todas) if (t.estado === 'creada' && t.creadaId !== undefined) mapa[t.id] = t.creadaId

    const resultados = new Map<string, Obj>()
    let pendientes: Tarjeta[] = []
    for (const t of elegidas) {
      switch (t.estado) {
        case 'creada': resultados.set(t.id, { id: t.id, ok: true, creadaId: t.creadaId ?? null }); break
        case 'descartada': resultados.set(t.id, { id: t.id, ok: false, error: 'Esta tarjeta está descartada.' }); break
        default: pendientes.push(t)
      }
    }
    // primero lo que se crea o cambia (departamento -> agente -> regla -> conector -> flujo -> tarea), al final lo que se quita
    const posicion = new Map(todas.map((t, i) => [t.id, i]))
    const rango = (t: Tarjeta) => {
      let i = Creador.ordenTipos.indexOf(t.tipo)
      if (i < 0) i = Creador.ordenTipos.length
      return t.accion === 'quitar' ? 100 + (Creador.ordenTipos.length - i) : i
    }
    pendientes = pendientes.sort((a, b) => rango(a) - rango(b) || (posicion.get(a.id) ?? 0) - (posicion.get(b.id) ?? 0))

    for (const t of pendientes) {
      try {
        if (t.accion === 'quitar' && !confirmarQuitar) throw new SinConfirmar()
        const id = Creador.aplicarUna(s, t, mapa)
        tarjetas.estado(carpeta, t.id, 'creada', undefined, id)
        mapa[t.id] = id
        resultados.set(t.id, { id: t.id, ok: true, creadaId: id })
      } catch (e) {
        if (e instanceof SinConfirmar) {
          // sigue lista: hace falta que la persona confirme que quiere quitar
          resultados.set(t.id, { id: t.id, ok: false, error: `Quitar necesita tu confirmación: confirmá que querés quitar «${t.objetivo ?? t.tipo}».` })
        } else if (e instanceof ErrorAPI) {
          tarjetas.estado(carpeta, t.id, 'error', e.mensaje)
          resultados.set(t.id, { id: t.id, ok: false, error: e.mensaje })
        } else {
          const m = 'No pude aplicar esta tarjeta.'
          tarjetas.estado(carpeta, t.id, 'error', m)
          resultados.set(t.id, { id: t.id, ok: false, error: m })
        }
      }
    }
    version.subir(carpeta)
    return elegidas.flatMap((t) => { const r = resultados.get(t.id); return r ? [r] : [] })
  },

  resolver(v: unknown, mapa: Record<string, string>): unknown {
    if (typeof v !== 'string' || !v.startsWith('tarjeta:')) return v
    const id = v.slice('tarjeta:'.length)
    const r = mapa[id]
    if (r === undefined) throw new ErrorAPI(409, `Depende de la tarjeta «${id}», que todavía no se creó.`)
    return r
  },

  /** Aplica una tarjeta con lo que ya existe en `Oficinas`. Devuelve el id de lo creado o cambiado. */
  aplicarUna(s: Servicios, t: Tarjeta, mapa: Record<string, string>): string {
    let d = objetoDe(t.datos)
    const of = s.oficinas
    const obj = t.objetivo ?? ''
    const faltaObj = () => new ErrorAPI(400, 'La tarjeta no dice sobre qué cambio (falta el objetivo).')
    const texto = Creador.texto
    switch (`${t.tipo}:${t.accion}`) {
      case 'departamento:crear': {
        const nombre = texto(d.nombre)
        if (nombre === undefined) throw new ErrorAPI(400, 'Falta el nombre del departamento.')
        const [dep] = crearDepartamento(of, { id: texto(d.id), nombre, color: texto(d.color), mision: texto(d.mision) })
        return dep.id
      }
      case 'departamento:modificar':
        if (obj === '') throw faltaObj()
        editarDepartamento(of, obj, { nombre: texto(d.nombre), color: texto(d.color), mision: typeof d.mision === 'string' ? d.mision : undefined })
        return obj
      case 'departamento:quitar':
        if (obj === '') throw faltaObj()
        borrarDepartamento(of, obj, texto(d.moverA))
        return obj

      case 'agente:crear': {
        d.departamento = Creador.resolver(d.departamento, mapa)
        const [a] = contratar(of, nuevoAgenteDesde(d))
        return a.id
      }
      case 'agente:modificar':
        if (obj === '') throw faltaObj()
        if (d.departamento !== undefined) d.departamento = Creador.resolver(d.departamento, mapa)
        editarAgente(of, obj, cambiosAgenteDesde(d))
        return obj
      case 'agente:quitar':
        if (obj === '') throw faltaObj()
        despedir(of, obj)
        return obj

      case 'regla:crear': {
        const origen = prefijo(t.origen, ValidarReglas.maxTexto)
        const [r] = of.modificar((o) => {
          const rs = o.reglas ?? []
          if (rs.length >= ValidarReglas.maxReglas) throw new ErrorAPI(400, `Máximo ${ValidarReglas.maxReglas} reglas.`)
          const x: Obj = { ...d }
          if (origen !== '') x.origen = origen
          const nueva = reglaDesde(x, new Set(rs.map((y) => y.id)))
          rs.push(nueva)
          o.reglas = rs
          return nueva
        })
        return r.id
      }
      case 'regla:modificar':
        if (obj === '') throw faltaObj()
        of.modificar((o) => {
          const i = (o.reglas ?? []).findIndex((x) => x.id === obj)
          if (i < 0) throw new ErrorAPI(404, 'No existe esa regla.')
          const tx = texto(d.texto)
          if (tx !== undefined) o.reglas![i]!.texto = tx
        })
        return obj
      case 'regla:quitar':
        if (obj === '') throw faltaObj()
        of.modificar((o) => {
          if (!(o.reglas ?? []).some((x) => x.id === obj)) throw new ErrorAPI(404, 'No existe esa regla.')
          o.reglas = o.reglas!.filter((x) => x.id !== obj)
          if (o.reglas.length === 0) delete o.reglas
        })
        return obj

      case 'conector:crear': case 'conector:modificar': {
        const r = Creador.resolver(d.agente, mapa)
        const agente = typeof r === 'string' ? r : obj
        const servidor = texto(d.servidor)
        if (agente === '' || servidor === undefined) throw new ErrorAPI(400, 'Faltan el agente o el conector.')
        const leer = LecturaAPI.lista(d.leer, 'leer'), actuar = LecturaAPI.lista(d.actuar, 'actuar')
        of.modificar((o) => {
          const i = o.agentes.findIndex((a) => a.id === agente)
          if (i < 0) throw new ErrorAPI(404, `No existe el agente «${agente}».`)
          const cs: ConectorAsignado[] = o.agentes[i]!.conectores ?? []
          const j = cs.findIndex((c) => Creador.clave(c.servidor) === Creador.clave(servidor))
          if (j >= 0) {
            if (leer) cs[j]!.leer = leer
            if (actuar) cs[j]!.actuar = actuar
          } else {
            cs.push({ servidor, leer: leer ?? [], actuar: actuar ?? [] })
          }
          o.agentes[i]!.conectores = cs
        })
        return agente
      }
      case 'conector:quitar': {
        const servidor = texto(d.servidor)
        if (obj === '' || servidor === undefined) throw new ErrorAPI(400, 'Para quitar un conector hace falta el agente y el servidor.')
        of.modificar((o) => {
          const i = o.agentes.findIndex((a) => a.id === obj)
          if (i < 0) throw new ErrorAPI(404, 'No existe ese agente.')
          const cs = (o.agentes[i]!.conectores ?? []).filter((c) => Creador.clave(c.servidor) !== Creador.clave(servidor))
          if (cs.length === 0) delete o.agentes[i]!.conectores
          else o.agentes[i]!.conectores = cs
        })
        return obj
      }

      case 'flujo:crear': {
        d = Creador.resolverPasos(d, mapa)
        d.origen = prefijo(t.origen, ValidarReglas.maxTexto)
        d.creado = ahoraISO()
        const [f] = of.modificar((o) => {
          const fs = o.flujos ?? []
          if (fs.length >= ValidarFlujos.maxFlujos) throw new ErrorAPI(400, `Máximo ${ValidarFlujos.maxFlujos} flujos.`)
          const nuevo = flujoDesde(d, new Set(fs.map((x) => x.id)))
          fs.push(nuevo)
          o.flujos = fs
          return nuevo
        })
        return f.id
      }
      case 'flujo:modificar':
        if (obj === '') throw faltaObj()
        d = Creador.resolverPasos(d, mapa)
        of.modificar((o) => {
          const fs = o.flujos
          const i = fs ? fs.findIndex((x) => x.id === obj) : -1
          if (!fs || i < 0) throw new ErrorAPI(404, 'No existe ese flujo.')
          const base = flujoJSON(fs[i]!)
          for (const [k, v] of Object.entries(d)) base[k] = v
          base.id = obj
          fs[i] = flujoDesde(base, new Set(fs.map((x) => x.id).filter((x) => x !== obj)))
          o.flujos = fs
        })
        return obj
      case 'flujo:quitar':
        if (obj === '') throw faltaObj()
        of.modificar((o) => {
          if (!(o.flujos ?? []).some((x) => x.id === obj)) throw new ErrorAPI(404, 'No existe ese flujo.')
          o.flujos = o.flujos!.filter((x) => x.id !== obj)
          if (o.flujos.length === 0) delete o.flujos
        })
        return obj

      case 'tarea:crear': {
        const r = Creador.resolver(d.agente, mapa)
        const agente = typeof r === 'string' ? r : ''
        const nombre = texto(d.nombre), consigna = texto(d.consigna), hora = texto(d.hora)
        if (agente === '' || nombre === undefined || consigna === undefined || hora === undefined) throw new ErrorAPI(400, 'A la tarea le faltan datos.')
        const fecha = texto(d.fecha)
        const dias = fecha !== undefined ? [] : Creador.diasValidos(d.dias)
        const zona = texto(d.zona) ?? zonaDelSistema()
        const ahora = Programacion.iso(new Date())
        const [tarea] = of.modificar((o) => {
          if (!o.agentes.some((a) => a.id === agente)) throw new ErrorAPI(404, `No existe el agente «${agente}».`)
          const ts = o.tareas ?? []
          ValidarTareas.hayLugar(ts)
          const usados = new Set(ts.map((x) => x.id))
          const pedido = texto(d.id)
          if (pedido !== undefined && usados.has(pedido)) throw new ErrorAPI(409, 'Ya hay una tarea con ese id.')
          const id = pedido ?? Slug.unico(nombre, usados, 'tarea')
          const nueva: TareaProgramada = { id, agente, nombre, consigna, dias, hora, zona, activa: true, creada: ahora, desde: ahora }
          if (fecha !== undefined) nueva.fecha = fecha
          ts.push(nueva)
          o.tareas = ts
          return nueva
        })
        return tarea.id
      }
      case 'tarea:modificar': {
        if (obj === '') throw faltaObj()
        const agente = d.agente === undefined ? undefined : Creador.resolver(d.agente, mapa)
        const ahora = Programacion.iso(new Date())
        of.modificar((o) => {
          const i = (o.tareas ?? []).findIndex((x) => x.id === obj)
          if (i < 0) throw new ErrorAPI(404, 'No existe esa tarea.')
          const x: TareaProgramada = { ...o.tareas![i]! }
          let cambioHorario = false
          if (typeof agente === 'string') x.agente = agente
          const n = texto(d.nombre); if (n !== undefined) x.nombre = n
          const c = texto(d.consigna); if (c !== undefined) x.consigna = c
          if (d.dias !== undefined) { x.dias = Creador.diasValidos(d.dias); delete x.fecha; delete x.hecha; cambioHorario = true }
          const fe = texto(d.fecha); if (fe !== undefined) { x.fecha = fe; x.dias = []; delete x.hecha; cambioHorario = true }
          const h = texto(d.hora); if (h !== undefined && h !== x.hora) { x.hora = h; cambioHorario = true }
          const z = texto(d.zona); if (z !== undefined && z !== x.zona) { x.zona = z; cambioHorario = true }
          if (cambioHorario) x.desde = ahora
          o.tareas![i] = x
        })
        return obj
      }
      case 'tarea:quitar':
        if (obj === '') throw faltaObj()
        of.modificar((o) => {
          if (!(o.tareas ?? []).some((x) => x.id === obj)) throw new ErrorAPI(404, 'No existe esa tarea.')
          o.tareas = o.tareas!.filter((x) => x.id !== obj)
          if (o.tareas.length === 0) delete o.tareas
        })
        return obj

      default:
        throw new ErrorAPI(400, `No sé aplicar una tarjeta ${t.tipo} con la acción ${t.accion}.`)
    }
  },

  resolverPasos(d: Obj, mapa: Record<string, string>): Obj {
    if (!Array.isArray(d.pasos) || !d.pasos.every(esObjeto)) return d
    const out: Obj = { ...d }
    out.pasos = (d.pasos as Obj[]).map((p) => {
      const x: Obj = { ...p }
      if (p.quien !== undefined) x.quien = Creador.resolver(p.quien, mapa)
      return x as unknown as PasoFlujo
    })
    return out
  },

  // MARK: vistas

  /** Tarjetas visibles (sin las descartadas) y cuántas hay en cada estado. */
  resumen(tarjetas: Tarjeta[]): Record<string, number> {
    const r: Record<string, number> = { borrador: 0, lista: 0, creada: 0, error: 0 }
    for (const t of tarjetas) if (t.estado in r) r[t.estado]! += 1
    return r
  },

  resumenOficina(o: Oficina, tarjetas: Tarjeta[]): Obj {
    const r: Obj = { nombre: o.nombre }
    r.departamentos = o.departamentos.map((d) => {
      const x: Obj = { id: d.id, nombre: d.nombre }
      if (d.mision !== undefined) x.mision = d.mision
      return x
    })
    r.agentes = o.agentes.map((a) => {
      const x: Obj = { id: a.id, nombre: a.nombre, rol: a.rol, departamento: a.departamento }
      if (esCoordinador(a)) x.coordinador = true
      if (a.conectores && a.conectores.length > 0) x.conectores = a.conectores.map((c) => c.servidor)
      if (a.limites && ((a.limites.solo?.length ?? 0) > 0 || (a.limites.proponer?.length ?? 0) > 0)) {
        x.limites = { solo: a.limites.solo?.length ?? 0, proponer: a.limites.proponer?.length ?? 0 }
      }
      return x
    })
    r.reglas = (o.reglas ?? []).map((x) => ({ id: x.id, texto: x.texto }))
    r.flujos = (o.flujos ?? []).map((f) => ({
      id: f.id, nombre: f.nombre, pasos: f.pasos.map((p) => ({ id: p.id, nombre: p.nombre, quien: p.quien, aprobacion: p.aprobacion })),
    }))
    r.tareas = (o.tareas ?? []).map((t) => {
      const x: Obj = { id: t.id, agente: t.agente, nombre: t.nombre, hora: t.hora, activa: t.activa }
      if (t.fecha !== undefined) x.fecha = t.fecha
      else x.dias = t.dias
      return x
    })
    r.tarjetas = tarjetas.filter((t) => t.estado !== 'descartada').map((t) => {
      const x: Obj = { id: t.id, tipo: t.tipo, accion: t.accion, estado: t.estado, faltantes: listaDe(t.faltantes).map((f) => (typeof f.campo === 'string' ? f.campo : '')) }
      if (t.objetivo !== undefined) x.objetivo = t.objetivo
      const dt = objetoDe(t.datos)
      const n = Creador.texto(dt.nombre) ?? Creador.texto(dt.texto)
      if (n !== undefined) x.nombre = prefijo(n, 80)
      return x
    })
    return r
  },

  conectoresJSON(catalogo: ServidorConector[] | undefined): Obj {
    if (!catalogo) {
      return {
        detectado: false, nota: 'Todavía no se detectaron los conectores de la cuenta de claude.ai: la persona tiene que abrir Conectores y actualizar.',
        servidores: [],
      }
    }
    return { detectado: true, servidores: catalogo.map((c) => ({ nombre: c.nombre, estado: c.estado, disponible: disponible(c), herramientas: c.herramientas })) }
  },
}

// MARK: - herramientas MCP del perfil creador

const accionSchema = {
  type: 'string', enum: Creador.acciones,
  description: 'crear una cosa nueva, modificar una que ya existe (con objetivo) o quitarla (con objetivo; la persona lo confirma)',
}

function defProponer(tipo: string, que: string, datos: string): Obj {
  return {
    name: 'proponer_' + tipo,
    description: `Propone una tarjeta de ${que} para que la persona la apruebe. No crea nada: la tarjeta queda en borrador (si falta algo) o lista. ${datos}`,
    inputSchema: {
      type: 'object',
      properties: {
        accion: accionSchema,
        objetivo: { type: 'string', description: 'id de lo que ya existe en la oficina (para modificar o quitar)' },
        ref: { type: 'string', description: 'id de una tarjeta tuya para actualizarla en vez de crear otra (por ejemplo t1)' },
        origen: { type: 'string', description: 'cita TEXTUAL de lo que dijo la persona y que justifica esta tarjeta' },
        datos: { type: 'object', description: datos },
      },
      required: ['accion', 'origen'],
    },
  }
}

export class HerramientasCreador implements MCPHerramientas {
  constructor(private readonly s: Servicios, private readonly token: string, private readonly identidad: IdentidadMCP) {}

  get definiciones(): Obj[] {
    const ref = 'Para referirte a otra tarjeta escribí "tarjeta:<id>".'
    return [
      {
        name: 'ver_oficina',
        description: 'Resumen de la oficina (departamentos, agentes, reglas, flujos, tareas) y de las tarjetas que ya armaste. Miralo antes de proponer cambios.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'listar_conectores',
        description: 'Los conectores de la cuenta de claude.ai (Calendar, Gmail, Drive…) con sus herramientas y si están disponibles.',
        inputSchema: { type: 'object', properties: {} },
      },
      defProponer('departamento', 'departamento', '{id?, nombre*, mision?, color?}'),
      defProponer('agente', 'agente', `{id?, nombre*, rol*, departamento* (id o tarjeta:x), prompt*, description?, modelo?, chips?, sabeDe? (3 a 6 temas sobre los que sabe, para que los colegas sepan a quién preguntarle), limites?:{solo?,proponer?}, conectores?, permisos? (["coordinador"] para quien coordina la oficina)}. ${ref}`),
      defProponer('flujo', 'flujo de trabajo', `{id?, nombre*, descripcion?, pasos*:[{id?, nombre*, quien* (id de agente, tarjeta:x o persona), consigna?, recibe?, recibeDe?, entrega*, aprobacion* (true o false, tiene que venir explícita), plazoDias?, esperaDias?}]}. ${ref}`),
      defProponer('regla', 'regla de la oficina', '{id?, texto*}'),
      defProponer('conector', 'conector para un agente', `{agente* (id o tarjeta:x), servidor*, leer?, actuar?} con nombres completos de herramientas (ver listar_conectores). ${ref}`),
      defProponer('tarea', 'tarea programada', `{agente* (id o tarjeta:x), nombre*, consigna*, dias* ([1…7], 1 = lunes) o fecha (AAAA-MM-DD), hora* (HH:MM), zona?, periodicidad? (solo semanal)}. ${ref}`),
      {
        name: 'marcar_faltante',
        description: 'Anota una pregunta pendiente en una tarjeta: lo que el texto no dice. La tarjeta pasa a borrador hasta que se complete ese campo.',
        inputSchema: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'id de la tarjeta' },
            campo: { type: 'string', description: 'campo que falta (por ejemplo mision)' },
            pregunta: { type: 'string', description: 'la pregunta para la persona' },
          },
          required: ['ref', 'campo', 'pregunta'],
        },
      },
      {
        name: 'descartar_tarjeta',
        description: 'Descarta una tarjeta tuya que ya no corresponde.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    ]
  }

  private cupo(): boolean {
    const m = mcpDe(this.s)
    if (!m) return true
    return m.tokens.tomar(this.token, Creador.claveCupo, Creador.maxEscrituras)
  }

  private static readonly sinCupo = () => MCPResultados.error(`Ya hiciste ${Creador.maxEscrituras} cambios en este mensaje y no podés hacer más. Respondé con lo que tengas.`)

  async llamar(nombre: string, argumentos: Obj): Promise<MCPResultado | undefined> {
    switch (nombre) {
      case 'ver_oficina': return this.verOficina()
      case 'listar_conectores': return MCPResultados.ok(Creador.json(Creador.conectoresJSON(catalogoDe(this.s)?.servidores())))
      case 'marcar_faltante': return this.marcar(argumentos)
      case 'descartar_tarjeta': return this.descartar(argumentos)
      default: {
        if (nombre.startsWith('proponer_') && tiposTarjeta.includes(nombre.slice('proponer_'.length))) {
          return this.proponer(nombre.slice('proponer_'.length), argumentos)
        }
        return undefined
      }
    }
  }

  private verOficina(): MCPResultado {
    let o: Oficina
    try { o = OficinaStore.leer(this.identidad.oficina) } catch { return MCPResultados.error('No pude leer la oficina.') }
    const ts = creadorDe(this.s).tarjetas.lista(this.identidad.oficina)
    return MCPResultados.ok(sanear(Creador.json(Creador.resumenOficina(o, ts))))
  }

  private proponer(tipo: string, args: Obj): MCPResultado {
    // 1) cupo
    if (!this.cupo()) return HerramientasCreador.sinCupo()
    const accion = args.accion
    if (typeof accion !== 'string' || !Creador.acciones.includes(accion)) return MCPResultados.error('«accion» tiene que ser crear, modificar o quitar.')
    // 2) anti-invento: la cita tiene que estar en lo que dijo la persona
    const origen = Creador.texto(args.origen)
    if (origen === undefined) return MCPResultados.error('Falta «origen»: citá textual lo que dijo la persona.')
    const mensajes = this.s.store.mensajes(this.identidad.sid)
    if (!Creador.citaValida(origen, mensajes)) {
      return MCPResultados.error(`Citá textual lo que dijo la persona: «${sanear(prefijo(origen, 80))}» no aparece en sus mensajes. No inventes: si el texto no lo dice, marcalo con marcar_faltante.`)
    }
    if (args.datos !== undefined && !esObjeto(args.datos)) return MCPResultados.error('«datos» tiene que ser un objeto.')
    const datos: Obj = esObjeto(args.datos) ? args.datos : {}
    try {
      // 3) a 8) sanear, faltantes, referencias, formato, estado, guardar, versión
      const t = Creador.armar(this.s, {
        carpeta: this.identidad.oficina, sid: this.identidad.sid, tipo, accion, objetivo: Creador.texto(args.objetivo), ref: Creador.texto(args.ref),
        origen: sanear(origen), datos,
      })
      return MCPResultados.ok(sanear(Creador.json(tarjetaJSON(t))))
    } catch (e) {
      if (e instanceof ErrorAPI) return MCPResultados.error(sanear(e.mensaje))
      return MCPResultados.error('No pude guardar la tarjeta.')
    }
  }

  private marcar(args: Obj): MCPResultado {
    if (!this.cupo()) return HerramientasCreador.sinCupo()
    const ref = Creador.texto(args.ref), campo = Creador.texto(args.campo), pregunta = Creador.texto(args.pregunta)
    if (ref === undefined || campo === undefined || pregunta === undefined) return MCPResultados.error('Faltan «ref», «campo» y «pregunta».')
    const { tarjetas, version } = creadorDe(this.s)
    const t = tarjetas.una(this.identidad.oficina, ref)
    if (!t) return MCPResultados.error(`No existe la tarjeta «${sanear(ref)}».`)
    if (!['borrador', 'lista', 'error'].includes(t.estado)) return MCPResultados.error(`La tarjeta «${ref}» ya está ${t.estado} y no se puede cambiar.`)
    const f = listaDe(t.faltantes).filter((x) => x.campo !== campo)
    const nuevo = Creador.faltante(prefijo(sanear(campo), 80), prefijo(sanear(pregunta), 400))
    nuevo.manual = true
    f.push(nuevo)
    t.faltantes = Creador.json(f, false)
    t.estado = 'borrador'
    t.error = undefined
    tarjetas.guardar(t)
    version.subir(this.identidad.oficina)
    const g = tarjetas.una(this.identidad.oficina, ref)
    if (!g) return MCPResultados.error('No pude guardar la tarjeta.')
    return MCPResultados.ok(sanear(Creador.json(tarjetaJSON(g))))
  }

  private descartar(args: Obj): MCPResultado {
    if (!this.cupo()) return HerramientasCreador.sinCupo()
    const id = Creador.texto(args.id)
    if (id === undefined) return MCPResultados.error('Falta «id».')
    const { tarjetas, version } = creadorDe(this.s)
    const t = tarjetas.una(this.identidad.oficina, id)
    if (!t) return MCPResultados.error(`No existe la tarjeta «${sanear(id)}».`)
    if (t.estado === 'creada') return MCPResultados.error(`La tarjeta «${id}» ya se creó: no se puede descartar.`)
    const g = tarjetas.estado(this.identidad.oficina, id, 'descartada')
    if (!g) return MCPResultados.error('No pude descartar la tarjeta.')
    version.subir(this.identidad.oficina)
    return MCPResultados.ok(sanear(Creador.json(tarjetaJSON(g))))
  }
}

/** Solo con el perfil creador del token. */
export const herramientasCreador = (s: Servicios, token: string, identidad: IdentidadMCP): MCPHerramientas | undefined =>
  identidad.perfil === 'creador' ? new HerramientasCreador(s, token, identidad) : undefined
