// Biblioteca de la oficina (Biblioteca.swift): archivos del usuario (subidos o vinculados), ficha de cada uno por el
// «bibliotecario» (un `claude -p` sin agente), catálogo en `conocimiento/archivos.md`, búsqueda FTS5, lectura por rol,
// propuestas de contradicción y carpetas vinculadas. Mismas tablas, archivos, prompts y API que Swift.
//
// Carpetas: archivos/compartido/, archivos/<departamento>/, archivos/entregables/<agente>/, archivos/.texto/<slug>.md,
// archivos/.papelera/, conocimiento/archivos.md, conocimiento/fuentes/<slug>.md.
//
// Concurrencia: la base es sincrónica; la cola de procesamiento tiene un solo trabajador (una promesa) y cada
// leer-modificar-escribir sin `await` en el medio es atómico. Con `await` (claude) se vuelve a leer después.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ClaudeError, ClaudeRunner } from './claude-runner.js'
import { iso, type Entrega } from './entregas.js'
import { ErrorAPI } from './errores.js'
import { dentro, realAunqueFalte } from './explorador.js'
import { esObjeto, objeto, objetoOpcional, type Obj } from './json.js'
import { Config } from './config.js'
import { escribirAtomico, OficinaStore, type AgenteDef, type AlcanceVinculo, type BibliotecaCfg, type Oficina, type Vinculo } from './oficina.js'
import { OficinaActiva } from './oficinas.js'
import { alcanceIncluye, argumentos, dirsVinculos, type ContextoOficina } from './permisos.js'
import { atrapar, no404, no405, type Query, type Resp, type SubRouter } from './router.js'
import { registrarModulo, type Servicios } from './servicios.js'
import { num, txt, type Fila, type SQLiteDB, type SQLValor } from './sqlite.js'
import { CajaCosto, type Observador } from './stream.js'
import { Slug, Validar, largo, plegar, prefijo, uuidValido } from './validar.js'
import { dia, decisiones, palabras, plano } from './reuniones.js'
import * as Extraccion from './extraccion.js'
import { vedadasDatos } from './datos-vedados.js'
import { TipoArchivo } from './extraccion.js'

// MARK: - modelo

export type Ficha = {
  titulo: string
  resumen: string
  datosClave: string[]
  temas: string[]
  utilPara: string[]
  fechas: string[]
}

export type Contradiccion = { actual: string; nuevo: string; sugerencia: string }

export type ArchivoFila = {
  slug: string
  oficina: string
  nombre: string
  /** "compartido", id de departamento o "vinculo": la carpeta donde está el original (el primero de `departamentos`). */
  departamento: string
  /** Departamentos a los que está asignado (uno o más; `["compartido"]` = toda la oficina). */
  departamentos: string[]
  /** Relativa a la oficina (`archivos/...`) si se subió; absoluta si viene de una carpeta vinculada. */
  ruta: string
  /** "subido" | "vinculo" */
  origen: string
  vinculo?: string
  tipo: string
  tam: number
  hash: string
  /** pendiente | extrayendo | fichando | leyendo | listo | error */
  estado: string
  error?: string
  aviso?: string
  ficha?: Ficha
  /** Agentes que todavía tienen que leerlo por rol. */
  leer: string[]
  lectura: Record<string, string>
  creado: number
  actualizado: number
  papelera: boolean
  /** El usuario pidió lectura por rol al subirlo. */
  leerPedido: boolean
  /** Si es la copia de un entregable que la persona guardó al revisarlo: de qué entrega, de qué agente y de qué archivo. */
  entrega?: OrigenEntrega
}

export type OrigenEntrega = { id: number; agente: string; ruta: string }

function origenEntregaDe(v: unknown): OrigenEntrega | undefined {
  if (!esObjeto(v) || typeof v.id !== 'number' || typeof v.ruta !== 'string') return undefined
  return { id: v.id, agente: typeof v.agente === 'string' ? v.agente : '', ruta: v.ruta }
}

/** ArchivoFila con los valores por omisión de Swift. */
export function nuevaFila(p: Pick<ArchivoFila, 'slug' | 'oficina' | 'nombre' | 'departamento' | 'ruta' | 'origen' | 'tipo' | 'tam' | 'hash' | 'estado' | 'creado' | 'actualizado'> & Partial<ArchivoFila>): ArchivoFila {
  return { leer: [], lectura: {}, papelera: false, leerPedido: false, departamentos: [p.departamento], ...p }
}

export type PropuestaFila = {
  id: string
  oficina: string
  archivo: string
  titulo: string
  actual: string
  nuevo: string
  sugerencia: string
  /** pendiente | aceptada | rechazada */
  estado: string
  creada: number
  resuelta?: number
}

export const fichaJSON = (f: Ficha): Obj => ({
  titulo: f.titulo, resumen: f.resumen, datos_clave: f.datosClave, temas: f.temas, util_para: f.utilPara, fechas: f.fechas,
})

/** Texto de un valor JSON como lo lee Swift (cadena recortada; números como texto; si no, ""). */
export function cadena(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  return ''
}

export function lista(v: unknown): string[] {
  if (typeof v === 'string') {
    const t = cadena(v)
    return t === '' ? [] : [t]
  }
  if (!Array.isArray(v)) return []
  return v.map((x) => {
    if (esObjeto(x)) return Object.entries(x).map(([k, val]) => `${k}: ${cadena(val)}`).sort().join(', ')
    return cadena(x)
  }).filter((x) => x !== '')
}

export function fichaDesde(o: Obj): Ficha {
  return { titulo: cadena(o.titulo), resumen: cadena(o.resumen), datosClave: lista(o.datos_clave), temas: lista(o.temas),
    utilPara: lista(o.util_para), fechas: lista(o.fechas) }
}

// MARK: - SQLite

const colsArchivo = 'slug,oficina,nombre,departamento,ruta,origen,vinculo,tipo,tam,hash,estado,error,aviso,ficha,leer,lectura,creado,actualizado,papelera,leer_pedido,departamentos,entrega'
const colsPropuesta = 'id,oficina,archivo,titulo,actual,nuevo,sugerencia,estado,creada,resuelta'

const jsonA = (o: unknown) => JSON.stringify(o)
const analizar = (t: string): unknown => { try { return JSON.parse(t) } catch { return undefined } }
const ahora = () => Date.now() / 1000

function archivoDe(r: Fila): ArchivoFila {
  const fi = r.ficha === null ? undefined : analizar(txt(r.ficha))
  const le = r.leer === null ? undefined : analizar(txt(r.leer))
  const lec = r.lectura === null ? undefined : analizar(txt(r.lectura))
  const deps = r.departamentos === null || r.departamentos === undefined ? undefined : analizar(txt(r.departamentos))
  const f: ArchivoFila = {
    slug: txt(r.slug), oficina: txt(r.oficina), nombre: txt(r.nombre), departamento: txt(r.departamento), ruta: txt(r.ruta),
    departamentos: Array.isArray(deps) && deps.length > 0 && deps.every((x) => typeof x === 'string') ? (deps as string[]) : [txt(r.departamento)],
    origen: txt(r.origen), tipo: txt(r.tipo), tam: num(r.tam), hash: txt(r.hash), estado: txt(r.estado),
    leer: Array.isArray(le) && le.every((x) => typeof x === 'string') ? (le as string[]) : [],
    lectura: esObjeto(lec) && Object.values(lec).every((x) => typeof x === 'string') ? (lec as Record<string, string>) : {},
    creado: num(r.creado), actualizado: num(r.actualizado), papelera: num(r.papelera) !== 0, leerPedido: num(r.leer_pedido) !== 0,
  }
  if (r.vinculo !== null) f.vinculo = txt(r.vinculo)
  if (r.error !== null) f.error = txt(r.error)
  if (r.aviso !== null) f.aviso = txt(r.aviso)
  if (esObjeto(fi)) f.ficha = fichaDesde(fi)
  const ent = r.entrega === null || r.entrega === undefined ? undefined : origenEntregaDe(analizar(txt(r.entrega)))
  if (ent) f.entrega = ent
  return f
}

function propuestaDe(r: Fila): PropuestaFila {
  const p: PropuestaFila = { id: txt(r.id), oficina: txt(r.oficina), archivo: txt(r.archivo), titulo: txt(r.titulo), actual: txt(r.actual),
    nuevo: txt(r.nuevo), sugerencia: txt(r.sugerencia), estado: txt(r.estado), creada: num(r.creada) }
  if (r.resuelta !== null) p.resuelta = num(r.resuelta)
  return p
}

/** Texto del índice sin FTS: título, resumen, temas y texto, sin acentos y en minúsculas. */
export const normIndice = (...partes: string[]) => plano(partes.join('\n'))

// `plano`, `palabras`, `dia` y `decisiones` son los de ReunionTexto (reuniones.ts).
export { plano, palabras, dia }

/** Tablas y consultas de la biblioteca (extensión de Store en Swift). */
export class BibliotecaDatos {
  constructor(private readonly db: SQLiteDB) {}

  /** Crea las tablas si faltan (con FTS5 si el SQLite lo trae; si no, una tabla común y búsqueda con LIKE) y deja
   *  `pendiente` lo que estaba a medio procesar al apagarse la app. */
  preparar(sinFTS = false) {
    const db = this.db
    db.exec(`
        CREATE TABLE IF NOT EXISTS archivos (
            slug TEXT NOT NULL,
            oficina TEXT NOT NULL,
            nombre TEXT NOT NULL,
            departamento TEXT NOT NULL,
            ruta TEXT NOT NULL,
            origen TEXT NOT NULL,
            vinculo TEXT,
            tipo TEXT NOT NULL,
            tam INTEGER NOT NULL DEFAULT 0,
            hash TEXT NOT NULL DEFAULT '',
            estado TEXT NOT NULL,
            error TEXT,
            aviso TEXT,
            ficha TEXT,
            leer TEXT,
            lectura TEXT,
            creado REAL NOT NULL,
            actualizado REAL NOT NULL,
            papelera INTEGER NOT NULL DEFAULT 0,
            leer_pedido INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (oficina, slug)
        );
        CREATE INDEX IF NOT EXISTS archivos_estado ON archivos(estado, papelera);
        CREATE TABLE IF NOT EXISTS propuestas (
            id TEXT PRIMARY KEY,
            oficina TEXT NOT NULL,
            archivo TEXT NOT NULL,
            titulo TEXT NOT NULL,
            actual TEXT NOT NULL,
            nuevo TEXT NOT NULL,
            sugerencia TEXT NOT NULL,
            estado TEXT NOT NULL,
            creada REAL NOT NULL,
            resuelta REAL
        );
        CREATE INDEX IF NOT EXISTS propuestas_oficina ON propuestas(oficina, estado);
        `)
    // asignación a varios departamentos (bases viejas no tienen la columna: NULL = solo `departamento`)
    if (!db.query("SELECT name FROM pragma_table_info('archivos')").some((f) => txt(f.name) === 'departamentos')) {
      db.exec('ALTER TABLE archivos ADD COLUMN departamentos TEXT')
    }
    // copia de un entregable (bases viejas no tienen la columna: NULL = no viene de una entrega)
    if (!db.query("SELECT name FROM pragma_table_info('archivos')").some((f) => txt(f.name) === 'entrega')) {
      db.exec('ALTER TABLE archivos ADD COLUMN entrega TEXT')
    }
    const hay = db.query("SELECT 1 AS x FROM sqlite_master WHERE name='archivos_fts'").length > 0
    if (!hay) {
      const comun = 'CREATE TABLE archivos_fts (slug TEXT, oficina TEXT, titulo TEXT, resumen TEXT, temas TEXT, texto TEXT, norm TEXT)'
      if (sinFTS) db.exec(comun)
      else {
        try {
          db.exec("CREATE VIRTUAL TABLE archivos_fts USING fts5(slug UNINDEXED, oficina UNINDEXED, titulo, resumen, temas, texto, tokenize='unicode61 remove_diacritics 2')")
        } catch {
          db.exec(comun)
        }
      }
    }
    // Índice sin FTS: `norm` guarda el texto sin acentos ni mayúsculas, que es donde busca el LIKE.
    if (!this.indiceEsFTS()) {
      const cols = db.query("SELECT name FROM pragma_table_info('archivos_fts')").map((f) => txt(f.name))
      if (!cols.includes('norm')) {
        db.exec('ALTER TABLE archivos_fts ADD COLUMN norm TEXT')
        const filas = db.query('SELECT rowid AS id, titulo, resumen, temas, texto FROM archivos_fts')
        for (const f of filas) {
          db.run('UPDATE archivos_fts SET norm=? WHERE rowid=?', [normIndice(txt(f.titulo), txt(f.resumen), txt(f.temas), txt(f.texto)), f.id as SQLValor])
        }
      }
    }
    db.run("UPDATE archivos SET estado='pendiente' WHERE estado IN ('extrayendo','fichando')")
  }

  indiceEsFTS(): boolean {
    try {
      return txt(this.db.query("SELECT sql FROM sqlite_master WHERE name='archivos_fts'")[0]?.sql).toUpperCase().includes('VIRTUAL')
    } catch {
      return false
    }
  }

  archivoGuardar(f: ArchivoFila) {
    this.db.run(`INSERT OR REPLACE INTO archivos(${colsArchivo}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      f.slug, f.oficina, f.nombre, f.departamento, f.ruta, f.origen, f.vinculo ?? null, f.tipo, f.tam, f.hash, f.estado,
      f.error ?? null, f.aviso ?? null, f.ficha ? jsonA(fichaJSON(f.ficha)) : null,
      f.leer.length === 0 ? null : jsonA(f.leer), Object.keys(f.lectura).length === 0 ? null : jsonA(f.lectura),
      f.creado, f.actualizado, f.papelera ? 1 : 0, f.leerPedido ? 1 : 0,
      f.departamentos.length > 1 || f.departamentos[0] !== f.departamento ? jsonA(f.departamentos) : null,
      f.entrega ? jsonA(f.entrega) : null,
    ])
  }

  /** Anota de qué entrega viene (o lo borra con undefined). */
  archivoEntrega(slug: string, oficina: string, entrega: OrigenEntrega | undefined) {
    this.db.run('UPDATE archivos SET entrega=? WHERE oficina=? AND slug=?', [entrega ? jsonA(entrega) : null, oficina, slug])
  }

  /** Los documentos (sin la papelera) que salieron de esa entrega. */
  archivosDeEntrega(oficina: string, id: number): ArchivoFila[] {
    return this.archivos(oficina).filter((f) => f.entrega?.id === id)
  }

  archivo(slug: string, oficina: string): ArchivoFila | undefined {
    try {
      const f = this.db.query(`SELECT ${colsArchivo} FROM archivos WHERE oficina=? AND slug=?`, [oficina, slug])[0]
      return f ? archivoDe(f) : undefined
    } catch { return undefined }
  }

  archivos(oficina: string, papelera = false): ArchivoFila[] {
    try {
      return this.db.query(`SELECT ${colsArchivo} FROM archivos WHERE oficina=? AND papelera=? ORDER BY creado DESC, slug`, [oficina, papelera ? 1 : 0]).map(archivoDe)
    } catch { return [] }
  }

  slugsUsados(oficina: string): Set<string> {
    try {
      return new Set(this.db.query('SELECT slug FROM archivos WHERE oficina=?', [oficina]).map((f) => txt(f.slug)))
    } catch { return new Set() }
  }

  /** Próximo archivo a procesar (de cualquier oficina): pendiente, o con lectura por rol pedida. */
  siguienteArchivo(): ArchivoFila | undefined {
    const f = this.db.query(`SELECT ${colsArchivo} FROM archivos WHERE papelera=0 AND estado IN ('pendiente','leyendo') ORDER BY actualizado, slug LIMIT 1`)[0]
    return f ? archivoDe(f) : undefined
  }

  archivoEstado(slug: string, oficina: string, estado: string, error?: string) {
    this.db.run('UPDATE archivos SET estado=?, error=?, actualizado=? WHERE oficina=? AND slug=? AND papelera=0', [estado, error ?? null, ahora(), oficina, slug])
  }

  archivoAviso(slug: string, oficina: string, aviso?: string) {
    this.db.run('UPDATE archivos SET aviso=? WHERE oficina=? AND slug=? AND papelera=0', [aviso ?? null, oficina, slug])
  }

  archivoFicha(slug: string, oficina: string, ficha: Ficha) {
    this.db.run('UPDATE archivos SET ficha=? WHERE oficina=? AND slug=? AND papelera=0', [jsonA(fichaJSON(ficha)), oficina, slug])
  }

  archivoLeer(slug: string, oficina: string, pendientes: string[], resultados: Record<string, string>) {
    this.db.run('UPDATE archivos SET leer=?, lectura=?, actualizado=? WHERE oficina=? AND slug=? AND papelera=0',
      [pendientes.length === 0 ? null : jsonA(pendientes), Object.keys(resultados).length === 0 ? null : jsonA(resultados), ahora(), oficina, slug])
  }

  /** Pide lectura por rol de estos agentes: pasa a `leyendo` (el procesador la toma enseguida). */
  archivoPedirLectura(slug: string, oficina: string, agentes: string[]) {
    this.db.run("UPDATE archivos SET estado='leyendo', leer=?, lectura=NULL, error=NULL, actualizado=? WHERE oficina=? AND slug=? AND papelera=0",
      [jsonA(agentes), ahora(), oficina, slug])
  }

  /** Cambia los departamentos a los que está asignado (el primero es la carpeta) y la ruta, si el original se movió. */
  archivoAsignar(slug: string, oficina: string, departamentos: string[], ruta: string, nombre: string) {
    this.db.run('UPDATE archivos SET departamento=?, departamentos=?, ruta=?, nombre=?, actualizado=? WHERE oficina=? AND slug=? AND papelera=0',
      [departamentos[0]!, departamentos.length > 1 ? jsonA(departamentos) : null, ruta, nombre, ahora(), oficina, slug])
  }

  archivoPapelera(slug: string, oficina: string, ruta: string) {
    this.db.run('UPDATE archivos SET papelera=1, ruta=?, actualizado=? WHERE oficina=? AND slug=?', [ruta, ahora(), oficina, slug])
  }

  /** El contenido cambió (hash distinto): se vuelve a procesar. */
  archivoReprocesar(slug: string, oficina: string, hash: string, tam: number, leerPedido?: boolean) {
    this.db.run("UPDATE archivos SET hash=?, tam=?, estado='pendiente', error=NULL, aviso=NULL, leer=NULL, lectura=NULL, actualizado=? WHERE oficina=? AND slug=? AND papelera=0",
      [hash, tam, ahora(), oficina, slug])
    if (leerPedido !== undefined) this.db.run('UPDATE archivos SET leer_pedido=? WHERE oficina=? AND slug=?', [leerPedido ? 1 : 0, oficina, slug])
  }

  // MARK: índice de búsqueda

  indiceGuardar(slug: string, oficina: string, titulo: string, resumen: string, temas: string, texto: string) {
    this.db.run('DELETE FROM archivos_fts WHERE slug=? AND oficina=?', [slug, oficina])
    const recorte = texto.length <= 300_000 ? texto : prefijo(texto, 300_000)
    if (this.indiceEsFTS()) {
      this.db.run('INSERT INTO archivos_fts(slug,oficina,titulo,resumen,temas,texto) VALUES(?,?,?,?,?,?)', [slug, oficina, titulo, resumen, temas, recorte])
    } else {
      this.db.run('INSERT INTO archivos_fts(slug,oficina,titulo,resumen,temas,texto,norm) VALUES(?,?,?,?,?,?,?)',
        [slug, oficina, titulo, resumen, temas, recorte, normIndice(titulo, resumen, temas, recorte)])
    }
  }

  indiceQuitar(slug: string, oficina: string) {
    try { this.db.run('DELETE FROM archivos_fts WHERE slug=? AND oficina=?', [slug, oficina]) } catch {}
  }

  /** Slugs que coinciden con `q` (mejor primero) y un fragmento del texto. FTS5 si está; si no, LIKE. */
  buscar(oficina: string, q: string): { slug: string; snippet: string }[] {
    const toks = palabras(q)
    if (toks.length === 0) return []
    try {
      if (this.indiceEsFTS()) {
        const m = toks.map((t) => `"${t}"*`).join(' ')
        return this.db.query(`
                SELECT slug, snippet(archivos_fts, 5, '[', ']', '…', 14) AS s FROM archivos_fts
                WHERE archivos_fts MATCH ? AND oficina=? ORDER BY rank LIMIT 100
                `, [m, oficina]).map((f) => ({ slug: txt(f.slug), snippet: txt(f.s) }))
      }
      const cond = toks.map(() => 'norm LIKE ?').join(' AND ')
      const filas = this.db.query(`SELECT slug, texto FROM archivos_fts WHERE oficina=? AND ${cond} LIMIT 100`, [oficina, ...toks.map((t) => `%${t}%`)])
      return filas.map((f) => ({ slug: txt(f.slug), snippet: fragmento(txt(f.texto), toks[0]!) }))
    } catch {
      return []
    }
  }

  // MARK: propuestas

  propuestaAgregar(p: PropuestaFila) {
    // no repetir la misma sugerencia pendiente para el mismo archivo
    const ya = this.db.query("SELECT 1 AS x FROM propuestas WHERE oficina=? AND archivo=? AND sugerencia=? AND estado='pendiente'", [p.oficina, p.archivo, p.sugerencia]).length > 0
    if (ya) return
    this.db.run('INSERT INTO propuestas(id,oficina,archivo,titulo,actual,nuevo,sugerencia,estado,creada) VALUES(?,?,?,?,?,?,?,?,?)',
      [p.id, p.oficina, p.archivo, p.titulo, p.actual, p.nuevo, p.sugerencia, p.estado, p.creada])
  }

  propuestas(oficina: string, todas: boolean): PropuestaFila[] {
    try {
      return this.db.query(`SELECT ${colsPropuesta} FROM propuestas WHERE oficina=? ${todas ? '' : "AND estado='pendiente'"} ORDER BY creada DESC`, [oficina]).map(propuestaDe)
    } catch { return [] }
  }

  propuesta(id: string, oficina: string): PropuestaFila | undefined {
    try {
      const f = this.db.query(`SELECT ${colsPropuesta} FROM propuestas WHERE id=? AND oficina=?`, [id, oficina])[0]
      return f ? propuestaDe(f) : undefined
    } catch { return undefined }
  }

  propuestaResolver(id: string, estado: string) {
    this.db.run('UPDATE propuestas SET estado=?, resuelta=? WHERE id=?', [estado, ahora(), id])
  }
}

/** Fragmento del texto alrededor de la primera coincidencia (sin acentos ni mayúsculas): «…fragmento…». */
function fragmento(texto: string, tok: string): string {
  let plegado = ''
  const mapa: number[] = []
  let i = 0
  for (const ch of texto) {
    const p = plegar(ch)
    for (let k = 0; k < p.length; k++) mapa.push(i)
    plegado += p
    i += ch.length
  }
  const h = plegado.indexOf(tok)
  if (h < 0) return ''
  const ini = mapa[h]!
  const fin = (mapa[h + tok.length - 1] ?? ini) + 1
  const a = Math.max(0, ini - 60)
  const b = Math.min(texto.length, fin + 80)
  return '…' + texto.slice(a, b).replaceAll('\n', ' ') + '…'
}

// MARK: - textos, prompts y parseo (puros)

export const maxTextoPrompt = 12_000
export const maxMemoriaPrompt = 3_000
export const maxDecisionesPrompt = 2_000
export const maxContradicciones = 5
export const maxLectores = 10
export const carpetaCompartido = 'compartido'
export const carpetaVinculo = 'vinculo'

export function recortar(s: string, max: number): string {
  if (s.length <= max) return s
  return largo(s) > max ? prefijo(s, max) + '…' : s
}

export function nombreDepartamento(id: string, oficina: Oficina): string {
  if (id === carpetaCompartido) return 'Compartido'
  if (id === carpetaVinculo) return 'Carpeta vinculada'
  return oficina.departamentos.find((d) => d.id === id)?.nombre ?? id
}

/** «Ventas», «Ventas y Redes», «Dirección, Ventas y Redes». */
export function nombresDepartamentos(ids: string[], oficina: Oficina): string {
  const n = ids.map((id) => nombreDepartamento(id, oficina))
  return n.length <= 1 ? (n[0] ?? '') : n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1]
}

export function tamTexto(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.floor(n / 1024)} KB`
  return `${(n / 1_048_576).toFixed(1)} MB`
}

const leerTexto = (p: string): string => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const soloEspacios = (s: string) => s.replace(/^[\s\u0085\u2028\u2029]+|[\s\u0085\u2028\u2029]+$/g, '')

export function promptFicha(p: { oficina: Oficina; carpeta: string; nombre: string; tipo: string; departamento: string; departamentos?: string[]; texto: string }): string {
  const { oficina } = p
  const deps = oficina.departamentos.map((d) => `- ${d.id}: ${d.nombre}`).join('\n')
  const memoria = recortar(soloEspacios(leerTexto(path.join(p.carpeta, 'conocimiento/oficina.md'))), maxMemoriaPrompt)
  const dec = decisiones(p.carpeta)
  return `Sos el bibliotecario de la oficina «${oficina.nombre}». Llegó un documento nuevo y tenés que fichar.

Documento: ${p.nombre} (tipo: ${p.tipo}; carpeta: ${nombresDepartamentos(p.departamentos ?? [p.departamento], oficina)})

Departamentos de la oficina (id: nombre):
${deps === '' ? '(ninguno)' : deps}

Memoria común de la oficina (recortada):
${memoria === '' ? '(vacía)' : memoria}

Decisiones recientes:
${recortar(dec, maxDecisionesPrompt)}

Texto del documento (recortado a ${maxTextoPrompt} caracteres):
<<<
${prefijo(p.texto, maxTextoPrompt)}
>>>

Devolvé SOLO un objeto JSON estricto (sin texto antes ni después, sin bloques de código) con esta forma:
{"titulo": "título claro del documento", "resumen": "resumen en 3-5 oraciones", "datos_clave": ["dato concreto: cifras, nombres, fechas, condiciones"], "temas": ["tema"], "util_para": ["id-de-departamento"], "fechas": ["fechas relevantes"], "contradicciones": [{"actual": "lo que dice hoy la memoria o las decisiones", "nuevo": "lo que dice el documento", "sugerencia": "frase breve para anexar a la memoria común"}]}
Reglas: en "util_para" poné solo ids de la lista de departamentos a los que este documento les sirve. En "contradicciones" poné solo diferencias reales y verificables entre el documento y la memoria o las decisiones (lista vacía si no hay). No inventes nada que no esté en el texto.`
}

/** Extrae el objeto JSON (con o sin ```json) y lo normaliza. undefined si no hay forma de leerlo. */
export function parsearFicha(t: string, nombre: string, oficina: Oficina): [Ficha, Contradiccion[]] | undefined {
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a < 0 || b < 0 || a >= b) return undefined
  const o = analizar(t.slice(a, b + 1))
  if (!esObjeto(o)) return undefined
  const f = fichaDesde(o)
  if (f.titulo === '' && f.resumen === '') return undefined
  if (f.titulo === '') f.titulo = nombre
  f.utilPara = departamentosDe(f.utilPara, oficina)
  const cs: Contradiccion[] = []
  for (const x of Array.isArray(o.contradicciones) ? o.contradicciones : []) {
    if (!esObjeto(x)) continue
    const c: Contradiccion = { actual: cadena(x.actual), nuevo: cadena(x.nuevo), sugerencia: cadena(x.sugerencia) }
    if (c.sugerencia !== '') cs.push(c)
    if (cs.length >= maxContradicciones) break
  }
  return [f, cs]
}

/** Ids de departamento a partir de ids o nombres (descarta los desconocidos, sin repetir). */
export function departamentosDe(v: string[], oficina: Oficina): string[] {
  const out: string[] = []
  for (const x of v) {
    const s = Slug.de(x)
    const hit = oficina.departamentos.find((d) => d.id === x || d.id === s || Slug.de(d.nombre) === s)
    if (hit && !out.includes(hit.id)) out.push(hit.id)
  }
  return out
}

export function fichaMD(f: ArchivoFila, ficha: Ficha, oficina: Oficina): string {
  const origen = f.origen === 'vinculo' ? `carpeta vinculada «${f.vinculo ?? ''}»` : `subido el ${dia(new Date(f.creado * 1000))}`
  let s = `# ${ficha.titulo === '' ? f.nombre : ficha.titulo}\n\n`
  s += `- **Archivo:** ${f.nombre}\n`
  s += `- **Tipo:** ${f.tipo} · ${tamTexto(f.tam)}\n`
  s += `- **Carpeta:** ${nombresDepartamentos(f.departamentos, oficina)}\n`
  s += `- **Origen:** ${origen}\n`
  s += `- **Ubicación del original:** ${f.ruta}\n`
  s += `- **Texto completo:** archivos/.texto/${f.slug}.md\n`
  s += `- **Identificador:** ${f.slug} (sha256 ${f.hash.slice(0, 12)})\n`
  if (ficha.utilPara.length > 0) s += '- **Útil para:** ' + ficha.utilPara.map((d) => nombreDepartamento(d, oficina)).join(', ') + '\n'
  if (ficha.fechas.length > 0) s += '- **Fechas:** ' + ficha.fechas.join('; ') + '\n'
  s += `\n## Resumen\n\n${ficha.resumen === '' ? '(sin resumen)' : ficha.resumen}\n`
  if (ficha.datosClave.length > 0) s += '\n## Datos clave\n\n' + ficha.datosClave.map((d) => `- ${d}`).join('\n') + '\n'
  if (ficha.temas.length > 0) s += '\n## Temas\n\n' + ficha.temas.join(', ') + '\n'
  return s
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Una línea por documento (los que no están en la papelera). */
export function catalogoMD(filas: ArchivoFila[], oficina: Oficina): string {
  const s = '# Archivos de la oficina\n\nCatálogo de documentos: una línea por documento. Para el detalle, leé su ficha en `conocimiento/fuentes/<slug>.md` y, si hace falta, el texto completo en `archivos/.texto/<slug>.md`.\n'
  const vivas = filas.filter((f) => !f.papelera).sort((a, b) => cmp(a.departamento, b.departamento) || cmp(a.nombre, b.nombre))
  if (vivas.length === 0) return s + '(Todavía no hay documentos.)\n'
  let out = s
  for (const f of vivas) {
    const dep = nombresDepartamentos(f.departamentos, oficina)
    const fi = f.ficha
    if (fi) {
      let resumen = fi.resumen.split(/\r\n|[\n\r\u000b\u000c\u0085\u2028\u2029]/).filter((x) => x !== '').join(' ')
      if (largo(resumen) > 180) resumen = prefijo(resumen, 180) + '…'
      out += `- **${fi.titulo === '' ? f.nombre : fi.titulo}** (\`${f.slug}\`, ${dep}, ${f.tipo}): ${resumen} → \`conocimiento/fuentes/${f.slug}.md\`\n`
    } else {
      out += `- **${f.nombre}** (\`${f.slug}\`, ${dep}, ${f.tipo}): todavía sin ficha (${f.estado === 'error' ? 'no se pudo fichar' : 'en proceso'}) → texto en \`archivos/.texto/${f.slug}.md\`\n`
    }
  }
  return out
}

export function promptLectura(p: { titulo: string; nombre: string; slug: string; agente: AgenteDef; esImagen: boolean; ruta: string }): string {
  let s = `Se sumó un documento a la biblioteca de la oficina: «${p.titulo}» (archivo ${p.nombre}).
Leé su ficha en \`conocimiento/fuentes/${p.slug}.md\` y, si hace falta, el texto completo en \`archivos/.texto/${p.slug}.md\`.`
  if (p.esImagen) s += `\nEs una imagen: el original está en \`${p.ruta}\`; podés verlo con Read.`
  s += `

Después anotá en tus notas (\`conocimiento/agentes/${p.agente.id}.md\`, el único archivo que podés escribir) qué te sirve de este documento desde tu rol de ${p.agente.rol}: breve, solo hechos, sin suposiciones. Leé tus notas antes y agregá al final sin pisar lo que ya tenés. Si nada de esto sirve para tu rol, anotá una línea que lo diga.
Cuando termines, respondé solo «listo».`
  return s
}

/** Anexa una sugerencia aceptada a la memoria común (`conocimiento/oficina.md`). */
export function anexarActualizacion(carpeta: string, sugerencia: string, titulo: string, slug: string, fecha: Date = new Date()) {
  const p = path.join(carpeta, 'conocimiento/oficina.md')
  let actual = leerTexto(p)
  if (actual !== '' && !actual.endsWith('\n')) actual += '\n'
  actual += `\n## Actualizado ${dia(fecha)}\n${sugerencia}\n(Fuente: ${titulo}, \`conocimiento/fuentes/${slug}.md\`)\n`
  fs.mkdirSync(path.dirname(p), { recursive: true })
  escribirAtomico(actual, p)
}

/** Un `claude -p` SIN agente con la herramienta `Read` y carpetas extra (`--add-dir`): para describir imágenes. */
export async function correrConLectura(runner: ClaudeRunner, p: { prompt: string; cwd: string; dirs: string[]; timeout: number; obs?: Observador }): Promise<string> {
  runner.verificar(p.cwd)
  const a = ['-p', ...ClaudeRunner.formatoSalida, '--tools', 'Read', ...ClaudeRunner.argsModelo(runner.config.modelo('internos'))]
  for (const d of p.dirs) a.push('--add-dir', d)
  a.push('--allowedTools', 'Read', ...ClaudeRunner.sinConectores, ...vedadasDatos(runner.config.datosDir, [p.cwd], false))
  return runner.resultado([...a, '--', p.prompt], { timeout: p.timeout, cwd: p.cwd, obs: p.obs })
}

// MARK: - servicio

const maxBodyChico = 200_000
const maxVinculos = 20
const maxBase64Directo = 8 * 1024 * 1024
const MB = 1_048_576

type Limites = { maxArchivoBytes: number; maxArchivos: number; maxTotalBytes: number }

/** Biblioteca de una instalación: la cola de procesamiento (un solo trabajador) vive acá; el estado de cada archivo, en SQLite. */
export class Biblioteca {
  readonly datos: BibliotecaDatos
  private readonly sinFTS: boolean
  private readonly timeoutFicha: number
  private readonly timeoutImagen: number
  private readonly envMaxMB: number
  private readonly envMaxArchivos: number
  private readonly envMaxTotalMB: number
  private trabajador?: Promise<void>
  private otraVuelta = false
  private cerrado = false
  readonly leyendoAhora = new Set<string>()

  constructor(private readonly s: Servicios) {
    const env = s.env
    this.datos = new BibliotecaDatos(s.store.db)
    this.sinFTS = env.HQ_BIBLIOTECA_SIN_FTS === '1'
    const numero = (k: string, d: number) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== '' && Number.isFinite(v) && v > 0 ? v : d }
    this.timeoutFicha = numero('HQ_BIBLIOTECA_TIMEOUT', 180)
    this.timeoutImagen = numero('HQ_BIBLIOTECA_IMAGEN_TIMEOUT', 120)
    this.envMaxMB = Math.trunc(numero('HQ_BIBLIOTECA_MAX_MB', 25))
    this.envMaxArchivos = Math.trunc(numero('HQ_BIBLIOTECA_MAX_ARCHIVOS', 200))
    this.envMaxTotalMB = Math.trunc(numero('HQ_BIBLIOTECA_MAX_TOTAL_MB', 500))
    this.datos.preparar(this.sinFTS)
  }

  get oficinas() { return this.s.oficinas }
  get log() { return this.s.log }

  /** Deja de tomar trabajo nuevo (se llama antes de matar los claude). */
  cerrar() { this.cerrado = true }

  /** Espera a que termine el archivo en curso (cierre ordenado). */
  async detener() {
    this.cerrado = true
    await this.trabajador
  }

  // MARK: límites y rutas

  limites(o: Oficina): Limites {
    const c: BibliotecaCfg | undefined = o.biblioteca
    const pos = (v: number | undefined, d: number) => ((v ?? 0) > 0 ? v! : d)
    return { maxArchivoBytes: pos(c?.maxMB, this.envMaxMB) * MB, maxArchivos: pos(c?.maxArchivos, this.envMaxArchivos),
      maxTotalBytes: pos(c?.maxTotalMB, this.envMaxTotalMB) * MB }
  }

  rutaAbsoluta(f: ArchivoFila, a: OficinaActiva): string { return path.isAbsolute(f.ruta) ? f.ruta : a.ruta(f.ruta) }

  /** Escribe un texto (carpetas incluidas) de forma atómica. */
  escribir(texto: string, ruta: string) {
    fs.mkdirSync(path.dirname(ruta), { recursive: true })
    escribirAtomico(texto, ruta)
  }

  // MARK: exportar / importar (paquete)

  /** Filas de la biblioteca de la oficina (sin la papelera), para el manifiesto del paquete. */
  filasParaExportar(carpeta: string): ArchivoFila[] { return this.datos.archivos(carpeta) }

  /** Registra los documentos de una oficina importada: los que traen ficha y texto quedan `listo` (y se indexan); el resto,
   *  `pendiente`, y el trabajador los vuelve a fichar. Regenera el catálogo. */
  importarFilas(filas: ArchivoFila[], carpeta: string, oficina: Oficina): { listos: number; pendientes: number } {
    let listos = 0
    let pendientes = 0
    for (const f of filas) {
      this.datos.archivoGuardar(f)
      if (f.estado === 'listo' && f.ficha) {
        const texto = leerTexto(path.join(carpeta, `archivos/.texto/${f.slug}.md`))
        try { this.datos.indiceGuardar(f.slug, carpeta, [f.ficha.titulo, f.nombre].join(' '), f.ficha.resumen, f.ficha.temas.join(' '), texto) } catch {}
        listos++
      } else pendientes++
    }
    try { this.escribir(catalogoMD(this.datos.archivos(carpeta), oficina), path.join(carpeta, 'conocimiento/archivos.md')) } catch {}
    if (pendientes > 0) this.despertar()
    return { listos, pendientes }
  }

  // MARK: cola

  despertar() {
    if (this.cerrado) return
    if (this.trabajador) { this.otraVuelta = true; return }
    // arranca después de que termine el pedido que lo despertó (así la respuesta de una subida dice «pendiente»)
    this.trabajador = new Promise<void>((resolve) => setImmediate(resolve)).then(() => this.bucle())
  }

  private async bucle() {
    try {
      while (!this.cerrado) {
        const f = this.datos.siguienteArchivo()
        if (f) { await this.procesar(f); continue }
        if (this.otraVuelta) { this.otraVuelta = false; continue }
        break
      }
    } catch (e) {
      if (!this.cerrado) this.log.error(`biblioteca: ${e instanceof Error ? e.message : e}`)
    } finally {
      this.trabajador = undefined
    }
  }

  private sigue(f: ArchivoFila): boolean {
    const x = this.datos.archivo(f.slug, f.oficina)
    return x !== undefined && !x.papelera
  }

  private async procesar(f0: ArchivoFila) {
    let f = f0
    let of: Oficina
    try {
      of = OficinaStore.leer(f.oficina)
    } catch {
      try { this.datos.archivoEstado(f.slug, f.oficina, 'error', 'No pude leer la oficina.') } catch {}
      return
    }
    const a = new OficinaActiva(f.oficina, of)
    if (f.estado === 'pendiente') {
      await this.extraerYFichar(f, a)
      if (!this.sigue(f)) return
      const x = this.datos.archivo(f.slug, f.oficina)
      if (!x) return
      f = x
    }
    if (f.estado === 'leyendo') await this.leerPorRol(f, a)
  }

  /** Extrae el texto, ficha, indexa y deja el catálogo al día. Termina en `listo`, `error` o `leyendo`. */
  private async extraerYFichar(f: ArchivoFila, a: OficinaActiva) {
    const { datos, s } = this
    const slug = f.slug
    const carpeta = a.carpeta
    const ruta = this.rutaAbsoluta(f, a)
    const sinError = (g: () => void) => { try { g() } catch {} }
    sinError(() => datos.archivoEstado(slug, carpeta, 'extrayendo'))
    sinError(() => datos.archivoAviso(slug, carpeta))
    // 1) texto
    const r = await Extraccion.texto(ruta, f.tipo)
    if (r.necesitaVision) {
      const caja = new CajaCosto()
      try {
        const p = `Describí la imagen que está en «${ruta}» (usá la herramienta Read para verla). Incluí todo el texto visible tal cual, números, objetos, personas (sin identificarlas), colores y contexto. Respondé en español, en texto plano, sin inventar lo que no se ve.`
        const t = await correrConLectura(s.runner, { prompt: p, cwd: carpeta, dirs: [path.dirname(ruta)], timeout: this.timeoutImagen, obs: caja.observador() })
        const limpio = soloEspacios(t)
        if (limpio === '') r.aviso = 'Claude no devolvió una descripción de la imagen.'
        else r.texto = limpio
      } catch (e) {
        r.aviso = e instanceof ClaudeError ? `No pude describir la imagen: ${e.mensaje}` : 'No pude describir la imagen.'
      } finally {
        s.store.registrarCosto({ oficina: carpeta, origen: 'biblioteca', ref: slug, costo: caja.valor })
      }
    }
    if (this.cerrado || !this.sigue(f)) return
    const texto = r.texto ?? ''
    if (texto !== '') sinError(() => this.escribir(texto, a.ruta(`archivos/.texto/${slug}.md`)))
    sinError(() => datos.archivoEstado(slug, carpeta, 'fichando'))
    if (r.aviso !== undefined) { const av = r.aviso; sinError(() => datos.archivoAviso(slug, carpeta, av)) }
    // 2) sin texto: no hay qué fichar; queda buscable por nombre
    if (texto === '') {
      const aviso = r.aviso ?? 'No pude sacar texto de este archivo.'
      sinError(() => datos.indiceGuardar(slug, carpeta, f.nombre, '', '', ''))
      sinError(() => datos.archivoEstado(slug, carpeta, 'error', aviso))
      sinError(() => datos.archivoAviso(slug, carpeta, aviso))
      this.regenerarCatalogo(a)
      return
    }
    // 3) ficha del bibliotecario
    let ficha: Ficha | undefined
    let contradicciones: Contradiccion[] = []
    let errorFicha: string | undefined
    const caja = new CajaCosto()
    try {
      const p = promptFicha({ oficina: a.oficina, carpeta, nombre: f.nombre, tipo: f.tipo, departamento: f.departamento, departamentos: f.departamentos, texto })
      const t = await s.runner.correrSinAgente(p, { timeout: this.timeoutFicha, cwd: carpeta, obs: caja.observador() })
      const parsed = parsearFicha(t, f.nombre, a.oficina)
      if (parsed) [ficha, contradicciones] = parsed
      else errorFicha = 'El bibliotecario no devolvió la ficha en el formato esperado.'
    } catch (e) {
      errorFicha = e instanceof ClaudeError ? e.mensaje : 'No pude fichar el documento.'
    } finally {
      s.store.registrarCosto({ oficina: carpeta, origen: 'biblioteca', ref: slug, costo: caja.valor })
    }
    if (this.cerrado || !this.sigue(f)) return
    // 4) indexar (con o sin ficha: el texto siempre es buscable)
    if (ficha) {
      const fi = ficha
      f.ficha = fi
      sinError(() => datos.archivoFicha(slug, carpeta, fi))
      sinError(() => this.escribir(fichaMD(f, fi, a.oficina), a.ruta(`conocimiento/fuentes/${slug}.md`)))
      for (const c of contradicciones) {
        sinError(() => datos.propuestaAgregar({ id: randomUUID().toLowerCase(), oficina: carpeta, archivo: slug, titulo: fi.titulo, actual: c.actual,
          nuevo: c.nuevo, sugerencia: c.sugerencia, estado: 'pendiente', creada: ahora() }))
      }
    }
    sinError(() => datos.indiceGuardar(slug, carpeta, [ficha?.titulo ?? '', f.nombre].join(' '), ficha?.resumen ?? '', (ficha?.temas ?? []).join(' '), texto))
    // el estado de error va antes del catálogo: si no, la línea queda para siempre en «en proceso»
    if (!ficha) sinError(() => datos.archivoEstado(slug, carpeta, 'error', errorFicha))
    this.regenerarCatalogo(a)
    if (!ficha) return
    // 5) ¿lectura por rol?
    const auto = a.oficina.biblioteca?.lecturaAutomatica ?? false
    if (f.leerPedido || auto) {
      f.ficha = ficha
      const ids = this.lectoresPorDefecto(f, a.oficina)
      if (ids.length > 0) {
        sinError(() => datos.archivoPedirLectura(slug, carpeta, ids))
        sinError(() => datos.archivoEstado(slug, carpeta, 'leyendo'))
        return
      }
    }
    sinError(() => datos.archivoEstado(slug, carpeta, 'listo'))
  }

  /** Agentes a los que les sirve: primero los de los departamentos a los que está asignado el archivo y después los de
   *  los departamentos de `util_para`, limitados por el alcance de la carpeta vinculada. */
  lectoresPorDefecto(f: ArchivoFila, o: Oficina): string[] {
    const deps: string[] = f.departamentos.filter((id) => o.departamentos.some((d) => d.id === id))
    for (const d of f.ficha?.utilPara ?? []) if (!deps.includes(d)) deps.push(d)
    let ags = deps.flatMap((d) => o.agentes.filter((ag) => ag.departamento === d))
    const vin = f.vinculo === undefined ? undefined : o.vinculos?.find((v) => v.id === f.vinculo)
    if (vin) ags = ags.filter((ag) => alcanceIncluye(vin.alcance, ag))
    return ags.slice(0, maxLectores).map((ag) => ag.id)
  }

  /** Cada agente lee la ficha y anota en SU archivo de notas (único permiso de escritura), en su carril. */
  private async leerPorRol(f: ArchivoFila, a: OficinaActiva) {
    const { datos, s } = this
    const carpeta = a.carpeta
    const slug = f.slug
    const titulo = f.ficha?.titulo ?? f.nombre
    const ids = f.leer
    const resultados: Record<string, string> = {}
    for (const id of ids) this.leyendoAhora.add(id)
    try {
      for (const [i, id] of ids.entries()) {
        if (this.cerrado || !this.sigue(f)) return
        const ag = a.oficina.agentes.find((x) => x.id === id)
        if (!ag) { resultados[id] = 'error: el agente ya no está en la oficina'; continue }
        const prompt = promptLectura({ titulo, nombre: f.nombre, slug, agente: ag, esImagen: TipoArchivo.imagenes.has(f.tipo), ruta: this.rutaAbsoluta(f, a) })
        const ctx: ContextoOficina = {
          carpeta, escritura: [a.ruta(`conocimiento/agentes/${id}.md`)], dirsExtra: dirsVinculos(a.oficina, ag), permitidas: [],
          vedadas: ['mcp__claude_ai_*'], // leer una ficha no usa conectores de claude.ai (plan §3)
          perfilMCP: 'agente',
        }
        const caja = new CajaCosto()
        try {
          await s.runner.conCarrilDe(carpeta, id, () => s.runner.actividad.seguir(
            { oficina: carpeta, agente: id, origen: 'biblioteca', tarea: 'Leyendo ' + f.nombre, extra: caja.observador() },
            (obs) => s.runner.ejecutarChat({ agente: id, mensaje: prompt, sid: randomUUID().toLowerCase(), activa: false, carpeta, obs, armar: (p) => argumentos(s.config, ctx, p) })))
          resultados[id] = 'ok'
        } catch (e) {
          if (e instanceof ClaudeError) {
            if (e.tipo === 'cerrando') return
            resultados[id] = 'error: ' + e.mensaje
          } else resultados[id] = 'error: no pude correr al agente'
        } finally {
          s.store.registrarCosto({ oficina: carpeta, agente: id, origen: 'biblioteca', ref: slug, costo: caja.valor })
        }
        try { datos.archivoLeer(slug, carpeta, ids.slice(i + 1), resultados) } catch {}
      }
      try { datos.archivoLeer(slug, carpeta, [], resultados) } catch {}
      try { datos.archivoEstado(slug, carpeta, 'listo') } catch {}
    } finally {
      for (const id of ids) this.leyendoAhora.delete(id)
    }
  }

  // MARK: catálogo

  regenerarCatalogo(a: OficinaActiva) {
    try { this.escribir(catalogoMD(this.datos.archivos(a.carpeta), a.oficina), a.ruta('conocimiento/archivos.md')) } catch {}
  }

  // MARK: rutas de archivos (las usa el router)

  // MARK: guardar (subidas y entregables)

  /** Guarda un archivo en `archivos/<dep>/` y lo deja `pendiente` para fichar (lo que hace una subida). Mismo contenido en
   *  la misma carpeta = duplicado (no se vuelve a procesar); mismo nombre con otro contenido = se reemplaza y se reprocesa.
   *  `nombre` ya saneado y con un tipo soportado. */
  guardarSubido(a: OficinaActiva, p: { nombre: string; data: Buffer; dep: string; leerPedido: boolean; entrega?: OrigenEntrega }): { fila: ArchivoFila; duplicado?: true; reemplazado?: true } {
    const { nombre, data, dep, leerPedido } = p
    const ext = TipoArchivo.extension(nombre)
    const hash = Extraccion.sha256(data)
    const carpeta = a.carpeta
    const existentes = this.datos.archivos(carpeta)
    const anotar = (slug: string) => { if (p.entrega) this.datos.archivoEntrega(slug, carpeta, p.entrega) }

    // mismo contenido en la misma carpeta: ya está
    const ya = existentes.find((x) => x.origen === 'subido' && x.departamento === dep && x.hash === hash)
    if (ya) {
      if (p.entrega && !ya.entrega) anotar(ya.slug)
      return { fila: this.datos.archivo(ya.slug, carpeta) ?? ya, duplicado: true }
    }
    // mismo nombre en la misma carpeta con otro contenido: se reemplaza y se vuelve a procesar
    const relBase = `archivos/${dep}`
    const viejo = existentes.find((x) => x.origen === 'subido' && x.departamento === dep && x.nombre === nombre)
    if (viejo) {
      try {
        fs.mkdirSync(a.ruta(relBase), { recursive: true })
        escribirAtomico(data, a.ruta(viejo.ruta))
        this.datos.archivoReprocesar(viejo.slug, carpeta, hash, data.length, leerPedido)
        anotar(viejo.slug)
      } catch {
        throw new ErrorAPI(500, 'No pude guardar el archivo.')
      }
      this.despertar()
      return { fila: this.datos.archivo(viejo.slug, carpeta) ?? viejo, reemplazado: true }
    }
    const destino = Extraccion.rutaLibre(a.ruta(relBase), nombre)
    try {
      fs.mkdirSync(a.ruta(relBase), { recursive: true })
      escribirAtomico(data, destino)
    } catch {
      throw new ErrorAPI(500, 'No pude guardar el archivo.')
    }
    const slug = Slug.unico(TipoArchivo.sinExtension(nombre), this.datos.slugsUsados(carpeta), 'archivo')
    const t = ahora()
    const f = nuevaFila({ slug, oficina: carpeta, nombre: path.basename(destino), departamento: dep, ruta: `${relBase}/${path.basename(destino)}`,
      origen: 'subido', tipo: ext, tam: data.length, hash, estado: 'pendiente', creado: t, actualizado: t, leerPedido })
    if (p.entrega) f.entrega = p.entrega
    try { this.datos.archivoGuardar(f) } catch { throw new ErrorAPI(500, 'No pude registrar el archivo.') }
    this.despertar()
    this.log.info(`biblioteca: archivo ${p.entrega ? 'de una entrega' : 'subido'} tipo=${ext} tam=${data.length}`)
    return { fila: f }
  }

  /** Guarda en la biblioteca una copia de archivos de una entrega (los que la persona eligió al revisarla). Cada ruta tiene
   *  que ser uno de los archivos de la entrega, estar dentro de la oficina, existir y tener un tipo soportado. La copia
   *  queda fija: si el agente hace una versión nueva, la de la biblioteca no cambia. */
  guardarDeEntrega(a: OficinaActiva, e: Entrega, rels: string[], dep: string, leerPedido: boolean): Obj[] {
    if (dep !== carpetaCompartido && !a.oficina.departamentos.some((x) => x.id === dep)) throw new ErrorAPI(400, `El departamento «${dep}» no existe.`)
    if (rels.length === 0) throw new ErrorAPI(400, 'Elegí al menos un archivo.')
    const lim = this.limites(a.oficina)
    const base = realAunqueFalte(path.resolve(a.carpeta))
    const datos: { rel: string; nombre: string; data: Buffer }[] = []
    for (const rel of rels) {
      if (!e.archivos.includes(rel)) throw new ErrorAPI(400, `«${rel}» no es un archivo de esta entrega.`)
      const abs = realAunqueFalte(path.resolve(a.carpeta, rel))
      if (!dentro(base, abs) || abs === base) throw new ErrorAPI(400, `«${rel}» no está dentro de la oficina.`)
      const nombre = Extraccion.nombreSeguro(path.basename(rel))
      const ext = TipoArchivo.extension(nombre)
      if (!TipoArchivo.soportados.has(ext)) throw new ErrorAPI(400, `«${nombre}» no se puede guardar en la biblioteca (${ext === '' ? 'sin extensión' : '.' + ext}).`)
      let st: fs.Stats
      try { st = fs.statSync(abs) } catch { throw new ErrorAPI(404, `«${nombre}» ya no está en la oficina.`) }
      if (!st.isFile()) throw new ErrorAPI(400, `«${rel}» no es un archivo.`)
      if (st.size > lim.maxArchivoBytes) throw new ErrorAPI(413, `«${nombre}» pesa ${tamTexto(st.size)} y el máximo es ${Math.floor(lim.maxArchivoBytes / MB)} MB.`)
      let data: Buffer
      try { data = fs.readFileSync(abs) } catch { throw new ErrorAPI(500, `No pude leer «${nombre}».`) }
      if (data.length === 0) throw new ErrorAPI(400, `«${nombre}» está vacío.`)
      datos.push({ rel, nombre, data })
    }
    return datos.map((d) => {
      const r = this.guardarSubido(a, { nombre: d.nombre, data: d.data, dep, leerPedido, entrega: { id: e.id, agente: e.agente, ruta: d.rel } })
      const v = archivoVista(r.fila)
      if (r.duplicado) v.duplicado = true
      if (r.reemplazado) v.reemplazado = true
      return v
    })
  }

  /** Los archivos de la entrega que se pueden guardar en la biblioteca: dentro de la oficina, que existen y con un tipo
   *  soportado (las actas de reunión cuentan; las carpetas y los tipos que no se leen, no). */
  guardables(a: OficinaActiva, e: Entrega): string[] {
    const base = realAunqueFalte(path.resolve(a.carpeta))
    return e.archivos.filter((rel) => {
      if (!TipoArchivo.soportados.has(TipoArchivo.extension(path.basename(rel)))) return false
      const abs = realAunqueFalte(path.resolve(a.carpeta, rel))
      if (!dentro(base, abs) || abs === base) return false
      try { return fs.statSync(abs).isFile() } catch { return false }
    })
  }

  /** Los documentos de la biblioteca que salieron de esa entrega (`Archivo` de la API). */
  vistasDeEntrega(oficina: string, id: number): Obj[] {
    return this.datos.archivosDeEntrega(oficina, id).map((f) => archivoVista(f))
  }

  /** `{nombre, tipo, mime, tam, ruta, base64?}`: la app no puede abrir un archivo local desde el WebView, así que los
   *  archivos de hasta 8 MB viajan en base64 (el front arma un Blob); los más grandes devuelven solo la ruta. */
  contenidoDe(ruta: string, nombre: string, tipo: string): Obj {
    let tam: number
    try { tam = fs.statSync(ruta).size } catch { throw new ErrorAPI(404, 'El archivo original ya no está en esa ubicación.') }
    const o: Obj = { nombre, tipo, mime: TipoArchivo.mime(tipo), tam, ruta }
    if (tam <= maxBase64Directo) {
      try { o.base64 = fs.readFileSync(ruta).toString('base64') } catch {}
    }
    return o
  }
}

export const bibliotecaDe = (s: Servicios) => s.huecos.biblioteca as Biblioteca

// MARK: - rutas

const sinSuperficie = (v: unknown): v is Obj => esObjeto(v)

/** `Archivo` de la API (ver API.md). */
export function archivoVista(f: ArchivoFila, snippet?: string): Obj {
  const o: Obj = {
    slug: f.slug, nombre: f.nombre, titulo: f.ficha && f.ficha.titulo !== '' ? f.ficha.titulo : f.nombre,
    departamento: f.departamento, departamentos: f.departamentos, tipo: f.tipo, tam: f.tam, hash: f.hash, estado: f.estado, origen: f.origen, ruta: f.ruta,
    creado: iso(f.creado), actualizado: iso(f.actualizado),
    fichaRuta: `conocimiento/fuentes/${f.slug}.md`, textoRuta: `archivos/.texto/${f.slug}.md`,
  }
  if (f.vinculo !== undefined) o.vinculo = f.vinculo
  if (f.error !== undefined) o.error = f.error
  if (f.aviso !== undefined) o.aviso = f.aviso
  if (f.ficha) o.ficha = fichaJSON(f.ficha)
  if (f.leer.length > 0) o.leer = f.leer
  if (Object.keys(f.lectura).length > 0) o.lectura = f.lectura
  if (f.entrega) o.entrega = { id: f.entrega.id, agente: f.entrega.agente, ruta: f.entrega.ruta }
  if (snippet !== undefined && snippet !== '') o.snippet = snippet
  return o
}

/** `/api/archivos*`, `/api/vinculos*`, `/api/biblioteca*`. */
export class BibliotecaRouter implements SubRouter {
  constructor(private readonly b: Biblioteca) {}

  async handle(method: string, path: string, query: Query, body?: Buffer) {
    const partes = path.split('/').slice(1)
    if (partes.length < 2 || partes[0] !== 'api' || !['archivos', 'vinculos', 'biblioteca'].includes(partes[1]!) || partes.length > 5 || partes.includes('')) return null
    return atrapar(async () => {
      try {
        return await this.despachar(method, partes, query, body)
      } catch (e) {
        if (!(e instanceof ErrorAPI)) this.b.log.error(`biblioteca error interno: ${e instanceof Error ? e.stack ?? e.message : e}`)
        throw e
      }
    })
  }

  private async despachar(m: string, partes: string[], query: Query, body?: Buffer): Promise<Resp> {
    const n = partes.length
    switch (partes[1]) {
      case 'archivos': {
        if (n === 2) {
          if (m === 'GET') return [200, this.listar(query)]
          if (m === 'POST') return [200, this.subir(body)]
          return no405
        }
        const slug = partes[2]!
        if (!Slug.valido(slug)) return no404
        if (n === 3) {
          if (m === 'GET') return [200, this.detalle(slug)]
          if (m === 'PATCH') return [200, this.asignar(slug, body)]
          if (m === 'DELETE') return [200, this.quitar(slug)]
          return no405
        }
        if (n !== 4) return no404
        switch (partes[3]) {
          case 'original': return m === 'GET' ? [200, this.original(slug)] : no405
          case 'leer': return m === 'POST' ? [200, this.leer(slug, body)] : no405
          case 'reprocesar': return m === 'POST' ? [200, await this.reprocesar(slug)] : no405
          default: return no404
        }
      }
      case 'vinculos': {
        if (n === 2) {
          if (m === 'GET') return [200, this.listarVinculos()]
          if (m === 'POST') return [200, this.crearVinculo(body)]
          return no405
        }
        const id = partes[2]!
        if (!Slug.valido(id)) return no404
        if (n === 3) {
          if (m === 'PATCH') return [200, this.cambiarVinculo(id, body)]
          if (m === 'DELETE') return [200, this.quitarVinculo(id)]
          return no405
        }
        if (n === 4 && partes[3] === 'escanear') return m === 'POST' ? [200, await this.escanearVinculo(id)] : no405
        return no404
      }
      default: {
        const clave = `${partes[2]}/${n}`
        switch (clave) {
          case 'estado/3': return m === 'GET' ? [200, this.estado()] : no405
          case 'config/3':
            if (m === 'GET') return [200, this.config()]
            if (m === 'PATCH') return [200, this.cambiarConfig(body)]
            return no405
          case 'propuestas/3': return m === 'GET' ? [200, this.propuestas(query)] : no405
          case 'propuestas/4': return m === 'POST' ? [200, this.resolverPropuesta(partes[3]!, body)] : no405
          case 'entregables/3': return m === 'GET' ? [200, this.entregables(query)] : no405
          case 'entregable/3': return m === 'GET' ? [200, this.entregable(query)] : no405
          default: return no404
        }
      }
    }
  }

  // MARK: utilidades

  private get oficinas() { return this.b.oficinas }
  private get datos() { return this.b.datos }

  private vista(f: ArchivoFila, snippet?: string): Obj { return archivoVista(f, snippet) }

  private fila(slug: string, a: OficinaActiva): ArchivoFila {
    const f = this.datos.archivo(slug, a.carpeta)
    if (!f || f.papelera) throw new ErrorAPI(404, 'No encontré ese archivo.')
    return f
  }

  // MARK: archivos

  private listar(q: Query): Obj {
    const a = this.oficinas.requerirActiva()
    let filas = this.datos.archivos(a.carpeta)
    const snippets = new Map<string, string>()
    const busqueda = (q.q ?? '').trim()
    if (busqueda !== '') {
      const hits = this.datos.buscar(a.carpeta, busqueda)
      const orden = new Map<string, number>()
      hits.forEach((h, i) => { if (!orden.has(h.slug)) orden.set(h.slug, i) })
      for (const h of hits) snippets.set(h.slug, h.snippet)
      filas = filas.filter((f) => orden.has(f.slug)).sort((x, y) => orden.get(x.slug)! - orden.get(y.slug)!)
    }
    const d = q.departamento
    if (d !== undefined && d !== '') filas = filas.filter((f) => f.departamentos.includes(d))
    const o: Obj = { archivos: filas.map((f) => this.vista(f, snippets.get(f.slug))) }
    if (busqueda !== '') o.q = busqueda
    return o
  }

  private detalle(slug: string): Obj {
    const a = this.oficinas.requerirActiva()
    const f = this.fila(slug, a)
    const v = this.vista(f)
    v.rutaAbsoluta = this.b.rutaAbsoluta(f, a)
    const texto = leerTexto(a.ruta(`archivos/.texto/${slug}.md`))
    return { archivo: v, texto: recortar(texto, 4000) }
  }

  private subir(body?: Buffer): Obj {
    const a = this.oficinas.requerirActiva()
    const lim = this.b.limites(a.oficina)
    const d = objeto(body, Math.floor(lim.maxArchivoBytes * 4 / 3) + 100_000)
    const nombreCrudo = Validar.texto(d.nombre, 'nombre', 255)!
    const nombre = Extraccion.nombreSeguro(nombreCrudo)
    const ext = TipoArchivo.extension(nombre)
    if (!TipoArchivo.soportados.has(ext)) {
      throw new ErrorAPI(400, `Ese tipo de archivo no se puede leer (${ext === '' ? 'sin extensión' : '.' + ext}). Tipos soportados: ${TipoArchivo.lista}.`)
    }
    let dep = Validar.texto(d.departamento, 'departamento', 41, false) ?? carpetaCompartido
    if (dep !== carpetaCompartido) {
      if (!a.oficina.departamentos.some((x) => x.id === dep)) throw new ErrorAPI(400, `El departamento «${dep}» no existe.`)
    } else dep = carpetaCompartido
    if (typeof d.base64 !== 'string' || d.base64 === '') throw new ErrorAPI(400, 'Falta el contenido del archivo (base64).')
    let b64: string = d.base64
    if (b64.startsWith('data:')) {
      const i = b64.indexOf(',')
      if (i >= 0) b64 = b64.slice(i + 1)
    }
    const mb = Math.floor(lim.maxArchivoBytes / MB)
    if (Buffer.byteLength(b64) > Math.floor(lim.maxArchivoBytes * 4 / 3) + 8) throw new ErrorAPI(413, `El archivo es demasiado grande (el máximo es ${mb} MB).`)
    const data = Buffer.from(b64.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64')
    if (data.length === 0) throw new ErrorAPI(400, 'El contenido del archivo no es base64 válido.')
    if (data.length > lim.maxArchivoBytes) throw new ErrorAPI(413, `El archivo pesa ${tamTexto(data.length)} y el máximo es ${mb} MB.`)
    const leerPedido = typeof d.leer === 'boolean' ? d.leer : false
    const r = this.b.guardarSubido(a, { nombre, data, dep, leerPedido })
    const v = this.vista(r.fila)
    if (r.duplicado) { v.duplicado = true; return { archivo: v, duplicado: true } }
    if (r.reemplazado) { v.reemplazado = true; return { archivo: v, reemplazado: true } }
    return { archivo: v }
  }

  /** Asigna un archivo subido a uno o más departamentos (o a «compartido», toda la oficina): el original queda en la
   *  carpeta del primero (`archivos/<departamento>/`); se actualizan la ficha y el catálogo. Los de carpetas vinculadas no
   *  se asignan uno por uno: se cambia el acceso de la carpeta. */
  private asignar(slug: string, body?: Buffer): Obj {
    const a = this.oficinas.requerirActiva()
    const f = this.fila(slug, a)
    const d = objeto(body, maxBodyChico)
    let pedidos: unknown[]
    if (Array.isArray(d.departamentos)) pedidos = d.departamentos
    else if (typeof d.departamento === 'string') pedidos = [d.departamento]
    else throw new ErrorAPI(400, 'Falta «departamentos» (lista de ids; "compartido" = toda la oficina).')
    let deps: string[] = []
    for (const x of pedidos) {
      if (typeof x !== 'string') throw new ErrorAPI(400, '«departamentos» tiene que ser una lista de ids.')
      if (x !== carpetaCompartido && !a.oficina.departamentos.some((y) => y.id === x)) throw new ErrorAPI(400, `El departamento «${x}» no existe.`)
      if (!deps.includes(x)) deps.push(x)
    }
    // «toda la oficina» no se combina con departamentos; sin ninguno, es de toda la oficina
    if (deps.length === 0 || deps.includes(carpetaCompartido)) deps = [carpetaCompartido]
    if (f.origen !== 'subido') throw new ErrorAPI(409, 'Los archivos de una carpeta vinculada se asignan desde la carpeta (cambiá a quién le da acceso).')
    if (deps.join(',') === f.departamentos.join(',')) return { archivo: this.vista(f) }
    let ruta = f.ruta
    let nombre = f.nombre
    if (deps[0] !== f.departamento) {
      const relBase = `archivos/${deps[0]}`
      const destino = Extraccion.rutaLibre(a.ruta(relBase), f.nombre)
      try {
        fs.mkdirSync(a.ruta(relBase), { recursive: true })
        fs.renameSync(a.ruta(f.ruta), destino)
      } catch {
        throw new ErrorAPI(500, 'No pude mover el archivo a la carpeta del departamento.')
      }
      nombre = path.basename(destino)
      ruta = `${relBase}/${nombre}`
    }
    try { this.datos.archivoAsignar(slug, a.carpeta, deps, ruta, nombre) } catch { throw new ErrorAPI(500, 'No pude guardar el cambio.') }
    const nueva = this.datos.archivo(slug, a.carpeta) ?? f
    if (nueva.ficha) { const fi = nueva.ficha; try { this.b.escribir(fichaMD(nueva, fi, a.oficina), a.ruta(`conocimiento/fuentes/${slug}.md`)) } catch {} }
    this.b.regenerarCatalogo(a)
    this.b.log.info(`biblioteca: archivo asignado a ${deps.join(',')}`)
    return { archivo: this.vista(nueva) }
  }

  private quitar(slug: string): Obj {
    const a = this.oficinas.requerirActiva()
    const f = this.fila(slug, a)
    const ts = dia() + '-' + String(Math.floor(Date.now() / 1000) % 100000)
    const rel = `archivos/.papelera/${slug}-${ts}`
    try { fs.mkdirSync(a.ruta(rel), { recursive: true }) } catch {}
    // los archivos subidos se mueven (nada se borra); los vinculados no se tocan (son del usuario, fuera de la oficina)
    let destino = f.ruta
    if (f.origen === 'subido') {
      const d = Extraccion.rutaLibre(a.ruta(rel), f.nombre)
      try {
        fs.renameSync(a.ruta(f.ruta), d)
        destino = `${rel}/${path.basename(d)}`
      } catch {}
    }
    for (const [de, a2] of [[`conocimiento/fuentes/${slug}.md`, 'ficha.md'], [`archivos/.texto/${slug}.md`, 'texto.md']] as const) {
      if (fs.existsSync(a.ruta(de))) { try { fs.renameSync(a.ruta(de), a.ruta(`${rel}/${a2}`)) } catch {} }
    }
    try { this.datos.archivoPapelera(slug, a.carpeta, destino) } catch { throw new ErrorAPI(500, 'No pude quitar el archivo.') }
    this.datos.indiceQuitar(slug, a.carpeta)
    this.b.regenerarCatalogo(a)
    return { ok: true, papelera: destino }
  }

  private original(slug: string): Obj {
    const a = this.oficinas.requerirActiva()
    const f = this.fila(slug, a)
    return this.b.contenidoDe(this.b.rutaAbsoluta(f, a), f.nombre, f.tipo)
  }

  private async reprocesar(slug: string): Promise<Obj> {
    const a = this.oficinas.requerirActiva()
    const f = this.fila(slug, a)
    const ruta = this.b.rutaAbsoluta(f, a)
    const h = await Extraccion.sha256Archivo(ruta)
    if (h === undefined) throw new ErrorAPI(404, 'El archivo original ya no está en esa ubicación.')
    let tam = f.tam
    try { tam = fs.statSync(ruta).size } catch {}
    this.datos.archivoReprocesar(slug, a.carpeta, h, tam)
    const v = this.vista(this.datos.archivo(slug, a.carpeta) ?? f)
    this.b.despertar()
    return { archivo: v }
  }

  // MARK: lectura por rol

  private leer(slug: string, body?: Buffer): Obj {
    const a = this.oficinas.requerirActiva()
    const f = this.fila(slug, a)
    const d = objetoOpcional(body, maxBodyChico)
    if (!['listo', 'error'].includes(f.estado) || !f.ficha) {
      throw new ErrorAPI(409, !f.ficha ? 'Todavía no hay ficha de este archivo: esperá a que termine de procesarse.' : 'El archivo todavía se está procesando.')
    }
    let ids: string[]
    if (d.agentes !== undefined && d.agentes !== null) {
      if (!Array.isArray(d.agentes)) throw new ErrorAPI(400, '«agentes» tiene que ser una lista de ids.')
      ids = []
      for (const x of d.agentes) {
        if (typeof x !== 'string' || !a.oficina.agentes.some((g) => g.id === x)) throw new ErrorAPI(400, 'Hay un agente que no está en la oficina.')
        if (!ids.includes(x)) ids.push(x)
      }
      if (ids.length > maxLectores) throw new ErrorAPI(400, `Máximo ${maxLectores} agentes por lectura.`)
    } else {
      ids = this.b.lectoresPorDefecto(f, a.oficina)
    }
    if (ids.length === 0) throw new ErrorAPI(409, 'No hay agentes a quienes les sirva este documento (revisá «útil para» o elegí agentes).')
    try { this.datos.archivoPedirLectura(slug, a.carpeta, ids) } catch { throw new ErrorAPI(500, 'No pude pedir la lectura.') }
    const v = this.vista(this.datos.archivo(slug, a.carpeta) ?? f)
    this.b.despertar()
    return { archivo: v, agentes: ids }
  }

  // MARK: estado, config y propuestas

  private estado(): Obj {
    const a = this.oficinas.requerirActiva()
    const filas = this.datos.archivos(a.carpeta)
    const activos = filas.filter((f) => f.estado !== 'listo')
    const enCurso = filas.filter((f) => ['pendiente', 'extrayendo', 'fichando', 'leyendo'].includes(f.estado))
    const cola = activos.map((f) => {
      const o: Obj = { slug: f.slug, nombre: f.nombre, estado: f.estado }
      if (f.error !== undefined) o.error = f.error
      if (f.aviso !== undefined) o.aviso = f.aviso
      if (f.leer.length > 0) o.leer = f.leer
      return o
    })
    const ids = new Set(a.oficina.agentes.map((x) => x.id))
    const lee = [...this.b.leyendoAhora].filter((x) => ids.has(x)).sort()
    const props = this.datos.propuestas(a.carpeta, false).length
    return { cola, pendientes: enCurso.length, total: filas.length, leyendo: lee, propuestas: props, fts: this.datos.indiceEsFTS() }
  }

  private config(): Obj {
    const a = this.oficinas.requerirActiva()
    const l = this.b.limites(a.oficina)
    return { lecturaAutomatica: a.oficina.biblioteca?.lecturaAutomatica ?? false, maxMB: Math.floor(l.maxArchivoBytes / MB), maxArchivos: l.maxArchivos,
      maxTotalMB: Math.floor(l.maxTotalBytes / MB), extensiones: [...TipoArchivo.soportados].sort() }
  }

  private cambiarConfig(body?: Buffer): Obj {
    const d = objeto(body, maxBodyChico)
    const entero = (k: string, max: number): number | undefined => {
      const v = d[k]
      if (v === undefined || v === null) return undefined
      const n = typeof v === 'number' ? Math.trunc(v) : NaN
      if (!(n >= 1 && n <= max)) throw new ErrorAPI(400, `«${k}» tiene que ser un número entre 1 y ${max}.`)
      return n
    }
    const auto = typeof d.lecturaAutomatica === 'boolean' ? d.lecturaAutomatica : undefined
    if (d.lecturaAutomatica !== undefined && auto === undefined && d.lecturaAutomatica !== null) throw new ErrorAPI(400, '«lecturaAutomatica» tiene que ser verdadero o falso.')
    const mb = entero('maxMB', 500)
    const na = entero('maxArchivos', 5000)
    const mt = entero('maxTotalMB', 20000)
    this.oficinas.modificar((o) => {
      const c: BibliotecaCfg = o.biblioteca ?? {}
      if (auto !== undefined) c.lecturaAutomatica = auto
      if (mb !== undefined) c.maxMB = mb
      if (na !== undefined) c.maxArchivos = na
      if (mt !== undefined) c.maxTotalMB = mt
      o.biblioteca = c
    })
    return this.config()
  }

  private vistaPropuesta(p: PropuestaFila): Obj {
    const o: Obj = { id: p.id, archivo: p.archivo, titulo: p.titulo, actual: p.actual, nuevo: p.nuevo, sugerencia: p.sugerencia, estado: p.estado, creada: iso(p.creada) }
    if (p.resuelta !== undefined) o.resuelta = iso(p.resuelta)
    return o
  }

  private propuestas(q: Query): Obj {
    const a = this.oficinas.requerirActiva()
    return { propuestas: this.datos.propuestas(a.carpeta, q.todas === '1').map((p) => this.vistaPropuesta(p)) }
  }

  private resolverPropuesta(id: string, body?: Buffer): Obj {
    if (!uuidValido(id)) throw new ErrorAPI(404, 'No encontré esa propuesta.')
    const a = this.oficinas.requerirActiva()
    const aceptar = objeto(body, maxBodyChico).aceptar
    if (typeof aceptar !== 'boolean') throw new ErrorAPI(400, 'Falta «aceptar» (verdadero o falso).')
    const p = this.datos.propuesta(id.toLowerCase(), a.carpeta)
    if (!p) throw new ErrorAPI(404, 'No encontré esa propuesta.')
    if (p.estado !== 'pendiente') throw new ErrorAPI(409, 'Esa propuesta ya fue resuelta.')
    if (aceptar) {
      try { anexarActualizacion(a.carpeta, p.sugerencia, p.titulo, p.archivo) } catch { throw new ErrorAPI(500, 'No pude actualizar la memoria de la oficina.') }
    }
    try { this.datos.propuestaResolver(p.id, aceptar ? 'aceptada' : 'rechazada') } catch { throw new ErrorAPI(500, 'No pude guardar la decisión.') }
    const v = this.vistaPropuesta(this.datos.propuesta(p.id, a.carpeta) ?? p)
    v.aplicada = aceptar
    return { propuesta: v }
  }

  // MARK: entregables

  private carpetaEntregables(q: Query, a: OficinaActiva): { id: string; dir: string } {
    const id = q.agente
    if (id === undefined || !Slug.valido(id)) throw new ErrorAPI(400, 'Falta el agente.')
    return { id, dir: a.ruta(`archivos/entregables/${id}`) }
  }

  private entregables(q: Query): Obj {
    const a = this.oficinas.requerirActiva()
    const { id, dir } = this.carpetaEntregables(q, a)
    return { agente: id, carpeta: `archivos/entregables/${id}`, entregables: recorrerEntregables(dir) }
  }

  private entregable(q: Query): Obj {
    const a = this.oficinas.requerirActiva()
    const { dir } = this.carpetaEntregables(q, a)
    const rel = q.ruta
    if (rel === undefined || rel === '' || rel.includes('\0')) throw new ErrorAPI(400, 'Falta la ruta del entregable.')
    const base = realAunqueFalte(dir)
    const p = realAunqueFalte(path.join(dir, rel))
    if (p === base || !dentro(base, p) || !fs.existsSync(p)) throw new ErrorAPI(404, 'No encontré ese entregable.')
    return this.b.contenidoDe(p, path.basename(p), path.extname(p).slice(1).toLowerCase())
  }

  // MARK: vínculos

  private vistaVinculo(v: Vinculo, filas: ArchivoFila[]): Obj {
    const mios = filas.filter((f) => f.vinculo === v.id)
    return { id: v.id, ruta: v.ruta, alcance: v.alcance, archivos: mios.length, existe: fs.existsSync(v.ruta),
      pendientes: mios.filter((f) => f.estado !== 'listo' && f.estado !== 'error').length }
  }

  private listarVinculos(): Obj {
    const a = this.oficinas.requerirActiva()
    const filas = this.datos.archivos(a.carpeta)
    return { vinculos: (a.oficina.vinculos ?? []).map((v) => this.vistaVinculo(v, filas)) }
  }

  private alcanceDe(v: unknown, o: Oficina): AlcanceVinculo {
    const msg = '«alcance» tiene que ser "oficina", {departamentos:[...]} o {agentes:[...]}.'
    if (v === undefined || v === null) return 'oficina'
    if (typeof v === 'string') {
      if (v !== 'oficina') throw new ErrorAPI(400, msg)
      return 'oficina'
    }
    if (!sinSuperficie(v)) throw new ErrorAPI(400, msg)
    const ids = (k: string): string[] | undefined => {
      const x = v[k]
      if (x === undefined) return undefined
      if (!Array.isArray(x) || x.length === 0) throw new ErrorAPI(400, `«alcance.${k}» tiene que ser una lista con al menos un id.`)
      const out: string[] = []
      for (const e of x) {
        if (typeof e !== 'string' || !Slug.valido(e)) throw new ErrorAPI(400, `«alcance.${k}» tiene que ser una lista de ids.`)
        if (!out.includes(e)) out.push(e)
      }
      return out
    }
    const deps = ids('departamentos')
    if (deps) {
      const mal = deps.find((d) => !o.departamentos.some((x) => x.id === d))
      if (mal !== undefined) throw new ErrorAPI(400, `El departamento «${mal}» no existe.`)
      return { departamentos: deps }
    }
    const ags = ids('agentes')
    if (ags) {
      const mal = ags.find((g) => !o.agentes.some((x) => x.id === g))
      if (mal !== undefined) throw new ErrorAPI(400, `El agente «${mal}» no está en la oficina.`)
      return { agentes: ags }
    }
    throw new ErrorAPI(400, msg)
  }

  private crearVinculo(body?: Buffer): Obj {
    const a = this.oficinas.requerirActiva()
    const d = objeto(body, maxBodyChico)
    const cruda = Validar.texto(d.ruta, 'ruta', 1024)!
    if (!(path.isAbsolute(cruda) || cruda === '~' || cruda.startsWith('~/') || cruda.startsWith('~\\'))) throw new ErrorAPI(400, 'La carpeta tiene que ser una ruta absoluta.')
    const home = this.oficinas.config.home
    const ruta = Config.ruta(cruda, home)
    const real = realAunqueFalte(ruta)
    const realHome = realAunqueFalte(home)
    const esRaiz = (p: string) => path.parse(p).root === p
    if (esRaiz(ruta) || esRaiz(real) || ruta === home || real === realHome) {
      throw new ErrorAPI(400, 'Esa carpeta es demasiado amplia: elegí una carpeta concreta (no «/» ni tu carpeta personal entera).')
    }
    let st: fs.Stats
    try { st = fs.statSync(ruta) } catch { throw new ErrorAPI(404, 'No encuentro esa carpeta.') }
    if (!st.isDirectory()) throw new ErrorAPI(400, 'Eso no es una carpeta.')
    const ofReal = realAunqueFalte(a.carpeta)
    if (dentro(ofReal, real)) throw new ErrorAPI(400, 'Esa carpeta ya es parte de la oficina: no hace falta vincularla.')
    const alcance = this.alcanceDe(d.alcance, a.oficina)
    const existentes = a.oficina.vinculos ?? []
    if (existentes.some((x) => x.ruta === ruta)) throw new ErrorAPI(409, 'Esa carpeta ya está vinculada.')
    if (existentes.length >= maxVinculos) throw new ErrorAPI(400, `Máximo ${maxVinculos} carpetas vinculadas.`)
    const usados = new Set(existentes.map((x) => x.id))
    let id: string
    const pid = Validar.texto(d.id, 'id', 41, false)
    if (pid !== undefined) {
      if (!Slug.valido(pid)) throw new ErrorAPI(400, 'Id inválido (usá minúsculas, números y guiones).')
      if (usados.has(pid)) throw new ErrorAPI(409, 'Ya hay una carpeta vinculada con ese id.')
      id = pid
    } else {
      id = Slug.unico(path.basename(ruta), usados, 'carpeta')
    }
    const v: Vinculo = { id, ruta, alcance }
    this.oficinas.modificar((o) => { o.vinculos = [...(o.vinculos ?? []), v] })
    this.b.log.info(`biblioteca: carpeta vinculada id=${id}`)
    return { vinculo: this.vistaVinculo(v, this.datos.archivos(a.carpeta)) }
  }

  /** Cambia a quién le da acceso una carpeta vinculada (`alcance`). */
  private cambiarVinculo(id: string, body?: Buffer): Obj {
    const a = this.oficinas.requerirActiva()
    const v = (a.oficina.vinculos ?? []).find((x) => x.id === id)
    if (!v) throw new ErrorAPI(404, 'No existe esa carpeta vinculada.')
    const alcance = this.alcanceDe(objeto(body, maxBodyChico).alcance, a.oficina)
    const [, nueva] = this.oficinas.modificar((o) => {
      o.vinculos = (o.vinculos ?? []).map((x) => (x.id === id ? { ...x, alcance } : x))
    })
    const v2 = (nueva.oficina.vinculos ?? []).find((x) => x.id === id) ?? { ...v, alcance }
    return { vinculo: this.vistaVinculo(v2, this.datos.archivos(a.carpeta)) }
  }

  private quitarVinculo(id: string): Obj {
    const a = this.oficinas.requerirActiva()
    if (!(a.oficina.vinculos ?? []).some((v) => v.id === id)) throw new ErrorAPI(404, 'No existe esa carpeta vinculada.')
    let quitados = 0
    for (const f of this.datos.archivos(a.carpeta).filter((x) => x.vinculo === id)) {
      const rel = `archivos/.papelera/${f.slug}-vinculo`
      for (const [de, a2] of [[`conocimiento/fuentes/${f.slug}.md`, 'ficha.md'], [`archivos/.texto/${f.slug}.md`, 'texto.md']] as const) {
        if (fs.existsSync(a.ruta(de))) {
          try {
            fs.mkdirSync(a.ruta(rel), { recursive: true })
            fs.renameSync(a.ruta(de), a.ruta(`${rel}/${a2}`))
          } catch {}
        }
      }
      try { this.datos.archivoPapelera(f.slug, a.carpeta, f.ruta) } catch {}
      this.datos.indiceQuitar(f.slug, a.carpeta)
      quitados++
    }
    const [, nueva] = this.oficinas.modificar((o) => {
      o.vinculos = (o.vinculos ?? []).filter((v) => v.id !== id)
      if (o.vinculos.length === 0) delete o.vinculos
    })
    this.b.regenerarCatalogo(nueva)
    return { ok: true, quitados }
  }

  private async escanearVinculo(id: string): Promise<Obj> {
    const a = this.oficinas.requerirActiva()
    const v = (a.oficina.vinculos ?? []).find((x) => x.id === id)
    if (!v) throw new ErrorAPI(404, 'No existe esa carpeta vinculada.')
    let dirOk = false
    try { dirOk = fs.statSync(v.ruta).isDirectory() } catch {}
    if (!dirOk) throw new ErrorAPI(404, 'La carpeta vinculada ya no existe en esa ubicación.')
    const lim = this.b.limites(a.oficina)
    const esc = await Extraccion.escanear(v.ruta, { maxArchivos: lim.maxArchivos, maxBytes: lim.maxTotalBytes, maxArchivoBytes: lim.maxArchivoBytes })
    // el escaneo puede tardar: lo que sigue lee la base de nuevo
    const carpeta = a.carpeta
    const datos = this.datos
    const usados = datos.slugsUsados(carpeta)
    const previos = datos.archivos(carpeta).filter((x) => x.vinculo === id)
    const vistos = new Set<string>()
    let nuevos = 0
    let actualizados = 0
    let iguales = 0
    const t = ahora()
    for (const h of esc.hallados) {
      vistos.add(h.ruta)
      const p = previos.find((x) => x.ruta === h.ruta)
      if (p) {
        if (p.hash === h.hash) iguales++
        else { try { datos.archivoReprocesar(p.slug, carpeta, h.hash, h.tam) } catch {}; actualizados++ }
        continue
      }
      const nombre = path.basename(h.ruta)
      const slug = Slug.unico(TipoArchivo.sinExtension(nombre), usados, 'archivo')
      usados.add(slug)
      const f = nuevaFila({ slug, oficina: carpeta, nombre, departamento: carpetaVinculo, ruta: h.ruta, origen: 'vinculo', vinculo: id,
        tipo: TipoArchivo.extension(nombre), tam: h.tam, hash: h.hash, estado: 'pendiente', creado: t, actualizado: t })
      try { datos.archivoGuardar(f) } catch {}
      nuevos++
    }
    // los que ya no están en la carpeta (y no quedaron fuera por el tope) salen de la biblioteca
    let quitados = 0
    for (const p of previos) {
      if (vistos.has(p.ruta) || fs.existsSync(p.ruta)) continue
      try { datos.archivoPapelera(p.slug, carpeta, p.ruta) } catch {}
      datos.indiceQuitar(p.slug, carpeta)
      quitados++
    }
    if (quitados > 0 || nuevos > 0 || actualizados > 0) this.b.regenerarCatalogo(a)
    this.b.despertar()
    const o: Obj = { ok: true, nuevos, actualizados, sinCambios: iguales, quitados, omitidos: esc.omitidos, tope: esc.tope }
    if (esc.tope) o.aviso = `La carpeta tiene más archivos o más peso que el tope (${lim.maxArchivos} archivos, ${Math.floor(lim.maxTotalBytes / MB)} MB): se leyeron solo los primeros.`
    return o
  }
}

/** Archivos regulares de la carpeta de entregables (sin ocultos ni enlaces), del más nuevo al más viejo; hasta 300. */
export function recorrerEntregables(dir: string): Obj[] {
  const out: [number, Obj][] = []
  const base = realAunqueFalte(dir)
  let lleno = false
  const recorrer = (d: string) => {
    let entradas: fs.Dirent[]
    try { entradas = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entradas) {
      if (lleno) return
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { recorrer(p); continue }
      if (!e.isFile()) continue
      let st: fs.Stats
      try { st = fs.statSync(p) } catch { continue }
      const rel = path.relative(base, realAunqueFalte(p)).split(path.sep).join('/')
      const t = st.mtimeMs / 1000
      out.push([t, { nombre: e.name, ruta: rel.startsWith('..') ? e.name : rel, tam: st.size, tipo: path.extname(e.name).slice(1).toLowerCase(), modificado: iso(t) }])
      if (out.length >= 300) { lleno = true; return }
    }
  }
  recorrer(dir)
  return out.sort((a, b) => b[0] - a[0]).map((x) => x[1])
}

// MARK: - módulo

registrarModulo('biblioteca', 60, (s) => {
  const b = new Biblioteca(s)
  s.huecos.biblioteca = b
  s.router.biblioteca = new BibliotecaRouter(b)
  // al abrir una oficina se vuelven a escanear sus carpetas vinculadas, sin bloquear la respuesta
  s.alAbrir.push(async (a) => {
    const ids = (a.oficina.vinculos ?? []).map((v) => v.id)
    if (ids.length === 0) return
    void (async () => {
      for (const id of ids) {
        try { await s.router.biblioteca?.handle('POST', `/api/vinculos/${id}/escanear`, {}, Buffer.from('{}')) } catch {}
      }
    })()
  })
  // lo que quedó a medio procesar se retoma al arrancar
  s.alArrancar.push(() => b.despertar())
  s.alCerrar.push(() => b.cerrar())
  s.despuesDeProcesos.push(() => b.detener())
})
