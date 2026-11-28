// Las conversaciones de las corridas de tareas no son charlas: no van en la lista ni se abren como «la última charla».
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { SQLiteDB } from '../../src/sqlite.js'
import { Store } from '../../src/store.js'
import { Programador } from '../../src/programador.js'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ses-tareas-')); dirs.push(d); return path.join(d, 'hq.db') }
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'

test('una sesión de tarea no aparece en la lista ni como la última charla', () => {
  const s = new Store(tmp())
  s.asegurarSesion(A, 'ana', '/of')
  s.agregar(A, 'u', 'hola')
  s.asegurarSesion(B, 'ana', '/of', true)
  s.agregar(B, 'u', 'revisá Gmail')
  expect(s.sesiones('/of').map((x) => x.sid)).toEqual([A])
  expect(s.ultimaSesion('ana', '/of')).toBe(A)
  // se sigue pudiendo abrir por su id
  expect(s.mensajes(B).map((m) => m.t)).toEqual(['revisá Gmail'])
  s.close()
})

test('la migración marca como tarea las sesiones de corridas viejas', () => {
  const ruta = tmp()
  const db = new SQLiteDB(ruta)
  db.exec(`CREATE TABLE sesiones (id TEXT PRIMARY KEY, agente TEXT NOT NULL, creada REAL NOT NULL, activa INTEGER NOT NULL DEFAULT 0, oficina TEXT NOT NULL DEFAULT '');
    CREATE TABLE mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, sid TEXT NOT NULL, rol TEXT NOT NULL, texto TEXT NOT NULL, error INTEGER NOT NULL DEFAULT 0, ts REAL NOT NULL);
    CREATE TABLE ejecuciones (id INTEGER PRIMARY KEY AUTOINCREMENT, sid TEXT NOT NULL DEFAULT '');`)
  for (const sid of [A, B]) {
    db.run('INSERT INTO sesiones(id,agente,creada,oficina) VALUES(?,?,?,?)', [sid, 'ana', 1, '/of'])
    db.run('INSERT INTO mensajes(sid,rol,texto,ts) VALUES(?,?,?,?)', [sid, 'u', 'x', 1])
  }
  db.run('INSERT INTO ejecuciones(sid) VALUES(?)', [B])
  db.close()
  const s = new Store(ruta)
  expect(s.sesiones('/of').map((x) => x.sid)).toEqual([A])
  s.close()
})

test('las delegaciones entre agentes sí son charlas; el resto de las corridas no', () => {
  expect(Programador.esCharla('delegar:12')).toBe(true)
  expect(Programador.esCharla('delegar-12')).toBe(true)
  for (const id of ['encargo:x', 'secretaria:gmail', 'flujo:3', 'coord:1', 'tarea-diaria']) expect(Programador.esCharla(id)).toBe(false)
})

test('la migración desmarca las delegaciones que habían quedado como tarea', () => {
  const ruta = tmp()
  const s0 = new Store(ruta)
  s0.asegurarSesion(A, 'ana', '/of', true)
  s0.agregar(A, 'u', 'revisá Gmail')
  s0.asegurarSesion(B, 'ana', '/of', true)
  s0.agregar(B, 'u', 'encargo de Marce')
  s0.close()
  const db = new SQLiteDB(ruta)
  db.exec("CREATE TABLE IF NOT EXISTS ejecuciones (id INTEGER PRIMARY KEY AUTOINCREMENT, tarea TEXT NOT NULL, sid TEXT NOT NULL DEFAULT '')")
  db.run('INSERT INTO ejecuciones(tarea,sid) VALUES(?,?)', ['secretaria:gmail', A])
  db.run('INSERT INTO ejecuciones(tarea,sid) VALUES(?,?)', ['delegar:7', B])
  db.run("DELETE FROM meta WHERE clave='esquema_v6'", [])
  db.close()
  const s = new Store(ruta)
  expect(s.sesiones('/of').map((x) => x.sid)).toEqual([B])
  s.close()
})
