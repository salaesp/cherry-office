// Exportar una oficina a un .zip y volver a importarla (en esta u otra compu) (Paquete.swift).
//
//   POST /api/oficina/exportar  {destino?}  → {archivo, nombre, tam, documentos, omitidos:{vinculos, papelera}, avisos}
//   POST /api/oficinas/importar {archivo}   → {carpeta, oficina, documentos, reprocesar, avisos}
//
// El .zip lleva la carpeta de la oficina (agentes, conocimiento, actas, archivos subidos y entregables) más
// `.oficina-paquete.json`, con las filas de la biblioteca (ficha incluida) para que al importarla no haya que volver a
// fichar nada. No lleva lo que vive en `hq.db` (chats, estado de reuniones, entregas, costos), ni la papelera, ni las
// carpetas vinculadas (son rutas de la otra compu). La ruta absoluta de la oficina en los textos viaja como `{{OFICINA}}`.
// El zip se lee y se escribe con `fflate` (zip.ts), sin programas del sistema: anda igual en macOS y Windows.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ArchivoFila, bibliotecaDe, catalogoMD, fichaDesde, fichaJSON, nuevaFila } from './biblioteca.js'
import { Config } from './config.js'
import { ErrorAPI } from './errores.js'
import { iso } from './entregas.js'
import { dentro, esDirectorio, realAunqueFalte } from './explorador.js'
import { codificar, esObjeto, type Obj } from './json.js'
import { jsonSwift } from './json-swift.js'
import type { HQLog } from './log.js'
import { OficinaStore, escribirAtomico, type Oficina } from './oficina.js'
import { Oficinas, type OficinaActiva } from './oficinas.js'
import type { RespuestaAPI, SubRouter } from './router.js'
import { sobreOficina } from './rutas-oficinas.js'
import { registrarModulo, type Servicios } from './servicios.js'
import { Validar, prefijo } from './validar.js'
import { ErrorZip, escribirZip, extraerEntrada, leerDirectorio, type EntradaZip, type ParaZip } from './zip.js'

export const manifiesto = '.oficina-paquete.json'
export const marcador = '{{OFICINA}}'
export const formato = 1
export const extensionZip = '.oficina.zip'
/** Topes del zip a importar: tamaño del archivo, total descomprimido y cantidad de entradas. */
export const maxZip = 2 * 1024 * 1024 * 1024
export const maxDescomprimido = 4 * 1024 * 1024 * 1024
export const maxEntradas = 50_000
/** Carpetas cuyos textos pueden mencionar la ruta de la oficina (los documentos del usuario no se tocan). */
export const carpetasConRutas = ['.claude', 'conocimiento', 'reuniones']
export const extensionesTexto = new Set(['md', 'txt', 'json'])

const rutaAbsoluta = (p: string) => path.isAbsolute(p) || p === '~' || p.startsWith('~/') || p.startsWith('~\\')

// MARK: - utilidades puras (con unit tests)

/** Rutas `/Users/<usuario>/...` (o `C:\Users\<usuario>\...`) que aparecen en el texto (hasta un espacio, comilla, paréntesis o
 *  fin de línea). */
export function rutasAbsolutas(t: string): string[] {
  const out: string[] = []
  const corte = new Set([...' \t\n"\'`)]>*,;'])
  const esLetraONumero = (c: string) => /[\p{L}\p{N}]/u.test(c)
  let desde = 0
  for (;;) {
    const i = t.indexOf('/Users/', desde)
    if (i < 0) break
    const previo = i > desde ? t[i - 1]! : undefined
    if (previo !== undefined && (esLetraONumero(previo) || previo === '.')) { desde = i + '/Users/'.length; continue }
    let fin = i + '/Users/'.length
    while (fin < t.length && !corte.has(t[fin]!)) fin++
    let ruta = t.slice(i, fin)
    while (ruta.endsWith('.') || ruta.endsWith(':')) ruta = ruta.slice(0, -1)
    if ([...ruta].length > '/Users/'.length && !out.includes(ruta)) out.push(ruta)
    desde = fin
  }
  // rutas de Windows de otra compu: C:\Users\<usuario>\...
  for (const m of t.matchAll(/(?<![\p{L}\p{N}.])[A-Za-z]:\\Users\\[^\s"'`)\]>*,;]+/gu)) {
    let ruta = m[0]
    while (ruta.endsWith('.') || ruta.endsWith(':')) ruta = ruta.slice(0, -1)
    if (!out.includes(ruta)) out.push(ruta)
  }
  return out
}

export function rutaDocumentoValida(r: string): boolean {
  return r.startsWith('archivos/') && !r.startsWith('archivos/.') && !r.includes('\0') && !r.includes('\\')
    && !r.split('/').filter((x) => x !== '').includes('..')
}

export function slugValido(s: string): boolean {
  return s !== '' && [...s].length <= 200 && !s.includes('/') && !s.includes('\\') && !s.includes('\0') && !s.startsWith('.')
}

export function filaJSON(f: ArchivoFila): Obj {
  const o: Obj = { slug: f.slug, nombre: f.nombre, departamento: f.departamento, ruta: f.ruta, tipo: f.tipo, tam: f.tam, hash: f.hash, creado: f.creado }
  if (f.departamentos.length > 1) o.departamentos = f.departamentos
  if (f.ficha) o.ficha = fichaJSON(f.ficha)
  if (f.aviso !== undefined) o.aviso = f.aviso
  return o
}

export function filaDesde(o: Obj, oficina: string, ahora: number): ArchivoFila | undefined {
  const slug = o.slug
  const ruta = o.ruta
  if (typeof slug !== 'string' || !slugValido(slug) || typeof ruta !== 'string' || !rutaDocumentoValida(ruta)) return undefined
  const base = path.posix.basename(ruta)
  const nombre = typeof o.nombre === 'string' && o.nombre !== '' ? o.nombre : base
  const tipo = typeof o.tipo === 'string' ? o.tipo : path.posix.extname(ruta).slice(1).toLowerCase()
  return nuevaFila({
    slug, oficina, nombre: prefijo(nombre, 200), departamento: typeof o.departamento === 'string' ? o.departamento : 'compartido',
    ...(Array.isArray(o.departamentos) && o.departamentos.length > 0 && o.departamentos.every((x) => typeof x === 'string') ? { departamentos: o.departamentos as string[] } : {}),
    ruta, origen: 'subido', tipo, tam: typeof o.tam === 'number' ? Math.trunc(o.tam) : 0, hash: typeof o.hash === 'string' ? o.hash : '',
    estado: 'pendiente', aviso: typeof o.aviso === 'string' ? o.aviso : undefined,
    ficha: esObjeto(o.ficha) ? fichaDesde(o.ficha) : undefined, creado: typeof o.creado === 'number' ? o.creado : ahora, actualizado: ahora,
  })
}

/** Nombre de una entrada del zip con `/` (los zips hechos en Windows pueden traer `\`). */
export const normalizarNombre = (n: string) => n.replaceAll('\\', '/')

/** Nombre inválido: absoluto, con letra de unidad, con `\0` o con `..`. */
export function nombreInvalido(n: string): boolean {
  const x = normalizarNombre(n)
  return x.startsWith('/') || x.includes('\0') || /^[A-Za-z]:/.test(x) || x.split('/').includes('..')
}

/** Revisa la lista del zip antes de extraer nada: sin rutas absolutas ni `..`, sin enlaces simbólicos y dentro de los
 *  topes (cantidad de entradas y total descomprimido, según el directorio central). Devuelve las entradas. */
export function revisarZip(fd: number, tam: number): EntradaZip[] {
  let lista: EntradaZip[]
  try {
    lista = leerDirectorio(fd, tam, maxEntradas)
  } catch (e) {
    if (e instanceof ErrorZip && e.causa === 'demasiadas') throw new ErrorAPI(413, 'El .zip tiene demasiados archivos.')
    throw new ErrorAPI(400, 'Ese archivo no es un .zip válido.')
  }
  if (lista.length === 0) throw new ErrorAPI(400, 'El .zip está vacío.')
  for (const e of lista) {
    if (nombreInvalido(e.nombre)) throw new ErrorAPI(400, 'El .zip tiene rutas inválidas; no lo importo.')
  }
  if (lista.some((e) => e.enlace)) throw new ErrorAPI(400, 'El .zip trae enlaces simbólicos; no lo importo.')
  if (lista.reduce((a, e) => a + e.tam, 0) > maxDescomprimido) throw new ErrorAPI(413, 'El .zip descomprimido pesa demasiado (máximo 4 GB).')
  return lista
}

export function revisarZipArchivo(zip: string): EntradaZip[] {
  let fd: number
  try {
    fd = fs.openSync(zip, 'r')
  } catch {
    throw new ErrorAPI(400, 'Ese archivo no es un .zip válido.')
  }
  try {
    return revisarZip(fd, fs.fstatSync(fd).size)
  } finally {
    fs.closeSync(fd)
  }
}

/** La carpeta con `oficina.json`: la raíz del zip o su única carpeta (sin contar `__MACOSX` ni ocultos). */
export function buscarRaiz(tmp: string): string | undefined {
  if (OficinaStore.existe(tmp)) return tmp
  let hijos: string[] = []
  try {
    hijos = fs.readdirSync(tmp)
  } catch {}
  const dirs = hijos.filter((h) => !h.startsWith('.') && h !== '__MACOSX').map((h) => path.join(tmp, h)).filter(esDirectorio)
  return dirs.length === 1 && OficinaStore.existe(dirs[0]!) ? dirs[0] : undefined
}

/** Recorre una carpeta sin seguir enlaces: `[ruta relativa con '/', lstat]`, en orden. */
function recorrer(base: string): [string, fs.Stats][] {
  const out: [string, fs.Stats][] = []
  const ir = (dir: string, rel: string) => {
    let nombres: string[]
    try {
      nombres = fs.readdirSync(dir).sort()
    } catch {
      return
    }
    for (const n of nombres) {
      const r = rel === '' ? n : `${rel}/${n}`
      const p = path.join(dir, n)
      let st: fs.Stats
      try {
        st = fs.lstatSync(p)
      } catch {
        continue
      }
      out.push([r, st])
      if (st.isDirectory()) ir(p, r)
    }
  }
  ir(base, '')
  return out
}

/** Copia la carpeta de la oficina a `destino` sin seguir enlaces simbólicos y sin la papelera, los respaldos de la memoria (`conocimiento/.respaldo-*`) ni los `.DS_Store`.
 *  Devuelve true si la papelera tenía algo (quedó afuera). */
export function copiar(origen: string, destino: string): boolean {
  fs.mkdirSync(destino, { recursive: true })
  let papelera = false
  let leidos: [string, fs.Stats][]
  try {
    leidos = recorrer(origen)
  } catch {
    throw new ErrorAPI(500, 'No pude leer la carpeta de la oficina.')
  }
  const omitidos: string[] = []
  for (const [rel, st] of leidos) {
    if (omitidos.some((o) => rel.startsWith(o + '/'))) continue
    const nombre = rel.slice(rel.lastIndexOf('/') + 1)
    if (rel === 'archivos/.papelera') {
      try { papelera = fs.readdirSync(path.join(origen, 'archivos', '.papelera')).length > 0 } catch {}
      omitidos.push(rel)
      fs.mkdirSync(path.join(destino, ...rel.split('/')), { recursive: true })
      continue
    }
    // el respaldo de la migración de la memoria es de esta compu: no viaja
    if (/^conocimiento\/\.respaldo-[^/]+$/.test(rel)) {
      omitidos.push(rel)
      continue
    }
    if (nombre === '.DS_Store' || st.isSymbolicLink()) continue
    const src = path.join(origen, ...rel.split('/'))
    const dst = path.join(destino, ...rel.split('/'))
    if (st.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true })
    } else if (st.isFile()) {
      try {
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.copyFileSync(src, dst)
      } catch {
        throw new ErrorAPI(500, `No pude copiar «${rel}».`)
      }
    }
  }
  return papelera
}

export function archivosDeTexto(raiz: string): string[] {
  const out: string[] = []
  for (const c of carpetasConRutas) {
    const base = path.join(raiz, c)
    for (const [rel, st] of recorrer(base)) {
      if (!st.isFile()) continue
      const ext = path.posix.extname(rel).slice(1).toLowerCase()
      if (extensionesTexto.has(ext)) out.push(path.join(base, ...rel.split('/')))
    }
  }
  return out.sort()
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** Reemplaza textos (p. ej. la ruta de la oficina por el marcador) en los .md/.txt/.json de agentes, conocimiento y actas. */
export function reemplazarEnTextos(raiz: string, pares: [string, string][]) {
  const lista = pares.filter(([de, a]) => de !== '' && de !== a).sort((x, y) => [...y[0]].length - [...x[0]].length)
  if (lista.length === 0) return
  for (const p of archivosDeTexto(raiz)) {
    let t: string
    try {
      t = utf8.decode(fs.readFileSync(p))
    } catch {
      continue
    }
    let n = t
    for (const [de, a] of lista) n = n.split(de).join(a)
    if (n !== t) try { escribirAtomico(Buffer.from(n, 'utf8'), p) } catch {}
  }
}

/** Agentes cuyo `.md` menciona rutas absolutas de una carpeta personal (`/Users/...`) que `existe` no encuentra. */
export function avisosRutas(raiz: string, oficina: Oficina, existe: (p: string) => boolean): string[] {
  const out: string[] = []
  for (const a of oficina.agentes) {
    let t: string
    try {
      t = fs.readFileSync(path.join(raiz, '.claude', 'agents', `${a.id}.md`), 'utf8')
    } catch {
      continue
    }
    const rutas = rutasAbsolutas(t).filter((r) => !existe(r))
    if (rutas.length > 0) out.push(`«${a.nombre}» menciona rutas de otra compu (por ejemplo ${rutas[0]}). Revisá sus instrucciones.`)
  }
  return out
}

export function archivoLibre(dir: string, nombre: string): string {
  let cand = path.join(dir, nombre + extensionZip)
  for (let n = 2; fs.existsSync(cand); n++) cand = path.join(dir, `${nombre} ${n}${extensionZip}`)
  return cand
}

export function escribirTexto(t: string, destino: string) {
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  escribirAtomico(t, destino)
}

/** Mover una carpeta: rename, o copiar y borrar si el temporal está en otro disco. */
function moverCarpeta(origen: string, destino: string) {
  try {
    fs.renameSync(origen, destino)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    fs.cpSync(origen, destino, { recursive: true, errorOnExist: true })
    fs.rmSync(origen, { recursive: true, force: true })
  }
}

function cuerpo(body: Buffer | undefined, opcional: boolean): Obj {
  if (!body || body.length === 0) {
    if (opcional) return {}
    throw new ErrorAPI(400, 'Falta el cuerpo del pedido.')
  }
  let o: unknown
  try {
    o = JSON.parse(body.toString('utf8'))
  } catch {}
  if (!esObjeto(o)) throw new ErrorAPI(400, 'JSON inválido.')
  return o
}

// MARK: - rutas

export class PaqueteRouter implements SubRouter {
  private readonly config: Config
  private readonly oficinas: Oficinas
  private readonly log: HQLog

  constructor(private readonly s: Servicios) {
    this.config = s.config
    this.oficinas = s.oficinas
    this.log = s.log
  }

  static esRuta(p: string) { return p === '/api/oficina/exportar' || p === '/api/oficinas/importar' }

  async handle(method: string, p: string, _query: Record<string, string>, body?: Buffer): Promise<RespuestaAPI | null> {
    if (!PaqueteRouter.esRuta(p)) return null
    if (method !== 'POST') return { status: 405, json: codificar({ error: 'método no permitido' }) }
    try {
      const obj = p === '/api/oficina/exportar' ? await this.exportar(body) : await this.importar(body)
      return { status: 200, json: codificar(obj) }
    } catch (e) {
      if (e instanceof ErrorAPI) return { status: e.status, json: codificar({ error: e.mensaje }) }
      this.log.error(`paquete: ${e instanceof Error ? e.message : e}`)
      return { status: 500, json: codificar({ error: 'No pude completar la operación.' }) }
    }
  }

  // MARK: exportar

  async exportar(body?: Buffer): Promise<Obj> {
    const act = this.oficinas.requerirActiva()
    const d = cuerpo(body, true)
    const destino = this.carpetaDestino(Validar.texto(d.destino, 'destino', 1024, false))

    const biblioteca = bibliotecaDe(this.s)
    const filas = biblioteca.filasParaExportar(act.carpeta)
    const subidos = filas.filter((f) => f.origen === 'subido' && rutaDocumentoValida(f.ruta))
    const deVinculos = filas.filter((f) => f.origen !== 'subido').map((f) => f.slug)

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-exportar-'))
    try {
      const raiz = Oficinas.carpetaLibre(tmp, act.oficina.nombre)
      const papelera = copiar(act.carpeta, raiz)

      // lo de las carpetas vinculadas no viaja: sus fichas y su texto apuntan a archivos de esta compu
      for (const slug of deVinculos) {
        if (!slugValido(slug)) continue
        fs.rmSync(path.join(raiz, 'conocimiento', 'fuentes', `${slug}.md`), { force: true })
        fs.rmSync(path.join(raiz, 'archivos', '.texto', `${slug}.md`), { force: true })
      }
      const of = structuredClone(act.oficina)
      const vinculos = of.vinculos?.length ?? 0
      delete of.vinculos
      // las carpetas de trabajo son rutas de esta compu (un repo, por ejemplo): tampoco viajan
      delete of.carpetasTrabajo
      // la secretaría nombra chats de WhatsApp de esta persona (números de teléfono): viaja sin ellos
      if (of.secretaria && Array.isArray(of.secretaria.fuentes)) {
        of.secretaria = { ...of.secretaria, fuentes: (of.secretaria.fuentes as unknown[]).map((f) => (typeof f === 'object' && f !== null ? { ...(f as Record<string, unknown>), chats: undefined } : f)) }
      }
      OficinaStore.escribir(of, raiz)
      escribirTexto(catalogoMD(subidos, of), path.join(raiz, 'conocimiento', 'archivos.md'))

      // la ruta de la oficina viaja como marcador; las demás rutas de esta compu quedan y se avisan
      const pares: [string, string][] = []
      for (const c of new Set([act.carpeta, realAunqueFalte(act.carpeta)])) {
        pares.push([c, marcador])
        if (path.sep === '\\') pares.push([c.replaceAll('\\', '/'), marcador])
      }
      reemplazarEnTextos(raiz, pares)
      const avisos = avisosRutas(raiz, of, () => false)

      const man = {
        formato, app: 'oficina', version: this.config.version, exportada: iso(Date.now() / 1000),
        nombre: of.nombre, archivos: subidos.map(filaJSON),
      }
      fs.writeFileSync(path.join(raiz, manifiesto), jsonSwift(man))

      const nombreRaiz = path.basename(raiz)
      const zip = archivoLibre(destino, nombreRaiz)
      const entradas: ParaZip[] = [{ nombre: nombreRaiz, dir: true }]
      for (const [rel, st] of recorrer(raiz)) {
        if (st.isDirectory()) entradas.push({ nombre: `${nombreRaiz}/${rel}`, dir: true })
        else if (st.isFile()) entradas.push({ nombre: `${nombreRaiz}/${rel}`, ruta: path.join(raiz, ...rel.split('/')) })
      }
      try {
        await escribirZip(zip, entradas)
      } catch (e) {
        fs.rmSync(zip, { force: true })
        this.log.error(`exportar: no pude armar el zip: ${e instanceof Error ? e.message : e}`)
        throw new ErrorAPI(500, 'No pude armar el archivo .zip.')
      }
      let tam = 0
      try { tam = fs.statSync(zip).size } catch {}
      this.log.info(`oficina exportada documentos=${subidos.length} vinculos=${vinculos} tam=${tam}`)
      return { archivo: zip, nombre: path.basename(zip), tam, documentos: subidos.length, omitidos: { vinculos, papelera }, avisos }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  /** Carpeta donde dejar el .zip: la pedida (absoluta, tiene que existir) o Descargas (o la carpeta personal). */
  carpetaDestino(pedido?: string): string {
    const p = pedido?.trim()
    if (p) {
      if (!rutaAbsoluta(p)) throw new ErrorAPI(400, 'La carpeta tiene que ser una ruta absoluta.')
      const r = Config.ruta(p, this.config.home)
      if (!esDirectorio(r)) throw new ErrorAPI(404, 'No encuentro esa carpeta.')
      try {
        fs.accessSync(r, fs.constants.W_OK)
      } catch {
        throw new ErrorAPI(403, 'No puedo escribir en esa carpeta.')
      }
      return r
    }
    const descargas = path.join(this.config.home, 'Downloads')
    return esDirectorio(descargas) ? descargas : this.config.home
  }

  // MARK: importar

  async importar(body?: Buffer): Promise<Obj> {
    const d = cuerpo(body, false)
    const pedido = Validar.texto(d.archivo, 'archivo', 1024)!.trim()
    if (!(path.isAbsolute(pedido) || pedido.startsWith('~/') || pedido.startsWith('~\\'))) {
      throw new ErrorAPI(400, 'El archivo tiene que ser una ruta absoluta.')
    }
    const zip = Config.ruta(pedido, this.config.home)
    let st: fs.Stats | undefined
    try { st = fs.statSync(zip) } catch {}
    if (!st || st.isDirectory()) throw new ErrorAPI(404, 'No encuentro ese archivo.')
    if (!zip.toLowerCase().endsWith('.zip')) throw new ErrorAPI(400, 'Elegí un archivo .zip exportado desde Oficina.')
    if (st.size > maxZip) throw new ErrorAPI(413, 'El archivo es demasiado grande (máximo 2 GB).')

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-importar-'))
    try {
      await this.extraer(zip, tmp)
      const raiz = buscarRaiz(tmp)
      if (!raiz) throw new ErrorAPI(400, 'Ese .zip no tiene una oficina adentro (falta oficina.json).')
      const of = OficinaStore.leer(raiz)

      fs.mkdirSync(this.config.oficinasDir, { recursive: true })
      const dest = Oficinas.carpetaLibre(this.config.oficinasDir, of.nombre)
      try {
        moverCarpeta(raiz, dest)
      } catch {
        throw new ErrorAPI(500, 'No pude crear la carpeta de la oficina.')
      }
      return this.registrar(dest, of)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  /** Revisa el zip y lo extrae en `tmp`. */
  private async extraer(zip: string, tmp: string) {
    let fd: number
    try {
      fd = fs.openSync(zip, 'r')
    } catch {
      throw new ErrorAPI(400, 'Ese archivo no es un .zip válido.')
    }
    try {
      const entradas = revisarZip(fd, fs.fstatSync(fd).size)
      let total = 0
      try {
        for (const e of entradas) {
          const n = normalizarNombre(e.nombre)
          if (n === '__MACOSX' || n.startsWith('__MACOSX/')) continue
          const destino = path.resolve(tmp, ...n.split('/'))
          if (!dentro(tmp, destino)) throw new ErrorAPI(400, 'El .zip tiene rutas inválidas; no lo importo.')
          if (n.endsWith('/')) {
            fs.mkdirSync(destino, { recursive: true })
            continue
          }
          fs.mkdirSync(path.dirname(destino), { recursive: true })
          total += await extraerEntrada(fd, e, destino, maxDescomprimido - total)
        }
      } catch (e) {
        if (e instanceof ErrorAPI) throw e
        if (e instanceof ErrorZip && e.causa === 'tam') throw new ErrorAPI(413, 'El .zip descomprimido pesa demasiado (máximo 4 GB).')
        this.log.warn(`importar: no pude descomprimir: ${e instanceof Error ? e.message : e}`)
        throw new ErrorAPI(400, 'No pude descomprimir ese archivo.')
      }
    } finally {
      fs.closeSync(fd)
    }
  }

  /** La oficina ya está en `dest`: vínculos, rutas, biblioteca y abrirla. */
  private registrar(dest: string, of: Oficina): Obj {
    const avisos: string[] = []
    this.oficinas.olvidarDatos(dest)
    const pathManifiesto = path.join(dest, manifiesto)
    let man: Obj | undefined
    try {
      const m = JSON.parse(fs.readFileSync(pathManifiesto, 'utf8'))
      if (esObjeto(m)) man = m
    } catch {}
    fs.rmSync(pathManifiesto, { force: true })
    if (!man) avisos.push('El archivo no trae el índice de la biblioteca: los documentos están en la carpeta, pero no aparecen en la Biblioteca.')

    if (of.vinculos && of.vinculos.length > 0) {
      const quedan = of.vinculos.filter((v) => fs.existsSync(v.ruta))
      if (quedan.length < of.vinculos.length) {
        avisos.push(`Se quitaron ${of.vinculos.length - quedan.length} carpeta(s) vinculada(s) que no existen en esta compu.`)
        if (quedan.length === 0) delete of.vinculos
        else of.vinculos = quedan
        OficinaStore.escribir(of, dest)
      }
    }
    reemplazarEnTextos(dest, [[marcador, dest]])
    avisos.push(...avisosRutas(dest, of, (r) => fs.existsSync(r)))

    const ahora = Date.now() / 1000
    const filas: ArchivoFila[] = []
    const usados = new Set<string>()
    for (const o of Array.isArray(man?.archivos) ? man.archivos : []) {
      if (!esObjeto(o)) continue
      const f = filaDesde(o, dest, ahora)
      if (!f || usados.has(f.slug) || !fs.existsSync(path.join(dest, ...f.ruta.split('/')))) continue
      const hayTexto = fs.existsSync(path.join(dest, 'archivos', '.texto', `${f.slug}.md`))
      f.estado = f.ficha && hayTexto ? 'listo' : 'pendiente'
      usados.add(f.slug)
      filas.push(f)
    }
    const { listos, pendientes } = bibliotecaDe(this.s).importarFilas(filas, dest, of)
    if (pendientes > 0) avisos.push(`${pendientes} documento(s) se van a volver a fichar (hace falta Claude Code).`)

    const act: OficinaActiva = this.oficinas.abrir(dest)
    this.log.info(`oficina importada documentos=${listos} reprocesar=${pendientes} avisos=${avisos.length}`)
    return { ...sobreOficina(act), documentos: listos + pendientes, reprocesar: pendientes, avisos }
  }
}

registrarModulo('paquete', 80, (s) => {
  s.router.paquete = new PaqueteRouter(s)
})
