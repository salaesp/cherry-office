// La oficina activa, los recientes (`config.json` de la app) y todas las escrituras de `oficina.json` (actor Oficinas
// de Swift). Todo es sincrónico: con un solo hilo, cada leer-modificar-escribir corre sin intercalaciones, igual que
// en el actor. Si un método necesita esperar algo en el medio (claude), tiene que releer la oficina después.
import fs from 'node:fs'
import path from 'node:path'
import { Config, type ClaveModelo, type PreferenciasIA, type ConectoresAgentes, type EstiloOficina, type ModoPermisos } from './config.js'
import { ErrorAPI } from './errores.js'
import { esObjeto, type Obj } from './json.js'
import { jsonSwift } from './json-swift.js'
import type { HQLog } from './log.js'
import {
  OficinaStore, ValidarAgenteExtra, clavesAvatar, escribirAtomico, validarOficina,
  type Avatar, type Departamento, type Oficina,
} from './oficina.js'
import { migrarMemoria } from './memoria-estructura.js'
import { actualizarMemoria, completarEstructura, crearEstructura } from './plantillas.js'
import { Validar, largo } from './validar.js'
import { armarDepartamento, departamentosSugeridos, maxDepartamentos, type DepartamentoNuevo } from './departamentos.js'

export type { DepartamentoNuevo } from './departamentos.js'

/** Oficina abierta: carpeta absoluta + contenido de oficina.json (leído en el momento). */
export class OficinaActiva {
  constructor(readonly carpeta: string, readonly oficina: Oficina) {}
  /** Ruta absoluta de una ruta relativa a la oficina. */
  ruta(rel: string) { return path.join(this.carpeta, rel) }
  /** `{carpeta, nombre}` del contrato de /api/estado. */
  get resumen(): Obj { return { carpeta: this.carpeta, nombre: this.oficina.nombre } }
}

type Reciente = { carpeta: string; nombre: string; abierta: number }

/** Quien dirige una oficina (YO): `duenio` + `avatarDuenio` de su oficina.json. */
export type Perfil = { nombre: string; avatar?: Avatar }
export const perfilJSON = (p: Perfil): Obj => ({ nombre: p.nombre, avatar: p.avatar ? { ...p.avatar } : null })

/** Avatar validado de un cuerpo (NuevoAgente.avatarValido de Swift): textos de hasta 60, colores #rrggbb en minúsculas. */
export function avatarValido(v: unknown): Avatar | undefined {
  if (v === undefined || v === null) return undefined
  if (!esObjeto(v)) throw new ErrorAPI(400, '«avatar» tiene que ser un objeto.')
  const a: Avatar = {}
  for (const k of clavesAvatar) {
    const x = v[k]
    if (x === undefined || x === null) continue
    if (typeof x !== 'string' || largo(x) > 60) throw new ErrorAPI(400, `Avatar: «${k}» inválido.`)
    if (x !== '') a[k] = x
  }
  for (const k of ['colorPelo', 'colorTorso', 'colorPiernas', 'colorPiel', 'colorBrazos', 'colorAccesorio'] as const) {
    const c = a[k]
    if (c === undefined) continue
    if (!Validar.colorHex(c)) throw new ErrorAPI(400, 'Avatar: los colores tienen que ser tipo #141414.')
    a[k] = c.toLowerCase()
  }
  return a
}

function perfilDesde(o: unknown): Perfil {
  if (!esObjeto(o)) return { nombre: '' }
  const n = typeof o.nombre === 'string' ? o.nombre.trim() : ''
  let avatar: Avatar | undefined
  try {
    avatar = avatarValido(o.avatar)
  } catch {}
  return { nombre: largo(n) <= 80 ? n : '', avatar }
}

/** Ruta del usuario: absoluta o con `~`. */
const esRutaAbsoluta = (c: string) => path.isAbsolute(c) || c === '~' || c.startsWith('~/') || c.startsWith('~\\')

export class Oficinas {
  static readonly maxAgentes = 60

  readonly estadoPath: string
  private activaCarpeta?: string
  private recientes: Reciente[] = []
  /** Perfil global de versiones anteriores (config.json); solo para migrar la minifig a cada oficina. */
  private perfilViejo: Perfil = { nombre: '' }
  /** Ganchos que borran lo guardado fuera de la carpeta para una ruta (hq.db): al borrar una oficina y al estrenar una
   *  carpeta como oficina nueva (crear o importar un .zip), por si quedó algo de una anterior en esa misma ruta. */
  readonly alOlvidar: ((dir: string) => void)[] = []

  constructor(readonly config: Config, readonly log: HQLog) {
    this.estadoPath = path.join(config.datosDir, 'config.json')
    let o: unknown
    try {
      o = JSON.parse(fs.readFileSync(this.estadoPath, 'utf8'))
    } catch {}
    if (esObjeto(o)) {
      if (typeof o.oficina_activa === 'string' && o.oficina_activa !== '') this.activaCarpeta = o.oficina_activa
      this.perfilViejo = perfilDesde(o.perfil)
      for (const r of Array.isArray(o.oficinas_recientes) ? o.oficinas_recientes : []) {
        if (esObjeto(r) && typeof r.carpeta === 'string' && typeof r.nombre === 'string') {
          this.recientes.push({ carpeta: r.carpeta, nombre: r.nombre, abierta: typeof r.abierta === 'number' ? r.abierta : 0 })
        }
      }
    }
  }

  // MARK: consulta

  /** Oficina activa leída del disco, o undefined (ninguna abierta, o su oficina.json ya no es válido). */
  activa(): OficinaActiva | undefined {
    const c = this.activaCarpeta
    if (!c) return undefined
    let o: Oficina
    try {
      o = OficinaStore.leer(c)
    } catch {
      return undefined
    }
    if (this.migrarPerfilViejo(o)) {
      try {
        OficinaStore.escribir(o, c)
      } catch {}
    }
    return new OficinaActiva(c, o)
  }

  /** Igual que `activa()` pero lanza 409 «No hay una oficina abierta». */
  requerirActiva(): OficinaActiva {
    const a = this.activa()
    if (!a) throw ErrorAPI.sinOficina
    return a
  }

  /** Recientes cuya carpeta todavía tiene una oficina válida (nombre leído del disco). */
  listar(): Obj[] {
    const out: Obj[] = []
    for (const r of [...this.recientes].sort((a, b) => b.abierta - a.abierta)) {
      try {
        const o = OficinaStore.leer(r.carpeta)
        out.push({ carpeta: r.carpeta, nombre: o.nombre, activa: r.carpeta === this.activaCarpeta })
      } catch {}
    }
    return out
  }

  // MARK: perfil (YO)

  /** Quien dirige la oficina activa (vacío si no hay oficina abierta). */
  perfilActual(): Perfil {
    const o = this.activa()?.oficina
    return o ? { nombre: o.duenio, avatar: o.avatarDuenio } : { nombre: '' }
  }

  /** Cambia quien dirige la oficina activa (nombre y minifig). Las demás oficinas no se tocan. */
  guardarPerfil(p: Perfil): [Perfil, OficinaActiva] {
    const n = p.nombre.trim()
    if (largo(n) > 80) throw new ErrorAPI(400, 'El nombre es demasiado largo (hasta 80 caracteres).')
    const av = p.avatar ? { ...p.avatar } : undefined
    if (av && av.semilla === undefined) av.semilla = 'yo'
    const [, a] = this.modificar((o) => {
      o.duenio = n
      if (av) o.avatarDuenio = av
      else delete o.avatarDuenio
    })
    return [{ nombre: n, avatar: av }, a]
  }

  /** Oficinas de antes de que cada una tuviera su director: si no tienen minifig y las dirigía el perfil global viejo,
   *  se quedan con la suya (y con su nombre si no tenían dueño). True si cambió algo. */
  private migrarPerfilViejo(o: Oficina): boolean {
    const pv = this.perfilViejo
    if (o.avatarDuenio || !pv.avatar || pv.nombre === '' || !(o.duenio === '' || o.duenio === pv.nombre)) return false
    if (o.duenio === '') o.duenio = pv.nombre
    o.avatarDuenio = { ...pv.avatar }
    return true
  }

  // MARK: crear y abrir

  /** `vacia`: la oficina arranca sin departamentos (la arma el Creador); si no, sin lista van los sugeridos. */
  crear({ nombre, duenio, carpeta, departamentos, vacia = false }: {
    nombre: string; duenio: string; carpeta?: string; departamentos?: DepartamentoNuevo[]; vacia?: boolean
  }): OficinaActiva {
    const n = nombre.trim()
    if (n === '' || largo(n) > 80) throw new ErrorAPI(400, 'Poné un nombre para la oficina (hasta 80 caracteres).')
    const d = duenio.trim()
    if (largo(d) > 80) throw new ErrorAPI(400, 'El nombre del dueño es demasiado largo.')

    const pedidos = departamentos && departamentos.length > 0 ? departamentos
      : vacia ? [] : departamentosSugeridos.map((x) => ({ nombre: x }))
    if (pedidos.length > maxDepartamentos) throw new ErrorAPI(400, `Máximo ${maxDepartamentos} departamentos.`)
    const deps: Departamento[] = []
    pedidos.forEach((p, i) => deps.push(armarDepartamento(p, i, new Set(deps.map((x) => x.id)))))

    let dir: string
    const c = carpeta?.trim()
    if (c) {
      if (!esRutaAbsoluta(c)) throw new ErrorAPI(400, 'La carpeta tiene que ser una ruta absoluta.')
      dir = Config.ruta(c, this.config.home)
      if (OficinaStore.existe(dir)) throw new ErrorAPI(409, 'Ya hay una oficina en esa carpeta. Abrila en lugar de crearla.')
    } else {
      dir = Oficinas.carpetaLibre(this.config.oficinasDir, n)
    }
    const of: Oficina = { version: 1, nombre: n, duenio: d, departamentos: deps, agentes: [], memoria: { version: 2 } }
    validarOficina(of)
    try {
      crearEstructura(dir, of)
    } catch (e) {
      if (e instanceof ErrorAPI) throw e
      throw new ErrorAPI(500, 'No pude crear la carpeta de la oficina.')
    }
    OficinaStore.escribir(of, dir)
    this.olvidarDatos(dir)
    this.activar(dir, n)
    this.log.info(`oficina creada nombre=${largo(n)}c departamentos=${deps.length}`)
    return new OficinaActiva(dir, of)
  }

  /** Corre los ganchos de `alOlvidar` (un error no frena la creación ni el borrado). */
  olvidarDatos(dir: string) {
    for (const f of this.alOlvidar) {
      try {
        f(dir)
      } catch {
        this.log.warn('no pude limpiar lo guardado de una oficina anterior en esa carpeta')
      }
    }
  }

  /** Valida `oficina.json` de la carpeta y la deja activa. */
  abrir(carpeta: string): OficinaActiva {
    const c = carpeta.trim()
    if (!esRutaAbsoluta(c)) throw new ErrorAPI(400, 'La carpeta tiene que ser una ruta absoluta.')
    const dir = Config.ruta(c, this.config.home)
    let esDir = false
    try {
      esDir = fs.statSync(dir).isDirectory()
    } catch {}
    if (!esDir) throw new ErrorAPI(404, 'No encuentro esa carpeta.')
    const o = this.prepararCarpeta(dir)
    this.activar(dir, o.nombre)
    return new OficinaActiva(dir, o)
  }

  /** Lo que se hace con una oficina al abrirla: completa la estructura, migra la memoria a la estructura nueva (con
   *  respaldo; un error no impide abrir) y pone al día la sección de memoria de los agentes. Devuelve la oficina leída. */
  private prepararCarpeta(dir: string): Oficina {
    let o = OficinaStore.leer(dir)
    try {
      completarEstructura(dir)
    } catch {}
    try {
      const m = migrarMemoria(dir, o)
      if (m.migrada) {
        OficinaStore.escribir(m.oficina, dir)
        o = m.oficina
        this.log.info(`memoria migrada respaldo=${m.respaldo}`)
      } else if (m.fallo) this.log.warn('no pude migrar la memoria: falló el respaldo (se reintenta al abrir)')
    } catch {
      this.log.warn('no pude migrar la memoria de la oficina')
    }
    actualizarMemoria(dir, o.agentes.map((a) => a.id))
    return o
  }

  /** Al arrancar con una oficina activa (`abrir` no se llama): hace lo mismo que `abrir`, sin activar. */
  prepararActiva() {
    const c = this.activaCarpeta
    if (!c) return
    try {
      this.prepararCarpeta(c)
    } catch {}
  }

  /** Borra la oficina `dir` de la app: deja de estar activa y en recientes, olvida lo guardado en hq.db y borra la
   *  carpeta del disco (recursivo, permanente: no va a la papelera). */
  borrar(dir: string) {
    if (this.activaCarpeta === dir) this.activaCarpeta = undefined
    this.recientes = this.recientes.filter((r) => r.carpeta !== dir)
    this.guardarEstado()
    this.olvidarDatos(dir)
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      this.log.warn('no pude borrar la carpeta de la oficina del disco')
    }
    this.log.info('oficina borrada')
  }

  /** Deja `dir` como activa y la sube a recientes (máximo 10). Guarda config.json. */
  activar(dir: string, nombre: string) {
    this.activaCarpeta = dir
    this.recientes = this.recientes.filter((r) => r.carpeta !== dir)
    this.recientes.unshift({ carpeta: dir, nombre, abierta: Date.now() / 1000 })
    if (this.recientes.length > 10) this.recientes = this.recientes.slice(0, 10)
    this.guardarEstado()
  }

  /** Guarda en config.json cómo piden permiso los agentes (toda la app). Vale desde la próxima corrida. */
  guardarModoPermisos(modo: ModoPermisos) {
    this.config.modoPermisos = modo
    this.guardarEstado()
    this.log.info(`modo de permisos: ${modo}`)
  }

  /** Guarda en config.json si todos los agentes usan todos los conectores o solo los asignados. Vale desde la próxima corrida. */
  guardarConectoresAgentes(modo: ConectoresAgentes) {
    this.config.conectoresAgentes = modo
    this.guardarEstado()
    this.log.info(`conectores de los agentes: ${modo}`)
  }

  /** Guarda en config.json cómo se dibuja la oficina (pixel o la maqueta LEGO). */
  guardarEstiloOficina(estilo: EstiloOficina) {
    this.config.estiloOficina = estilo
    this.guardarEstado()
    this.log.info(`estilo de la oficina: ${estilo}`)
  }

  /** Guarda en config.json los modelos de los procesos internos que cambian (validados). Vale desde la próxima corrida. */
  guardarModelos(m: Partial<Record<ClaveModelo, string>>) {
    Object.assign(this.config.modelos, m)
    this.guardarEstado()
    this.log.info(`modelos: ${JSON.stringify(this.config.modelos)}`)
  }

  guardarIA(ia: Partial<PreferenciasIA>) {
    Object.assign(this.config.ia, ia)
    this.guardarEstado()
    this.log.info(`ia: ${JSON.stringify(this.config.ia)}`)
  }

  private guardarEstado() {
    let o: Obj = {}
    if (fs.existsSync(this.estadoPath)) {
      let leido: unknown
      try {
        leido = JSON.parse(fs.readFileSync(this.estadoPath, 'utf8'))
      } catch {}
      if (!esObjeto(leido)) {
        this.log.warn('config.json ilegible: no guardo la oficina activa')
        return
      }
      o = leido
    }
    o.oficina_activa = this.activaCarpeta ?? null
    if (this.config.modoPermisos !== undefined) o.modo_permisos = this.config.modoPermisos
    if (this.config.conectoresAgentes !== undefined) o.conectores_agentes = this.config.conectoresAgentes
    if (this.config.estiloOficina !== undefined) o.estilo_oficina = this.config.estiloOficina
    if (Object.keys(this.config.modelos).length) o.modelos = { ...this.config.modelos }
    if (Object.keys(this.config.ia).length) o.ia = { ...this.config.ia }
    o.oficinas_recientes = this.recientes.map((r) => ({ carpeta: r.carpeta, nombre: r.nombre, abierta: r.abierta }))
    try {
      fs.mkdirSync(this.config.datosDir, { recursive: true })
      escribirAtomico(jsonSwift(o), this.estadoPath)
    } catch {
      this.log.error('no pude guardar config.json')
    }
  }

  static carpetaLibre(base: string, nombre: string): string {
    let limpio = [...nombre].map((ch) => {
      const u = ch.codePointAt(0)!
      if (ch === '/' || ch === ':' || ch === '\\' || u < 32) return '-'
      if (ch === ' ') return '_' // los espacios del título van como guiones bajos en la carpeta
      return ch
    }).join('').trim()
    limpio = limpio.replace(/^[._]+/, '')
    // Sin punto ni guion bajo al final: antes era por el espacio final («Luis Inc.» -> «Luis Inc»), con el que Claude
    // Code nunca aplica `Edit(//…)`/`Write(//…)` y en `dontAsk` rechaza toda escritura (docs/aprendizajes.md).
    limpio = limpio.replace(/[._]+$/u, '')
    if (limpio === '') limpio = 'Oficina'
    let cand = path.join(base, limpio)
    for (let n = 2; fs.existsSync(cand); n++) cand = path.join(base, `${limpio}_${n}`)
    return cand
  }

  // MARK: oficina y departamentos

  /** Lee la oficina activa, aplica `cambio` y la escribe (validada, atómica). */
  modificar<T>(cambio: (o: Oficina) => T): [T, OficinaActiva] {
    const a = this.requerirActiva()
    const o = structuredClone(a.oficina)
    const r = cambio(o)
    OficinaStore.escribir(o, a.carpeta)
    if (o.nombre !== a.oficina.nombre) this.activar(a.carpeta, o.nombre)
    return [r, new OficinaActiva(a.carpeta, o)]
  }

  /** Suma reglas de «Siempre» a un agente de la oficina activa (sin repetir). Devuelve las reglas que quedaron. */
  agregarReglas(id: string, nuevas: string[]): string[] {
    const [rs] = this.modificar((o) => {
      const ag = o.agentes.find((x) => x.id === id)
      if (!ag) throw new ErrorAPI(404, 'No existe ese agente.')
      const rs = [...(ag.reglas ?? [])]
      for (const r of nuevas) if (!rs.includes(r)) rs.push(r)
      ValidarAgenteExtra.reglas(rs)
      if (rs.length === 0) delete ag.reglas
      else ag.reglas = rs
      return rs
    })
    return rs
  }

  editar(nombre?: string, duenio?: string): OficinaActiva {
    const n = nombre === undefined ? undefined : nombre.trim()
    if (n !== undefined && (n === '' || largo(n) > 80)) throw new ErrorAPI(400, 'El nombre de la oficina es obligatorio (hasta 80 caracteres).')
    const d = duenio === undefined ? undefined : duenio.trim()
    if (d !== undefined && largo(d) > 80) throw new ErrorAPI(400, 'El nombre del dueño es demasiado largo.')
    return this.modificar((o) => {
      if (n !== undefined) o.nombre = n
      if (d !== undefined) o.duenio = d
    })[1]
  }
}
