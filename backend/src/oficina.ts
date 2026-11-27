// Modelo de oficina.json (versión 1) y su lectura/escritura (Oficina.swift: Oficina, AgenteDef, Departamento, Avatar,
// Vinculo, BibliotecaCfg, Validar.oficina, OficinaStore).
//
// La decodificación imita a Codable: tipos estrictos en los campos conocidos (un tipo equivocado = oficina.json
// inválido), claves desconocidas descartadas, opcionales ausentes = undefined (no se escriben).
// `tareas`, `flujos` y `reglas` se tipan con sus módulos (tareas.ts, modelo-flujos.ts); sus validaciones se registran en `validacionesExtra`.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ErrorAPI } from './errores.js'
import { esObjeto, type Obj } from './json.js'
import { jsonSwift } from './json-swift.js'
import { Habilitados, type IAOficina } from './habilitados.js'
import { decodificarFlujo, decodificarRegla, type FlujoDef, type Regla } from './modelo-flujos.js'
import { decodificarTarea, type TareaProgramada } from './tareas.js'
import { Slug, Validar, largo, plegar, prefijo } from './validar.js'

export type Avatar = Partial<Record<(typeof clavesAvatar)[number], string>>
/** Las claves `px*` son de la oficina pixel (peinado, prenda de arriba, de abajo y accesorio); las demás vienen de la maqueta LEGO de antes y se conservan para leer avatares guardados. */
export const clavesAvatar = ['semilla', 'pelo', 'colorPelo', 'cara', 'torso', 'colorTorso', 'colorPiernas', 'colorPiel',
  'colorBrazos', 'colorAccesorio', 'piernas', 'sombrero', 'cuello', 'pxPelo', 'pxArriba', 'pxAbajo', 'pxAccesorio'] as const

export type Departamento = { id: string; nombre: string; color: string; mision?: string }
export type LimitesAgente = { solo?: string[]; proponer?: string[] }
export type ConectorAsignado = { servidor: string; leer: string[]; actuar: string[] }

export type AgenteDef = {
  id: string
  nombre: string
  rol: string
  departamento: string
  brief?: string
  modelo?: string
  /** Esfuerzo por defecto de sus corridas (`--effort`: low…max). Sin él, el de Claude Code de la persona. */
  esfuerzo?: string
  /** Skills de Claude Code que usa, dentro de las que habilita la oficina. Sin el campo, hereda las de la oficina; [] = ninguna. */
  skills?: string[]
  /** Servidores MCP de Claude Code que usa, dentro de los que habilita la oficina. Sin el campo, hereda; [] = ninguno. */
  mcp?: string[]
  chips?: string[]
  /** Temas sobre los que sabe (para que los colegas sepan a quién preguntarle): `colegas()` y `quien_sabe(tema)`. */
  sabeDe?: string[]
  avatar?: Avatar
  creado?: string
  /** Rutas extra dentro de `conocimiento/` donde puede escribir (las pone el importador). */
  escritura?: string[]
  limites?: LimitesAgente
  conectores?: ConectorAsignado[]
  /** Hoy el único valor válido es "coordinador". */
  permisos?: string[]
  /** Reglas de `--allowedTools` que la persona le dio con «Siempre» al responder un pedido de permiso
   *  (`Bash(git pull:*)`, `Edit(//ruta/**)`, `Write(//ruta/**)`). Ver permisos-vivos.ts. */
  reglas?: string[]
}

/** Quién puede leer una carpeta vinculada: "oficina", {departamentos: [...]} o {agentes: [...]}. */
export type AlcanceVinculo = 'oficina' | { departamentos: string[] } | { agentes: string[] }
export type Vinculo = { id: string; ruta: string; alcance: AlcanceVinculo }
/** Carpeta de trabajo (trabajo.ts): una carpeta de la compu donde los agentes del alcance leen y escriben (un repo, por
 *  ejemplo) y desde donde la app muestra archivos. No pasa por la Biblioteca. Misma forma que un vínculo. */
export type CarpetaTrabajo = Vinculo
export type BibliotecaCfg = { lecturaAutomatica?: boolean; maxMB?: number; maxArchivos?: number; maxTotalMB?: number }

export type ConsolidarMemoria = 'diaria' | 'semanal' | 'manual'
export const frecuenciasMemoria: readonly ConsolidarMemoria[] = ['diaria', 'semanal', 'manual']
/** Estado de la memoria de la oficina (memoria-estructura.ts, memoria.ts). Sin el campo, la oficina es de la estructura vieja (versión 1). */
export type MemoriaOficina = {
  /** 2 = estructura nueva (temas, histórico por mes, diario, índice). */
  version: number
  /** Fecha en que se migró una oficina vieja. */
  migrada?: string
  /** La persona ya aplicó o descartó la primera propuesta del bibliotecario (solo importa si hay `migrada`). */
  revisada?: boolean
  /** Cada cuánto ordena la memoria el bibliotecario (por defecto semanal). */
  consolidar?: ConsolidarMemoria
  /** Tokens de lo que se lee siempre a partir de los cuales ordena (2000 a 50000; 0 = sin disparo por tope; por defecto 6000). */
  topeTokens?: number
}

export type Oficina = {
  version: number
  nombre: string
  duenio: string
  avatarDuenio?: Avatar
  departamentos: Departamento[]
  agentes: AgenteDef[]
  vinculos?: Vinculo[]
  carpetasTrabajo?: CarpetaTrabajo[]
  biblioteca?: BibliotecaCfg
  tareas?: TareaProgramada[]
  flujos?: FlujoDef[]
  reglas?: Regla[]
  /** Skills, MCP de Claude Code y conectores de claude.ai habilitados para los agentes de esta oficina (habilitados.ts). */
  ia?: IAOficina
  memoria?: MemoriaOficina
  /** Secretaría de la oficina (secretaria.ts): quién la atiende, qué fuentes revisa y cada cuánto. Se guarda tal cual y
   *  la valida su módulo. */
  secretaria?: Obj
}

// MARK: - decodificación (como Codable)

class ErrorFormato extends Error {}
const falla = (): never => { throw new ErrorFormato() }

const str = (v: unknown): string => (typeof v === 'string' ? v : falla())
const optStr = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : str(v))
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : falla())
const optStrs = (v: unknown): string[] | undefined => (v === undefined || v === null ? undefined : strs(v))
const obj = (v: unknown): Obj => (esObjeto(v) ? v : falla())
const optInt = (v: unknown): number | undefined => (v === undefined || v === null ? undefined : Number.isInteger(v) ? (v as number) : falla())
const optBool = (v: unknown): boolean | undefined => (v === undefined || v === null ? undefined : typeof v === 'boolean' ? v : falla())
function opt<T>(v: unknown, f: (x: unknown) => T): T | undefined { return v === undefined || v === null ? undefined : f(v) }
function sinUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k]
  return o
}

export function decodificarAvatar(v: unknown): Avatar {
  const o = obj(v)
  const a: Avatar = {}
  for (const k of clavesAvatar) {
    const s = optStr(o[k])
    if (s !== undefined) a[k] = s
  }
  return a
}

function decodificarDepartamento(v: unknown): Departamento {
  const o = obj(v)
  return sinUndefined({ id: str(o.id), nombre: str(o.nombre), color: str(o.color), mision: optStr(o.mision) })
}

function decodificarAgente(v: unknown): AgenteDef {
  const o = obj(v)
  return sinUndefined({
    id: str(o.id), nombre: str(o.nombre), rol: str(o.rol), departamento: str(o.departamento),
    brief: optStr(o.brief), modelo: optStr(o.modelo), esfuerzo: optStr(o.esfuerzo), skills: optStrs(o.skills), mcp: optStrs(o.mcp), chips: optStrs(o.chips), sabeDe: optStrs(o.sabeDe),
    avatar: opt(o.avatar, decodificarAvatar), creado: optStr(o.creado), escritura: optStrs(o.escritura),
    limites: opt(o.limites, (x) => { const l = obj(x); return sinUndefined({ solo: optStrs(l.solo), proponer: optStrs(l.proponer) }) }),
    conectores: opt(o.conectores, (x) => (Array.isArray(x) ? x : falla()).map((c) => {
      const d = obj(c)
      return { servidor: str(d.servidor), leer: optStrs(d.leer) ?? [], actuar: optStrs(d.actuar) ?? [] }
    })),
    permisos: optStrs(o.permisos),
    reglas: optStrs(o.reglas),
  })
}

export function decodificarAlcance(v: unknown): AlcanceVinculo {
  if (typeof v === 'string') return v === 'oficina' ? 'oficina' : falla()
  const o = obj(v)
  if (o.departamentos !== undefined) return { departamentos: strs(o.departamentos) }
  if (o.agentes !== undefined) return { agentes: strs(o.agentes) }
  return falla()
}

/** JSON (ya parseado) → Oficina. Lanza ErrorFormato si no respeta los tipos. */
function decodificarOficina(v: unknown): Oficina {
  const o = obj(v)
  const lista = (x: unknown) => (x === undefined || x === null ? undefined : Array.isArray(x) ? x : falla())
  return sinUndefined({
    version: optInt(o.version) ?? 1,
    nombre: str(o.nombre),
    duenio: optStr(o.duenio) ?? '',
    avatarDuenio: opt(o.avatarDuenio, decodificarAvatar),
    departamentos: (lista(o.departamentos) ?? []).map(decodificarDepartamento),
    agentes: (lista(o.agentes) ?? []).map(decodificarAgente),
    vinculos: lista(o.vinculos)?.map((x) => { const d = obj(x); return { id: str(d.id), ruta: str(d.ruta), alcance: decodificarAlcance(d.alcance) } }),
    carpetasTrabajo: lista(o.carpetasTrabajo)?.map((x) => { const d = obj(x); return { id: str(d.id), ruta: str(d.ruta), alcance: decodificarAlcance(d.alcance) } }),
    biblioteca: opt(o.biblioteca, (x) => {
      const b = obj(x)
      return sinUndefined({ lecturaAutomatica: optBool(b.lecturaAutomatica), maxMB: optInt(b.maxMB), maxArchivos: optInt(b.maxArchivos), maxTotalMB: optInt(b.maxTotalMB) })
    }),
    tareas: lista(o.tareas)?.map(decodificarTarea),
    flujos: lista(o.flujos)?.map(decodificarFlujo),
    reglas: lista(o.reglas)?.map(decodificarRegla),
    ia: opt(o.ia, (x) => { const d = obj(x); return sinUndefined({ skills: optStrs(d.skills), mcp: optStrs(d.mcp), conectores: optStrs(d.conectores) }) }),
    memoria: opt(o.memoria, (x) => {
      const m = obj(x)
      return sinUndefined({
        version: optInt(m.version) ?? 1, migrada: optStr(m.migrada), revisada: optBool(m.revisada),
        consolidar: optStr(m.consolidar) as ConsolidarMemoria | undefined, topeTokens: optInt(m.topeTokens),
      })
    }),
    secretaria: opt(o.secretaria, obj),
  })
}

// MARK: - validación (Validar.oficina y ValidarAgenteExtra)

export const ValidarAgenteExtra = {
  permisoCoordinador: 'coordinador',
  /** Puede leer los chats de WhatsApp elegidos (whatsapp.ts). */
  permisoWhatsapp: 'whatsapp',
  maxItemsLimites: 12,
  maxLargoLimite: 300,
  maxServidores: 12,
  maxHerramientas: 80,
  maxLargoServidor: 80,
  maxLargoHerramienta: 200,
  maxMision: 600,

  limites(l: LimitesAgente) {
    for (const [campo, items] of [['solo', l.solo ?? []], ['proponer', l.proponer ?? []]] as const) {
      if (items.length > this.maxItemsLimites) throw new ErrorAPI(400, `«limites.${campo}» admite hasta ${this.maxItemsLimites} ítems.`)
      for (const t of items) {
        if (t.trim() === '' || largo(t) > this.maxLargoLimite) {
          throw new ErrorAPI(400, `Cada ítem de «limites.${campo}» tiene que tener entre 1 y ${this.maxLargoLimite} caracteres.`)
        }
      }
    }
  },

  conectores(cs: ConectorAsignado[]) {
    if (cs.length > this.maxServidores) throw new ErrorAPI(400, `Máximo ${this.maxServidores} conectores por agente.`)
    for (const c of cs) {
      const n = c.servidor.trim()
      if (n === '' || largo(n) > this.maxLargoServidor) {
        throw new ErrorAPI(400, `El nombre de un conector tiene que tener entre 1 y ${this.maxLargoServidor} caracteres.`)
      }
      for (const [campo, hs] of [['leer', c.leer], ['actuar', c.actuar]] as const) {
        if (hs.length > this.maxHerramientas) throw new ErrorAPI(400, `«${c.servidor}»: máximo ${this.maxHerramientas} herramientas en «${campo}».`)
        for (const h of hs) {
          if (!h.startsWith('mcp__') || h.startsWith('mcp__hq__') || largo(h) > this.maxLargoHerramienta) {
            throw new ErrorAPI(400, `«${c.servidor}»: «${[...h].slice(0, 60).join('')}» no es una herramienta válida (tiene que empezar con mcp__, no con mcp__hq__, y tener hasta ${this.maxLargoHerramienta} caracteres).`)
          }
        }
      }
    }
  },

  permisos(ps: string[]) {
    const vistos = new Set<string>()
    for (const p of ps) {
      if (p !== this.permisoCoordinador && p !== this.permisoWhatsapp) throw new ErrorAPI(400, `Permiso inválido: «${p}» (los permisos son «coordinador» y «whatsapp»).`)
      if (vistos.has(p)) throw new ErrorAPI(400, `Permiso repetido: «${p}».`)
      vistos.add(p)
    }
  },

  maxReglas: 40,
  maxLargoRegla: 300,

  /** Reglas guardadas con «Siempre»: `Bash(<algo>)`, `Edit(/<ruta absoluta>)` o `Write(/<ruta absoluta>)`, sin saltos de
   *  línea ni caracteres de control. `Bash` solo (sin paréntesis) no vale: sería permitir cualquier comando. */
  reglas(rs: string[]) {
    if (rs.length > this.maxReglas) throw new ErrorAPI(400, `Máximo ${this.maxReglas} permisos guardados por agente.`)
    const vistas = new Set<string>()
    for (const r of rs) {
      if (!this.reglaValida(r)) throw new ErrorAPI(400, `Permiso guardado inválido: «${prefijo(r, 80)}».`)
      if (vistas.has(r)) throw new ErrorAPI(400, `Permiso guardado repetido: «${prefijo(r, 80)}».`)
      vistas.add(r)
    }
  },

  reglaValida(r: string): boolean {
    if (largo(r) > this.maxLargoRegla || !r.endsWith(')')) return false
    for (const c of r) { const v = c.codePointAt(0)!; if (v < 0x20 || v === 0x7f) return false }
    for (const [pref, abs] of [['Bash(', false], ['Edit(', true], ['Write(', true]] as const) {
      if (!r.startsWith(pref)) continue
      const dentro = r.slice(pref.length, -1)
      if (dentro.trim() === '') return false
      if (abs && (!dentro.startsWith('/') || dentro.includes('..'))) return false
      return true
    }
    return false
  },

  maxTemas: 12,
  maxLargoTema: 60,

  /** «Sabe de»: hasta `maxTemas` temas de 1 a `maxLargoTema` caracteres, sin repetidos (sin importar acentos ni mayúsculas). */
  sabeDe(ts: string[]) {
    if (ts.length > this.maxTemas) throw new ErrorAPI(400, `«sabeDe» admite hasta ${this.maxTemas} temas.`)
    const vistos = new Set<string>()
    for (const t of ts) {
      if (t.trim() === '' || largo(t) > this.maxLargoTema) throw new ErrorAPI(400, `Cada tema de «sabeDe» tiene que tener entre 1 y ${this.maxLargoTema} caracteres.`)
      const n = plegar(t).trim()
      if (vistos.has(n)) throw new ErrorAPI(400, `Tema repetido en «sabeDe»: «${prefijo(t, 60)}».`)
      vistos.add(n)
    }
  },

  mision(m: string | undefined) {
    if (m !== undefined && largo(m) > this.maxMision) throw new ErrorAPI(400, `La misión es demasiado larga (máximo ${this.maxMision} caracteres).`)
  },
}

export const topesMemoria = { minTokens: 2000, maxTokens: 50000 }

/** `memoria` de oficina.json: versión 1 o más, frecuencia conocida y tope de 2000 a 50000 tokens (o 0 = sin tope). */
export function validarMemoria(m: MemoriaOficina) {
  if (m.version < 1) throw new ErrorAPI(400, 'oficina.json: la versión de la memoria no es válida.')
  if (m.consolidar !== undefined && !frecuenciasMemoria.includes(m.consolidar)) {
    throw new ErrorAPI(400, '«consolidar» tiene que ser «diaria», «semanal» o «manual».')
  }
  if (m.topeTokens !== undefined && m.topeTokens !== 0 && (m.topeTokens < topesMemoria.minTokens || m.topeTokens > topesMemoria.maxTokens)) {
    throw new ErrorAPI(400, `«topeTokens» tiene que ser 0 (sin tope) o un número entre ${topesMemoria.minTokens} y ${topesMemoria.maxTokens}.`)
  }
  if (m.migrada !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(m.migrada)) throw new ErrorAPI(400, 'oficina.json: la fecha de migración de la memoria no es válida.')
}

/** Validaciones extra de secciones que se portan después (tareas, flujos, reglas): se registran al portarlas. */
export const validacionesExtra: ((o: Oficina) => void)[] = []

/** «Departamento» fijo de quien atiende la secretaría (secretaria.ts): el id quedó de cuando se sentaba en la
 *  recepción; ahora tiene su despacho al lado del de la persona (sala «Secretaría» en la oficina pixel). No
 *  es una sala de `departamentos`; si la oficina tiene un departamento con este id, manda el de la oficina. */
export const deptoRecepcion = 'recepcion'
export const existeDepto = (o: Oficina, id: string) => id === deptoRecepcion || o.departamentos.some((d) => d.id === id)

/** Oficina completa: slugs, unicidad, departamentos existentes, colores. */
export function validarOficina(o: Oficina) {
  if (o.version !== 1) throw new ErrorAPI(400, `oficina.json: versión no soportada (${o.version}).`)
  if (o.nombre.trim() === '') throw new ErrorAPI(400, 'oficina.json: falta el nombre.')
  const deps = new Set<string>()
  for (const d of o.departamentos) {
    if (!Slug.valido(d.id)) throw new ErrorAPI(400, `Departamento con id inválido: ${d.id}.`)
    if (deps.has(d.id)) throw new ErrorAPI(400, `Departamento repetido: ${d.id}.`)
    deps.add(d.id)
    if (d.nombre.trim() === '') throw new ErrorAPI(400, `Departamento sin nombre: ${d.id}.`)
    if (!Validar.colorHex(d.color)) throw new ErrorAPI(400, `Color inválido en el departamento ${d.id}: ${d.color}.`)
    ValidarAgenteExtra.mision(d.mision)
  }
  const ids = new Set<string>()
  for (const a of o.agentes) {
    if (!Slug.valido(a.id)) throw new ErrorAPI(400, `Agente con id inválido: ${a.id}.`)
    if (ids.has(a.id)) throw new ErrorAPI(400, `Agente repetido: ${a.id}.`)
    ids.add(a.id)
    if (!deps.has(a.departamento) && a.departamento !== deptoRecepcion) throw new ErrorAPI(400, `El agente ${a.id} está en un departamento que no existe (${a.departamento}).`)
    for (const r of a.escritura ?? []) if (!Validar.rutaEscrituraValida(r)) throw new ErrorAPI(400, `Ruta de escritura inválida en ${a.id}: ${r}.`)
    if (a.limites) ValidarAgenteExtra.limites(a.limites)
    if (a.conectores) ValidarAgenteExtra.conectores(a.conectores)
    if (a.permisos) ValidarAgenteExtra.permisos(a.permisos)
    if (a.reglas) ValidarAgenteExtra.reglas(a.reglas)
    if (a.sabeDe) ValidarAgenteExtra.sabeDe(a.sabeDe)
    if (a.skills) Habilitados.lista(a.skills, `skills de ${a.id}`)
    if (a.mcp) Habilitados.lista(a.mcp, `mcp de ${a.id}`)
  }
  if (o.ia) Habilitados.validarOficina(o.ia)
  if (o.memoria) validarMemoria(o.memoria)
  const vins = new Set<string>()
  for (const v of o.vinculos ?? []) {
    if (!Slug.valido(v.id) || vins.has(v.id)) throw new ErrorAPI(400, `Carpeta vinculada con id inválido o repetido: ${v.id}.`)
    vins.add(v.id)
    if (!path.isAbsolute(v.ruta)) throw new ErrorAPI(400, `La carpeta vinculada ${v.id} tiene que tener una ruta absoluta.`)
  }
  const cts = new Set<string>()
  for (const c of o.carpetasTrabajo ?? []) {
    if (!Slug.valido(c.id) || cts.has(c.id)) throw new ErrorAPI(400, `Carpeta de trabajo con id inválido o repetido: ${c.id}.`)
    cts.add(c.id)
    if (!path.isAbsolute(c.ruta)) throw new ErrorAPI(400, `La carpeta de trabajo ${c.id} tiene que tener una ruta absoluta.`)
  }
  for (const f of validacionesExtra) f(o)
}

// MARK: - lectura y escritura

export const OficinaStore = {
  archivo: 'oficina.json',

  ruta(carpeta: string) { return path.join(carpeta, this.archivo) },

  existe(carpeta: string) { return fs.existsSync(this.ruta(carpeta)) },

  /** Texto de oficina.json con el formato de Swift. */
  codificar(o: Oficina): string { return jsonSwift(o) },

  leer(carpeta: string): Oficina {
    let texto: string
    try {
      texto = fs.readFileSync(this.ruta(carpeta), 'utf8')
    } catch {
      throw new ErrorAPI(404, 'No hay una oficina en esa carpeta (falta oficina.json).')
    }
    let o: Oficina
    try {
      o = decodificarOficina(JSON.parse(texto))
    } catch {
      throw new ErrorAPI(400, 'oficina.json no se puede leer: tiene un formato inválido.')
    }
    validarOficina(o)
    return o
  },

  /** Valida y escribe de forma atómica (archivo temporal en la misma carpeta + rename). */
  escribir(o: Oficina, carpeta: string) {
    validarOficina(o)
    escribirAtomico(this.codificar(o), this.ruta(carpeta))
  },
}

/** Escritura atómica: temporal + rename. En Windows el rename falla si otro proceso tiene el destino abierto: reintenta. */
export function escribirAtomico(datos: string | Buffer, destino: string) {
  const tmp = `${destino}.tmp-${randomUUID().slice(0, 8)}`
  try {
    fs.writeFileSync(tmp, datos)
    for (let intento = 0; ; intento++) {
      try {
        fs.renameSync(tmp, destino)
        break
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (intento >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (intento + 1))
      }
    }
  } catch {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {}
    throw new ErrorAPI(500, 'No pude guardar el archivo.')
  }
}

// MARK: - JSON de respuesta

/** Lo que devuelve la API: la oficina tal como se escribe (sin opcionales ausentes). */
export function oficinaJSON(o: Oficina): Obj { return JSON.parse(JSON.stringify(o)) }
export const agenteJSON = (a: AgenteDef): Obj => JSON.parse(JSON.stringify(a))
export function departamentoJSON(d: Departamento): Obj {
  const r: Obj = { id: d.id, nombre: d.nombre, color: d.color }
  if (d.mision !== undefined) r.mision = d.mision
  return r
}
