// SQLite en `hq.db` (WAL), como Store.swift. Mismo esquema y mismas migraciones: la base es compartida con la app Swift.
// Este archivo tiene el esquema base (sesiones, mensajes, meta, costos); cada módulo agrega sus tablas sobre la misma
// base al portarse (avisos, consultas, entregas, ejecuciones, reuniones, …), igual que en Swift.
// node:sqlite es sincrónico y el proceso tiene un solo hilo: el acceso queda serializado como en el actor de Swift.
import fs from 'node:fs'
import path from 'node:path'
import { SQLiteDB, num, txt } from './sqlite.js'

export class Store {
  /** Otras partes del backend agregan sus tablas sobre la misma base. */
  readonly db: SQLiteDB

  constructor(ruta: string) {
    fs.mkdirSync(path.dirname(ruta), { recursive: true })
    this.db = new SQLiteDB(ruta)
    this.db.query('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA synchronous=NORMAL')
    this.db.exec('PRAGMA foreign_keys=ON')
    this.db.exec(`
    CREATE TABLE IF NOT EXISTS sesiones (
        id TEXT PRIMARY KEY,
        agente TEXT NOT NULL,
        creada REAL NOT NULL,
        activa INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS mensajes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sid TEXT NOT NULL REFERENCES sesiones(id),
        rol TEXT NOT NULL,
        texto TEXT NOT NULL,
        error INTEGER NOT NULL DEFAULT 0,
        ts REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mensajes_sid ON mensajes(sid, id);
    CREATE INDEX IF NOT EXISTS sesiones_agente ON sesiones(agente);
    CREATE TABLE IF NOT EXISTS meta (
        clave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
    );
    `)
    Store.migrarEsquema(this.db)
  }

  /** v2: `sesiones.oficina` ('' = chats anteriores a las oficinas). v3: `costos`. v4: `sesiones.ctx_usados` y
   *  `ctx_ventana` (cuánto contexto ocupa la charla, del último turno; 0 = no se sabe). v5: `sesiones.tarea` (1 = la
   *  conversación de una corrida de tarea o encargo: no es una charla y no va en la lista de charlas). */
  private static migrarEsquema(db: SQLiteDB) {
    const cols = db.query('PRAGMA table_info(sesiones)').map((f) => txt(f.name))
    if (!cols.includes('oficina')) db.exec("ALTER TABLE sesiones ADD COLUMN oficina TEXT NOT NULL DEFAULT ''")
    if (!cols.includes('ctx_usados')) db.exec('ALTER TABLE sesiones ADD COLUMN ctx_usados INTEGER NOT NULL DEFAULT 0')
    if (!cols.includes('ctx_ventana')) db.exec('ALTER TABLE sesiones ADD COLUMN ctx_ventana INTEGER NOT NULL DEFAULT 0')
    if (!cols.includes('tarea')) {
      db.exec('ALTER TABLE sesiones ADD COLUMN tarea INTEGER NOT NULL DEFAULT 0')
      // las corridas de antes: su sesión es la que guardó la ejecución (tabla del programador, en esta misma base)
      if (db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ejecuciones'").length > 0)
        db.exec("UPDATE sesiones SET tarea=1 WHERE id IN (SELECT sid FROM ejecuciones WHERE sid<>'')")
    }
    db.exec('CREATE INDEX IF NOT EXISTS sesiones_oficina ON sesiones(oficina, agente)')
    db.exec(`
    CREATE TABLE IF NOT EXISTS costos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        oficina TEXT NOT NULL,
        agente TEXT NOT NULL DEFAULT '',
        origen TEXT NOT NULL,
        ref TEXT NOT NULL DEFAULT '',
        costo REAL NOT NULL,
        ts REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS costos_oficina ON costos(oficina, ts);
    `)
  }

  // MARK: meta

  meta(clave: string): string | undefined {
    const f = this.db.query('SELECT valor FROM meta WHERE clave=?', [clave])[0]
    return f ? txt(f.valor) : undefined
  }

  fijarMeta(clave: string, valor: string) {
    this.db.run('INSERT INTO meta(clave,valor) VALUES(?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor', [clave, valor])
  }

  // MARK: olvidar una oficina

  /** Borra todo lo guardado para la carpeta `carpeta` (chats, Creador, reuniones, tareas, biblioteca, costos…): cualquier
   *  tabla con columna `oficina`, más los hijos que cuelgan por id. Se usa al crear una oficina nueva en una carpeta
   *  que pudo tener otra antes (borraron la carpeta y la recrearon con el mismo nombre): la nueva arranca de cero. */
  olvidarOficina(carpeta: string) {
    if (carpeta === '') return
    const db = this.db
    const tablas = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((f) => txt(f.name))
    const conOficina = tablas.filter((t) => {
      try {
        return db.query(`PRAGMA table_info("${t.replace(/"/g, '""')}")`).some((f) => txt(f.name) === 'oficina')
      } catch {
        return false
      }
    })
    // los hijos con clave foránea van antes que su tabla
    conOficina.sort((a, b) => Number(b === 'turnos') - Number(a === 'turnos'))
    db.transaccion(() => {
      db.run('DELETE FROM mensajes WHERE sid IN (SELECT id FROM sesiones WHERE oficina=?)', [carpeta])
      if (tablas.includes('corrida_pasos') && tablas.includes('corridas')) {
        db.run('DELETE FROM corrida_pasos WHERE corrida IN (SELECT id FROM corridas WHERE oficina=?)', [carpeta])
      }
      for (const t of conOficina) db.run(`DELETE FROM "${t.replace(/"/g, '""')}" WHERE oficina=?`, [carpeta])
    })
  }

  // MARK: costos

  /** Guarda el costo estimado de una corrida. `agente` '' = sin agente. */
  registrarCosto({ oficina, agente = '', origen, ref = '', costo }: { oficina: string; agente?: string; origen: string; ref?: string; costo?: number }) {
    if (costo === undefined || !(costo > 0) || !Number.isFinite(costo)) return
    try {
      this.db.run('INSERT INTO costos(oficina,agente,origen,ref,costo,ts) VALUES(?,?,?,?,?,?)', [oficina, agente, origen, ref, costo, Date.now() / 1000])
    } catch {}
  }

  /** Totales de una oficina desde `desde` (epoch): total, por agente, por origen y por referencia de reunión. */
  costos(oficina: string, desde = 0) {
    const p = [oficina, desde]
    const total = num(this.db.query('SELECT COALESCE(SUM(costo),0) AS t FROM costos WHERE oficina=? AND ts>=?', p)[0]?.t)
    const agrupar = (col: string, extra = '') => {
      const out: Record<string, number> = {}
      for (const f of this.db.query(`SELECT ${col} AS k, SUM(costo) AS s FROM costos WHERE oficina=? AND ts>=? ${extra} GROUP BY ${col}`, p)) {
        const k = txt(f.k)
        if (k !== '') out[k] = (out[k] ?? 0) + num(f.s)
      }
      return out
    }
    return { total, agentes: agrupar('agente'), origenes: agrupar('origen'), reuniones: agrupar('ref', "AND origen IN ('reunion','sintesis')") }
  }

  // MARK: sesiones

  agenteDe(sid: string): string | undefined {
    const f = this.db.query('SELECT agente FROM sesiones WHERE id=?', [sid])[0]
    return f ? txt(f.agente) : undefined
  }

  estaActiva(sid: string): boolean {
    return num(this.db.query('SELECT activa FROM sesiones WHERE id=?', [sid])[0]?.activa) !== 0
  }

  /** Oficina dueña de la sesión ('' = anterior a las oficinas), o undefined si no existe. */
  oficinaDe(sid: string): string | undefined {
    const f = this.db.query('SELECT oficina FROM sesiones WHERE id=?', [sid])[0]
    return f ? txt(f.oficina) : undefined
  }

  /** Crea la sesión si no existe. `tarea`: es la conversación de una corrida (no se lista como charla); si la sesión ya
   *  existía se queda como estaba. */
  asegurarSesion(sid: string, agente: string, oficina = '', tarea = false) {
    this.db.run('INSERT OR IGNORE INTO sesiones(id,agente,creada,activa,oficina,tarea) VALUES(?,?,?,0,?,?)', [sid, agente, Date.now() / 1000, oficina, tarea ? 1 : 0])
  }

  marcarActiva(sid: string) { this.db.run('UPDATE sesiones SET activa=1 WHERE id=?', [sid]) }

  /** Guarda cuánto contexto ocupa la charla tras su último turno. Sin ventana nueva, se queda la anterior. */
  fijarContexto(sid: string, u: { usados: number; ventana?: number }) {
    this.db.run('UPDATE sesiones SET ctx_usados=?, ctx_ventana=COALESCE(NULLIF(?,0),ctx_ventana) WHERE id=?', [Math.round(u.usados), Math.round(u.ventana ?? 0), sid])
  }

  /** Cuánto contexto ocupa la charla (lo del último turno), o undefined si todavía no se sabe. */
  contexto(sid: string): { usados: number; ventana?: number } | undefined {
    const f = this.db.query('SELECT ctx_usados, ctx_ventana FROM sesiones WHERE id=?', [sid])[0]
    const usados = num(f?.ctx_usados)
    if (!(usados > 0)) return undefined
    const ventana = num(f?.ctx_ventana)
    return ventana > 0 ? { usados, ventana } : { usados }
  }

  /** Charla más reciente del agente que tenga mensajes (sin las de tareas), o undefined. */
  ultimaSesion(agente: string, oficina = ''): string | undefined {
    const f = this.db.query(`
      SELECT s.id FROM sesiones s WHERE s.agente=? AND s.oficina=? AND s.tarea=0 AND EXISTS (SELECT 1 FROM mensajes m WHERE m.sid=s.id)
      ORDER BY (SELECT MAX(id) FROM mensajes m WHERE m.sid=s.id) DESC LIMIT 1`, [agente, oficina])[0]
    return f ? txt(f.id) : undefined
  }

  /** Sesiones de la oficina que tienen mensajes, la más reciente primero (por el último mensaje). Para la lista de
   *  charlas: el primer mensaje del usuario hace de título y el último de vista previa. `agente` filtra. Las conversaciones
   *  de tareas y encargos no son charlas: no van. */
  sesiones(oficina: string, agente?: string, limite = 300): ResumenSesion[] {
    const p: (string | number)[] = [oficina]
    if (agente !== undefined) p.push(agente)
    p.push(limite)
    return this.db.query(`
      SELECT s.id, s.agente,
        (SELECT texto FROM mensajes m WHERE m.sid=s.id AND m.rol='u' ORDER BY m.id LIMIT 1) AS primero,
        (SELECT texto FROM mensajes m WHERE m.sid=s.id ORDER BY m.id DESC LIMIT 1) AS ultimo,
        (SELECT rol FROM mensajes m WHERE m.sid=s.id ORDER BY m.id DESC LIMIT 1) AS rol,
        (SELECT MAX(ts) FROM mensajes m WHERE m.sid=s.id) AS ts,
        (SELECT COUNT(*) FROM mensajes m WHERE m.sid=s.id) AS n
      FROM sesiones s
      WHERE s.oficina=? AND s.tarea=0 ${agente !== undefined ? 'AND s.agente=?' : ''} AND EXISTS (SELECT 1 FROM mensajes m WHERE m.sid=s.id)
      ORDER BY ts DESC LIMIT ?`, p)
      .map((f) => ({ sid: txt(f.id), agente: txt(f.agente), primero: txt(f.primero), ultimo: txt(f.ultimo), rol: txt(f.rol), ts: num(f.ts), n: num(f.n) }))
  }

  // MARK: mensajes

  agregar(sid: string, rol: 'u' | 'a', texto: string, error = false) {
    this.db.run('INSERT INTO mensajes(sid,rol,texto,error,ts) VALUES(?,?,?,?,?)', [sid, rol, texto, error ? 1 : 0, Date.now() / 1000])
  }

  mensajes(sid: string, limite = 500): Mensaje[] {
    return this.db.query('SELECT rol,texto,error FROM (SELECT id,rol,texto,error FROM mensajes WHERE sid=? ORDER BY id DESC LIMIT ?) ORDER BY id', [sid, limite])
      .map((f) => ({ r: txt(f.rol), t: txt(f.texto), e: num(f.error) !== 0 }))
  }

  cuentaMensajes(sid: string): number {
    return num(this.db.query('SELECT COUNT(*) AS n FROM mensajes WHERE sid=?', [sid])[0]?.n)
  }

  close() { this.db.close() }
}

export type Mensaje = { r: string; t: string; e: boolean }
export type ResumenSesion = { sid: string; agente: string; primero: string; ultimo: string; rol: string; ts: number; n: number }
