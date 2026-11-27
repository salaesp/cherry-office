// Entregas: lo que un agente terminó y la persona tiene que revisar (Entregas.swift). Nacen «sin revisar» y pasan a
// «revisada» solo cuando la persona toca «Listo». Este archivo tiene el modelo, la tabla y el registro (lo usan chat,
// tareas y reuniones); las rutas /api/entregas* se portan en el paso 4.
import fs from 'node:fs'
import path from 'node:path'
import type { Avisos } from './avisos.js'
import type { Obj } from './json.js'
import { num, txt, type Fila, type SQLValor } from './sqlite.js'
import type { Store } from './store.js'
import { largo, prefijo } from './validar.js'

export const estadosEntrega = ['sin_revisar', 'revisada', 'cambios']

export type Entrega = {
  id: number
  oficina: string
  /** '' = sin agente (actas de reunión). */
  agente: string
  /** tarea | encargo | reunion | chat | cambios | pedido | espera | persona */
  origen: string
  ref: string
  titulo: string
  texto: string
  sid: string
  /** Rutas relativas a la carpeta de la oficina. */
  archivos: string[]
  creada: number
  estado: string
  revisada?: number
  padre?: number
  costo?: number
  /** Las notas de «Pedir cambios» con las que la persona pidió la versión siguiente (docs/plan-vista-previa.md). */
  notas?: NotaEntrega[]
  /** Retoques a mano de la persona sobre los archivos de esta entrega, del más viejo al más nuevo. */
  retoques?: Retoque[]
}

/** Dónde apunta una nota: un elemento de la página, una cita del texto o un punto de una imagen. */
export type AnclaNota = { cita?: string; selector?: string; seccion?: string; x?: number; y?: number }
export type NotaEntrega = { archivo: string; ancla?: AnclaNota; texto: string }
/** `foto`: copia del archivo antes del retoque, relativa a la oficina (en la papelera). */
export type Retoque = { archivo: string; ts: number; foto: string }

export const iso = (t: number) => new Date(t * 1000).toISOString()

export const TextoEntrega = {
  maxTexto: 100_000,
  /** Una línea para la lista: sin las marcas de markdown que se verían como texto. Los títulos terminan en «:» y las
   *  viñetas seguidas se separan con «·». */
  resumen(t: string): string {
    const partes: string[] = []
    let viniaAntes = false
    for (const crudo of t.split(/\r\n|\n/)) {
      if (crudo.trim() === '') continue
      const titulo = /^\s*#{1,6}\s+/.test(crudo)
      const vinieta = /^\s*([-*•]|\d+[.)])\s+/.test(crudo)
      let l = crudo.replace(/^\s*(#{1,6}\s+|[-*•]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)/, '').replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2').trim()
      if (l === '') continue
      if (titulo && !/[:.?!]$/.test(l)) l += ':'
      partes.push((partes.length ? (vinieta && viniaAntes ? ' · ' : ' ') : '') + l)
      viniaAntes = vinieta
    }
    const s = unaLinea(partes.join('')).replace(/\s+/g, ' ')
    return largo(s) > 280 ? prefijo(s, 279) + '…' : s
  },
  /** Título corto a partir de un pedido de chat. */
  titulo(t: string): string {
    const s = unaLinea(t)
    return largo(s) > 70 ? prefijo(s, 69) + '…' : s
  },
}

/** Líneas unidas con un espacio (sin las vacías), sin espacios en los bordes. */
function unaLinea(t: string): string {
  return t.split(/\r\n|[\n\r\u000b\u000c\u0085\u2028\u2029]/).filter((x) => x !== '').join(' ').replace(/^[ \t]+|[ \t]+$/g, '')
}

/** Fila para listas (sin el texto completo). */
export function entregaJSON(e: Entrega): Obj {
  return {
    id: e.id, agente: e.agente, origen: e.origen, ref: e.ref, titulo: e.titulo, resumen: TextoEntrega.resumen(e.texto),
    sid: e.sid, archivos: e.archivos, creada: iso(e.creada), estado: e.estado,
    revisada: e.revisada === undefined ? null : iso(e.revisada), padre: e.padre ?? null, costo: e.costo ?? null,
    notas: e.notas ?? [], retoques: (e.retoques ?? []).map((r) => ({ archivo: r.archivo, ts: iso(r.ts) })),
    // los reportes de la secretaría y las importaciones tienen formato fijo: la lista arma su tarjeta con el principio
    ...(e.origen === 'secretaria' || e.origen === 'importacion' ? { adelanto: largo(e.texto) > 3000 ? prefijo(e.texto, 3000) : e.texto } : {}),
  }
}
export const entregaJSONCompleto = (e: Entrega): Obj => ({ ...entregaJSON(e), texto: e.texto })

/** Qué archivos escritos cuentan para una entrega. */
export const ArchivosEntrega = {
  carpetaEntregables: 'archivos/entregables/',
  /** Notas internas que los agentes tocan seguido: no son trabajo para revisar. */
  ignorados: ['.claude/', 'conocimiento/agentes/'],

  /** Rutas relativas a `carpeta` (con `/`), sin repetir, de las que caen dentro de la oficina. */
  relativos(rutas: string[], carpeta: string): string[] {
    const real = (p: string) => { try { return fs.realpathSync.native(p) } catch { return p } }
    const bases = [...new Set([path.resolve(carpeta), real(carpeta)])].map((b) => (b.endsWith(path.sep) ? b : b + path.sep))
    const out: string[] = []
    for (const r of rutas) {
      const abs = path.isAbsolute(r) ? r : path.join(carpeta, r)
      const cands = [path.resolve(abs), realAunqueFalte(abs)]
      let rel: string | undefined
      for (const c of cands) {
        const b = bases.find((x) => c.startsWith(x))
        if (b) { rel = c.slice(b.length).split(path.sep).join('/'); break }
      }
      if (!rel || rel.split('/').includes('..') || this.ignorados.some((i) => rel!.startsWith(i)) || out.includes(rel)) continue
      out.push(rel)
    }
    return out
  },

  enEntregables(rels: string[]) { return rels.filter((r) => r.startsWith(this.carpetaEntregables)) },
}

function realAunqueFalte(p: string): string {
  try {
    return fs.realpathSync.native(p)
  } catch {
    const padre = path.dirname(p)
    return padre === p ? p : path.join(realAunqueFalte(padre), path.basename(p))
  }
}

// MARK: - SQLite

const columnas = 'id,oficina,agente,origen,ref,titulo,texto,sid,archivos,creada,estado,revisada,padre,costo,notas,retoques'

function deFila(f: Fila): Entrega {
  let archivos: string[] = []
  try {
    const a = JSON.parse(txt(f.archivos))
    if (Array.isArray(a)) archivos = a.filter((x): x is string => typeof x === 'string')
  } catch {}
  const e: Entrega = {
    id: num(f.id), oficina: txt(f.oficina), agente: txt(f.agente), origen: txt(f.origen), ref: txt(f.ref), titulo: txt(f.titulo),
    texto: txt(f.texto), sid: txt(f.sid), archivos, creada: num(f.creada), estado: txt(f.estado),
  }
  if (f.revisada !== null && f.revisada !== undefined) e.revisada = num(f.revisada)
  if (f.padre !== null && f.padre !== undefined) e.padre = num(f.padre)
  if (f.costo !== null && f.costo !== undefined) e.costo = num(f.costo)
  const notas = listaJSON(f.notas)
  if (notas.length) e.notas = notas as NotaEntrega[]
  const retoques = listaJSON(f.retoques)
  if (retoques.length) e.retoques = retoques as Retoque[]
  return e
}

function listaJSON(v: SQLValor | undefined): unknown[] {
  if (v === null || v === undefined) return []
  try {
    const a = JSON.parse(txt(v))
    return Array.isArray(a) ? a.filter((x) => typeof x === 'object' && x !== null) : []
  } catch {
    return []
  }
}

export type GanchoRegistro = (e: Entrega) => void

export class Entregas {
  /** Se llaman (síncronos, cada uno en try/catch) después de crear y avisar cada entrega, venga de donde venga. */
  readonly alRegistrar: GanchoRegistro[] = []

  constructor(private readonly store: Store, private readonly avisos: Avisos) {
    store.db.exec(`
    CREATE TABLE IF NOT EXISTS entregas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        oficina TEXT NOT NULL,
        agente TEXT NOT NULL DEFAULT '',
        origen TEXT NOT NULL,
        ref TEXT NOT NULL DEFAULT '',
        titulo TEXT NOT NULL,
        texto TEXT NOT NULL DEFAULT '',
        sid TEXT NOT NULL DEFAULT '',
        archivos TEXT NOT NULL DEFAULT '[]',
        creada REAL NOT NULL,
        estado TEXT NOT NULL DEFAULT 'sin_revisar',
        revisada REAL,
        padre INTEGER,
        costo REAL
    );
    CREATE INDEX IF NOT EXISTS entregas_oficina ON entregas(oficina, estado, id);
    CREATE INDEX IF NOT EXISTS entregas_ref ON entregas(oficina, ref);
    `)
    const cols = store.db.query('PRAGMA table_info(entregas)').map((f) => txt(f.name))
    for (const c of ['notas', 'retoques']) if (!cols.includes(c)) store.db.exec(`ALTER TABLE entregas ADD COLUMN ${c} TEXT`)
  }

  /** Guarda las notas con las que se pidieron cambios sobre esta entrega. */
  guardarNotas(oficina: string, id: number, notas: NotaEntrega[]): Entrega | undefined {
    this.store.db.run('UPDATE entregas SET notas=? WHERE oficina=? AND id=?', [notas.length ? JSON.stringify(notas) : null, oficina, id])
    return this.una(oficina, id)
  }

  /** Reemplaza la lista de retoques (sumar uno o deshacer el último). */
  guardarRetoques(oficina: string, id: number, retoques: Retoque[]): Entrega | undefined {
    this.store.db.run('UPDATE entregas SET retoques=? WHERE oficina=? AND id=?', [retoques.length ? JSON.stringify(retoques) : null, oficina, id])
    return this.una(oficina, id)
  }

  crear(p: { oficina: string; agente: string; origen: string; ref: string; titulo: string; texto: string; sid?: string; archivos?: string[]; padre?: number; costo?: number }): Entrega | undefined {
    const t = largo(p.texto) > TextoEntrega.maxTexto ? prefijo(p.texto, TextoEntrega.maxTexto) : p.texto
    const tit = p.titulo.trim()
    try {
      this.store.db.run('INSERT INTO entregas(oficina,agente,origen,ref,titulo,texto,sid,archivos,creada,padre,costo) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [
        p.oficina, p.agente, p.origen, p.ref, tit === '' ? 'Entrega' : tit, t, p.sid ?? '', JSON.stringify(p.archivos ?? []),
        Date.now() / 1000, p.padre ?? null, p.costo ?? null,
      ])
      const id = num(this.store.db.query('SELECT last_insert_rowid() AS id')[0]?.id)
      return this.una(p.oficina, id)
    } catch {
      return undefined
    }
  }

  una(oficina: string, id: number): Entrega | undefined {
    const f = this.store.db.query(`SELECT ${columnas} FROM entregas WHERE oficina=? AND id=?`, [oficina, id])[0]
    return f ? deFila(f) : undefined
  }

  /** De la más nueva a la más vieja. Filtros opcionales. */
  lista(oficina: string, { estado, agente, origen, limite = 100 }: { estado?: string; agente?: string; origen?: string; limite?: number } = {}): Entrega[] {
    let sql = `SELECT ${columnas} FROM entregas WHERE oficina=?`
    const p: SQLValor[] = [oficina]
    if (estado !== undefined) { sql += ' AND estado=?'; p.push(estado) }
    if (agente !== undefined) { sql += ' AND agente=?'; p.push(agente) }
    if (origen !== undefined) { sql += ' AND origen=?'; p.push(origen) }
    sql += ' ORDER BY id DESC LIMIT ?'
    p.push(Math.max(1, Math.min(limite, 500)))
    return this.store.db.query(sql, p).map(deFila)
  }

  sinRevisar(oficina: string): number {
    return num(this.store.db.query("SELECT COUNT(*) AS n FROM entregas WHERE oficina=? AND estado='sin_revisar'", [oficina])[0]?.n)
  }

  /** Cambia el estado. `revisada` guarda cuándo; volver a `sin_revisar` lo borra. */
  marcar(oficina: string, id: number, estado: string): Entrega | undefined {
    if (!estadosEntrega.includes(estado)) return undefined
    try {
      this.store.db.run('UPDATE entregas SET estado=?, revisada=? WHERE oficina=? AND id=?', [estado, estado === 'revisada' ? Date.now() / 1000 : null, oficina, id])
    } catch {}
    return this.una(oficina, id)
  }

  /** La entrega más nueva con esa ref. */
  porRef(oficina: string, ref: string): Entrega | undefined {
    const f = this.store.db.query(`SELECT ${columnas} FROM entregas WHERE oficina=? AND ref=? ORDER BY id DESC LIMIT 1`, [oficina, ref])[0]
    return f ? deFila(f) : undefined
  }

  /** Las entregas que tienen a `id` como padre (versiones nuevas), de la más vieja a la más nueva. */
  hijas(oficina: string, id: number): Entrega[] {
    return this.store.db.query(`SELECT ${columnas} FROM entregas WHERE oficina=? AND padre=? ORDER BY id`, [oficina, id]).map(deFila)
  }

  /** La primera de la cadena de versiones: sube por `padre` (hasta 10 niveles). */
  raiz(oficina: string, e: Entrega): Entrega {
    let x = e
    for (let i = 0; i < 10 && x.padre !== undefined; i++) {
      const p = this.una(oficina, x.padre)
      if (!p) break
      x = p
    }
    return x
  }

  /** La última versión de la cadena que sigue a `e` (si la persona ya pidió cambios, la más nueva de las descendientes). */
  vigente(oficina: string, e: Entrega): Entrega {
    let x = e
    for (let i = 0; i < 10; i++) {
      const h = this.hijas(oficina, x.id)
      const ultima = h[h.length - 1]
      if (!ultima) break
      x = ultima
    }
    return x
  }

  /** Crea la entrega y avisa a la app nativa («te entregó»). */
  registrar(p: { oficina: string; agente: string; nombre: string; origen: string; ref: string; titulo: string; texto: string; sid?: string; archivos?: string[]; padre?: number; costo?: number; silenciosa?: boolean }): Entrega | undefined {
    const e = this.crear(p)
    if (!e) return undefined
    if (!p.silenciosa) this.avisos.emitir({ id: `e${e.id}`, tipo: 'entrega', agente: p.agente, texto: e.titulo, ref: String(e.id), creado: e.creada }, p.nombre)
    for (const g of this.alRegistrar) {
      try { g(e) } catch {}
    }
    return e
  }
}
