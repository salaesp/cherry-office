// Reuniones (Reuniones.swift, ReunionPatrones.swift, Pendientes.swift, PendientesAcciones.swift): varios agentes opinan
// por rondas sobre un tema; el usuario interviene; al cerrar sale una síntesis con decisiones que queda en
// `reuniones/AAAA-MM-DD-<tema>.md` y en `conocimiento/decisiones.md`. Los pendientes de la síntesis llegan a las notas de
// cada agente y se pueden encargar («Hacelo ahora») al Programador. Mismos textos y archivos que Swift.
//
// Concurrencia: la base es sincrónica y hay un solo hilo (como el actor de Swift): el estado de las rondas en curso
// (`corriendo`, `hablando`, `cerrando`) vive en el router; lo demás, en SQLite. Con `await` en el medio se vuelve a leer.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ClaudeError } from './claude-runner.js'
import { iso, TextoEntrega, type Entrega } from './entregas.js'
import { ErrorAPI } from './errores.js'
import { esObjeto, objeto, objetoOpcional, type Obj } from './json.js'
import { escribirAtomico, OficinaStore, type AgenteDef, type Oficina } from './oficina.js'
import type { OficinaActiva } from './oficinas.js'
import { conMemoria, dirsTrabajo, dirsVinculos, esfuerzoDe, Instrucciones, turnoConPermiso } from './permisos.js'
import { esMemoriaIA } from './config.js'
import type { TurnoConPermiso } from './claude-runner.js'
import { anotarEnDiario } from './memoria-estructura.js'
import { anexarDecisiones } from './plantillas.js'
import { eleccionCharla } from './agentes.js'
import { dependenciasDe } from './dependencias.js'
import { flujoDesde, flujoJSON } from './modelo-flujos.js'
import { Programador, programadorDe } from './programador.js'
import { atrapar, no404, no405, type Query, type Resp, type SubRouter } from './router.js'
import { entregasRouterDe } from './rutas-entregas.js'
import { registrarModulo, type Servicios } from './servicios.js'
import { num, txt, type Fila, type SQLiteDB, type SQLValor } from './sqlite.js'
import { CajaCosto } from './stream.js'
import { deReunion } from './tareas.js'
import { Slug, Validar, largo, plegar, prefijo, uuidDe, uuidValido } from './validar.js'
import { coincide, palabras, plano, vacias } from './texto-comun.js'
export { coincide, palabras, plano, vacias }

// MARK: - modelo

export type TurnoReunion = {
  ronda: number
  /** id del agente o "usuario" */
  agente: string
  texto: string
  error: boolean
  ts: number
}

export type Pendiente = {
  quien: string
  que: string
  /** El responsable no lo puede hacer solo (correr programas, mandar mensajes…): necesita a la persona. */
  usuario: boolean
  /** Título corto (solo los que salen de un chat; la síntesis de reunión no lo pide). */
  nombre?: string
  /** Índices (0-based, en la lista de pendientes) de los pendientes que tienen que estar hechos antes de este. */
  dependeDe?: number[]
}

/** `depende_de` va 0-based dentro del JSON de la síntesis (el prompt lo pide 1-based) y solo si no está vacío. */
export const pendienteJSON = (p: Pendiente): Obj => {
  const o: Obj = { quien: p.quien, que: p.que, necesita_usuario: p.usuario }
  if (p.dependeDe && p.dependeDe.length > 0) o.depende_de = p.dependeDe
  return o
}
export const lineaMD = (p: Pendiente) => (p.quien === '' ? `- ${p.que}` : `- **${p.quien}:** ${p.que}`) + (p.usuario ? ' _(necesita a la persona)_' : '')
  + (p.dependeDe && p.dependeDe.length > 0 ? ` _(después de ${p.dependeDe.map((i) => i + 1).join(', ')})_` : '')

export type SintesisReunion = { resumen: string; decisiones: string[]; pendientes: Pendiente[] }
export const sintesisJSON = (s: SintesisReunion): Obj => ({ resumen: s.resumen, decisiones: s.decisiones, pendientes: s.pendientes.map(pendienteJSON) })

export type ReunionFila = {
  id: string
  oficina: string
  /** Nombre corto de la reunión (el que se muestra en listas, panel, acta y avisos). */
  titulo: string
  /** Descripción larga del tema (opcional). Da contexto a los agentes; puede estar vacía. */
  tema: string
  agentes: string[]
  estado: string
  creada: number
  cerrada?: number
  sintesis?: string
  errorSintesis?: string
  acta?: string
  error?: string
  /** slugs de documentos de la biblioteca adjuntos al tema (su ficha entra en el prompt de cada turno). */
  documentos: string[]
  /** patrón de reunión (debate si la fila es anterior a la fase 3). */
  patron: string
  lider?: string
  /** {"a":[ids],"b":[ids]} solo en red/blue. */
  bandos?: Record<string, string[]>
  salida?: string
  /** JSON del último resumen pedido sin cerrar (`resumenParcialJSON`). */
  resumenParcial?: string
  /** Modelo y esfuerzo elegidos para toda la reunión (pisan los de cada agente). */
  modelo?: string
  esfuerzo?: string
  memoria?: string
}

/** Resumen de lo dicho hasta ahora, sin cerrar: no deja acta ni toca decisiones ni pendientes. */
export type ResumenParcial = SintesisReunion & { abiertas: string[]; turnos: number; ts: number }
export const resumenParcialJSON = (r: ResumenParcial): Obj => ({ ...sintesisJSON(r), abiertas: r.abiertas, turnos: r.turnos, ts: iso(r.ts) })

export const patrones = ['debate', 'lider', 'mapreduce', 'redblue', 'revision'] as const
export type PatronReunion = (typeof patrones)[number]
export const esPatron = (t: string): t is PatronReunion => (patrones as readonly string[]).includes(t)
export const etiquetaPatron: Record<PatronReunion, string> = {
  debate: 'Debate',
  lider: 'Líder y equipo',
  mapreduce: 'Map-reduce (opiniones independientes)',
  redblue: 'Red/blue (dos bandos)',
  revision: 'Panel de revisión',
}

/** Qué se le pide a quien habla en ese turno. */
export type FaseTurno = 'libre' | 'abre' | 'opina' | 'cierra' | 'defiende' | 'critica' | 'revisa'
export type PasoTurno = { agente: string; fase: FaseTurno }

/** Texto del tema para los prompts de los agentes: el título y, debajo, la descripción si la hay y aporta algo. */
export function temaReunion(f: { titulo: string; tema?: string }): string {
  const d = (f.tema ?? '').trim()
  if (d === '' || d === f.titulo || d.startsWith(f.titulo)) return d === '' ? f.titulo : d
  return `${f.titulo}\n\n${d}`
}

// MARK: - SQLite (tablas `reuniones` y `turnos`, con clave de oficina)

const columnasReunion = 'id,oficina,titulo,tema,agentes,estado,creada,cerrada,sintesis,error_sintesis,acta,error,documentos,patron,lider,bandos,salida,resumen_parcial,modelo,esfuerzo,memoria'

const opt = (v: SQLValor | undefined) => (v === null || v === undefined ? undefined : txt(v))

function listaTexto(v: SQLValor | undefined): string[] {
  if (v === null || v === undefined) return []
  try {
    const a = JSON.parse(txt(v))
    return Array.isArray(a) && a.every((x) => typeof x === 'string') ? (a as string[]) : []
  } catch {
    return []
  }
}

function filaReunion(r: Fila): ReunionFila {
  let bandos: Record<string, string[]> | undefined
  if (r.bandos !== null && r.bandos !== undefined) {
    try {
      const b = JSON.parse(txt(r.bandos))
      if (esObjeto(b) && Object.values(b).every((x) => Array.isArray(x) && x.every((y) => typeof y === 'string'))) bandos = b as Record<string, string[]>
    } catch {}
  }
  const tema = txt(r.tema)
  const f: ReunionFila = {
    // filas viejas no tienen `titulo`: se deriva del tema (recortado).
    id: txt(r.id), oficina: txt(r.oficina), titulo: opt(r.titulo) ?? prefijo(tema, 120), tema, agentes: listaTexto(r.agentes), estado: txt(r.estado), creada: num(r.creada),
    documentos: listaTexto(r.documentos), patron: r.patron === null || r.patron === undefined ? 'debate' : txt(r.patron),
  }
  if (r.cerrada !== null && r.cerrada !== undefined) f.cerrada = num(r.cerrada)
  f.sintesis = opt(r.sintesis); f.errorSintesis = opt(r.error_sintesis); f.acta = opt(r.acta); f.error = opt(r.error)
  f.lider = opt(r.lider); f.bandos = bandos; f.salida = opt(r.salida); f.resumenParcial = opt(r.resumen_parcial)
  f.modelo = opt(r.modelo); f.esfuerzo = opt(r.esfuerzo); f.memoria = opt(r.memoria)
  for (const k of Object.keys(f) as (keyof ReunionFila)[]) if (f[k] === undefined) delete f[k]
  return f
}

/** Acceso a las tablas `reuniones` y `turnos` (extensión de Store en Swift). */
export class ReunionesDB {
  constructor(private readonly db: SQLiteDB) {}

  /** Crea las tablas si faltan y deja en `esperando` las reuniones que estaban en curso al apagarse la app. */
  preparar() {
    this.db.exec(`
    CREATE TABLE IF NOT EXISTS reuniones (
        id TEXT PRIMARY KEY,
        oficina TEXT NOT NULL,
        titulo TEXT,
        tema TEXT NOT NULL,
        agentes TEXT NOT NULL,
        estado TEXT NOT NULL,
        creada REAL NOT NULL,
        cerrada REAL,
        sintesis TEXT,
        error_sintesis TEXT,
        acta TEXT,
        error TEXT
    );
    CREATE INDEX IF NOT EXISTS reuniones_oficina ON reuniones(oficina, creada);
    CREATE TABLE IF NOT EXISTS turnos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reunion TEXT NOT NULL REFERENCES reuniones(id),
        oficina TEXT NOT NULL,
        ronda INTEGER NOT NULL,
        agente TEXT NOT NULL,
        texto TEXT NOT NULL,
        error INTEGER NOT NULL DEFAULT 0,
        ts REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS turnos_reunion ON turnos(reunion, id);
    `)
    const cols = this.db.query('PRAGMA table_info(reuniones)').map((f) => txt(f.name))
    if (!cols.includes('documentos')) this.db.exec('ALTER TABLE reuniones ADD COLUMN documentos TEXT')
    for (const [c, tipo] of [['titulo', 'TEXT'], ['patron', 'TEXT'], ['lider', 'TEXT'], ['bandos', 'TEXT'], ['salida', 'TEXT'], ['resumen_parcial', 'TEXT'], ['modelo', 'TEXT'], ['esfuerzo', 'TEXT'], ['memoria', 'TEXT']]) {
      if (!cols.includes(c!)) this.db.exec(`ALTER TABLE reuniones ADD COLUMN ${c} ${tipo}`)
    }
    this.prepararVista()
    this.db.run("UPDATE reuniones SET estado='esperando', vista=NULL WHERE estado='en_curso'")
  }

  /** Columna `vista`: 1 cuando el usuario abrió la reunión mientras esperaba (el aviso «te espera» se apaga).
   *  Se vuelve a NULL cada vez que la reunión pasa a `esperando`. */
  prepararVista() {
    const cols = this.db.query('PRAGMA table_info(reuniones)').map((f) => txt(f.name))
    if (cols.length > 0 && !cols.includes('vista')) this.db.exec('ALTER TABLE reuniones ADD COLUMN vista INTEGER')
  }

  crear(p: { id: string; oficina: string; titulo: string; tema: string; agentes: string[]; documentos?: string[]; patron?: string; lider?: string; bandos?: Record<string, string[]>; salida?: string; modelo?: string; esfuerzo?: string; memoria?: string }) {
    const docs = p.documentos ?? []
    this.db.run('INSERT INTO reuniones(id,oficina,titulo,tema,agentes,estado,creada,documentos,patron,lider,bandos,salida,modelo,esfuerzo,memoria) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
      p.id, p.oficina, p.titulo, p.tema, JSON.stringify(p.agentes), 'esperando', Date.now() / 1000, docs.length === 0 ? null : JSON.stringify(docs),
      p.patron ?? 'debate', p.lider ?? null, p.bandos ? JSON.stringify({ a: p.bandos.a, b: p.bandos.b }) : null, p.salida ?? null,
      p.modelo ?? null, p.esfuerzo ?? null, p.memoria ?? null,
    ])
  }

  /** Ruta final del archivo de salida (puede diferir de la pedida si ya existía una con ese nombre). */
  salida(id: string, salida: string) { this.db.run('UPDATE reuniones SET salida=? WHERE id=?', [salida, id]) }

  resumenParcial(id: string, json: string) { this.db.run('UPDATE reuniones SET resumen_parcial=? WHERE id=?', [json, id]) }

  una(id: string, oficina: string): ReunionFila | undefined {
    try {
      const f = this.db.query(`SELECT ${columnasReunion} FROM reuniones WHERE id=? AND oficina=?`, [id, oficina])[0]
      return f ? filaReunion(f) : undefined
    } catch {
      return undefined
    }
  }

  de(oficina: string): ReunionFila[] {
    try {
      return this.db.query(`SELECT ${columnasReunion} FROM reuniones WHERE oficina=? ORDER BY creada DESC, rowid DESC`, [oficina]).map(filaReunion)
    } catch {
      return []
    }
  }

  estado(id: string, estado: string, error?: string) {
    // volver a «esperando» (terminó una ronda, se reinició la app) vuelve a avisar aunque ya la hubieras visto
    const vista = estado === 'esperando' ? ', vista=NULL' : ''
    this.db.run(`UPDATE reuniones SET estado=?, error=?${vista} WHERE id=?`, [estado, error ?? null, id])
  }

  cerrar(id: string, p: { sintesis?: string; errorSintesis?: string; acta?: string; error?: string }) {
    this.db.run("UPDATE reuniones SET estado='cerrada', cerrada=?, sintesis=?, error_sintesis=?, acta=?, error=? WHERE id=?",
      [Date.now() / 1000, p.sintesis ?? null, p.errorSintesis ?? null, p.acta ?? null, p.error ?? null, id])
  }

  turnoAgregar(p: { reunion: string; oficina: string; ronda: number; agente: string; texto: string; error: boolean }) {
    this.db.run('INSERT INTO turnos(reunion,oficina,ronda,agente,texto,error,ts) VALUES(?,?,?,?,?,?,?)',
      [p.reunion, p.oficina, p.ronda, p.agente, p.texto, p.error ? 1 : 0, Date.now() / 1000])
  }

  turnosDe(reunion: string): TurnoReunion[] {
    try {
      return this.db.query('SELECT ronda,agente,texto,error,ts FROM turnos WHERE reunion=? ORDER BY id', [reunion])
        .map((f) => ({ ronda: num(f.ronda), agente: txt(f.agente), texto: txt(f.texto), error: num(f.error) !== 0, ts: num(f.ts) }))
    } catch {
      return []
    }
  }
}

// MARK: - textos y heurísticas (puros)

const recortarEspacios = (s: string) => s.replace(/^[\s\u0085\u2028\u2029]+|[\s\u0085\u2028\u2029]+$/g, '')
const sufijoG = (s: string, n: number) => {
  const gs = [...new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(s)]
  return gs.slice(Math.max(0, gs.length - n)).map((g) => g.segment).join('')
}
const saltos = /\r\n|[\n\r\u000b\u000c\u0085\u2028\u2029]/
export const leer = (p: string): string => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }

/** Día local `AAAA-MM-DD`. */
export function dia(f: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}`
}

export const maxMemoria = 2000
export const maxDecisiones = 15
export const maxTranscripcionTurno = 12_000
export const maxTranscripcionActa = 40_000
export const maxFicha = 2500
export const maxFichas = 8000

/** Agentes cuyo «sabe de», rol o departamento (peso 2) o brief/chips (peso 1) tienen más palabras del tema, primero; el resto detrás.
 *  Estable: a igual puntaje se respeta el orden en que vinieron. */
export function ordenar(agentes: AgenteDef[], oficina: Oficina, tema: string): AgenteDef[] {
  const vistos = new Set<string>()
  const claves: string[] = []
  for (const p of palabras(tema)) if (p.length >= 4 && !vacias.has(p) && !vistos.has(p)) { vistos.add(p); claves.push(p) }
  const puntaje = (a: AgenteDef) => {
    const fuerte = palabras(a.rol + ' ' + (oficina.departamentos.find((d) => d.id === a.departamento)?.nombre ?? '') + ' ' + (a.sabeDe ?? []).join(' '))
    const debil = palabras((a.brief ?? '') + ' ' + (a.chips ?? []).join(' '))
    let s = 0
    for (const c of claves) {
      if (fuerte.some((x) => coincide(x, c))) s += 2
      else if (debil.some((x) => coincide(x, c))) s += 1
    }
    return s
  }
  return agentes.map((a, i) => ({ i, a, p: puntaje(a) })).sort((x, y) => (x.p !== y.p ? y.p - x.p : x.i - y.i)).map((x) => x.a)
}

export function memoria(carpeta: string): string {
  const t = recortarEspacios(leer(path.join(carpeta, 'conocimiento/oficina.md')))
  if (t === '') return '(sin memoria común todavía)'
  return largo(t) > maxMemoria ? prefijo(t, maxMemoria) + '…' : t
}

/** Últimas decisiones (`- …`) de `conocimiento/decisiones.md`. */
export function decisiones(carpeta: string): string {
  const lineas = leer(path.join(carpeta, 'conocimiento/decisiones.md')).split(saltos).map((l) => l.replace(/^[ \t ]+|[ \t ]+$/g, '')).filter((l) => l.startsWith('- '))
  if (lineas.length === 0) return '(todavía no hay decisiones registradas)'
  return lineas.slice(-maxDecisiones).join('\n')
}

export function nombreDe(id: string, oficina: Oficina): string {
  if (id === 'usuario') return oficina.duenio === '' ? 'Usuario' : `${oficina.duenio} (dueño de la oficina)`
  return oficina.agentes.find((a) => a.id === id)?.nombre ?? id
}

const agenteDe = (o: Oficina, id: string) => o.agentes.find((a) => a.id === id)

/** Transcripción "Nombre: texto" con separadores de ronda; si pasa de `max` se descartan los turnos más viejos. */
export function transcripcion(turnos: TurnoReunion[], oficina: Oficina, max: number, conRol = false): string {
  const bloques: string[] = []
  let ultima = -1
  for (const t of turnos) {
    if (t.error) continue
    let b = ''
    if (t.ronda !== ultima && t.ronda > 0) { b += `— Ronda ${t.ronda} —\n`; ultima = t.ronda }
    let n = nombreDe(t.agente, oficina)
    const a = agenteDe(oficina, t.agente)
    if (conRol && a) n += ` (${a.rol})`
    b += `${n}: ${t.texto}`
    bloques.push(b)
  }
  let out = bloques.join('\n\n')
  if (largo(out) > max) out = '[…]\n' + sufijoG(out, max)
  return out
}

/** Fichas (`conocimiento/fuentes/<slug>.md`) de los documentos adjuntos al tema, recortadas. */
export function fichas(carpeta: string, documentos: string[]): string {
  const out: string[] = []
  let total = 0
  for (const slug of documentos) {
    let t = recortarEspacios(leer(path.join(carpeta, `conocimiento/fuentes/${slug}.md`)))
    if (t === '') continue
    if (largo(t) > maxFicha) t = prefijo(t, maxFicha) + '…'
    if (total + largo(t) > maxFichas) break
    total += largo(t)
    out.push(t)
  }
  return out.join('\n\n---\n\n')
}

const gente = (ps: AgenteDef[]) => ps.map((a) => `${a.nombre} (${a.rol})`).join(', ')

export function promptTurno(p: {
  oficina: Oficina; carpeta: string; tema: string; participantes: AgenteDef[]; quien: AgenteDef; turnos: TurnoReunion[]; ronda: number
  fichas?: string; patron?: PatronReunion; fase?: FaseTurno; lider?: AgenteDef; bandoA?: AgenteDef[]; bandoB?: AgenteDef[]
  /** Turnos que había cuando este agente armó su prompt anterior en la reunión. */
  leidos?: number
}): string {
  const patron = p.patron ?? 'debate'
  const dicho = transcripcion(ReunionPatron.visibles(patron, p.turnos, p.ronda), p.oficina, maxTranscripcionTurno)
  const fi = p.fichas ?? ''
  const docs = fi === '' ? '' : `\n\nDocumentos adjuntos a la reunión (fichas de la biblioteca; el texto completo está en archivos/.texto/<slug>.md):\n${fi}`
  return `Estás en una reunión de la oficina «${p.oficina.nombre}». Tema de la reunión:
${p.tema}

Participantes: ${gente(p.participantes)}

Memoria común de la oficina:
${memoria(p.carpeta)}

Decisiones recientes:
${decisiones(p.carpeta)}${docs}

Lo que se dijo hasta ahora (estamos en la ronda ${p.ronda}):
${dicho === '' ? '(todavía no habló nadie)' : dicho}
${sinResponder(p.turnos, p.quien.id, p.oficina, p.leidos)}
${ReunionPatron.consigna(patron, p.fase ?? 'libre', p.quien, p.lider, p.bandoA ?? [], p.bandoB ?? [])}`
}

/** El prompt de un turno que retoma la sesión del agente en la reunión: solo lo que se dijo desde lo que ya vio (`nuevos`),
 *  lo que escribió la persona y la consigna de esta fase. El tema, la memoria y los documentos ya están en su sesión. */
export function promptTurnoSeguido(p: {
  oficina: Oficina; tema: string; quien: AgenteDef; turnos: TurnoReunion[]; nuevos: TurnoReunion[]; ronda: number
  patron?: PatronReunion; fase?: FaseTurno; lider?: AgenteDef; bandoA?: AgenteDef[]; bandoB?: AgenteDef[]; leidos?: number
}): string {
  const patron = p.patron ?? 'debate'
  const dicho = transcripcion(p.nuevos, p.oficina, maxTranscripcionTurno)
  return `Sigue la reunión «${prefijo(p.tema, 200)}» (ronda ${p.ronda}).
${dicho === '' ? 'Desde tu último turno no habló nadie más.' : `Lo que se dijo desde tu último turno:\n${dicho}`}
${sinResponder(p.turnos, p.quien.id, p.oficina, p.leidos)}
${ReunionPatron.consigna(patron, p.fase ?? 'libre', p.quien, p.lider, p.bandoA ?? [], p.bandoB ?? [])}`
}

/** Lo que escribió el usuario después del último turno de `quien`: tiene que responderlo o incorporarlo en su turno. */
export function sinResponder(turnos: TurnoReunion[], quien: string, oficina: Oficina, leidos?: number): string {
  // `leidos`: cuántos turnos había cuando armó su último prompt (lo que llegó mientras hablaba no lo vio)
  let desde = 0
  turnos.forEach((t, i) => { if (t.agente === quien && !t.error) desde = i + 1 })
  if (leidos !== undefined) desde = Math.min(desde, leidos)
  const msgs = turnos.slice(desde).filter((t) => t.agente === 'usuario').map((t) => `«${t.texto}»`)
  if (msgs.length === 0) return ''
  const n = nombreDe('usuario', oficina)
  return `\nDesde tu último turno, ${n} escribió en la reunión:\n${msgs.join('\n')}\nRespondé o incorporá lo que dijo en tu intervención (sin dejar de lado el tema).\n`
}

export function promptSintesis(p: {
  oficina: Oficina; tema: string; participantes: AgenteDef[]; turnos: TurnoReunion[]
  patron?: PatronReunion; lider?: AgenteDef; bandoA?: AgenteDef[]; bandoB?: AgenteDef[]
  /** La reunión sigue abierta: resumen de lo dicho hasta ahora para que la persona piense qué contestar. */
  parcial?: boolean
}): string {
  if (p.parcial) return promptResumenParcial(p)
  return `Sos el secretario de actas de la oficina «${p.oficina.nombre}». Tema de la reunión: ${p.tema}
Participantes: ${gente(p.participantes)}

Transcripción:
${transcripcion(p.turnos, p.oficina, maxTranscripcionActa, true)}

Devolvé SOLO un objeto JSON estricto (sin texto antes ni después, sin bloques de código) con esta forma:
{"resumen": "resumen de la reunión en 3-6 oraciones", "decisiones": ["decisión concreta confirmada por la conversación"], "pendientes": [{"quien": "nombre de quien se encarga", "que": "tarea concreta", "necesita_usuario": false, "depende_de": []}]}
Incluí en "decisiones" solo lo que quedó razonablemente acordado (puede ser una lista vacía) y en "pendientes" los próximos pasos con responsable. En "depende_de" poné los números (empezando en 1, en el orden de la lista) de otros pendientes que tienen que estar hechos antes de poder hacer este; si no depende de ninguno, lista vacía.${PendientesReunion.consignaSecretario(p.oficina.duenio)}${ReunionPatron.varianteSintesis(p.patron ?? 'debate', p.lider, p.bandoA ?? [], p.bandoB ?? [])}`
}

function promptResumenParcial(p: {
  oficina: Oficina; tema: string; participantes: AgenteDef[]; turnos: TurnoReunion[]
  patron?: PatronReunion; lider?: AgenteDef; bandoA?: AgenteDef[]; bandoB?: AgenteDef[]
}): string {
  const n = nombreDe('usuario', p.oficina)
  return `Sos el secretario de actas de la oficina «${p.oficina.nombre}». Tema de la reunión: ${p.tema}
Participantes: ${gente(p.participantes)}

La reunión TODAVÍA NO TERMINÓ. ${n} te pide un resumen de lo dicho hasta ahora para pensar qué contestar antes de seguir.

Transcripción hasta el momento:
${transcripcion(p.turnos, p.oficina, maxTranscripcionActa, true)}

Devolvé SOLO un objeto JSON estricto (sin texto antes ni después, sin bloques de código) con esta forma:
{"resumen": "en qué está la conversación, en 3-6 oraciones: posturas de cada uno, coincidencias y diferencias", "decisiones": ["lo que ya parece acordado"], "abiertas": ["pregunta o punto abierto que espera la opinión o la decisión de ${n}"], "pendientes": [{"quien": "nombre", "que": "próximo paso propuesto", "necesita_usuario": false}]}
Sé fiel a la transcripción: no inventes acuerdos. «abiertas» es lo más importante: qué le preguntaron a ${n}, qué tiene que decidir y en qué no se ponen de acuerdo (puede ser una lista vacía).${ReunionPatron.varianteSintesis(p.patron ?? 'debate', p.lider, p.bandoA ?? [], p.bandoB ?? [])}`
}

/** Como `parsearSintesis`, más «abiertas». */
export function parsearResumenParcial(t: string): (SintesisReunion & { abiertas: string[] }) | undefined {
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  let abiertas: string[] = []
  if (a >= 0 && b > a) {
    try {
      const o = JSON.parse(t.slice(a, b + 1))
      if (esObjeto(o) && Array.isArray(o.abiertas)) abiertas = o.abiertas.map((x) => (typeof x === 'string' ? recortarEspacios(x) : '')).filter((x) => x !== '')
    } catch {}
  }
  const s = parsearSintesis(t)
  if (!s) return abiertas.length > 0 ? { resumen: '', decisiones: [], pendientes: [], abiertas } : undefined
  return { ...s, abiertas }
}

/** Extrae el objeto JSON de la respuesta (con o sin ```json) y lo normaliza. undefined si no hay forma de leerlo.
 *  `base`: de dónde cuentan los números de `depende_de` (1 en lo que escribe el secretario; 0 en la síntesis ya guardada).
 *  Las dependencias que no son enteros, caen fuera de rango, son del propio pendiente o forman un ciclo se descartan
 *  (se avisa por `descartado`, no es un error). */
export function parsearSintesis(t: string, base: 0 | 1 = 1, descartado?: (motivo: string) => void): SintesisReunion | undefined {
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a < 0 || b < 0 || a >= b) return undefined
  let o: unknown
  try { o = JSON.parse(t.slice(a, b + 1)) } catch { return undefined }
  if (!esObjeto(o)) return undefined
  const cadena = (v: unknown) => (typeof v === 'string' ? recortarEspacios(v) : '')
  const resumen = cadena(o.resumen)
  const decs = (Array.isArray(o.decisiones) ? o.decisiones : []).map(cadena).filter((x) => x !== '')
  const pend = parsearPendientes(Array.isArray(o.pendientes) ? o.pendientes : [], base, descartado)
  if (resumen === '' && decs.length === 0 && pend.length === 0) return undefined
  return { resumen, decisiones: decs, pendientes: pend }
}

/** La lista `pendientes` tal como la escribe un modelo (secretario de actas o el que ordena un chat) → Pendiente[].
 *  Cada uno trae `quien`, `que` (o `consigna`), `nombre?`, `necesita_usuario` y `depende_de`. `base`: de dónde cuentan
 *  los números de `depende_de`. Las dependencias inválidas, propias o en ciclo se descartan (se avisa por `descartado`). */
export function parsearPendientes(items: unknown[], base: 0 | 1 = 1, descartado?: (motivo: string) => void): Pendiente[] {
  const cadena = (v: unknown) => (typeof v === 'string' ? recortarEspacios(v) : '')
  const pend: Pendiente[] = []
  const crudas: unknown[][] = []   // depende_de tal como vino, por pendiente que quedó
  const nuevoIndice = new Map<number, number>()   // lugar en la lista original -> lugar entre los que quedaron
  let lugar = -1
  for (const p of items) {
    lugar++
    if (esObjeto(p)) {
      const q = cadena(p.quien)
      const k = cadena(p.que) || cadena(p.consigna)
      if (k === '') continue
      nuevoIndice.set(lugar, pend.length)
      const x: Pendiente = { quien: q, que: k, usuario: p.necesita_usuario === true || p.necesita_usuario === 1 }
      const nom = cadena(p.nombre)
      if (nom !== '') x.nombre = nom
      pend.push(x)
      crudas.push(Array.isArray(p.depende_de) ? p.depende_de : [])
    } else if (typeof p === 'string' && cadena(p) !== '') {
      nuevoIndice.set(lugar, pend.length)
      pend.push({ quien: '', que: cadena(p), usuario: false })
      crudas.push([])
    }
  }

  // dependencias: enteros (también en texto), dentro de la lista y que no sean el propio pendiente
  pend.forEach((p, i) => {
    const ok = new Set<number>()
    for (const v of crudas[i]!) {
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN
      if (!Number.isInteger(n)) { descartado?.(`pendiente ${i + 1}: «${String(v)}» no es un número de pendiente`); continue }
      const j = nuevoIndice.get(n - base)
      if (j === undefined) { descartado?.(`pendiente ${i + 1}: depende de ${n}, que no existe`); continue }
      if (j === i) { descartado?.(`pendiente ${i + 1}: depende de sí mismo`); continue }
      ok.add(j)
    }
    if (ok.size > 0) p.dependeDe = [...ok].sort((x, y) => x - y)
  })
  // ciclos: se podan (Kahn) los que no tienen dependencias sin resolver y los que nadie espera; lo que queda está en un ciclo
  const vivos = new Set(pend.map((_, i) => i))
  const deps = (i: number) => (pend[i]!.dependeDe ?? []).filter((d) => vivos.has(d))
  for (let cambio = true; cambio && vivos.size > 0;) {
    cambio = false
    for (const i of [...vivos]) {
      // sin dependencias sin resolver se puede hacer; sin nadie que lo espere no puede cerrar un ciclo
      const esperado = [...vivos].some((j) => deps(j).includes(i))
      if (deps(i).length === 0 || !esperado) { vivos.delete(i); cambio = true }
    }
  }
  for (const i of vivos) {
    descartado?.(`pendiente ${i + 1}: forma parte de un ciclo de dependencias`)
    delete pend[i]!.dependeDe
  }
  return pend
}

/** Sin punto(s) final(es) ni espacios: la plantilla agrega el suyo. */
export function sinPuntoFinal(s: string): string {
  return recortarEspacios(recortarEspacios(s).replace(/[.…]+$/, ''))
}

export function acta(p: { oficina: Oficina; tema: string; participantes: AgenteDef[]; turnos: TurnoReunion[]; sintesis?: SintesisReunion; errorSintesis?: string; fecha: Date }): string {
  const { oficina, turnos, sintesis: x } = p
  let s = `# Reunión: ${p.tema}\n\n`
  s += `- **Oficina:** ${oficina.nombre}\n- **Fecha:** ${dia(p.fecha)}\n`
  s += '- **Participantes:** ' + gente(p.participantes) + '\n\n'
  s += '## Transcripción\n\n'
  let ultima = -1
  for (const t of turnos) {
    if (t.ronda !== ultima && t.ronda > 0) { s += `### Ronda ${t.ronda}\n\n`; ultima = t.ronda }
    let n = nombreDe(t.agente, oficina)
    const a = agenteDe(oficina, t.agente)
    if (a) n += ` (${a.rol})`
    s += t.error ? `**${n}:** _(no pudo responder: ${t.texto})_\n\n` : `**${n}:** ${t.texto}\n\n`
  }
  if (turnos.length === 0) s += '_(sin intervenciones)_\n\n'
  s += '## Síntesis\n\n'
  if (x) {
    s += (x.resumen === '' ? '_(sin resumen)_' : x.resumen) + '\n\n### Decisiones\n\n'
    s += x.decisiones.length === 0 ? '_(ninguna)_\n' : x.decisiones.map((d) => `- ${d}`).join('\n') + '\n'
    s += '\n### Pendientes\n\n'
    s += x.pendientes.length === 0 ? '_(ninguno)_\n' : x.pendientes.map(lineaMD).join('\n') + '\n'
  } else {
    s += `_No se pudo generar la síntesis${p.errorSintesis !== undefined ? ': ' + sinPuntoFinal(p.errorSintesis) : ''}._\n`
  }
  return s
}

/** Consigna del encargo: el pendiente con su contexto (tema, acta) y dónde dejar lo que produzca. */
export function consignaEncargo(p: { tema: string; acta?: string; pendiente: Pendiente }): string {
  let s = `Pendiente de la reunión «${p.tema}»`
  if (p.acta !== undefined) s += ` (acta: \`${p.acta}\`)`
  s += `:\n\n${p.pendiente.que}`
  return s   // qué hacer con él va como mensaje de sistema (`Programador.sistemaPendiente`)
}

export const ReunionTexto = {
  maxMemoria, maxDecisiones, maxTranscripcionTurno, maxTranscripcionActa, maxFicha, maxFichas, vacias,
  plano, palabras, coincide, ordenar, leer, memoria, decisiones, nombreDe, transcripcion, fichas,
  promptTurno, promptSintesis, parsearSintesis, dia, sinPuntoFinal, acta, consignaEncargo,
}

// MARK: - patrones de reunión (fase 3)

export const ReunionPatron = {
  /** Orden de una ronda. `ids` ya viene en el orden de la reunión. Map-reduce devuelve el mismo orden, pero se corre en paralelo. */
  plan(patron: PatronReunion, ids: string[], lider?: string, bandos?: { a: string[]; b: string[] }): PasoTurno[] {
    const todos = (fase: FaseTurno): PasoTurno[] => ids.map((agente) => ({ agente, fase }))
    switch (patron) {
      case 'debate':
      case 'mapreduce':
        return todos('libre')
      case 'revision':
        return todos('revisa')
      case 'lider': {
        if (lider === undefined || !ids.includes(lider)) return todos('libre')
        return [{ agente: lider, fase: 'abre' }, ...ids.filter((x) => x !== lider).map((agente): PasoTurno => ({ agente, fase: 'opina' })), { agente: lider, fase: 'cierra' }]
      }
      case 'redblue': {
        if (!bandos) return todos('libre')
        const a = ids.filter((x) => bandos.a.includes(x))
        const c = ids.filter((x) => bandos.b.includes(x))
        const out: PasoTurno[] = []
        for (let i = 0; i < Math.max(a.length, c.length); i++) {
          if (i < a.length) out.push({ agente: a[i]!, fase: 'defiende' })
          if (i < c.length) out.push({ agente: c[i]!, fase: 'critica' })
        }
        return out
      }
    }
  },

  /** Map-reduce: en la ronda en curso nadie ve los turnos de la misma ronda (sí las intervenciones del usuario y las rondas anteriores). */
  visibles(patron: PatronReunion, turnos: TurnoReunion[], ronda: number): TurnoReunion[] {
    return patron === 'mapreduce' ? turnos.filter((t) => t.ronda < ronda || t.agente === 'usuario') : turnos
  },

  salidaPorDefecto(tema: string, fecha: Date): string {
    const s = Slug.de(tema)
    return `archivos/entregables/reuniones/${dia(fecha)}-${s === '' ? 'reunion' : s}.md`
  },

  /** Mensaje de error si `s` no sirve como ruta de salida; undefined si está bien. Relativa, dentro de `archivos/`, sin `..`,
   *  sin componentes ocultos (así no pisa `archivos/.texto`) y termina en `.md`. */
  errorDeSalida(s: string): string | undefined {
    const malo = '«salida» tiene que ser una ruta relativa dentro de archivos/ que termine en .md (sin «..»).'
    if (s === '' || largo(s) > 200 || s.startsWith('/') || s.startsWith('~') || s.includes('\\') || s.includes('\0')) return malo
    const comps = s.split('/')
    if (comps.length < 2 || comps[0] !== 'archivos') return malo
    if (comps.some((c) => c === '' || c.startsWith('.'))) return malo
    const archivo = comps[comps.length - 1]!
    if (!archivo.toLowerCase().endsWith('.md') || largo(archivo) <= 3) return malo
    return undefined
  },

  /** Si `rel` existe, `-2`, `-3`... antes de la extensión. */
  rutaLibre(rel: string, existe: (r: string) => boolean): string {
    if (!existe(rel)) return rel
    const base = rel.slice(0, -3)
    let n = 2
    while (existe(`${base}-${n}.md`)) n++
    return `${base}-${n}.md`
  },

  /** Último párrafo del prompt de un turno. En debate es el texto de siempre. */
  consigna(patron: PatronReunion, fase: FaseTurno, quien: AgenteDef, lider: AgenteDef | undefined, bandoA: AgenteDef[], bandoB: AgenteDef[]): string {
    const cierre = 'Respondé solo con tu intervención, en primera persona y sin encabezados.'
    const nombres = gente
    const q = `${quien.nombre}, ${quien.rol}`
    if (patron === 'lider' && fase === 'abre') {
      return `Sos ${q}, y liderás esta reunión. Abrí la ronda en 100-150 palabras: encuadrá el tema, decí qué hay que resolver y dejale al equipo dos o tres preguntas concretas. ${cierre}`
    }
    if (patron === 'lider' && fase === 'opina') {
      const l = lider ? `${lider.nombre} (${lider.rol})` : 'el líder'
      return `Sos ${q}. ${l} lidera la reunión y ya abrió la ronda. Opiná desde tu rol en 120-180 palabras, respondiendo a lo que planteó y sin repetir lo ya dicho; decí con qué estás de acuerdo y con qué no, y proponé un próximo paso concreto. ${cierre}`
    }
    if (patron === 'lider' && fase === 'cierra') {
      return `Sos ${q}, y liderás esta reunión. El equipo ya opinó en esta ronda. Cerrala con tu posición en 100-150 palabras: qué tomás de lo dicho, qué descartás y por qué, y qué queda por decidir. ${cierre}`
    }
    if (patron === 'mapreduce') {
      return `Sos ${q}. En esta ronda cada participante responde por separado y sin ver lo que dicen los demás; no asumas qué van a decir. Opiná desde tu rol en 120-180 palabras, con tu propia postura (podés apoyarte en lo dicho en rondas anteriores) y proponé un próximo paso concreto. ${cierre}`
    }
    if (patron === 'redblue' && fase === 'defiende') {
      return `Esta reunión es un debate entre dos bandos. Bando A (defiende la propuesta o postura del tema): ${nombres(bandoA)}. Bando B (la critica): ${nombres(bandoB)}. Sos ${q}, del bando A: DEFENDÉS. Argumentá a favor desde tu rol en 120-180 palabras, respondiendo a las críticas del bando B si ya hablaron y sin repetir lo ya dicho, y proponé un próximo paso concreto. ${cierre}`
    }
    if (patron === 'redblue' && fase === 'critica') {
      return `Esta reunión es un debate entre dos bandos. Bando A (defiende la propuesta o postura del tema): ${nombres(bandoA)}. Bando B (la critica): ${nombres(bandoB)}. Sos ${q}, del bando B: CRITICÁS. Señalá desde tu rol en 120-180 palabras los riesgos, huecos y objeciones de lo que defendió el bando A, sin repetir lo ya dicho, y proponé qué habría que cambiar o probar. ${cierre}`
    }
    if (patron === 'revision') {
      return `Sos ${q}. Esta reunión es un panel de revisión de los documentos adjuntos. Revisalos desde tu rol en 120-180 palabras: hallazgos (qué está bien y qué falla), riesgos y qué cambiarías, sin repetir lo que ya señalaron tus colegas. Si necesitás el texto completo, leelo en archivos/.texto/<slug>.md. ${cierre.replace('tu intervención', 'tu revisión')}`
    }
    return `Sos ${q}. Opiná desde tu rol en 120-180 palabras, sin repetir lo ya dicho; decí con qué estás de acuerdo y con qué no, y proponé un próximo paso concreto. Respondé solo con tu opinión, en primera persona y sin encabezados.`
  },

  /** Frase que se suma al prompt de la síntesis según el patrón ("" en debate). */
  varianteSintesis(patron: PatronReunion, lider: AgenteDef | undefined, bandoA: AgenteDef[], bandoB: AgenteDef[]): string {
    switch (patron) {
      case 'debate': return ''
      case 'lider':
        return `\nLa reunión la lideró ${lider ? `${lider.nombre} (${lider.rol})` : 'un líder'}, que abrió y cerró cada ronda: su posición final pesa en las decisiones.`
      case 'mapreduce':
        return '\nCada participante opinó por separado en cada ronda, sin ver a los demás: en el resumen marcá las coincidencias y las diferencias entre posturas independientes.'
      case 'redblue':
        return `\nFue un debate entre dos bandos. Bando A (defiende): ${gente(bandoA)}. Bando B (critica): ${gente(bandoB)}. El resumen tiene que ponderar los argumentos de ambos bandos con equilibrio, y las decisiones reflejar qué se adopta y qué objeciones del bando B se incorporan.`
      case 'revision':
        return '\nFue un panel de revisión de los documentos adjuntos: en «decisiones» poné los cambios recomendados (concretos y accionables) y en «resumen» los hallazgos y riesgos principales.'
    }
  },

  markdownSalida(p: { oficina: Oficina; f: ReunionFila; participantes: AgenteDef[]; sintesis?: SintesisReunion; errorSintesis?: string; acta?: string; fecha: Date }): string {
    const { oficina, f } = p
    const patron: PatronReunion = esPatron(f.patron) ? f.patron : 'debate'
    let s = `# ${f.titulo}\n\n`
    if (f.tema.trim() !== '' && f.tema.trim() !== f.titulo) s += `${f.tema.trim()}\n\n`
    s += `- **Patrón:** ${etiquetaPatron[patron]}\n- **Oficina:** ${oficina.nombre}\n- **Fecha:** ${dia(p.fecha)}\n`
    s += '- **Participantes:** ' + gente(p.participantes) + '\n'
    if (patron === 'lider' && f.lider !== undefined) s += `- **Líder:** ${nombreDe(f.lider, oficina)}\n`
    if (patron === 'redblue' && f.bandos) {
      s += '- **Bando A (defiende):** ' + (f.bandos.a ?? []).map((x) => nombreDe(x, oficina)).join(', ') + '\n'
      s += '- **Bando B (critica):** ' + (f.bandos.b ?? []).map((x) => nombreDe(x, oficina)).join(', ') + '\n'
    }
    s += '\n## Resumen\n\n'
    const x = p.sintesis
    if (x) {
      s += (x.resumen === '' ? '_(sin resumen)_' : x.resumen) + '\n\n## ' + (patron === 'revision' ? 'Cambios recomendados' : 'Decisiones') + '\n\n'
      s += x.decisiones.length === 0 ? '_(ninguna)_\n' : x.decisiones.map((d) => `- ${d}`).join('\n') + '\n'
      s += '\n## Pendientes\n\n'
      s += x.pendientes.length === 0 ? '_(ninguno)_\n' : x.pendientes.map(lineaMD).join('\n') + '\n'
    } else {
      s += `_No se pudo generar la síntesis${p.errorSintesis !== undefined ? ': ' + sinPuntoFinal(p.errorSintesis) : ''}._\n`
    }
    s += '\n---\n' + (p.acta !== undefined ? `Acta completa con la transcripción: \`${p.acta}\`.\n` : '_(el acta no se pudo guardar)_\n')
    return s
  },
}

// MARK: - pendientes de reunión

/** Pendientes de reunión que llegan a quien se encarga: al cerrar, cada pendiente asignado a un agente se anota en
 *  sus notas (`conocimiento/agentes/<id>.md`, sección «Pendientes de reuniones»), que el agente lee al empezar.
 *  Los que necesitan a la persona quedan marcados y generan un aviso «te necesita». */
export const PendientesReunion = {
  titulo: '## Pendientes de reuniones',

  normal(s: string): string { return plegar(s).replace(/^[ \t]+|[ \t]+$/g, '') },

  /** Agente responsable de un pendiente: id exacto, nombre completo o primera palabra del nombre. undefined = nadie / la persona. */
  agente(quien: string, of: Oficina): AgenteDef | undefined {
    const q = this.normal(quien)
    if (q === '') return undefined
    const exacto = of.agentes.find((a) => this.normal(a.id) === q || this.normal(a.nombre) === q)
    if (exacto) return exacto
    const primera = (t: string) => t.split(' ').filter((x) => x !== '')[0]
    const cand = of.agentes.filter((a) => primera(this.normal(a.nombre)) === (primera(q) ?? q))
    return cand.length === 1 ? cand[0] : undefined
  },

  linea(p: Pendiente, tema: string, dia: string): string {
    const que = p.que.split(saltos).filter((x) => x !== '').join(' ')
    return `- [ ] ${dia} · reunión «${tema}»: ${que}` + (p.usuario ? ' (necesita a la persona: avisale qué hace falta)' : '')
  },

  /** Anexa los pendientes a las notas de cada agente. Devuelve cuántos se anotaron por agente. */
  repartir(carpeta: string, of: Oficina, tema: string, pendientes: Pendiente[], fecha: Date): Record<string, number> {
    const d = dia(fecha)
    const porAgente = new Map<string, string[]>()
    for (const p of pendientes) {
      const a = this.agente(p.quien, of)
      if (a) porAgente.set(a.id, [...(porAgente.get(a.id) ?? []), this.linea(p, tema, d)])
    }
    const out: Record<string, number> = {}
    for (const [id, lineas] of porAgente) {
      const ruta = path.join(carpeta, `conocimiento/agentes/${id}.md`)
      let t = leer(ruta)
      if (t !== '' && !t.endsWith('\n')) t += '\n'
      if (!t.includes(this.titulo)) t += (t === '' ? '' : '\n') + this.titulo + '\n'
      // se agregan al final de la sección (que es la última o la siguiente sección empieza con «## »)
      const ini = t.indexOf(this.titulo)
      if (ini >= 0) {
        const desde = ini + this.titulo.length
        const sig = t.indexOf('\n## ', desde)
        const fin = sig >= 0 ? sig : t.length
        let bloque = t.slice(desde, fin)
        if (!bloque.endsWith('\n')) bloque += '\n'
        bloque += lineas.join('\n') + '\n'
        t = t.slice(0, desde) + bloque + t.slice(fin)
      }
      fs.mkdirSync(path.dirname(ruta), { recursive: true })
      escribirAtomico(t, ruta)
      out[id] = lineas.length
    }
    return out
  },

  /** Texto que se suma a la consigna del secretario de actas. */
  consignaSecretario(duenio: string): string {
    return `\nPara cada pendiente agregá "necesita_usuario": true si el responsable NO lo puede hacer solo. Los agentes de la oficina solo pueden leer archivos de la oficina y escribir sus notas y sus entregables: no pueden correr programas ni scripts, mandar mensajes o mails, publicar, ni mirar el calendario, el correo u otras apps. Si un pendiente necesita eso, asignalo a ${duenio === '' ? 'la persona dueña de la oficina' : duenio} (o al agente, con "necesita_usuario": true si el agente prepara algo y la persona lo ejecuta). Usá en "quien" el nombre exacto de un participante o el de la persona.`
  },

  /** Marca `- [x]` la línea del pendiente en las notas del agente. Devuelve si la encontró. */
  tildar(carpeta: string, agente: string, linea: string): boolean {
    const ruta = path.join(carpeta, `conocimiento/agentes/${agente}.md`)
    let t: string
    try { t = fs.readFileSync(ruta, 'utf8') } catch { return false }
    if (!linea.startsWith('- [ ] ')) return false
    const hecha = '- [x] ' + linea.slice(6)
    let hallada = false
    t = t.split('\n').map((l) => {
      if (!hallada && l === linea) { hallada = true; return hecha }
      return l
    }).join('\n')
    if (!hallada) return false
    escribirAtomico(t, ruta)
    return true
  },

  /** Al revisar la entrega de un encargo: tilda el pendiente que lo originó (si sigue en las notas). */
  tildarEncargo(e: Entrega, act: OficinaActiva, db: ReunionesDB) {
    if (e.origen !== 'encargo') return
    const enc = Programador.deEncargo(e.ref)
    if (!enc) return
    const [reu, n] = enc
    const f = db.una(reu, act.carpeta)
    if (!f || f.sintesis === undefined) return
    const s = parsearSintesis(f.sintesis, 0)
    if (!s || n < 0 || n >= s.pendientes.length) return
    const p = s.pendientes[n]!
    const a = this.agente(p.quien, act.oficina)
    if (!a) return
    const d = dia(new Date((f.cerrada ?? f.creada) * 1000))
    try { this.tildar(act.carpeta, a.id, this.linea(p, f.titulo, d)) } catch {}
  },
}

// MARK: - servicio

const entero = (t: string): number | undefined => (/^[+-]?\d+$/.test(t) && Number.isFinite(Number(t)) ? Number(t) : undefined)

type ResultadoTurno = { agente: string; texto: string; fallo: boolean; abortada: boolean }

/** `/api/reuniones*`. El estado de las rondas en curso (quién habla, promesas) vive acá; lo demás, en SQLite. */
export class ReunionesRouter implements SubRouter {
  static readonly maxBody = 200_000
  static readonly maxParticipantes = 20
  static readonly maxRondas = 3

  readonly db: ReunionesDB
  private readonly timeoutTurno: number
  private readonly timeoutSintesis: number
  private readonly corriendo = new Map<string, Promise<void>>()
  private readonly hablando = new Map<string, string>()
  /** Rondas que faltan después de la que está corriendo (un mensaje del usuario en la última suma una). */
  private readonly restantes = new Map<string, number>()
  /** `reunion:agente` → cuántos turnos había al armar su último prompt (para saber qué mensajes del usuario no vio). */
  private readonly leidos = new Map<string, number>()
  /** `reunion:agente` → índices de los turnos que ya se le mostraron en su sesión de claude (en memoria). */
  private readonly vistos = new Map<string, Set<number>>()
  private readonly cerrando = new Set<string>()
  private readonly resumiendo = new Set<string>()

  constructor(private readonly s: Servicios) {
    this.db = new ReunionesDB(s.store.db)
    const t = (v: string | undefined, def: number) => {
      const n = v === undefined || v === '' ? NaN : Number(v)
      return Number.isFinite(n) ? n : def
    }
    this.timeoutTurno = t(s.env.HQ_REUNION_TURNO_TIMEOUT, 180)
    this.timeoutSintesis = t(s.env.HQ_REUNION_SINTESIS_TIMEOUT, 180)
  }

  preparar() { this.db.preparar() }

  /** Espera a que terminen las rondas en curso (al cerrar, después de matar los claude). */
  async esperar() { await Promise.allSettled([...this.corriendo.values()]) }

  async handle(method: string, path: string, _query: Query, body?: Buffer) {
    const partes = path.split('/').slice(1)
    if (partes.length < 2 || partes[0] !== 'api' || partes[1] !== 'reuniones' || partes.length > 6 || partes.includes('')) return null
    return atrapar(async () => this.despachar(method, partes, body))
  }

  private async despachar(m: string, partes: string[], body?: Buffer): Promise<Resp> {
    switch (partes.length) {
      case 2:
        if (m === 'GET') return [200, this.listar()]
        if (m === 'POST') return [200, this.crear(body)]
        return no405
      case 3:
        if (!uuidValido(partes[2]!)) return no404
        return m === 'GET' ? [200, this.detalle(partes[2]!.toLowerCase())] : no405
      case 6: {
        // POST /api/reuniones/:id/pendientes/:n/encargar | hecho
        const n = entero(partes[4]!)
        if (!uuidValido(partes[2]!) || partes[3] !== 'pendientes' || n === undefined || n < 0 || (partes[5] !== 'encargar' && partes[5] !== 'hecho')) return no404
        if (m !== 'POST') return no405
        if (partes[5] === 'hecho') return [200, this.hecho(partes[2]!.toLowerCase(), n, body)]
        return [202, await this.encargar(partes[2]!.toLowerCase(), n, body)]
      }
      case 5: {
        // POST /api/reuniones/:id/pendientes/encargar-todos
        if (!uuidValido(partes[2]!) || partes[3] !== 'pendientes' || partes[4] !== 'encargar-todos') return no404
        if (m !== 'POST') return no405
        return [202, await this.encargarTodos(partes[2]!.toLowerCase())]
      }
      default: {
        if (!uuidValido(partes[2]!)) return no404
        const id = partes[2]!.toLowerCase()
        if (m !== 'POST') return no405
        switch (partes[3]) {
          case 'flujo': return [200, this.borradorFlujo(id)]
          case 'intervencion': return [200, this.intervenir(id, body)]
          case 'ronda': return [200, this.otraRonda(id)]
          case 'cerrar': return [200, await this.cerrar(id)]
          case 'resumen': return [200, await this.resumir(id)]
          default: return no404
        }
      }
    }
  }

  // MARK: utilidades

  private fila(id: string, a: OficinaActiva): ReunionFila {
    const f = this.db.una(id, a.carpeta)
    if (!f) throw new ErrorAPI(404, 'No encontré esa reunión.')
    return f
  }

  /** `vivo` y `habla` se toman ANTES de leer la fila: `correrRondas` guarda el estado final antes de soltar `corriendo`,
   *  así que quien ve «no corre» y lee después siempre ve el estado final (nunca un «en_curso» viejo). */
  private vista(f: ReunionFila, vivo: boolean, habla: string | undefined, turnos: TurnoReunion[], resumen = false): Obj {
    const estado = f.estado === 'en_curso' && !vivo ? 'esperando' : vivo ? 'en_curso' : f.estado
    const o: Obj = { id: f.id, titulo: f.titulo, tema: f.tema, agentes: f.agentes, estado, creada: iso(f.creada) }
    o.patron = f.patron
    if (f.lider !== undefined) o.lider = f.lider
    if (f.bandos) o.bandos = f.bandos
    if (f.salida !== undefined) o.salida = f.salida
    if (f.modelo !== undefined) o.modelo = f.modelo
    if (f.esfuerzo !== undefined) o.esfuerzo = f.esfuerzo
    if (f.memoria !== undefined) o.memoria = f.memoria
    if (resumen) { o.turnos = turnos.length; return o }
    o.hablando = vivo ? habla ?? null : null
    o.rondas = turnos.reduce((m, t) => Math.max(m, t.ronda), 0)
    o.turnos = turnos.map((t) => {
      const x: Obj = { ronda: t.ronda, agente: t.agente, texto: t.texto, ts: iso(t.ts) }
      if (t.error) x.error = true
      return x
    })
    if (f.sintesis !== undefined) { try { o.sintesis = JSON.parse(f.sintesis) } catch {} }
    if (f.errorSintesis !== undefined) o.errorSintesis = f.errorSintesis
    if (f.cerrada !== undefined) o.cerrada = iso(f.cerrada)
    if (f.acta !== undefined) { o.acta = f.acta; o.actaRuta = path.join(f.oficina, f.acta) }
    if (f.error !== undefined) o.error = f.error
    if (f.estado === 'cerrada' && f.salida !== undefined && fs.existsSync(path.join(f.oficina, f.salida))) o.salidaRuta = path.join(f.oficina, f.salida)
    if (f.documentos.length > 0) o.documentos = f.documentos
    if (f.estado !== 'cerrada' && f.resumenParcial !== undefined) { try { o.resumenParcial = JSON.parse(f.resumenParcial) } catch {} }
    if (this.resumiendo.has(f.id)) o.resumiendo = true
    return o
  }

  private respuesta(id: string, a: OficinaActiva): Obj {
    const vivo = this.corriendo.has(id)
    const habla = this.hablando.get(id)
    const f = this.fila(id, a)
    const o = this.vista(f, vivo, habla, this.db.turnosDe(id))
    const e = this.estadoPendientes(f, a)
    if (e) o.pendientesEstado = e
    return o
  }

  // MARK: endpoints

  private listar(): Obj {
    const a = this.s.oficinas.requerirActiva()
    const vivas = new Set(this.corriendo.keys())
    return { reuniones: this.db.de(a.carpeta).map((f) => this.vista(f, vivas.has(f.id), undefined, this.db.turnosDe(f.id), true)) }
  }

  private detalle(id: string): Obj { return this.respuesta(id, this.s.oficinas.requerirActiva()) }

  private crear(body?: Buffer): Obj {
    const a = this.s.oficinas.requerirActiva()
    const d = objeto(body, ReunionesRouter.maxBody)
    // `titulo` (corto) y `tema`/descripción (larga, opcional). Clientes viejos mandan solo `tema`: se deriva el título.
    const tituloIn = Validar.texto(d.titulo, 'título', 120, false)
    const tema = Validar.texto(d.tema, 'descripción', 1000, false) ?? ''
    if (tituloIn === undefined && tema === '') throw new ErrorAPI(400, 'Escribí un título para la reunión.')
    const titulo = tituloIn ?? prefijo(tema, 120)
    if (!Array.isArray(d.agentes) || d.agentes.length === 0) throw new ErrorAPI(400, 'Elegí al menos un agente para la reunión.')
    const ids: string[] = []
    for (const x of d.agentes) {
      if (typeof x !== 'string' || !Slug.valido(x)) throw new ErrorAPI(400, '«agentes» tiene que ser una lista de ids.')
      if (!agenteDe(a.oficina, x)) throw new ErrorAPI(400, `El agente «${x}» no está en la oficina.`)
      if (!ids.includes(x)) ids.push(x)
    }
    if (ids.length > ReunionesRouter.maxParticipantes) throw new ErrorAPI(400, `Demasiados participantes (máximo ${ReunionesRouter.maxParticipantes}).`)
    let rondas = 1
    if (d.rondas !== undefined && d.rondas !== null) {
      const n = typeof d.rondas === 'number' ? Math.trunc(d.rondas) : NaN
      if (!(n >= 1 && n <= ReunionesRouter.maxRondas)) throw new ErrorAPI(400, `«rondas» tiene que ser un número entre 1 y ${ReunionesRouter.maxRondas}.`)
      rondas = n
    }
    const documentos: string[] = []
    if (d.documentos !== undefined && d.documentos !== null) {
      if (!Array.isArray(d.documentos)) throw new ErrorAPI(400, '«documentos» tiene que ser una lista de slugs.')
      for (const x of d.documentos) {
        if (typeof x !== 'string' || !Slug.valido(x)) throw new ErrorAPI(400, '«documentos» tiene que ser una lista de slugs.')
        if (!fs.existsSync(a.ruta(`conocimiento/fuentes/${x}.md`))) throw new ErrorAPI(400, `El documento «${x}» no está en la biblioteca o todavía no tiene ficha.`)
        if (!documentos.includes(x)) documentos.push(x)
      }
      if (documentos.length > 10) throw new ErrorAPI(400, 'Máximo 10 documentos por reunión.')
    }
    let patron: PatronReunion = 'debate'
    if (d.patron !== undefined && d.patron !== null) {
      if (typeof d.patron !== 'string' || !esPatron(d.patron)) throw new ErrorAPI(400, '«patron» tiene que ser uno de: ' + patrones.join(', ') + '.')
      patron = d.patron
    }
    let lider: string | undefined
    if (patron === 'lider') {
      if (typeof d.lider !== 'string' || !ids.includes(d.lider)) throw new ErrorAPI(400, '«lider» tiene que ser uno de los participantes.')
      lider = d.lider
    }
    let bandos: Record<string, string[]> | undefined
    if (patron === 'redblue') {
      const malo = () => new ErrorAPI(400, '«bandos» tiene que repartir a todos los participantes entre «a» y «b», con al menos uno en cada bando.')
      const b = d.bandos
      if (!esObjeto(b) || !Array.isArray(b.a) || !Array.isArray(b.b)) throw malo()
      const ba = b.a.filter((x): x is string => typeof x === 'string')
      const bb = b.b.filter((x): x is string => typeof x === 'string')
      const sa = new Set(ba), sb = new Set(bb)
      if (ba.length !== b.a.length || bb.length !== b.b.length || ba.length === 0 || bb.length === 0 || sa.size !== ba.length || sb.size !== bb.length ||
        ba.some((x) => sb.has(x)) || new Set([...ba, ...bb]).size !== ids.length || ![...ba, ...bb].every((x) => ids.includes(x))) throw malo()
      bandos = { a: ba, b: bb }
    }
    if (patron === 'revision' && documentos.length === 0) throw new ErrorAPI(400, 'El panel de revisión necesita al menos un documento adjunto.')
    const creada = new Date()
    let salida = ReunionPatron.salidaPorDefecto(titulo, creada)
    if (d.salida !== undefined && d.salida !== null) {
      const t = typeof d.salida === 'string' ? d.salida.trim() : undefined
      if (t === undefined || ReunionPatron.errorDeSalida(t) !== undefined) {
        throw new ErrorAPI(400, ReunionPatron.errorDeSalida(typeof d.salida === 'string' ? d.salida : '') ?? '«salida» tiene que ser texto.')
      }
      salida = t
    }
    const eleccion = eleccionCharla(d)
    const id = randomUUID().toLowerCase()
    const ordenados = ordenar(ids.map((x) => agenteDe(a.oficina, x)!), a.oficina, temaReunion({ titulo, tema })).map((x) => x.id)
    try {
      this.db.crear({ id, oficina: a.carpeta, titulo, tema, agentes: ordenados, documentos, patron, lider, bandos, salida, modelo: eleccion.modelo, esfuerzo: eleccion.esfuerzo, memoria: eleccion.memoria })
    } catch {
      throw new ErrorAPI(500, 'No pude guardar la reunión.')
    }
    this.arrancar(id, a, rondas)
    return this.respuesta(id, a)
  }

  private intervenir(id: string, body?: Buffer): Obj {
    const a = this.s.oficinas.requerirActiva()
    const f = this.fila(id, a)
    const texto = Validar.texto(objeto(body, ReunionesRouter.maxBody).texto, 'texto', 5000)!
    if (f.estado === 'cerrada') throw new ErrorAPI(409, 'La reunión ya está cerrada.')
    const ronda = this.db.turnosDe(id).reduce((m, t) => Math.max(m, t.ronda), 0)
    try {
      this.db.turnoAgregar({ reunion: id, oficina: a.carpeta, ronda, agente: 'usuario', texto, error: false })
    } catch {
      throw new ErrorAPI(500, 'No pude guardar tu intervención.')
    }
    // Los agentes reaccionan: con rondas en curso lo incorporan los turnos que siguen; si ya es la última
    // (alguien ya habló o está hablando sin verlo) se suma una ronda más; sin rondas en curso, arranca una.
    if (this.corriendo.has(id)) {
      if ((this.restantes.get(id) ?? 0) === 0) this.restantes.set(id, 1)
    } else if (!this.cerrando.has(id)) {
      this.arrancar(id, a, 1)
    }
    return this.respuesta(id, a)
  }

  private otraRonda(id: string): Obj {
    const a = this.s.oficinas.requerirActiva()
    const f = this.fila(id, a)
    if (f.estado === 'cerrada' || this.cerrando.has(id)) throw new ErrorAPI(409, 'La reunión ya está cerrada.')
    if (this.corriendo.has(id)) throw new ErrorAPI(409, 'Todavía hay una ronda en curso.')
    this.arrancar(id, a, 1)
    return this.respuesta(id, a)
  }

  private async cerrar(id: string): Promise<Obj> {
    const a = this.s.oficinas.requerirActiva()
    const f = this.fila(id, a)
    if (f.estado === 'cerrada' || this.cerrando.has(id)) throw new ErrorAPI(409, 'La reunión ya está cerrada.')
    if (this.corriendo.has(id)) throw new ErrorAPI(409, 'Todavía hay una ronda en curso: esperá a que termine para cerrar.')
    this.cerrando.add(id)
    try {
      return await this.cerrarReunion(id, a, f)
    } finally {
      this.cerrando.delete(id)
    }
  }

  /** Resumen de lo dicho hasta ahora sin cerrar: no escribe acta ni toca decisiones, pendientes ni avisos.
   *  Se puede pedir con una ronda en curso (resume los turnos que ya están). */
  private async resumir(id: string): Promise<Obj> {
    const a = this.s.oficinas.requerirActiva()
    const f = this.fila(id, a)
    if (f.estado === 'cerrada' || this.cerrando.has(id)) throw new ErrorAPI(409, 'La reunión ya está cerrada.')
    if (this.resumiendo.has(id)) throw new ErrorAPI(409, 'Ya estoy armando un resumen de esta reunión.')
    const turnos = this.db.turnosDe(id)
    if (!turnos.some((t) => !t.error && t.agente !== 'usuario')) throw new ErrorAPI(409, 'Todavía no hay opiniones para resumir.')
    const of = a.oficina
    const parts = f.agentes.map((x) => agenteDe(of, x)).filter((x): x is AgenteDef => x !== undefined)
    const patron: PatronReunion = esPatron(f.patron) ? f.patron : 'debate'
    const { lider, bandoA, bandoB } = rolesDe(f, of)
    this.resumiendo.add(id)
    const caja = new CajaCosto()
    try {
      let t: string
      try {
        t = await this.s.runner.correrSinAgente(promptSintesis({ oficina: of, tema: temaReunion(f), participantes: parts, turnos, patron, lider, bandoA, bandoB, parcial: true }),
          { timeout: this.timeoutSintesis, cwd: a.carpeta, obs: caja.observador() })
      } catch (e) {
        throw new ErrorAPI(500, e instanceof ClaudeError ? e.mensaje : 'No pude armar el resumen.')
      } finally {
        this.s.store.registrarCosto({ oficina: a.carpeta, origen: 'sintesis', ref: id, costo: caja.valor })
      }
      const s = parsearResumenParcial(t)
      if (!s) throw new ErrorAPI(500, 'El resumen no vino en el formato esperado.')
      const r: ResumenParcial = { ...s, turnos: turnos.length, ts: Date.now() / 1000 }
      // si mientras tanto se cerró, el acta manda: no se guarda
      if (this.db.una(id, a.carpeta)?.estado !== 'cerrada') this.db.resumenParcial(id, JSON.stringify(resumenParcialJSON(r)))
    } finally {
      this.resumiendo.delete(id)
    }
    return this.respuesta(id, a)
  }

  private async cerrarReunion(id: string, a: OficinaActiva, f: ReunionFila): Promise<Obj> {
    const { store, runner, log } = this.s
    const turnos = this.db.turnosDe(id)
    const of = a.oficina
    const parts = f.agentes.map((x) => agenteDe(of, x)).filter((x): x is AgenteDef => x !== undefined)
    const patron: PatronReunion = esPatron(f.patron) ? f.patron : 'debate'
    const { lider, bandoA, bandoB } = rolesDe(f, of)
    let sintesis: SintesisReunion | undefined
    let errSint: string | undefined
    if (!turnos.some((t) => !t.error)) {
      errSint = 'No hubo opiniones para resumir.'
    } else {
      const caja = new CajaCosto()
      try {
        const t = await runner.correrSinAgente(promptSintesis({ oficina: of, tema: temaReunion(f), participantes: parts, turnos, patron, lider, bandoA, bandoB }),
          { timeout: this.timeoutSintesis, cwd: a.carpeta, obs: caja.observador() })
        const s = parsearSintesis(t, 1, (m) => log.info(`reuniones: dependencia descartada: ${m}`))
        if (s) sintesis = s
        else errSint = 'La síntesis no vino en el formato esperado.'
      } catch (e) {
        errSint = e instanceof ClaudeError ? e.mensaje : 'No pude generar la síntesis.'
      } finally {
        store.registrarCosto({ oficina: a.carpeta, origen: 'sintesis', ref: id, costo: caja.valor })
      }
    }
    const hoy = new Date()
    let errorActa: string | undefined
    let rel: string | undefined
    const textoActa = acta({ oficina: of, tema: f.titulo, participantes: parts, turnos, sintesis, errorSintesis: errSint, fecha: hoy })
    let salidaFinal: string | undefined
    try {
      rel = this.escribirActa(a, f, textoActa, hoy)
      if (sintesis && sintesis.decisiones.length > 0) anexarDecisiones(a.carpeta, sintesis.decisiones, hoy, of.nombre)
      if (sintesis && sintesis.pendientes.length > 0) {
        PendientesReunion.repartir(a.carpeta, of, f.titulo, sintesis.pendientes, hoy)
        // lo que necesita a la persona (asignado a ella o marcado) deja un aviso «te necesita»
        const paraVos = sintesis.pendientes.filter((p) => p.usuario || PendientesReunion.agente(p.quien, of) === undefined).length
        if (paraVos > 0) {
          this.s.avisos.crear({
            oficina: a.carpeta, tipo: 'pendiente', ref: id,
            texto: paraVos === 1 ? `Quedó 1 pendiente de «${f.titulo}» que necesita tu parte` : `Quedaron ${paraVos} pendientes de «${f.titulo}» que necesitan tu parte`,
          })
        }
      }
      // bitácora del día (solo en oficinas con la estructura nueva de la memoria)
      if (fs.existsSync(path.join(a.carpeta, 'conocimiento/diario'))) {
        const nd = sintesis?.decisiones.length ?? 0, np = sintesis?.pendientes.length ?? 0
        anotarEnDiario(a.carpeta, { autor: `Reunión «${f.titulo}»`, texto: `${nd} ${nd === 1 ? 'decisión' : 'decisiones'}, ${np} ${np === 1 ? 'pendiente' : 'pendientes'} (\`${rel}\`).`, fecha: hoy })
      }
    } catch (e) {
      errorActa = 'No pude guardar el acta o las decisiones en la carpeta de la oficina.'
      log.error(`reuniones: ${e instanceof Error ? e.message : e}`)
    }
    // archivo de salida: lo escribe el backend (los turnos son de solo lectura). Un fallo se informa como el del acta.
    if (f.salida !== undefined) {
      try {
        const definitiva = this.escribirSalida(a, f.salida, ReunionPatron.markdownSalida({ oficina: of, f, participantes: parts, sintesis, errorSintesis: errSint, acta: rel, fecha: hoy }))
        this.db.salida(id, definitiva)
        salidaFinal = definitiva
      } catch (e) {
        if (errorActa === undefined) errorActa = `No pude guardar el archivo de salida (${f.salida}).`
        log.error(`reuniones: salida: ${e instanceof Error ? e.message : e}`)
      }
    }
    try {
      this.db.cerrar(id, { sintesis: sintesis ? JSON.stringify(sintesisJSON(sintesis)) : undefined, errorSintesis: errSint, acta: rel, error: errorActa })
    } catch {
      throw new ErrorAPI(500, 'No pude guardar el cierre de la reunión.')
    }
    // el acta queda como entrega para revisar (sin agente: es de la reunión)
    if (rel !== undefined) {
      this.s.entregas.registrar({ oficina: a.carpeta, agente: '', nombre: '', origen: 'reunion', ref: id, titulo: `Acta: ${f.titulo}`, texto: textoActa, archivos: [rel, ...(salidaFinal !== undefined ? [salidaFinal] : [])] })
    }
    return this.respuesta(id, a)
  }

  /** `reuniones/AAAA-MM-DD-<slug-tema>.md` (si ya existe, `-2`, `-3`...). Devuelve la ruta relativa. */
  private escribirActa(a: OficinaActiva, f: ReunionFila, texto: string, fecha: Date): string {
    fs.mkdirSync(a.ruta('reuniones'), { recursive: true })
    const slug = Slug.de(f.titulo)
    const base = `${dia(fecha)}-${slug === '' ? 'reunion' : slug}`
    let rel = `reuniones/${base}.md`
    let n = 2
    while (fs.existsSync(a.ruta(rel))) { rel = `reuniones/${base}-${n}.md`; n++ }
    escribirAtomico(texto, a.ruta(rel))
    return rel
  }

  /** Escribe `rel` (ya validada, dentro de `archivos/`) creando las carpetas; si existe agrega `-2`, `-3`. Devuelve la ruta final.
   *  Se niega si un enlace simbólico sacaría el archivo de la carpeta de la oficina. */
  private escribirSalida(a: OficinaActiva, rel: string, texto: string): string {
    if (ReunionPatron.errorDeSalida(rel) !== undefined) throw new ErrorAPI(400, 'salida inválida')
    const definitiva = ReunionPatron.rutaLibre(rel, (r) => fs.existsSync(a.ruta(r)))
    const destino = a.ruta(definitiva)
    fs.mkdirSync(path.dirname(destino), { recursive: true })
    const base = fs.realpathSync(a.carpeta)
    const padre = fs.realpathSync(path.dirname(destino))
    if (!(padre === base || padre.startsWith(base.endsWith(path.sep) ? base : base + path.sep))) throw new ErrorAPI(400, 'salida fuera de la oficina')
    escribirAtomico(texto, destino)
    return definitiva
  }

  // MARK: rondas

  private arrancar(id: string, a: OficinaActiva, rondas: number) {
    try {
      this.db.estado(id, 'en_curso')
    } catch {
      throw new ErrorAPI(500, 'No pude guardar la reunión.')
    }
    this.corriendo.set(id, this.correrRondas(id, a.carpeta, rondas))
  }

  private async correrRondas(id: string, carpeta: string, cuantas: number) {
    // un instante: `corriendo` ya tiene que tener esta promesa antes de que alguien la suelte
    await Promise.resolve()
    let algunoOk = false
    let abortada = false
    let ultimoError: string | undefined
    try {
      this.restantes.set(id, cuantas)
      while ((this.restantes.get(id) ?? 0) > 0) {
        this.restantes.set(id, (this.restantes.get(id) ?? 1) - 1)
        const r = await this.correrRonda(id, carpeta)
        algunoOk = algunoOk || r.ok
        ultimoError = r.error ?? ultimoError
        if (r.abortada) { abortada = true; break }
      }
      // app cerrándose: queda como estaba y al reiniciar pasa a «esperando»
      // Estado final PRIMERO y recién después se suelta `corriendo`: así nadie ve «ya no corre» con el estado viejo.
      if (!abortada) { try { this.db.estado(id, algunoOk ? 'esperando' : 'error', algunoOk ? undefined : ultimoError) } catch {} }
    } catch (e) {
      this.s.log.error(`reuniones: ronda: ${e instanceof Error ? e.message : e}`)
      try { this.db.estado(id, 'error', 'No pude correr la ronda.') } catch {}
    } finally {
      this.corriendo.delete(id)
      this.hablando.delete(id)
      this.restantes.delete(id)
    }
  }

  private habla(id: string, agente: string | undefined) {
    if (agente === undefined) this.hablando.delete(id)
    else this.hablando.set(id, agente)
  }

  /** Una ronda: cada participante habla una vez, en el orden y con la consigna que marca el patrón de la reunión. */
  private async correrRonda(id: string, carpeta: string): Promise<{ ok: boolean; error?: string; abortada: boolean }> {
    let of: Oficina
    try { of = OficinaStore.leer(carpeta) } catch { return { ok: false, error: 'No pude leer la oficina.', abortada: false } }
    const f = this.db.una(id, carpeta)
    if (!f) return { ok: false, error: 'No encontré la reunión.', abortada: false }
    const ronda = this.db.turnosDe(id).reduce((m, t) => Math.max(m, t.ronda), 0) + 1
    const participantes = f.agentes.map((x) => agenteDe(of, x)).filter((x): x is AgenteDef => x !== undefined)
    const patron: PatronReunion = esPatron(f.patron) ? f.patron : 'debate'
    const plan = ReunionPatron.plan(patron, participantes.map((x) => x.id), f.lider, f.bandos ? { a: f.bandos.a ?? [], b: f.bandos.b ?? [] } : undefined)
    let ok = false
    let ultimo: string | undefined
    if (patron === 'mapreduce') {
      // todos a la vez; cada uno respeta su propio carril (conCarril) y no ve los turnos de esta ronda
      const pendientes = new Set(plan.map((p) => p.agente))
      this.habla(id, plan[0]?.agente)
      const resultados = await Promise.all(plan.map(async (paso) => {
        const r = await this.hacerTurno(id, carpeta, of, f, ronda, participantes, paso)
        pendientes.delete(r.agente)
        this.habla(id, plan.find((p) => pendientes.has(p.agente))?.agente)
        return r
      }))
      for (const r of resultados) {
        if (r.abortada) return { ok, error: ultimo, abortada: true }
        if (r.fallo) ultimo = r.texto
        else ok = true
      }
      return { ok, error: ultimo, abortada: false }
    }
    for (const paso of plan) {
      this.habla(id, paso.agente)
      const r = await this.hacerTurno(id, carpeta, of, f, ronda, participantes, paso)
      if (r.abortada) return { ok, error: ultimo, abortada: true }
      if (r.fallo) ultimo = r.texto
      else ok = true
    }
    return { ok, error: ultimo, abortada: false }
  }

  /** Un turno: arma el prompt, corre `turnoSoloLectura` en el carril del agente (con actividad y costo) y guarda el resultado. */
  private async hacerTurno(id: string, carpeta: string, of: Oficina, f: ReunionFila, ronda: number, participantes: AgenteDef[], paso: PasoTurno): Promise<ResultadoTurno> {
    const { runner, store, log } = this.s
    const ag = agenteDe(of, paso.agente)
    if (!ag) return { agente: paso.agente, texto: 'No encontré al agente.', fallo: true, abortada: false }
    const patron: PatronReunion = esPatron(f.patron) ? f.patron : 'debate'
    const { lider, bandoA, bandoB } = rolesDe(f, of)
    const turnos = this.db.turnosDe(id)
    const clave = `${id}:${ag.id}`
    const leidos = this.leidos.get(clave)
    // una conversación de claude por agente y reunión: el primer turno lleva todo (tema, memoria, documentos, lo dicho);
    // los siguientes retoman esa sesión y llevan solo lo que se dijo desde su último turno. Sin lo ya mostrado en memoria
    // (la app se reinició) vuelve a mandar todo, una vez.
    const completo = () => promptTurno({
      oficina: of, carpeta, tema: temaReunion(f), participantes, quien: ag, turnos, ronda, fichas: fichas(carpeta, f.documentos),
      patron, fase: paso.fase, lider, bandoA, bandoB, leidos,
    })
    const visibles = ReunionPatron.visibles(patron, turnos, ronda)
    const indice = (t: TurnoReunion) => turnos.indexOf(t)
    const yaHablo = turnos.some((t) => t.agente === ag.id)
    const vistos = this.vistos.get(clave)
    const sesion = { sid: uuidDe(`reunion:${id}:${ag.id}`), retomar: yaHablo }
    let prompt: string
    if (vistos && yaHablo) {
      const nuevos = visibles.filter((t) => !vistos.has(indice(t)) && t.agente !== ag.id)
      prompt = promptTurnoSeguido({ oficina: of, tema: f.titulo, quien: ag, turnos, nuevos, ronda, patron, fase: paso.fase, lider, bandoA, bandoB, leidos })
    } else prompt = completo()
    this.vistos.set(clave, new Set([...(vistos ?? []), ...visibles.map(indice)]))
    this.leidos.set(clave, turnos.length)
    let texto: string
    let fallo = false
    const caja = new CajaCosto()
    // la persona está mirando la reunión: lo que el agente no tiene permitido se le pregunta (como en el chat)
    const mcp = this.s.mcp?.()
    let token: string | undefined
    let preguntar: TurnoConPermiso | undefined
    let timeout = this.timeoutTurno
    try {
      const mcpUrl = mcp ? await mcp.url() : undefined
      if (mcp && mcpUrl !== undefined) {
        token = mcp.emitir({ oficina: carpeta, agente: ag.id, sid: randomUUID().toLowerCase(), perfil: 'agente', interactivo: true })
        preguntar = turnoConPermiso({ mcpUrl, token, reglas: ag.reglas })
        // la espera de la persona no tiene que comerse el turno
        timeout += mcp.permisos?.timeout ?? 240
      }
    } catch {}
    try {
      const dirs = [...dirsVinculos(of, ag), ...dirsTrabajo(of, ag)]
      texto = await runner.conCarrilDe(carpeta, ag.id, () => runner.actividad.seguir(
        { oficina: carpeta, agente: ag.id, origen: 'reunion', tarea: 'Reunión: ' + f.titulo, extra: caja.observador() },
        async (obs) => {
          const turno = (pr: string, ses: { sid: string; retomar: boolean }) => runner.turnoSoloLectura({ agente: ag.id, prompt: pr, cwd: carpeta, timeout, dirsExtra: dirs, obs,
            instrucciones: conMemoria(Instrucciones.para(of, ag, { enApp: true }), esMemoriaIA(f.memoria) ? f.memoria : this.s.config.iaEfectiva.memoria), preguntar,
            modelo: f.modelo, esfuerzo: f.esfuerzo ?? esfuerzoDe(ag), sesion: ses })
          try {
            return await turno(prompt, sesion)
          } catch (e) {
            // la sesión no estaba (su primer turno falló antes de crearla): todo de nuevo, en una sesión nueva con esa clave
            if (sesion.retomar && e instanceof ClaudeError && e.sinSesion) return turno(completo(), { sid: sesion.sid, retomar: false })
            throw e
          }
        }))
      texto = recortarEspacios(texto)
      if (texto === '') { texto = '(sin respuesta)'; fallo = true }
    } catch (e) {
      if (e instanceof ClaudeError) {
        if (e.tipo === 'cerrando') return { agente: ag.id, texto: '', fallo: true, abortada: true }
        texto = e.mensaje
        fallo = true
        log.warn(`reunion turno agente=${ag.id} tipo=${e.tipo}`)
      } else {
        texto = 'No pude responder.'
        fallo = true
      }
    } finally {
      if (token !== undefined) { mcp?.revocar(token); mcp?.cancelarPermisos?.(token) }
      store.registrarCosto({ oficina: carpeta, agente: ag.id, origen: 'reunion', ref: id, costo: caja.valor })
    }
    try { this.db.turnoAgregar({ reunion: id, oficina: carpeta, ronda, agente: ag.id, texto, error: fallo }) } catch {}
    return { agente: ag.id, texto, fallo, abortada: false }
  }

  // MARK: pendientes (PendientesAcciones.swift)

  /** Pendientes de la síntesis de una reunión cerrada (undefined si no está cerrada o no tiene). */
  static pendientes(f: ReunionFila): Pendiente[] | undefined {
    if (f.estado !== 'cerrada' || f.sintesis === undefined) return undefined
    const s = parsearSintesis(f.sintesis, 0)
    return s && s.pendientes.length > 0 ? s.pendientes : undefined
  }

  /** Estado de cada pendiente, en el orden de la síntesis: a quién le toca, si se puede encargar, el encargo (última
   *  ejecución y su entrega) y las tareas que salieron de él. */
  estadoPendientes(f: ReunionFila, a: OficinaActiva): Obj[] | undefined {
    const ps = ReunionesRouter.pendientes(f)
    if (!ps) return undefined
    const prog = programadorDe(this.s)
    const dep = dependenciasDe(this.s)
    return ps.map((p, i) => {
      const ag = PendientesReunion.agente(p.quien, a.oficina)
      const o: Obj = { pendiente: i, agente: ag ? ag.id : null, encargable: ag !== undefined && !p.usuario && prog !== undefined, dependeDe: p.dependeDe ?? [] }
      const idEnc = Programador.idEncargo(f.id, i)
      // esperando a sus dependencias (mientras alguna espera del grupo siga abierta)
      const es = dep?.abiertasDeGrupo(a.carpeta, `reunion:${f.id}:${i}`) ?? []
      if (es.length > 0) {
        o.espera = {
          estado: es.some((x) => x.estado === 'esperando') ? 'esperando' : es.some((x) => x.estado === 'lista') ? 'lista' : 'relanzada',
          esperaA: [...new Set(es.map((x) => x.esperaA))],
          esperando: es.filter((x) => x.estado === 'esperando').map((x) => Number(x.ref.split(':')[2])),
          ids: es.map((x) => x.id), desde: iso(Math.min(...es.map((x) => x.creada))),
        }
      }
      // un pendiente de la persona que ya marcó como hecho
      const hecho = this.s.entregas.porRef(a.carpeta, idEnc)
      if (hecho && hecho.origen === 'persona') o.hecho = hecho.id
      const ej = prog?.ejecuciones.ultima(a.carpeta, idEnc)
      if (ej) {
        const enc: Obj = { estado: ej.estado, ejecucion: ej.id }
        if (ej.estado === 'error') enc.error = ej.error ?? 'Falló.'
        const e = this.s.entregas.lista(a.carpeta, { origen: 'encargo', limite: 500 }).find((x) => x.ref === idEnc)
        if (e) { enc.entrega = e.id; enc.entregaEstado = e.estado }
        o.encargo = enc
      }
      o.tareas = (a.oficina.tareas ?? []).filter((t) => deReunion(t.origen)?.reunion === f.id && deReunion(t.origen)?.pendiente === i).map((t) => ({ id: t.id, nombre: t.nombre }))
      return o
    })
  }

  /** La reunión cerrada con pendientes (o 404/409), en la oficina activa. */
  private conPendientes(id: string): { a: OficinaActiva; f: ReunionFila; ps: Pendiente[] } {
    const a = this.s.oficinas.requerirActiva()
    const f = this.db.una(id, a.carpeta)
    if (!f) throw new ErrorAPI(404, 'No encontré esa reunión.')
    const ps = ReunionesRouter.pendientes(f)
    if (!ps) throw new ErrorAPI(409, 'La reunión todavía no tiene pendientes (se cierran con el acta).')
    return { a, f, ps }
  }

  private respuestaPendientes(id: string, a: OficinaActiva): Obj {
    const g = this.db.una(id, a.carpeta)
    if (!g) throw new ErrorAPI(404, 'No encontré esa reunión.')
    return { id: g.id, pendientesEstado: this.estadoPendientes(g, a) ?? [] }
  }

  /** `POST /api/reuniones/:id/flujo`: borrador (sin guardar nada) de un flujo con los pendientes como pasos, en orden
   *  topológico: cada uno recibe de las dependencias que tiene. La persona lo ajusta en el editor de flujos y lo guarda. */
  private borradorFlujo(id: string): Obj {
    const { a, f, ps } = this.conPendientes(id)
    if (!ps.some((p) => (p.dependeDe?.length ?? 0) > 0)) throw new ErrorAPI(409, 'Ningún pendiente de esta reunión depende de otro: no hay una cadena para pasar a flujo.')
    // Kahn estable por índice: siempre sale el de menor índice entre los que ya tienen todo lo que esperan
    const orden: number[] = []
    const listos = new Set<number>()
    while (orden.length < ps.length) {
      const i = ps.findIndex((p, k) => !listos.has(k) && (p.dependeDe ?? []).every((d) => listos.has(d)))
      if (i < 0) throw new ErrorAPI(409, 'Los pendientes dependen unos de otros en círculo: no se puede armar el flujo.')
      orden.push(i)
      listos.add(i)
    }
    const pasos = orden.map((i) => {
      const p = ps[i]!
      const ag = PendientesReunion.agente(p.quien, a.oficina)
      return {
        id: `p${i + 1}`, nombre: prefijo(TextoEntrega.titulo(p.que), 80), quien: p.usuario || !ag ? 'persona' : ag.id, consigna: p.que,
        // `[]` explícito: sin él, un paso raíz que queda en segundo lugar recibiría del anterior
        recibeDe: (p.dependeDe ?? []).map((d) => `p${d + 1}`), entrega: 'Lo que pide el pendiente', aprobacion: false,
      }
    })
    const usados = new Set((a.oficina.flujos ?? []).map((x) => x.id))
    const flujo = flujoDesde({ nombre: prefijo(f.titulo, 80), descripcion: prefijo(`Armado desde la reunión «${f.titulo}»`, 600), origen: `reunion:${f.id}`, pasos }, usados)
    return { borrador: flujoJSON(flujo) }
  }

  /** «Hacelo ahora»: valida el pendiente y lanza el encargo (o lo deja esperando a sus dependencias). 202 con la reunión (y
   *  su `pendientesEstado` actualizado). `{forzar: true}` arranca igual, sin esperar a las dependencias. */
  private async encargar(id: string, n: number, body?: Buffer): Promise<Obj> {
    if (!programadorDe(this.s)) throw new ErrorAPI(404, 'no')
    const { a, f, ps } = this.conPendientes(id)
    if (n >= ps.length) throw new ErrorAPI(404, 'No existe ese pendiente.')
    const forzar = objetoOpcional(body).forzar === true
    await this.encargarUno(a, f, ps, n, forzar, new Set())
    return this.respuestaPendientes(id, a)
  }

  /** Lanza el pendiente `n`, o lo deja en espera de las dependencias que todavía no entregaron (encargando en cascada las que
   *  son de un agente y todavía no corren; las de la persona quedan esperándola). */
  private async encargarUno(a: OficinaActiva, f: ReunionFila, ps: Pendiente[], n: number, forzar: boolean, visitando: Set<number>): Promise<void> {
    const prog = programadorDe(this.s)!
    const p = ps[n]!
    if (p.usuario) throw new ErrorAPI(409, 'Ese pendiente necesita tu parte: el agente no lo puede hacer solo.')
    const def = PendientesReunion.agente(p.quien, a.oficina)
    if (!def) throw new ErrorAPI(409, 'Ese pendiente no es de un agente de la oficina.')
    const consigna = consignaEncargo({ tema: f.titulo, acta: f.acta, pendiente: p })
    const nombre = TextoEntrega.titulo(p.que)
    const dep = dependenciasDe(this.s)
    const grupo = `reunion:${f.id}:${n}`
    if (dep && forzar) dep.cancelarGrupo(a.carpeta, grupo, 'Arrancó igual, sin esperar')
    else if (dep && (p.dependeDe?.length ?? 0) > 0) {
      if (dep.abiertasDeGrupo(a.carpeta, grupo).length > 0) return // ya está esperando (o rehaciéndose): nada más que hacer
      const faltan: { indice: number; quien: string; que: string; lanzar: boolean }[] = []
      for (const m of p.dependeDe!) {
        const pm = ps[m]
        if (!pm) continue
        const defM = PendientesReunion.agente(pm.quien, a.oficina)
        const persona = pm.usuario || !defM
        const quien = persona ? 'persona' : defM!.id
        const ref = Programador.idEncargo(f.id, m)
        if (dep.entregaDe(a.carpeta, ref, quien)) continue // ya está hecha
        // un encargo que corre, que ya entregó algo parcial o que está esperando lo suyo no se vuelve a lanzar
        const enCurso = prog.estaCorriendo(a.carpeta, ref) || dep.abiertasDeGrupo(a.carpeta, `reunion:${f.id}:${m}`).length > 0 || this.s.entregas.porRef(a.carpeta, ref) !== undefined
        faltan.push({ indice: m, quien, que: TextoEntrega.titulo(pm.que), lanzar: !persona && !enCurso })
      }
      if (faltan.length > 0 && !visitando.has(n)) {
        // las esperas se crean antes de lanzar nada: si una dependencia entrega enseguida, no se pierde
        dep.esperarPendientes({ act: a, reunion: f.id, pendiente: n, def, nombre, consigna, dependencias: faltan })
        try {
          for (const x of faltan.filter((y) => y.lanzar)) await this.encargarUno(a, f, ps, x.indice, false, new Set([...visitando, n]))
        } catch (e) {
          dep.cancelarGrupo(a.carpeta, grupo, 'No se pudo arrancar una de las dependencias')
          throw e
        }
        return
      }
    }
    await prog.encargar(a, def, { reunion: f.id, pendiente: n, nombre, consigna })
  }

  /** Encarga cada pendiente encargable que todavía no tiene encargo: los que no dependen de nadie arrancan y los demás quedan esperando. */
  private async encargarTodos(id: string): Promise<Obj> {
    const prog = programadorDe(this.s)
    if (!prog) throw new ErrorAPI(404, 'no')
    const { a, f, ps } = this.conPendientes(id)
    const dep = dependenciasDe(this.s)
    for (let n = 0; n < ps.length; n++) {
      const p = ps[n]!
      const def = PendientesReunion.agente(p.quien, a.oficina)
      if (p.usuario || !def) continue
      const idEnc = Programador.idEncargo(id, n)
      // sin encargo previo (ni corrida, ni entrega, ni esperas abiertas): lo que una cascada ya lanzó no se repite
      if (prog.ejecuciones.ultima(a.carpeta, idEnc) || prog.estaCorriendo(a.carpeta, idEnc) || this.s.entregas.porRef(a.carpeta, idEnc)) continue
      if (dep && dep.abiertasDeGrupo(a.carpeta, `reunion:${id}:${n}`).length > 0) continue
      try {
        await this.encargarUno(a, f, ps, n, false, new Set())
      } catch (e) {
        if (!(e instanceof ErrorAPI)) throw e
        this.s.log.info(`reuniones: encargar-todos: pendiente ${n + 1}: ${e.mensaje}`)
      }
    }
    return this.respuestaPendientes(id, a)
  }

  /** «Ya lo hice» de un pendiente de la persona: deja una entrega suya (ya revisada) con la ref del encargo, que libera a quien
   *  lo esperaba. 409 si el pendiente es de un agente y se puede encargar. */
  private hecho(id: string, n: number, body?: Buffer): Obj {
    const { a, ps } = this.conPendientes(id)
    if (n >= ps.length) throw new ErrorAPI(404, 'No existe ese pendiente.')
    const p = ps[n]!
    const def = PendientesReunion.agente(p.quien, a.oficina)
    if (def && !p.usuario) throw new ErrorAPI(409, 'Ese pendiente es de un agente: usá «Hacelo ahora».')
    const nota = Validar.texto(objetoOpcional(body).nota, 'nota', 4000, false) ?? ''
    const e = this.s.entregas.registrar({
      oficina: a.carpeta, agente: '', nombre: '', origen: 'persona', ref: Programador.idEncargo(id, n), titulo: TextoEntrega.titulo(p.que),
      texto: nota === '' ? 'Hecho.' : nota, silenciosa: true,
    })
    if (!e) throw new ErrorAPI(500, 'No pude guardar la entrega.')
    this.s.entregas.marcar(a.carpeta, e.id, 'revisada')
    // si ya no queda ningún pendiente de la persona sin hacer, se apaga el aviso «necesita tu parte» de la reunión
    const quedan = ps.some((q, i) => (q.usuario || PendientesReunion.agente(q.quien, a.oficina) === undefined)
      && this.s.entregas.porRef(a.carpeta, Programador.idEncargo(id, i))?.origen !== 'persona')
    if (!quedan) this.s.avisos.vistosPorRef(a.carpeta, 'pendiente', id)
    return this.respuestaPendientes(id, a)
  }
}

/** Líder y bandos de la reunión como agentes (los que ya no existan en la oficina se omiten). */
export function rolesDe(f: ReunionFila, of: Oficina): { lider?: AgenteDef; bandoA: AgenteDef[]; bandoB: AgenteDef[] } {
  const ag = (ids: string[] | undefined) => (ids ?? []).map((x) => agenteDe(of, x)).filter((x): x is AgenteDef => x !== undefined)
  return { lider: f.lider !== undefined ? agenteDe(of, f.lider) : undefined, bandoA: ag(f.bandos?.a), bandoB: ag(f.bandos?.b) }
}

// MARK: - módulo

export function instalar(s: Servicios) {
  const r = new ReunionesRouter(s)
  r.preparar()
  s.huecos.reuniones = r
  s.router.reuniones = r
  // revisar la entrega de un encargo tilda el pendiente que lo originó
  entregasRouterDe(s)?.alRevisar.push((e, act) => PendientesReunion.tildarEncargo(e, act, r.db))
  s.despuesDeProcesos.push(() => r.esperar())
}

registrarModulo('reuniones', 50, instalar)
