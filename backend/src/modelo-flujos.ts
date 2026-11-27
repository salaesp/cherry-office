// Modelo de flujos y reglas de `oficina.json` (ModeloFlujos.swift: PasoFlujo, FlujoDef, Regla, LecturaAPI, ValidarFlujos,
// ValidarReglas). Todas las claves son opcionales menos las obligatorias de cada tipo: una oficina vieja abre igual.
// Lo reutilizan el motor, las rutas de flujos, el Creador y Gobierno.
import { ErrorAPI } from './errores.js'
import { esObjeto, type Obj } from './json.js'
import type { Oficina } from './oficina.js'
import { Slug, Validar, largo } from './validar.js'

// MARK: - tipos

/** Un paso de un flujo. `quien` es un id de agente o `"persona"`. */
export type PasoFlujo = {
  id: string
  nombre: string
  quien: string
  consigna?: string
  recibe?: string
  /** undefined = el paso inmediato anterior. Si viene, ids de pasos ANTERIORES del mismo flujo. */
  recibeDe?: string[]
  entrega: string
  aprobacion: boolean
  /** Bloqueo si el paso espera más que esto (días). */
  plazoDias?: number
  /** El paso arranca X días después de terminado el anterior. */
  esperaDias?: number
}

export type FlujoDef = {
  id: string
  nombre: string
  descripcion?: string
  pasos: PasoFlujo[]
  activo: boolean
  creado?: string
  origen?: string
  /** Id de otro flujo: al terminar una corrida de este (último paso aprobado), arranca una corrida de ese con la última
   *  entrega como contexto. Se lee de la oficina al momento de arrancar, así que los cambios de ese flujo valen para los dos usos. */
  siguiente?: string
  /** Frases con las que la persona nombra el flujo en una charla («presupuesto», «cotización»): si su mensaje usa una, la
   *  secretaría (o cualquier agente) lo puede arrancar sin pedir ok (charla-flujos.ts). */
  disparadores?: string[]
  /** Lo que necesita para arrancar (`obligatorio`: sin eso no arranca y el agente lo tiene que preguntar). */
  datos?: DatoFlujo[]
}

export type DatoFlujo = { nombre: string; obligatorio?: boolean }

export type Regla = { id: string; texto: string; origen?: string }

// MARK: - decodificación (como Codable: tipos estrictos, ausente o null = nil)

class ErrorFormato extends Error {}
const falla = (): never => { throw new ErrorFormato() }

const str = (v: unknown): string => (typeof v === 'string' ? v : falla())
const optStr = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : str(v))
const optInt = (v: unknown): number | undefined => (v === undefined || v === null ? undefined : Number.isInteger(v) ? (v as number) : falla())
const optStrs = (v: unknown): string[] | undefined => (v === undefined || v === null ? undefined : Array.isArray(v) ? v.map(str) : falla())
const obj = (v: unknown): Obj => (esObjeto(v) ? v : falla())

function sinUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k]
  return o
}

export function decodificarPaso(v: unknown): PasoFlujo {
  const o = obj(v)
  return sinUndefined({
    id: str(o.id), nombre: str(o.nombre), quien: str(o.quien), consigna: optStr(o.consigna), recibe: optStr(o.recibe),
    recibeDe: optStrs(o.recibeDe), entrega: str(o.entrega),
    aprobacion: o.aprobacion === undefined || o.aprobacion === null ? false : typeof o.aprobacion === 'boolean' ? o.aprobacion : falla(),
    plazoDias: optInt(o.plazoDias), esperaDias: optInt(o.esperaDias),
  })
}

/** JSON (ya parseado) → FlujoDef. Lanza Error si no respeta los tipos. */
export function decodificarFlujo(v: unknown): FlujoDef {
  const o = obj(v)
  const pasos = o.pasos === undefined || o.pasos === null ? [] : Array.isArray(o.pasos) ? o.pasos.map(decodificarPaso) : falla()
  return sinUndefined({
    id: str(o.id), nombre: str(o.nombre), descripcion: optStr(o.descripcion), pasos,
    activo: o.activo === undefined || o.activo === null ? true : typeof o.activo === 'boolean' ? o.activo : falla(),
    creado: optStr(o.creado), origen: optStr(o.origen), siguiente: optStr(o.siguiente),
    disparadores: optStrs(o.disparadores), datos: o.datos === undefined || o.datos === null ? undefined : Array.isArray(o.datos) ? o.datos.map(decodificarDato) : falla(),
  })
}

function decodificarDato(v: unknown): DatoFlujo {
  const o = obj(v)
  return sinUndefined({
    nombre: str(o.nombre),
    obligatorio: o.obligatorio === undefined || o.obligatorio === null ? undefined : typeof o.obligatorio === 'boolean' ? o.obligatorio : falla(),
  })
}

export function decodificarRegla(v: unknown): Regla {
  const o = obj(v)
  return sinUndefined({ id: str(o.id), texto: str(o.texto), origen: optStr(o.origen) })
}

/** Copia como diccionario JSON (sin opcionales ausentes): lo que devuelve la API. */
export const aDiccionario = <T>(v: T): Obj => JSON.parse(JSON.stringify(v)) as Obj
export const pasoJSON = (p: PasoFlujo): Obj => aDiccionario(p)
export const flujoJSON = (f: FlujoDef): Obj => aDiccionario(f)
export const reglaJSON = (r: Regla): Obj => aDiccionario(r)

// MARK: - lectura del diccionario de la API

export const LecturaAPI = {
  texto(v: unknown, campo: string, max: number, obligatorio = false): string | undefined {
    return Validar.texto(v, campo, max, obligatorio)
  },

  entero(v: unknown, campo: string): number | undefined {
    if (v === undefined || v === null) return undefined
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new ErrorAPI(400, `«${campo}» tiene que ser un número entero.`)
    return v
  },

  bool(v: unknown, campo: string): boolean | undefined {
    if (v === undefined || v === null) return undefined
    if (typeof v !== 'boolean') throw new ErrorAPI(400, `«${campo}» tiene que ser verdadero o falso.`)
    return v
  },

  lista(v: unknown, campo: string): string[] | undefined {
    if (v === undefined || v === null) return undefined
    if (!Array.isArray(v)) throw new ErrorAPI(400, `«${campo}» tiene que ser una lista de textos.`)
    const out: string[] = []
    for (const x of v) {
      if (typeof x !== 'string') throw new ErrorAPI(400, `«${campo}» tiene que ser una lista de textos.`)
      const t = x.trim()
      if (t !== '') out.push(t)
    }
    return out
  },
}

/** `numero` (1-based) arma el id por defecto (`p1`, `p2`…); `idsUsados` evita choques con ids explícitos. */
export function pasoDesde(d: Obj, numero: number, idsUsados: Set<string>): PasoFlujo {
  const idPedido = LecturaAPI.texto(d.id, 'id del paso', 41)
  if (idPedido !== undefined && !Slug.valido(idPedido)) throw new ErrorAPI(400, `El id del paso «${idPedido}» tiene que ser minúsculas, números y guiones.`)
  const id = idPedido ?? Slug.unico(`p${numero}`, idsUsados, `p${numero}`)
  const nombre = LecturaAPI.texto(d.nombre, 'nombre del paso', ValidarFlujos.maxNombre, true)!
  const quien = LecturaAPI.texto(d.quien, 'quien', 41, true)!
  const entrega = LecturaAPI.texto(d.entrega, 'entrega', ValidarFlujos.maxCorto, true)!
  return sinUndefined({
    id, nombre, quien,
    consigna: LecturaAPI.texto(d.consigna, 'consigna', ValidarFlujos.maxConsigna),
    recibe: LecturaAPI.texto(d.recibe, 'recibe', ValidarFlujos.maxCorto),
    recibeDe: LecturaAPI.lista(d.recibeDe, 'recibeDe'),
    entrega,
    aprobacion: LecturaAPI.bool(d.aprobacion, 'aprobacion') ?? false,
    plazoDias: LecturaAPI.entero(d.plazoDias, 'plazoDias'),
    esperaDias: LecturaAPI.entero(d.esperaDias, 'esperaDias'),
  })
}

/** Arma y valida un flujo desde el JSON de la API. Sin `id`, lo arma del nombre (único respecto de `idsUsados`). */
export function flujoDesde(d: Obj, idsUsados: Set<string>): FlujoDef {
  const nombre = LecturaAPI.texto(d.nombre, 'nombre', ValidarFlujos.maxNombre, true)!
  const idPedido = LecturaAPI.texto(d.id, 'id', 41)
  let id: string
  if (idPedido !== undefined) {
    if (!Slug.valido(idPedido)) throw new ErrorAPI(400, 'El id del flujo tiene que ser minúsculas, números y guiones (hasta 41 caracteres).')
    if (idsUsados.has(idPedido)) throw new ErrorAPI(409, 'Ya hay un flujo con ese id.')
    id = idPedido
  } else {
    id = Slug.unico(Slug.de(nombre), idsUsados, 'flujo')
  }
  const crudos = d.pasos
  if (!Array.isArray(crudos) || crudos.length === 0) throw new ErrorAPI(400, 'El flujo necesita al menos un paso.')
  if (crudos.length > ValidarFlujos.maxPasos) throw new ErrorAPI(400, `Un flujo tiene como máximo ${ValidarFlujos.maxPasos} pasos.`)
  const explicitos = new Set<string>()
  for (const x of crudos) if (esObjeto(x) && typeof x.id === 'string') explicitos.add(x.id)
  const pasos: PasoFlujo[] = []
  crudos.forEach((x, i) => {
    if (!esObjeto(x)) throw new ErrorAPI(400, 'Cada paso del flujo tiene que ser un objeto.')
    pasos.push(pasoDesde(x, i + 1, new Set([...explicitos, ...pasos.map((p) => p.id)])))
  })
  const f: FlujoDef = sinUndefined({
    id, nombre,
    descripcion: LecturaAPI.texto(d.descripcion, 'descripcion', ValidarFlujos.maxCorto),
    pasos,
    activo: LecturaAPI.bool(d.activo, 'activo') ?? true,
    creado: LecturaAPI.texto(d.creado, 'creado', 40),
    origen: LecturaAPI.texto(d.origen, 'origen', 600),
    siguiente: LecturaAPI.texto(d.siguiente, 'siguiente', 41),
    disparadores: listaVacia(LecturaAPI.lista(d.disparadores, 'disparadores')),
    datos: listaVacia(datosDesde(d.datos)),
  })
  ValidarFlujos.validarFlujo(f)
  return f
}

const listaVacia = <T>(l: T[] | undefined): T[] | undefined => (l === undefined || l.length === 0 ? undefined : l)

/** `datos` desde la API: lista de `{nombre, obligatorio?}` (o de textos: «cliente*» es obligatorio). */
function datosDesde(v: unknown): DatoFlujo[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) throw new ErrorAPI(400, '«datos» tiene que ser una lista.')
  const out: DatoFlujo[] = []
  for (const x of v) {
    let nombre: string, obligatorio = false
    if (typeof x === 'string') { nombre = x.trim(); if (nombre.endsWith('*')) { obligatorio = true; nombre = nombre.slice(0, -1).trim() } }
    else if (esObjeto(x) && typeof x.nombre === 'string') { nombre = x.nombre.trim(); obligatorio = x.obligatorio === true }
    else throw new ErrorAPI(400, 'Cada dato del flujo tiene que tener un nombre.')
    if (nombre !== '') out.push(obligatorio ? { nombre, obligatorio } : { nombre })
  }
  return out
}

export function reglaDesde(d: Obj, idsUsados: Set<string>): Regla {
  const texto = LecturaAPI.texto(d.texto, 'texto', ValidarReglas.maxTexto, true)!
  const idPedido = LecturaAPI.texto(d.id, 'id', 41)
  let id: string
  if (idPedido !== undefined) {
    if (!Slug.valido(idPedido)) throw new ErrorAPI(400, 'El id de la regla tiene que ser minúsculas, números y guiones (hasta 41 caracteres).')
    if (idsUsados.has(idPedido)) throw new ErrorAPI(409, 'Ya hay una regla con ese id.')
    id = idPedido
  } else {
    id = Slug.unico(Slug.de(texto), idsUsados, 'regla')
  }
  return sinUndefined({ id, texto, origen: LecturaAPI.texto(d.origen, 'origen', ValidarReglas.maxTexto) })
}

// MARK: - validación

export const ValidarFlujos = {
  maxFlujos: 30,
  maxPasos: 20,
  maxNombre: 80,
  maxConsigna: 4000,
  /** `recibe`, `entrega` y `descripcion`. */
  maxCorto: 600,
  maxDisparadores: 12,
  maxDatos: 12,
  /** Una frase que nombra el flujo o el nombre de un dato. */
  maxFrase: 60,

  /** Un flujo suelto: topes, ids slug únicos, `quien` bien formado y `recibeDe` solo hacia pasos anteriores.
   *  Que el agente de un paso no exista NO es error: la oficina tiene que seguir abriendo después de despedir a alguien. */
  validarFlujo(f: FlujoDef) {
    if (!Slug.valido(f.id)) throw new ErrorAPI(400, `Flujo con id inválido: ${f.id}.`)
    const n = f.nombre.trim()
    if (n === '' || largo(n) > this.maxNombre) throw new ErrorAPI(400, `El flujo ${f.id} necesita un nombre (hasta ${this.maxNombre} caracteres).`)
    if (f.descripcion !== undefined && largo(f.descripcion) > this.maxCorto) {
      throw new ErrorAPI(400, `La descripción del flujo ${f.id} es demasiado larga (máximo ${this.maxCorto} caracteres).`)
    }
    if (f.pasos.length < 1 || f.pasos.length > this.maxPasos) throw new ErrorAPI(400, `El flujo ${f.id} tiene que tener entre 1 y ${this.maxPasos} pasos.`)
    if (f.siguiente !== undefined) {
      if (!Slug.valido(f.siguiente)) throw new ErrorAPI(400, `El flujo ${f.id} sigue con un flujo de id inválido: ${f.siguiente}.`)
      if (f.siguiente === f.id) throw new ErrorAPI(400, `El flujo ${f.id} no puede seguir con él mismo.`)
    }
    if ((f.disparadores?.length ?? 0) > this.maxDisparadores) throw new ErrorAPI(400, `El flujo ${f.id} tiene más de ${this.maxDisparadores} frases que lo nombran.`)
    for (const d of f.disparadores ?? []) {
      if (d.trim() === '' || largo(d) > this.maxFrase) throw new ErrorAPI(400, `Las frases que nombran el flujo ${f.id} tienen que tener entre 1 y ${this.maxFrase} caracteres.`)
    }
    if ((f.datos?.length ?? 0) > this.maxDatos) throw new ErrorAPI(400, `El flujo ${f.id} pide más de ${this.maxDatos} datos para arrancar.`)
    const nombresDatos = new Set<string>()
    for (const d of f.datos ?? []) {
      const n = d.nombre.trim()
      if (n === '' || largo(n) > this.maxFrase) throw new ErrorAPI(400, `Los datos del flujo ${f.id} tienen que tener un nombre de hasta ${this.maxFrase} caracteres.`)
      if (nombresDatos.has(n.toLowerCase())) throw new ErrorAPI(400, `El flujo ${f.id} pide dos veces el dato «${n}».`)
      nombresDatos.add(n.toLowerCase())
    }
    const anteriores = new Set<string>()
    for (const p of f.pasos) {
      const donde = `paso ${p.id} del flujo ${f.id}`
      if (!Slug.valido(p.id)) throw new ErrorAPI(400, `Paso con id inválido en el flujo ${f.id}: ${p.id}.`)
      if (anteriores.has(p.id)) throw new ErrorAPI(400, `Paso repetido en el flujo ${f.id}: ${p.id}.`)
      const pn = p.nombre.trim()
      if (pn === '' || largo(pn) > this.maxNombre) throw new ErrorAPI(400, `El ${donde} necesita un nombre (hasta ${this.maxNombre} caracteres).`)
      if (!(p.quien === 'persona' || Slug.valido(p.quien))) throw new ErrorAPI(400, `El ${donde} tiene un «quien» inválido: ${p.quien}.`)
      if (p.consigna !== undefined && largo(p.consigna) > this.maxConsigna) throw new ErrorAPI(400, `La consigna del ${donde} es demasiado larga (máximo ${this.maxConsigna} caracteres).`)
      if (p.recibe !== undefined && largo(p.recibe) > this.maxCorto) throw new ErrorAPI(400, `«recibe» del ${donde} es demasiado largo (máximo ${this.maxCorto} caracteres).`)
      if (largo(p.entrega) > this.maxCorto) throw new ErrorAPI(400, `«entrega» del ${donde} es demasiado largo (máximo ${this.maxCorto} caracteres).`)
      if (p.plazoDias !== undefined && !(p.plazoDias >= 1 && p.plazoDias <= 60)) throw new ErrorAPI(400, `«plazoDias» del ${donde} tiene que estar entre 1 y 60.`)
      if (p.esperaDias !== undefined && !(p.esperaDias >= 1 && p.esperaDias <= 90)) throw new ErrorAPI(400, `«esperaDias» del ${donde} tiene que estar entre 1 y 90.`)
      for (const r of p.recibeDe ?? []) {
        if (!anteriores.has(r)) throw new ErrorAPI(400, `El ${donde} recibe de «${r}», que no es un paso anterior.`)
      }
      anteriores.add(p.id)
    }
  },

  validar(o: Oficina) {
    const fs = o.flujos ?? []
    if (fs.length > this.maxFlujos) throw new ErrorAPI(400, `Máximo ${this.maxFlujos} flujos.`)
    const ids = new Set<string>()
    for (const f of fs) {
      if (ids.has(f.id)) throw new ErrorAPI(400, `Flujo repetido: ${f.id}.`)
      ids.add(f.id)
      this.validarFlujo(f)
    }
    // `siguiente` hacia un flujo que ya no existe NO es error (la oficina tiene que seguir abriendo): el motor avisa al llegar.
    // Lo que sí no puede haber es un círculo: cada flujo sigue como mucho a uno, así que alcanza con recorrer la cadena.
    const sig = new Map(fs.map((f) => [f.id, f.siguiente]))
    for (const f of fs) {
      const vistos = new Set<string>([f.id])
      for (let s = f.siguiente; s !== undefined; s = sig.get(s)) {
        if (vistos.has(s)) throw new ErrorAPI(400, `Los flujos siguen uno a otro en círculo (${[...vistos, s].join(' → ')}).`)
        vistos.add(s)
      }
    }
  },
}

export const ValidarReglas = {
  maxReglas: 40,
  maxTexto: 600,

  validar(o: Oficina) {
    const rs = o.reglas ?? []
    if (rs.length > this.maxReglas) throw new ErrorAPI(400, `Máximo ${this.maxReglas} reglas.`)
    const ids = new Set<string>()
    for (const r of rs) {
      if (!Slug.valido(r.id) || ids.has(r.id)) throw new ErrorAPI(400, `Regla con id inválido o repetido: ${r.id}.`)
      ids.add(r.id)
      const t = r.texto.trim()
      if (t === '' || largo(t) > this.maxTexto) throw new ErrorAPI(400, `El texto de la regla ${r.id} tiene que tener entre 1 y ${this.maxTexto} caracteres.`)
      if (r.origen !== undefined && largo(r.origen) > this.maxTexto) throw new ErrorAPI(400, `El origen de la regla ${r.id} es demasiado largo.`)
    }
  },
}
