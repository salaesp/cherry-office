// Skills propias de cada agente: skills de Claude Code que viven en la carpeta de la oficina
// (`.claude/skills/<nombre>/SKILL.md`, skills «de proyecto»), de modo que viajan con la oficina y no dependen de lo que la
// persona tenga instalado. Cada una es de UN agente: lo dice su frontmatter (`metadata: oficina-agente: <id>`).
// - En las corridas de su agente van siempre (salvo con «Consumo de IA» en `ninguna`), aunque la oficina acote las demás.
// - En las corridas de los demás agentes de la oficina van con `skillOverrides: off` (Claude Code las vería igual, porque
//   todos corren con la carpeta de la oficina como cwd).
// Además, las PROPUESTAS de skill (un agente sugiere una con `proponer_skill`): `.claude/skills-propuestas.json`. Nada se
// escribe en `.claude/skills` hasta que la persona la revisa y la guarda.
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ErrorAPI } from './errores.js'
import { esObjeto, type Obj } from './json.js'
import { partes, valorFrontmatter, yamlLinea } from './plantillas.js'
import { largo } from './validar.js'

export type SkillPropia = { nombre: string; descripcion: string; contenido: string; agente: string }

export type PropuestaSkill = {
  id: string
  agente: string
  nombre: string
  descripcion: string
  contenido: string
  /** Por qué la propone (lo que vio repetirse, por ejemplo). */
  motivo: string
  /** Charla en la que la propuso, si hubo. */
  sid?: string
  /** Segundos desde 1970. */
  creada: number
}

const dirSkills = path.join('.claude', 'skills')
const archivoPropuestas = path.join('.claude', 'skills-propuestas.json')
const claveAgente = 'oficina-agente'

export const SkillsPropias = {
  maxNombre: 64,
  maxDescripcion: 1024,
  maxContenido: 40_000,
  maxMotivo: 1000,
  maxPorAgente: 30,
  maxPropuestas: 20,
  /** Propuestas por corrida de un agente (cupo del token MCP). */
  maxPorCorrida: 2,
  claveCupo: 'proponer_skill',

  /** Nombre de skill de Claude Code: minúsculas, números y guiones sueltos (ni al principio ni al final). */
  nombreValido(n: string): boolean {
    return n.length > 0 && n.length <= SkillsPropias.maxNombre && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(n)
  },

  /** Lleva un texto libre a un nombre válido («Resumen de mails» → `resumen-de-mails`), o '' si no queda nada. */
  slug(s: string): string {
    const t = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return t.slice(0, SkillsPropias.maxNombre).replace(/-+$/, '')
  },

  /** El SKILL.md de una skill propia. */
  md(s: SkillPropia): string {
    return `---\nname: ${s.nombre}\ndescription: ${yamlLinea(s.descripcion)}\nmetadata:\n  ${claveAgente}: ${s.agente}\n---\n\n${s.contenido.trim()}\n`
  },

  /** Lee un SKILL.md: undefined si no es una skill propia de algún agente (por ejemplo, una que la persona puso a mano). */
  parsear(texto: string, carpeta: string): SkillPropia | undefined {
    const p = partes(texto.replace(/\r\n/g, '\n'))
    if (p.frontmatter.length === 0) return undefined
    const i = p.frontmatter.findIndex((l) => /^metadata:\s*$/.test(l))
    if (i < 0) return undefined
    let agente: string | undefined
    for (const l of p.frontmatter.slice(i + 1)) {
      if (!/^\s/.test(l)) break
      const m = new RegExp(`^\\s+${claveAgente}:\\s*["']?([a-z0-9-]+)["']?\\s*$`).exec(l)
      if (m) agente = m[1]
    }
    if (!agente) return undefined
    const nombre = valorFrontmatter(p.frontmatter, 'name') ?? carpeta
    return { nombre, descripcion: valorFrontmatter(p.frontmatter, 'description') ?? '', contenido: p.cuerpo.replace(/^\n+/, '').replace(/\s+$/, ''), agente }
  },

  /** Todas las skills propias de la oficina (de cualquier agente), por nombre. */
  listar(carpeta: string): SkillPropia[] {
    const dir = path.join(carpeta, dirSkills)
    let nombres: string[]
    try { nombres = fs.readdirSync(dir) } catch { return [] }
    const out: SkillPropia[] = []
    for (const n of nombres.sort()) {
      if (n.startsWith('.')) continue
      let t: string
      try { t = fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf8') } catch { continue }
      const s = SkillsPropias.parsear(t, n)
      if (s && s.nombre === n) out.push(s)
    }
    return out
  },

  delAgente(carpeta: string, agente: string): SkillPropia[] { return SkillsPropias.listar(carpeta).filter((s) => s.agente === agente) },

  /** Nombres de las propias de `agente` y de las de los demás agentes (estas se apagan en sus corridas). */
  nombres(carpeta: string, agente: string): { propias: string[]; ajenas: string[] } {
    const propias: string[] = []
    const ajenas: string[] = []
    for (const s of SkillsPropias.listar(carpeta)) (s.agente === agente ? propias : ajenas).push(s.nombre)
    return { propias, ajenas }
  },

  /** Valida y normaliza lo que llega de la interfaz o de un agente. Lanza ErrorAPI(400). */
  validar(d: { nombre?: unknown; descripcion?: unknown; contenido?: unknown }): { nombre: string; descripcion: string; contenido: string } {
    const nombre = typeof d.nombre === 'string' ? d.nombre.trim() : ''
    if (!SkillsPropias.nombreValido(nombre)) throw new ErrorAPI(400, `El nombre de la skill va en minúsculas, con números y guiones (por ejemplo «resumen-de-mails»), hasta ${SkillsPropias.maxNombre} caracteres.`)
    const descripcion = (typeof d.descripcion === 'string' ? d.descripcion : '').split(/[\n\r]+/).map((x) => x.trim()).filter((x) => x !== '').join(' ')
    if (descripcion === '') throw new ErrorAPI(400, 'Falta la descripción: cuándo tiene que usar la skill.')
    if (largo(descripcion) > SkillsPropias.maxDescripcion) throw new ErrorAPI(400, `La descripción es demasiado larga (máximo ${SkillsPropias.maxDescripcion} caracteres).`)
    const contenido = (typeof d.contenido === 'string' ? d.contenido : '').replace(/\r\n/g, '\n').trim()
    if (contenido === '') throw new ErrorAPI(400, 'Faltan las instrucciones de la skill.')
    if (largo(contenido) > SkillsPropias.maxContenido) throw new ErrorAPI(400, `Las instrucciones son demasiado largas (máximo ${SkillsPropias.maxContenido} caracteres).`)
    return { nombre, descripcion, contenido }
  },

  /** Crea (`nueva`) o reescribe una skill propia de `agente`. `ocupados`: nombres de skills instaladas en el Claude Code de
   *  la persona (no se puede usar uno de esos: no se sabría cuál carga). */
  guardar(carpeta: string, agente: string, d: { nombre?: unknown; descripcion?: unknown; contenido?: unknown }, { nueva, ocupados = [] }: { nueva: boolean; ocupados?: string[] }): SkillPropia {
    const v = SkillsPropias.validar(d)
    const dir = path.join(carpeta, dirSkills, v.nombre)
    const archivo = path.join(dir, 'SKILL.md')
    const existente = SkillsPropias.leer(carpeta, v.nombre)
    if (nueva) {
      if (existente) throw new ErrorAPI(409, existente.agente === agente ? 'Ya tiene una skill con ese nombre.' : 'Otro agente ya tiene una skill con ese nombre. Elegí otro.')
      if (fs.existsSync(dir)) throw new ErrorAPI(409, 'Ya hay una skill con ese nombre en la carpeta de la oficina. Elegí otro.')
      if (ocupados.includes(v.nombre)) throw new ErrorAPI(409, 'Ya tenés una skill instalada en Claude Code con ese nombre. Elegí otro.')
      if (SkillsPropias.delAgente(carpeta, agente).length >= SkillsPropias.maxPorAgente) throw new ErrorAPI(400, `Máximo ${SkillsPropias.maxPorAgente} skills propias por agente.`)
    } else if (!existente || existente.agente !== agente) {
      throw new ErrorAPI(404, 'No existe esa skill.')
    }
    const s: SkillPropia = { ...v, agente }
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(archivo, SkillsPropias.md(s))
    } catch {
      throw new ErrorAPI(500, 'No pude guardar la skill.')
    }
    return s
  },

  leer(carpeta: string, nombre: string): SkillPropia | undefined {
    if (!SkillsPropias.nombreValido(nombre)) return undefined
    try {
      const s = SkillsPropias.parsear(fs.readFileSync(path.join(carpeta, dirSkills, nombre, 'SKILL.md'), 'utf8'), nombre)
      return s && s.nombre === nombre ? s : undefined
    } catch { return undefined }
  },

  /** Borra una skill propia de `agente` (su carpeta entera). */
  borrar(carpeta: string, agente: string, nombre: string) {
    const s = SkillsPropias.leer(carpeta, nombre)
    if (!s || s.agente !== agente) throw new ErrorAPI(404, 'No existe esa skill.')
    try { fs.rmSync(path.join(carpeta, dirSkills, nombre), { recursive: true, force: true }) } catch { throw new ErrorAPI(500, 'No pude borrar la skill.') }
  },

  /** Al despedir a un agente: sus skills se mueven a `destino` (una carpeta de archivados) y sus propuestas se descartan.
   *  Devuelve cuántas skills movió. */
  archivar(carpeta: string, agente: string, destino: string): number {
    let n = 0
    for (const s of SkillsPropias.delAgente(carpeta, agente)) {
      try {
        fs.mkdirSync(destino, { recursive: true })
        fs.renameSync(path.join(carpeta, dirSkills, s.nombre), path.join(destino, s.nombre))
        n++
      } catch {}
    }
    const ps = Propuestas.lista(carpeta)
    if (ps.some((p) => p.agente === agente)) Propuestas.escribir(carpeta, ps.filter((p) => p.agente !== agente))
    return n
  },

  json(s: SkillPropia): Obj { return { nombre: s.nombre, descripcion: s.descripcion, contenido: s.contenido } },
}

export const Propuestas = {
  lista(carpeta: string): PropuestaSkill[] {
    let o: unknown
    try { o = JSON.parse(fs.readFileSync(path.join(carpeta, archivoPropuestas), 'utf8')) } catch { return [] }
    if (!esObjeto(o) || !Array.isArray(o.propuestas)) return []
    const out: PropuestaSkill[] = []
    for (const x of o.propuestas) {
      if (!esObjeto(x)) continue
      const s = (k: string) => (typeof x[k] === 'string' ? (x[k] as string) : '')
      if (s('id') === '' || s('agente') === '' || s('nombre') === '') continue
      const p: PropuestaSkill = { id: s('id'), agente: s('agente'), nombre: s('nombre'), descripcion: s('descripcion'), contenido: s('contenido'), motivo: s('motivo'), creada: typeof x.creada === 'number' ? x.creada : 0 }
      if (s('sid') !== '') p.sid = s('sid')
      out.push(p)
    }
    return out
  },

  delAgente(carpeta: string, agente: string): PropuestaSkill[] { return Propuestas.lista(carpeta).filter((p) => p.agente === agente) },

  escribir(carpeta: string, ps: PropuestaSkill[]) {
    const archivo = path.join(carpeta, archivoPropuestas)
    try {
      if (ps.length === 0) { fs.rmSync(archivo, { force: true }); return }
      fs.mkdirSync(path.dirname(archivo), { recursive: true })
      fs.writeFileSync(archivo, JSON.stringify({ propuestas: ps }, null, 2) + '\n')
    } catch {
      throw new ErrorAPI(500, 'No pude guardar las propuestas de skills.')
    }
  },

  /** Guarda una propuesta (ya validada). Si el agente ya había propuesto una con el mismo nombre, la reemplaza. */
  crear(carpeta: string, p: Omit<PropuestaSkill, 'id' | 'creada'>): PropuestaSkill {
    const ps = Propuestas.lista(carpeta).filter((x) => !(x.agente === p.agente && x.nombre === p.nombre))
    if (ps.length >= SkillsPropias.maxPropuestas) throw new ErrorAPI(400, `Ya hay ${SkillsPropias.maxPropuestas} propuestas de skills sin revisar.`)
    const n: PropuestaSkill = { ...p, id: randomBytes(6).toString('hex'), creada: Date.now() / 1000 }
    Propuestas.escribir(carpeta, [...ps, n])
    return n
  },

  quitar(carpeta: string, agente: string, id: string): boolean {
    const ps = Propuestas.lista(carpeta)
    const resto = ps.filter((p) => !(p.id === id && p.agente === agente))
    if (resto.length === ps.length) return false
    Propuestas.escribir(carpeta, resto)
    return true
  },

  json(p: PropuestaSkill, existente: boolean): Obj {
    return { id: p.id, nombre: p.nombre, descripcion: p.descripcion, contenido: p.contenido, motivo: p.motivo, sid: p.sid ?? null, creada: p.creada, cambio: existente }
  },
}
