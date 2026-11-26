// Agentes de la oficina: contratar, borrador, editar, despedir y notas (Agentes.swift + rutas de /api/agentes).
import { esMemoriaIA, type MemoriaIA } from './config.js'
import { modoSkillsDe, type ModoSkills } from './skills.js'
import { Habilitados } from './habilitados.js'
import fs from 'node:fs'
import path from 'node:path'
import { ErrorAPI } from './errores.js'
import { esObjeto, objeto, type Obj } from './json.js'
import {
  OficinaStore, ValidarAgenteExtra, agenteJSON, existeDepto, oficinaJSON,
  type AgenteDef, type Avatar, type ConectorAsignado, type LimitesAgente, type Oficina,
} from './oficina.js'
import { Oficinas, OficinaActiva, avatarValido } from './oficinas.js'
import { agenteMD, fijarFrontmatter, notasAgenteMD, partes, promptDe, valorFrontmatter, yamlLinea, escribirSiFalta } from './plantillas.js'
import { ClaudeError } from './claude-runner.js'
import { no404, no405, type Resp } from './router.js'
import { registrarModulo, type Servicios } from './servicios.js'
import { CajaCosto } from './stream.js'
import { Slug, Validar, largo, plegar, prefijo } from './validar.js'

// MARK: - validación del cuerpo

export type NuevoAgente = {
  id?: string; nombre: string; rol: string; description: string; prompt: string; departamento: string
  chips: string[]; modelo: string; esfuerzo?: string; skills?: string[]; brief?: string; avatar?: Avatar; escritura?: string[]
  limites?: LimitesAgente; conectores?: ConectorAsignado[]; permisos?: string[]; sabeDe?: string[]
}

/** Lista de textos recortados (los vacíos se descartan). undefined si la clave no viene (o es null). */
export function listaTextos(v: unknown, campo: string): string[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) throw new ErrorAPI(400, `«${campo}» tiene que ser una lista de textos.`)
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string') throw new ErrorAPI(400, `«${campo}» tiene que ser una lista de textos.`)
    const t = x.trim()
    if (t !== '') out.push(t)
  }
  return out
}

export function limitesValidos(v: unknown): LimitesAgente | undefined {
  if (v === undefined || v === null) return undefined
  if (!esObjeto(v)) throw new ErrorAPI(400, '«limites» tiene que ser un objeto con «solo» y «proponer».')
  const l: LimitesAgente = {}
  const solo = listaTextos(v.solo, 'limites.solo')
  const proponer = listaTextos(v.proponer, 'limites.proponer')
  if (solo !== undefined) l.solo = solo
  if (proponer !== undefined) l.proponer = proponer
  ValidarAgenteExtra.limites(l)
  return l
}

export function conectoresValidos(v: unknown): ConectorAsignado[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) throw new ErrorAPI(400, '«conectores» tiene que ser una lista.')
  const out: ConectorAsignado[] = []
  for (const x of v) {
    if (!esObjeto(x)) throw new ErrorAPI(400, 'Cada conector tiene que ser un objeto con «servidor», «leer» y «actuar».')
    const servidor = Validar.texto(x.servidor, 'servidor', ValidarAgenteExtra.maxLargoServidor)!
    out.push({ servidor, leer: listaTextos(x.leer, 'leer') ?? [], actuar: listaTextos(x.actuar, 'actuar') ?? [] })
  }
  ValidarAgenteExtra.conectores(out)
  return out
}

export function permisosValidos(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined
  const p = listaTextos(v, 'permisos')
  if (p === undefined) return undefined
  ValidarAgenteExtra.permisos(p)
  return p
}

/** «Sabe de»: lista de temas recortados, sin repetidos (sin importar acentos ni mayúsculas). undefined si no viene. */
export function sabeDeValido(v: unknown): string[] | undefined {
  const l = listaTextos(v, 'sabeDe')
  if (l === undefined) return undefined
  const vistos = new Set<string>()
  const out: string[] = []
  for (const t of l) {
    const n = plegar(t)
    if (vistos.has(n)) continue
    vistos.add(n)
    out.push(t)
  }
  ValidarAgenteExtra.sabeDe(out)
  return out
}

export function modeloValido(v: unknown): string {
  if (v === undefined || v === null) return 'sonnet'
  const s = typeof v === 'string' ? v.trim().toLowerCase() : undefined
  if (s === undefined || !Validar.modelos.has(s)) throw new ErrorAPI(400, 'Modelo inválido (sonnet, opus, haiku o inherit).')
  return s
}

/** Esfuerzo de un agente o de una charla: '' (o null) = el de Claude Code; si no, uno de `Validar.esfuerzos`. */
export function esfuerzoValido(v: unknown): string {
  if (v === undefined || v === null) return ''
  const s = typeof v === 'string' ? v.trim().toLowerCase() : undefined
  if (s === undefined || (s !== '' && !Validar.esfuerzos.has(s))) throw new ErrorAPI(400, 'Esfuerzo inválido (low, medium, high, xhigh o max).')
  return s
}

/** `modelo` y `esfuerzo` opcionales de una charla (chat, reunión, Creador): pisan los del agente solo en esa corrida. */
export type EleccionCharla = { modelo?: string; esfuerzo?: string; skills?: ModoSkills; memoria?: MemoriaIA; colegas?: boolean; mcpLocales?: boolean }
export function eleccionCharla(d: Obj): EleccionCharla {
  const r: EleccionCharla = {}
  if (d.modelo !== undefined && d.modelo !== null && d.modelo !== '') r.modelo = modeloValido(d.modelo)
  const e = esfuerzoValido(d.esfuerzo)
  if (e !== '') r.esfuerzo = e
  for (const k of ['colegas', 'mcpLocales'] as const) {
    const v = d[k]
    if (v === undefined || v === null) continue
    if (typeof v !== 'boolean') throw new ErrorAPI(400, `«${k}» tiene que ser verdadero o falso.`)
    r[k] = v
  }
  if (d.skills !== undefined && d.skills !== null) {
    const m = modoSkillsDe(d.skills)
    if (!m) throw new ErrorAPI(400, '«skills» tiene que ser resumidas, completas, agente o ninguna.')
    r.skills = m
  }
  if (d.memoria !== undefined && d.memoria !== null) {
    if (!esMemoriaIA(d.memoria)) throw new ErrorAPI(400, '«memoria» tiene que ser "completa" o "liviana".')
    r.memoria = d.memoria
  }
  return r
}

/** Vuelca una elección de charla sobre el contexto de la corrida. */
export function aplicarEleccion(ctx: { modelo?: string; esfuerzo?: string; skills?: ModoSkills; memoria?: MemoriaIA; colegas?: boolean; mcpLocales?: boolean }, e: EleccionCharla) {
  for (const k of ['modelo', 'esfuerzo', 'skills', 'memoria', 'colegas', 'mcpLocales'] as const) if (e[k] !== undefined) (ctx as Record<string, unknown>)[k] = e[k]
}

/** Skills elegidas de un agente: nombres de skills (los que informa Claude Code), sin repetir, hasta 60. */
export function skillsValidas(v: unknown): string[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new ErrorAPI(400, '«skills» tiene que ser una lista de nombres.')
  const out = [...new Set((v as string[]).map((x) => x.trim()).filter((x) => x !== ''))]
  if (out.length > 60 || out.some((x) => x.length > 200 || /[\s"]/.test(x))) throw new ErrorAPI(400, '«skills»: hasta 60 nombres de skills.')
  return out
}

export function chipsValidos(v: unknown): string[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw new ErrorAPI(400, '«chips» tiene que ser una lista de textos.')
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string') throw new ErrorAPI(400, '«chips» tiene que ser una lista de textos.')
    const t = x.trim()
    if (t === '') continue
    if (largo(t) > 200) throw new ErrorAPI(400, 'Un chip es demasiado largo (máximo 200 caracteres).')
    out.push(t)
  }
  if (out.length > 6) throw new ErrorAPI(400, 'Máximo 6 chips.')
  return out
}

/** Valida el JSON del `POST /api/agentes`. Lanza 400 con un mensaje claro. */
export function nuevoAgenteDesde(d: Obj): NuevoAgente {
  const id = Validar.texto(d.id, 'id', 41, false)
  if (id !== undefined && !Slug.valido(id)) throw new ErrorAPI(400, 'El id tiene que ser minúsculas, números y guiones (hasta 41 caracteres).')
  const nombre = Validar.texto(d.nombre, 'nombre', 80)!
  const rol = Validar.texto(d.rol, 'rol', 160)!
  const prompt = Validar.texto(d.prompt, 'prompt', 20_000)!
  const description = Validar.texto(d.description, 'description', 1000, false) ?? rol
  const departamento = Validar.texto(d.departamento, 'departamento', 41)!
  const modelo = modeloValido(d.modelo)
  const brief = Validar.texto(d.brief, 'brief', 4000, false)
  const n: NuevoAgente = { nombre, rol, description, prompt, departamento, chips: chipsValidos(d.chips), modelo }
  const esfuerzo = esfuerzoValido(d.esfuerzo)
  if (esfuerzo !== '') n.esfuerzo = esfuerzo
  const sk = skillsValidas(d.skills)
  if (sk.length > 0) n.skills = sk
  if (id !== undefined) n.id = id
  if (brief !== undefined) n.brief = brief
  n.avatar = avatarValido(d.avatar)
  n.limites = limitesValidos(d.limites)
  n.conectores = conectoresValidos(d.conectores)
  n.permisos = permisosValidos(d.permisos)
  n.sabeDe = sabeDeValido(d.sabeDe)
  return n
}

export type CambiosAgente = {
  nombre?: string; rol?: string; departamento?: string; avatar?: Avatar
  prompt?: string; description?: string; chips?: string[]; modelo?: string; brief?: string
  /** '' = volver al de Claude Code. */
  esfuerzo?: string
  /** null = heredar las de la oficina; [] = ninguna. */
  skills?: string[] | null
  /** Servidores MCP de Claude Code. null = heredar los de la oficina; [] = ninguno. */
  mcp?: string[] | null
  limites?: LimitesAgente; conectores?: ConectorAsignado[]; permisos?: string[]; sabeDe?: string[]
  /** Permisos guardados con «Siempre» (solo se pueden quitar o reemplazar: los agrega `agregarReglas`). */
  reglas?: string[]
}

export function cambiosAgenteDesde(d: Obj): CambiosAgente {
  const c: CambiosAgente = {}
  c.nombre = Validar.texto(d.nombre, 'nombre', 80, false)
  c.rol = Validar.texto(d.rol, 'rol', 160, false)
  c.departamento = Validar.texto(d.departamento, 'departamento', 41, false)
  c.prompt = Validar.texto(d.prompt, 'prompt', 20_000, false)
  c.description = Validar.texto(d.description, 'description', 1000, false)
  c.brief = Validar.texto(d.brief, 'brief', 4000, false)
  if (d.modelo !== undefined && d.modelo !== null) c.modelo = modeloValido(d.modelo)
  if (d.esfuerzo !== undefined) c.esfuerzo = esfuerzoValido(d.esfuerzo)
  if (d.skills !== undefined) c.skills = d.skills === null ? null : skillsValidas(d.skills)
  const mcp = Habilitados.lista(d.mcp, 'mcp')
  if (mcp !== undefined) c.mcp = mcp
  if (d.chips !== undefined && d.chips !== null) c.chips = chipsValidos(d.chips)
  c.avatar = avatarValido(d.avatar)
  c.limites = limitesValidos(d.limites)
  c.conectores = conectoresValidos(d.conectores)
  c.permisos = permisosValidos(d.permisos)
  c.sabeDe = sabeDeValido(d.sabeDe)
  const r = listaTextos(d.reglas, 'reglas')
  if (r !== undefined) {
    ValidarAgenteExtra.reglas(r)
    c.reglas = r
  }
  return c
}

// MARK: - borrador

export type BorradorAgente = { id: string; nombre: string; rol: string; description: string; prompt: string; chips: string[]; modelo: string; sabeDe?: string[] }

export const Borrador = {
  /** Meta-prompt (español) que pide el JSON del agente. No usa agente ni herramientas. */
  metaPrompt(oficina: Oficina, departamento: { nombre: string }, descripcion: string): string {
    const existentes = oficina.agentes.length === 0 ? '(todavía no hay agentes)'
      : oficina.agentes.map((a) => {
        const dep = oficina.departamentos.find((x) => x.id === a.departamento)?.nombre ?? a.departamento
        return `- ${a.nombre} (id: ${a.id}), ${a.rol}, departamento ${dep}`
      }).join('\n')
    return `Sos un diseñador de equipos que redacta la definición de un agente de Claude Code para una oficina de agentes.

CONTEXTO
- Oficina: ${oficina.nombre}${oficina.duenio === '' ? '' : ` (dueño/a: ${oficina.duenio})`}
- Departamento donde va a trabajar el agente nuevo: ${departamento.nombre}
- Agentes que ya existen (no dupliques sus roles; podés mencionarlos como compañeros si tiene sentido):
${existentes}

LO QUE PIDIÓ EL USUARIO PARA EL AGENTE NUEVO
${descripcion}

TU TAREA
Inventá a la persona que mejor cumple ese pedido y devolvé SOLO un objeto JSON válido, sin texto antes ni después, sin bloque de código, con exactamente estas claves:
{
  "id": "slug-en-minusculas",
  "nombre": "Nombre de pila o apodo, corto",
  "rol": "Cargo en pocas palabras, por ejemplo Directora creativa de redes",
  "description": "...",
  "prompt": "...",
  "chips": ["...", "...", "..."],
  "sabeDe": ["...", "...", "..."],
  "modelo": "sonnet"
}

REGLAS DE CADA CLAVE
- id: solo minúsculas sin acentos, números y guiones, hasta 40 caracteres, derivado del nombre (por ejemplo "marce", "don-armando"). No uses ids genéricos como "agente" o "asistente".
- nombre: un nombre propio humano y fácil de recordar, o el apodo del cargo si el usuario lo pidió.
- rol: máximo 8 palabras.
- description: una o dos oraciones, en tercera persona, al estilo de las descripciones de agentes de Claude Code: quién es y CUÁNDO conviene usarlo ("Usalo cuando haga falta..."). Sin saltos de línea.
- prompt: las instrucciones del agente, en segunda persona ("Sos ..."), en el mismo idioma en que escribió el usuario (español rioplatense por defecto). Estructura: quién es y para quién trabaja; "Tu trabajo" (qué hace y qué entrega); "Cómo respondés" (formato, extensión, tono); "Reglas" (propone y el usuario aprueba; no inventa datos, cifras ni promesas; si falta información pregunta lo mínimo). Entre 150 y 400 palabras. No incluyas rutas de archivos ni una sección de memoria: el sistema la agrega solo.
- chips: exactamente 3 frases cortas (máximo 60 caracteres) que el usuario podría escribirle al agente para empezar a trabajar.
- sabeDe: de 3 a 6 temas concretos sobre los que este agente sabe (máximo 4 palabras cada uno, por ejemplo "métricas de Instagram"). Los colegas los usan para saber a quién preguntarle.
- modelo: "sonnet" salvo que el trabajo exija razonamiento muy profundo ("opus") o sea muy simple y repetitivo ("haiku").

Devolvé únicamente el JSON.`
  },

  /** Extrae y valida el borrador del texto de `result` (JSON puro, dentro de ```json o rodeado de texto). */
  parsear(texto: string, ocupados: Set<string>): BorradorAgente | undefined {
    for (const cand of Borrador.candidatos(texto)) {
      let o: unknown
      try {
        o = JSON.parse(cand)
      } catch {
        continue
      }
      if (!esObjeto(o)) continue
      const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '').trim()
      const nombre = s('nombre'), rol = s('rol'), prompt = s('prompt')
      if (nombre === '' || rol === '' || prompt === '') continue
      const slug = Slug.de(s('id'))
      const pedido = slug === '' ? s('nombre') : slug
      const id = Slug.unico(pedido, new Set([...ocupados, ...Validar.reservados]), 'agente')
      let desc = s('description').split(/[\n\r\v\f\u0085\u2028\u2029]+/).filter((x) => x !== '').join(' ')
      if (desc === '') desc = `${nombre}, ${rol}.`
      const chips = (Array.isArray(o.chips) ? o.chips : [])
        .filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x !== '' && largo(x) <= 200)
      const m = s('modelo').toLowerCase()
      const temas: string[] = []
      for (const x of Array.isArray(o.sabeDe) ? o.sabeDe : []) {
        if (typeof x !== 'string') continue
        const t = x.trim()
        if (t === '' || largo(t) > ValidarAgenteExtra.maxLargoTema || temas.some((y) => plegar(y) === plegar(t))) continue
        temas.push(t)
      }
      const b: BorradorAgente = {
        id, nombre: prefijo(nombre, 80), rol: prefijo(rol, 160), description: prefijo(desc, 1000), prompt: prefijo(prompt, 20_000),
        chips: chips.slice(0, 3), modelo: Validar.modelos.has(m) ? m : 'sonnet',
      }
      if (temas.length > 0) b.sabeDe = temas.slice(0, 6)
      return b
    }
    return undefined
  },

  /** Posibles textos JSON dentro de la respuesta: tal cual, bloques ``` y del primer "{" al último "}". */
  candidatos(texto: string): string[] {
    const t = texto.trim()
    const out = [t]
    let resto = t
    for (;;) {
      const a = resto.indexOf('```')
      if (a < 0) break
      const tras = resto.slice(a + 3)
      const b = tras.indexOf('```')
      if (b < 0) break
      let bloque = tras.slice(0, b)
      const nl = bloque.indexOf('\n')
      if (nl >= 0 && !bloque.slice(0, nl).includes('{')) bloque = bloque.slice(nl + 1)
      out.push(bloque.trim())
      resto = tras.slice(b + 3)
    }
    const i = t.indexOf('{'), j = t.lastIndexOf('}')
    if (i >= 0 && j > i) out.push(t.slice(i, j + 1))
    return out
  },
}

// MARK: - operaciones sobre agentes de la oficina activa

export const ahoraISO = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

const rutaMD = (a: OficinaActiva, id: string) => a.ruta(path.join('.claude', 'agents', `${id}.md`))
const vacio = (l: LimitesAgente) => (l.solo ?? []).length === 0 && (l.proponer ?? []).length === 0

function leerTexto(p: string): string {
  try { return fs.readFileSync(p, 'utf8') } catch { return '' }
}

/** Contrata: escribe `.claude/agents/<id>.md` y `conocimiento/agentes/<id>.md` y actualiza oficina.json. */
export function contratar(oficinas: Oficinas, n: NuevoAgente, log?: { info(m: string): void }): [AgenteDef, OficinaActiva] {
  const a = oficinas.requerirActiva()
  const o = a.oficina
  if (o.agentes.length >= Oficinas.maxAgentes) throw new ErrorAPI(400, `Máximo ${Oficinas.maxAgentes} agentes por oficina.`)
  if (!existeDepto(o, n.departamento)) throw new ErrorAPI(400, 'El departamento no existe.')
  const usados = new Set(o.agentes.map((x) => x.id))
  let id: string
  if (n.id !== undefined) {
    if (Validar.reservados.has(n.id)) throw new ErrorAPI(400, 'Ese id está reservado por Claude Code. Elegí otro.')
    if (usados.has(n.id)) throw new ErrorAPI(409, 'Ya hay un agente con ese id.')
    id = n.id
  } else {
    id = Slug.unico(n.nombre, new Set([...usados, ...Validar.reservados]), 'agente')
  }
  const md = rutaMD(a, id)
  if (fs.existsSync(md)) throw new ErrorAPI(409, 'Ya existe un archivo de agente con ese id en .claude/agents.')
  const avatar: Avatar = { ...(n.avatar ?? {}) }
  if (avatar.semilla === undefined) avatar.semilla = id
  const def: AgenteDef = { id, nombre: n.nombre, rol: n.rol, departamento: n.departamento }
  if (n.brief !== undefined) def.brief = n.brief
  def.modelo = n.modelo
  if (n.esfuerzo !== undefined) def.esfuerzo = n.esfuerzo
  if (n.skills !== undefined) def.skills = n.skills
  if (n.chips.length > 0) def.chips = n.chips
  def.avatar = avatar
  def.creado = ahoraISO()
  if (n.escritura !== undefined) def.escritura = n.escritura
  if (n.limites && !vacio(n.limites)) def.limites = n.limites
  if (n.conectores && n.conectores.length > 0) def.conectores = n.conectores
  if (n.permisos && n.permisos.length > 0) def.permisos = n.permisos
  if (n.sabeDe && n.sabeDe.length > 0) def.sabeDe = n.sabeDe
  const notas = a.ruta(path.join('conocimiento', 'agentes', `${id}.md`))
  const notasNuevas = !fs.existsSync(notas)
  try {
    fs.mkdirSync(a.ruta(path.join('.claude', 'agents')), { recursive: true })
    fs.writeFileSync(md, agenteMD(id, n.description, n.modelo, n.prompt))
    escribirSiFalta(a.carpeta, `conocimiento/agentes/${id}.md`, notasAgenteMD(n.nombre, n.rol))
    const nueva: Oficina = { ...o, agentes: [...o.agentes, def] }
    OficinaStore.escribir(nueva, a.carpeta)
    log?.info(`agente contratado id=${id}`)
    return [def, new OficinaActiva(a.carpeta, nueva)]
  } catch (e) {
    try { fs.rmSync(md, { force: true }) } catch {}
    if (notasNuevas) { try { fs.rmSync(notas, { force: true }) } catch {} }
    if (e instanceof ErrorAPI) throw e
    throw new ErrorAPI(500, 'No pude guardar el agente.')
  }
}

/** Edita un agente: oficina.json y, si cambian prompt, description o modelo, su `.md`. */
export function editarAgente(oficinas: Oficinas, id: string, c: CambiosAgente): [AgenteDef, OficinaActiva] {
  const [def, act] = oficinas.modificar((o) => {
    const ag = o.agentes.find((x) => x.id === id)
    if (!ag) throw new ErrorAPI(404, 'No existe ese agente.')
    if (c.departamento !== undefined) {
      if (!existeDepto(o, c.departamento)) throw new ErrorAPI(400, 'El departamento no existe.')
      ag.departamento = c.departamento
    }
    if (c.nombre !== undefined) ag.nombre = c.nombre
    if (c.rol !== undefined) ag.rol = c.rol
    if (c.brief !== undefined) ag.brief = c.brief
    if (c.chips !== undefined) { if (c.chips.length === 0) delete ag.chips; else ag.chips = c.chips }
    if (c.modelo !== undefined) ag.modelo = c.modelo
    if (c.esfuerzo !== undefined) { if (c.esfuerzo === '') delete ag.esfuerzo; else ag.esfuerzo = c.esfuerzo }
    if (c.skills !== undefined) { if (c.skills === null) delete ag.skills; else ag.skills = c.skills }
    if (c.mcp !== undefined) { if (c.mcp === null) delete ag.mcp; else ag.mcp = c.mcp }
    if (c.limites !== undefined) { if (vacio(c.limites)) delete ag.limites; else ag.limites = c.limites }
    if (c.conectores !== undefined) { if (c.conectores.length === 0) delete ag.conectores; else ag.conectores = c.conectores }
    if (c.permisos !== undefined) { if (c.permisos.length === 0) delete ag.permisos; else ag.permisos = c.permisos }
    if (c.reglas !== undefined) { if (c.reglas.length === 0) delete ag.reglas; else ag.reglas = c.reglas }
    if (c.sabeDe !== undefined) { if (c.sabeDe.length === 0) delete ag.sabeDe; else ag.sabeDe = c.sabeDe }
    if (c.avatar !== undefined) {
      const av = { ...c.avatar }
      if (av.semilla === undefined) av.semilla = ag.avatar?.semilla ?? id
      ag.avatar = av
    }
    // .md: se reescribe solo si cambia algo que vive ahí
    if (c.prompt !== undefined || c.description !== undefined || c.modelo !== undefined) {
      const act = oficinas.requerirActiva()
      const md = rutaMD(act, id)
      const p = partes(leerTexto(md))
      const modelo = c.modelo ?? valorFrontmatter(p.frontmatter, 'model') ?? ag.modelo ?? 'sonnet'
      const desc = c.description ?? valorFrontmatter(p.frontmatter, 'description') ?? ag.rol
      let texto: string
      if (c.prompt !== undefined) {
        texto = agenteMD(id, desc, modelo, c.prompt)
      } else {
        let fm = p.frontmatter
        if (fm.length === 0) fm = [`name: ${id}`]
        if (c.description !== undefined) fm = fijarFrontmatter(fm, 'description', yamlLinea(c.description))
        if (c.modelo !== undefined) fm = fijarFrontmatter(fm, 'model', c.modelo)
        texto = '---\n' + fm.join('\n') + '\n---\n' + p.cuerpo
      }
      try {
        fs.mkdirSync(act.ruta(path.join('.claude', 'agents')), { recursive: true })
        fs.writeFileSync(md, texto)
      } catch {
        throw new ErrorAPI(500, 'No pude guardar el archivo del agente.')
      }
    }
    return ag
  })
  return [def, act]
}

/** Detalle editable: la definición, `description`, `prompt` (sin la sección de memoria) y `modelo` del `.md`. */
export function detalleAgente(oficinas: Oficinas, id: string): Obj {
  const a = oficinas.requerirActiva()
  const def = a.oficina.agentes.find((x) => x.id === id)
  if (!def) throw new ErrorAPI(404, 'No existe ese agente.')
  const p = partes(leerTexto(rutaMD(a, id)))
  const r: Obj = { agente: agenteJSON(def), prompt: promptDe(p.cuerpo), description: valorFrontmatter(p.frontmatter, 'description') ?? '' }
  const m = valorFrontmatter(p.frontmatter, 'model')
  if (m !== undefined) r.modelo = m
  return r
}

const dos = (n: number) => String(n).padStart(2, '0')
const sello = (d: Date) => `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`

/** "Despedir": mueve el `.md` a `.claude/agents/.archivados/<id>-<fecha>.md` y lo saca de oficina.json.
 *  `conocimiento/agentes/<id>.md` queda. Devuelve la ruta relativa del archivado (o undefined si no había .md). */
export function despedir(oficinas: Oficinas, id: string, log?: { info(m: string): void }): [string | undefined, OficinaActiva] {
  const a = oficinas.requerirActiva()
  const o = structuredClone(a.oficina)
  if (!o.agentes.some((x) => x.id === id)) throw new ErrorAPI(404, 'No existe ese agente.')
  const md = rutaMD(a, id)
  let rel: string | undefined
  let destino: string | undefined
  if (fs.existsSync(md)) {
    const dir = a.ruta(path.join('.claude', 'agents', '.archivados'))
    let nombre = `${id}-${sello(new Date())}`
    let n = 2
    while (fs.existsSync(path.join(dir, nombre + '.md'))) { nombre = `${id}-${sello(new Date())}-${n}`; n++ }
    try {
      fs.mkdirSync(dir, { recursive: true })
      destino = path.join(dir, nombre + '.md')
      fs.renameSync(md, destino)
    } catch {
      throw new ErrorAPI(500, 'No pude archivar el agente.')
    }
    rel = `.claude/agents/.archivados/${nombre}.md`
  }
  o.agentes = o.agentes.filter((x) => x.id !== id)
  // sus tareas programadas quedan desactivadas (no se borran)
  for (const t of o.tareas ?? []) if (esObjeto(t) && t.agente === id) t.activa = false
  try {
    OficinaStore.escribir(o, a.carpeta)
  } catch (e) {
    if (destino) { try { fs.renameSync(destino, md) } catch {} }
    throw e
  }
  log?.info(`agente despedido id=${id}`)
  return [rel, new OficinaActiva(a.carpeta, o)]
}

/** Notas de trabajo del agente (`conocimiento/agentes/<id>.md`); vacío si todavía no existe. */
export function conocimiento(oficinas: Oficinas, id: string): Obj {
  const a = oficinas.requerirActiva()
  if (!a.oficina.agentes.some((x) => x.id === id)) throw new ErrorAPI(404, 'No existe ese agente.')
  const rel = `conocimiento/agentes/${id}.md`
  let data: Buffer
  try { data = fs.readFileSync(a.ruta(path.join('conocimiento', 'agentes', `${id}.md`))) } catch { data = Buffer.alloc(0) }
  return { id, ruta: rel, texto: data.subarray(0, 200_000).toString('utf8') }
}

/** Prepara el borrador (valida y arma el meta-prompt). No ejecuta nada. */
export function prepararBorrador(oficinas: Oficinas, descripcion: string, departamento: string): [OficinaActiva, string] {
  const a = oficinas.requerirActiva()
  const desc = descripcion.trim()
  if (desc === '') throw new ErrorAPI(400, 'Contá en palabras qué agente querés.')
  if (largo(desc) > 4000) throw new ErrorAPI(400, 'La descripción es demasiado larga (máximo 4000 caracteres).')
  const dep = a.oficina.departamentos.find((d) => d.id === departamento)
  if (!dep) throw new ErrorAPI(400, 'El departamento no existe.')
  return [a, Borrador.metaPrompt(a.oficina, dep, desc)]
}

// MARK: - rutas

export function instalar(s: Servicios) {
  const { oficinas, runner, store, log } = s

  async function borrador(body?: Buffer): Promise<Resp> {
    const d = objeto(body)
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    const [a, prompt] = prepararBorrador(oficinas, str(d.descripcion), str(d.departamento))
    const caja = new CajaCosto()
    let texto: string
    try {
      texto = await runner.correrSinAgente(prompt, { cwd: a.carpeta, obs: caja.observador() })
    } catch (e) {
      if (e instanceof ClaudeError) {
        log.error(`borrador tipo=${e.tipo}`)
        return [502, { error: `No pude armar el borrador del agente: ${e.mensaje}` }]
      }
      throw e
    }
    store.registrarCosto({ oficina: a.carpeta, origen: 'borrador', costo: caja.valor })
    // los ids ocupados se recalculan por si cambió la oficina mientras Claude pensaba
    const ocupados = new Set((oficinas.activa()?.oficina ?? a.oficina).agentes.map((x) => x.id))
    const b = Borrador.parsear(texto, ocupados)
    if (!b) {
      log.error('borrador: respuesta sin JSON válido')
      return [502, { error: 'Claude no devolvió un borrador que pueda usar. Probá de nuevo con otra descripción.' }]
    }
    return [200, { ...b, departamento: str(d.departamento) }]
  }

  s.router.nucleo.push(async ({ method, partes: p, body }) => {
    if (p[1] !== 'agentes') return null
    const n = p.length
    if (n === 2) {
      if (method !== 'POST') return null // GET y el 405 los atiende rutas-oficinas
      const [def, a] = contratar(oficinas, nuevoAgenteDesde(objeto(body)), log)
      return [200, { agente: agenteJSON(def), oficina: oficinaJSON(a.oficina) }]
    }
    if (n === 3 && p[2] === 'borrador') return method === 'POST' ? borrador(body) : no405
    if (n === 3) {
      const id = p[2]!
      if (!Slug.valido(id)) return no404
      switch (method) {
        case 'GET': return [200, detalleAgente(oficinas, id)]
        case 'PATCH': {
          const [def, a] = editarAgente(oficinas, id, cambiosAgenteDesde(objeto(body)))
          return [200, { agente: agenteJSON(def), oficina: oficinaJSON(a.oficina) }]
        }
        case 'DELETE': {
          const [rel, a] = despedir(oficinas, id, log)
          return [200, { ok: true, archivado: rel ?? null, oficina: oficinaJSON(a.oficina) }]
        }
        default: return no405
      }
    }
    if (n === 4 && p[3] === 'conocimiento') {
      const id = p[2]!
      if (!Slug.valido(id)) return no404
      return method === 'GET' ? [200, conocimiento(oficinas, id)] : no405
    }
    return null
  })
}

registrarModulo('agentes', 20, instalar)
