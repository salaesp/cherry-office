// Arnés de los tests de la API: caja negra por HTTP (nació como port del TestSupport.swift del backend Swift, ya
// retirado; por eso algunos comentarios de los tests nombran archivos .swift).
//
// Cada test arma un Sandbox (HOME, datos y oficinas en un temporal + el `claude` falso de fixtures/claude-fake.cjs)
// y levanta su propio servidor de desarrollo del backend TS apuntando a ese sandbox.
// Nunca toca ~/Próspera, ~/.claude ni los datos reales.
//
//   const b = await sb.backend(); const r = await llamar(b, 'GET', '/api/estado')
//
// - No hay acceso a internals (store, runner, Programacion…): eso va en los unit tests (test/unit).
// - `config` se pasa como el JSON de config.json (claves snake_case: timeout, agentes, escritura, herramientas…).
// - `env` son variables del proceso del servidor (HQ_MAX_CLAUDE, HQ_BIBLIOTECA_*, …).
// - El servidor dev exige Host/Origin/Content-Type: el cliente los manda siempre.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inject, onTestFinished } from 'vitest'

const aqui = path.dirname(fileURLToPath(import.meta.url))
export const raizRepo = path.resolve(aqui, '../../..')
const scriptClaude = path.resolve(aqui, '../fixtures/claude-fake.cjs')

export const agentesPorDefecto = ['betty', 'don-armando', 'marce', 'catalina', 'patricia', 'sofia', 'mario', 'nicolas']

/** UUIDs fijos y válidos para los tests. */
export const U = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  c: '33333333-3333-4333-8333-333333333333',
  d: '44444444-4444-4444-8444-444444444444',
} as const

export type Obj = Record<string, any>
export type Resp = { status: number; obj: Obj }

export type OpcionesBackend = {
  /** Deja abierta una oficina de prueba en `proyecto` con los agentes de `config.agentes` (o los 8 por defecto). */
  oficina?: boolean
  /** Contenido de config.json (se le suma `oficina_activa` si `oficina`). */
  config?: Obj
  /** Variables de entorno extra para el servidor. */
  env?: Record<string, string>
  /** Binario de claude (default: el falso del sandbox). */
  claudePath?: string
}

// MARK: - Sandbox

export class Sandbox {
  readonly root: string
  readonly home: string
  readonly proyecto: string
  readonly datos: string
  readonly bin: string
  private servidores: Backend[] = []
  private antes: (() => Promise<void>)[] = []

  get binDir() { return path.dirname(this.bin) }
  /** Carpeta donde la API crea las oficinas (en vez de ~/Oficinas). */
  get oficinasDir() { return path.join(this.root, 'oficinas') }

  constructor({ proyecto = true }: { proyecto?: boolean } = {}) {
    // realpath: en macOS el temporal vive bajo /private (igual que en los tests Swift, ver `sinPrivate`); `.native`
    // además expande los nombres cortos de Windows (C:\Users\RUNNER~1 -> C:\Users\runneradmin), como hace el backend.
    this.root = path.join(fs.realpathSync.native(os.tmpdir()), `hqtests-${randomUUID()}`)
    this.home = path.join(this.root, 'home')
    this.proyecto = path.join(this.home, 'Próspera')
    this.datos = path.join(this.root, 'datos')
    fs.mkdirSync(path.join(this.root, 'bin'), { recursive: true })
    fs.mkdirSync(this.home, { recursive: true })
    if (proyecto) fs.mkdirSync(this.proyecto, { recursive: true })
    this.bin = scriptNode(path.join(this.root, 'bin', 'claude'), fs.readFileSync(scriptClaude, 'utf8'))
    onTestFinished(() => this.cerrar())
  }

  /** Levanta un servidor contra este sandbox (equivale a `sb.backend()` de Swift). */
  async backend(op: OpcionesBackend = {}): Promise<Backend> {
    const config: Obj = { ...(op.config ?? {}) }
    if (op.oficina ?? true) {
      const ok = this.abrirOficinaDePrueba((config.agentes as string[] | undefined) ?? agentesPorDefecto)
      if (ok) config.oficina_activa = this.proyecto
    }
    fs.mkdirSync(this.datos, { recursive: true })
    const cfgPath = path.join(this.datos, 'config.json')
    if (Object.keys(config).length > 0 || !fs.existsSync(cfgPath)) {
      const previo = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {}
      fs.writeFileSync(cfgPath, JSON.stringify({ ...previo, ...config }))
    }
    const b = await Backend.arrancar(this, op)
    this.servidores.push(b)
    return b
  }

  /** Escribe `oficina.json` en `proyecto` (antes de levantar el servidor). Devuelve false si no hay proyecto. */
  abrirOficinaDePrueba(ids: string[]): boolean {
    if (!fs.existsSync(this.proyecto)) return false
    const o = {
      version: 1,
      nombre: 'Prueba',
      duenio: 'Tester',
      departamentos: [{ id: 'dir', nombre: 'Dirección', color: '#ee6da6' }],
      agentes: ids.map((id) => ({ id, nombre: capitalizar(id), rol: 'rol de prueba', departamento: 'dir' })),
    }
    fs.writeFileSync(path.join(this.proyecto, 'oficina.json'), JSON.stringify(o, null, 2))
    return true
  }

  setAuth(ok: boolean) {
    const p = path.join(this.binDir, 'noauth')
    if (ok) fs.rmSync(p, { force: true })
    else fs.writeFileSync(p, '')
  }

  /** Llamadas de chat al claude falso, cada una como lista de argumentos.
   *  En NFC: Swift (Process) en macOS pasa los argumentos en NFD y su `==` compara por equivalencia canónica; JS no. */
  get llamadas(): string[][] {
    // sin las reglas que vedan la carpeta de datos: están en todas las corridas y se prueban aparte (datos-vedados.test.ts)
    return this.llamadasCrudas.map((a) => a.filter((x) => !(/^(Read|Glob|Grep|Edit|Write|Bash)\(/.test(x) && x.includes(this.datos.replace(/\\/g, '/').replace(/^\/+/, '')))))
  }

  /** Como `llamadas`, con todos los argumentos tal cual los recibió el claude falso. */
  get llamadasCrudas(): string[][] {
    const s = leerTexto(path.join(this.binDir, 'args.log')).normalize('NFC')
    return s.split('\u001e').filter((r) => r !== '').map((rec) => {
      const a = rec.split('\u001f')
      if (a[a.length - 1] === '') a.pop()
      return a
    })
  }

  /** "S betty", "E betty", ... en orden de ocurrencia. */
  get eventos(): string[] {
    return leerTexto(path.join(this.binDir, 'events.log')).split('\n').filter((l) => l !== '' && l !== 'AUTH')
  }

  get childPid(): number | undefined {
    const n = parseInt(leerTexto(path.join(this.binDir, 'child.pid')).trim(), 10)
    return Number.isFinite(n) ? n : undefined
  }

  /** Pisa la respuesta del claude falso para `clave` (borrador|acta|ficha|imagen|turno|lectura, o `turno.<agente>`). */
  responder(clave: string, texto: string) {
    fs.writeFileSync(path.join(this.binDir, `resp.${clave}.json`), JSON.stringify({ type: 'result', result: texto, is_error: false }))
  }

  /** Cambia el modo de una clave (`error`, `vacio`, `nojson`, `lento`, `puerta`); `null` lo quita. */
  modo(clave: string, modo: string | null) {
    const p = path.join(this.binDir, `modo.${clave}`)
    if (modo) fs.writeFileSync(p, modo)
    else fs.rmSync(p, { force: true })
  }

  /** Deja pasar a todos los claude que esperan en modo `puerta` (y a los siguientes). */
  abrirPuerta() { fs.writeFileSync(path.join(this.binDir, 'go'), '') }

  /** Las llamadas que hará el claude falso cuando el mensaje lleve CREADOR_LLAMAR: `[{name, arguments}]`. */
  llamadasCreador(llamadas: Obj[]) {
    fs.writeFileSync(path.join(this.binDir, 'creador.calls'), llamadas.map((l) => JSON.stringify(l)).join('\n') + '\n')
  }

  /** Las llamadas MCP que hará `agente` cuando el mensaje lleve MCP_LLAMAR (se usan una sola vez): `[{name, arguments}]`. */
  llamadasMCP(agente: string, llamadas: Obj[]) {
    fs.writeFileSync(path.join(this.binDir, `llamadas.${agente}`), llamadas.map((l) => JSON.stringify(l)).join('\n') + '\n')
  }

  /** Respuestas JSON-RPC a las llamadas MCP de `agente` (`mcp.<agente>.out`), en orden. */
  salidasMCP(agente: string): Obj[] {
    return leerTexto(path.join(this.binDir, `mcp.${agente}.out`)).split('\n').flatMap((l) => {
      try { const o = JSON.parse(l); return o && typeof o === 'object' ? [o] : [] } catch { return [] }
    })
  }

  /** Respuestas JSON-RPC del servidor MCP a las llamadas de `llamadasCreador` (una por llamada, en orden). */
  get salidasCreador(): Obj[] {
    return leerTexto(path.join(this.binDir, 'creador.out')).split('\n').flatMap((l) => {
      try { const o = JSON.parse(l); return o && typeof o === 'object' ? [o] : [] } catch { return [] }
    })
  }

  /** Carpeta de trabajo de cada llamada, en el mismo orden que `llamadas`. */
  get cwds(): string[] { return leerTexto(path.join(this.binDir, 'cwd.log')).normalize('NFC').split('\n').filter((l) => l !== '') }

  /** Último argumento (el prompt) de cada llamada. */
  get prompts(): string[] { return this.llamadas.map((a) => a[a.length - 1] ?? '') }

  /** Llamadas cuyo prompt contiene `texto`. */
  llamadasConPrompt(texto: string): string[][] { return this.llamadas.filter((a) => (a[a.length - 1] ?? '').includes(texto)) }

  /** Valor del argumento que sigue a `flag` (o undefined). */
  static valor(args: string[], flag: string): string | undefined {
    const i = args.indexOf(flag)
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
  }

  /** Todos los valores de un flag que puede repetirse (`--add-dir`). */
  static valores(args: string[], flag: string): string[] {
    return args.flatMap((a, i) => (a === flag && i + 1 < args.length ? [args[i + 1]!] : []))
  }

  /** Reglas de `--allowedTools` (todo lo que sigue hasta el `--` final). */
  static reglas(args: string[]): string[] {
    const i = args.indexOf('--allowedTools')
    if (i < 0) return []
    const fin = args.lastIndexOf('--')
    return args.slice(i + 1, fin >= 0 ? fin : args.length)
  }

  /** Algo que hay que cerrar antes de borrar el temporal (un backend en proceso: en Windows tiene carpetas tomadas). */
  antesDeBorrar(f: () => Promise<void>) { this.antes.push(f) }

  private async cerrar() {
    await Promise.all(this.servidores.map((s) => s.cerrar()))
    for (const f of this.antes) { try { await f() } catch {} }
    const pid = this.childPid
    if (pid) { try { process.kill(pid, 'SIGKILL') } catch {} }
    // En Windows un archivo recién cerrado (o que está mirando el antivirus) puede dar EBUSY un instante: reintentar.
    try {
      fs.rmSync(this.root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    } catch (e) {
      // Windows: un claude que el servidor estaba lanzando justo cuando se lo mató se le escapa a taskkill /T
      // (todavía no colgaba del árbol) y deja tomada su carpeta de trabajo. Se mata todo lo que corre desde este
      // sandbox y se reintenta.
      if (process.platform !== 'win32' || (e as NodeJS.ErrnoException).code !== 'EBUSY') throw e
      const filtro = `$_.CommandLine -like '*${path.basename(this.root)}*'`
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process | Where-Object { ${filtro} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
      { stdio: 'ignore', windowsHide: true, timeout: 20_000 })
      fs.rmSync(this.root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 })
    }
  }
}

// MARK: - Backend (un servidor de desarrollo levantado)

export class Backend {
  private salida = ''
  private constructor(readonly sb: Sandbox, readonly puerto: number, private proc: ChildProcess) {}

  get base() { return `http://localhost:${this.puerto}` }

  /** Levanta el servidor; reintenta con otro puerto si alguien lo ganó entre `puertoLibre()` y el bind. */
  static async arrancar(sb: Sandbox, op: OpcionesBackend): Promise<Backend> {
    for (let intento = 1; ; intento++) {
      try {
        return await Backend.arrancarEn(sb, op, await puertoLibre())
      } catch (e) {
        if (intento >= 3 || !/address already in use|EADDRINUSE|no pude escuchar/i.test(String(e))) throw e
      }
    }
  }

  private static async arrancarEn(sb: Sandbox, op: OpcionesBackend, puerto: number): Promise<Backend> {
    const cmd = inject('servidor')
    const env: Record<string, string> = {
      ...entornoSistema(),
      HOME: sb.home,
      HQ_HOME: sb.home,
      HQ_DATA_DIR: sb.datos,
      HQ_OFICINAS_DIR: sb.oficinasDir,
      CLAUDE_BIN: op.claudePath ?? sb.bin,
      PORT: String(puerto),
      HQ_MEMORIA: '0',
      LANG: 'en_US.UTF-8',
      TMPDIR: os.tmpdir(),
      ...(process.env.HQ_MENSAJE_STDIN ? { HQ_MENSAJE_STDIN: process.env.HQ_MENSAJE_STDIN } : {}),
      ...(op.env ?? {}),
    }
    const proc = spawn(cmd.exe, cmd.args, { cwd: sb.root, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const b = new Backend(sb, puerto, proc)
    const guardar = (d: Buffer) => { b.salida = (b.salida + d.toString()).slice(-20_000) }
    proc.stdout!.on('data', guardar)
    proc.stderr!.on('data', guardar)
    await b.esperarListo()
    return b
  }

  /** Espera a que NUESTRO proceso escuche. Que el puerto conteste no alcanza: entre `puertoLibre()` y el bind otro
   *  test puede ganarlo, y entonces contestaría un servidor ajeno (el nuestro muere con EADDRINUSE y el test habla con
   *  otra oficina). Por eso se espera el aviso de dev.js («… en http://localhost:<puerto>») en la salida de este proceso. */
  private async esperarListo() {
    const limite = Date.now() + 20_000
    const aviso = `http://localhost:${this.puerto}`
    while (Date.now() < limite) {
      if (this.proc.exitCode !== null || this.proc.signalCode !== null) break
      if (this.salida.includes(aviso)) {
        try {
          const r = await this.pedir('GET', '/api/__listo')
          if (r.status > 0) return
        } catch {}
      }
      await dormir(50)
    }
    await this.cerrar()
    throw new Error(`El servidor no arrancó en el puerto ${this.puerto}.\n${this.salida}`)
  }

  /** Salida del servidor (stdout + stderr, últimos 20 KB): sirve para diagnosticar un test. */
  get log() { return this.salida }

  async cerrar() {
    if (this.proc.exitCode !== null || this.proc.signalCode !== null) return
    const fin = new Promise<void>((r) => this.proc.once('exit', () => r()))
    // En Windows no hay SIGTERM: kill() termina solo al servidor y sus claude quedarían huérfanos (con la carpeta
    // de la oficina tomada). taskkill /T se lleva el árbol entero.
    if (process.platform === 'win32' && this.proc.pid !== undefined) {
      spawnSync(taskkill, ['/PID', String(this.proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } else this.proc.kill('SIGTERM')
    const t = setTimeout(() => this.proc.kill('SIGKILL'), 5_000)
    await fin
    clearTimeout(t)
  }

  /** Pedido HTTP crudo. `body`: objeto (se manda como JSON), string/Buffer (tal cual) o undefined. */
  pedir(metodo: string, ruta: string, { query, body, headers }: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}): Promise<Resp & { texto: string }> {
    const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : ''
    const datos = body === undefined || body === null ? undefined
      : typeof body === 'string' || Buffer.isBuffer(body) ? Buffer.from(body as any) : Buffer.from(JSON.stringify(body))
    const h: Record<string, string> = {
      Host: `localhost:${this.puerto}`,
      Origin: this.base,
      'Content-Type': 'application/json',
      ...(datos ? { 'Content-Length': String(datos.length) } : {}),
      ...(headers ?? {}),
    }
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: this.puerto, method: metodo, path: encodeURI(ruta) + qs, headers: h, agent: false },
        (res) => {
          const partes: Buffer[] = []
          res.on('data', (c) => partes.push(c))
          res.on('end', () => {
            const texto = Buffer.concat(partes).toString('utf8')
            let obj: Obj
            try {
              const o = JSON.parse(texto)
              obj = o && typeof o === 'object' && !Array.isArray(o) ? o : { __no_json__: texto }
            } catch { obj = { __no_json__: texto } }
            resolve({ status: res.statusCode ?? 0, obj, texto })
          })
          res.on('error', reject)
        },
      )
      req.on('error', reject)
      if (datos) req.write(datos)
      req.end()
    })
  }

  get(ruta: string, query?: Record<string, string>) { return this.pedir('GET', ruta, { query }) }
  post(ruta: string, body?: unknown) { return this.pedir('POST', ruta, { body }) }
  put(ruta: string, body?: unknown) { return this.pedir('PUT', ruta, { body }) }
  patch(ruta: string, body?: unknown) { return this.pedir('PATCH', ruta, { body }) }
  delete(ruta: string, body?: unknown, query?: Record<string, string>) { return this.pedir('DELETE', ruta, { body, query }) }
}

/** Llama a la API y decodifica el JSON (equivale a `llamar` de Swift). */
export async function llamar(b: Backend, metodo: string, ruta: string, op: { query?: Record<string, string>; body?: unknown } = {}): Promise<Resp> {
  const r = await b.pedir(metodo, ruta, op)
  return { status: r.status, obj: r.obj }
}

export function chat(b: Backend, { agent = 'betty', message = 'hola', session = U.a as string } = {}) {
  return llamar(b, 'POST', '/api/chat', { body: { agent, message, session } })
}

export function historial(b: Backend, { agent = 'betty', session }: { agent?: string; session?: string } = {}) {
  const query: Record<string, string> = { agent }
  if (session) query.session = session
  return llamar(b, 'GET', '/api/historial', { query })
}

/** Respuesta como lista de `msgs`. */
export const msgs = (r: Resp): Obj[] => (Array.isArray(r.obj.msgs) ? r.obj.msgs : [])

// MARK: - Fix: una oficina creada por la API

export class Fix {
  private constructor(readonly sb: Sandbox, readonly b: Backend, readonly carpeta: string) {}

  ruta(rel: string) { return path.join(this.carpeta, rel) }
  leer(rel: string) { return leerTexto(this.ruta(rel)) }
  existe(rel: string) { return fs.existsSync(this.ruta(rel)) }
  oficinaJSON(): Obj { try { return JSON.parse(fs.readFileSync(this.ruta('oficina.json'), 'utf8')) } catch { return {} } }
  get(ruta: string, query?: Record<string, string>) { return llamar(this.b, 'GET', ruta, { query }) }
  post(ruta: string, body?: unknown) { return llamar(this.b, 'POST', ruta, { body }) }
  put(ruta: string, body?: unknown) { return llamar(this.b, 'PUT', ruta, { body }) }
  patch(ruta: string, body?: unknown) { return llamar(this.b, 'PATCH', ruta, { body }) }
  delete(ruta: string, body?: unknown, query?: Record<string, string>) { return llamar(this.b, 'DELETE', ruta, { body, query }) }

  /** Crea la oficina (activa) por la API, con departamentos por nombre y agentes `{id, depto, rol?}`. */
  static async crear({
    nombre = 'Taller', duenio = 'Ana', deps = ['Dirección', 'Redes'], agentes = [], sb, env, config,
  }: {
    nombre?: string; duenio?: string; deps?: string[]
    agentes?: { id: string; depto: string; rol?: string }[]
    sb?: Sandbox; env?: Record<string, string>; config?: Obj
  } = {}): Promise<Fix> {
    const s = sb ?? new Sandbox()
    const b = await s.backend({ oficina: false, env, config })
    const r = await llamar(b, 'POST', '/api/oficinas', { body: { nombre, duenio, departamentos: deps } })
    if (r.status !== 200) throw new Error(`crear oficina (${r.status}): ${JSON.stringify(r.obj)}\n${b.log}`)
    const f = new Fix(s, b, str(r.obj.carpeta))
    for (const a of agentes) {
      const c = await contratar(b, { id: a.id, depto: a.depto, rol: a.rol })
      if (c.status !== 200) throw new Error(`contratar ${a.id}: ${JSON.stringify(c.obj)}`)
    }
    return f
  }
}

export function contratar(b: Backend, { id, nombre, depto, rol, extra = {} }: { id: string; nombre?: string; depto: string; rol?: string; extra?: Obj }) {
  const d: Obj = { id, nombre: nombre ?? capitalizar(id), rol: rol ?? `Rol de ${id}`, prompt: `Sos ${id}.`, departamento: depto, ...extra }
  return llamar(b, 'POST', '/api/agentes', { body: d })
}

// MARK: - utilidades

/** Código del `claude` falso común (para envolverlo en otro script). */
export const codigoClaudeFalso = () => fs.readFileSync(scriptClaude, 'utf8')

/** Escribe un script de Node (CommonJS) que se puede usar como `claude`: en macOS/Linux, `ruta` ejecutable con un
 *  shebang al node actual (así lo lanzan tanto Swift como el runner TS); en Windows, `ruta.cjs` (el runner TS lanza
 *  los .cjs con node). Devuelve la ruta para CLAUDE_BIN / `claudePath`. */
export function scriptNode(ruta: string, codigo: string): string {
  fs.mkdirSync(path.dirname(ruta), { recursive: true })
  if (process.platform === 'win32') {
    fs.writeFileSync(ruta + '.cjs', codigo)
    return ruta + '.cjs'
  }
  fs.writeFileSync(ruta, `#!${process.execPath}\n${codigo}`, { mode: 0o755 })
  fs.chmodSync(ruta, 0o755)
  return ruta
}

const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')

/** Variables mínimas del sistema para el servidor: en macOS/Linux un PATH fijo; en Windows hacen falta SystemRoot
 *  (sin ella fallan los sockets y el cifrado de Node) y System32 en el PATH (taskkill, cmd). */
function entornoSistema(): Record<string, string> {
  if (process.platform !== 'win32') return { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }
  const e = process.env
  const raiz = e.SystemRoot ?? 'C:\\Windows'
  const out: Record<string, string> = { SystemRoot: raiz, PATH: [path.join(raiz, 'System32'), raiz, path.dirname(process.execPath)].join(';') }
  for (const k of ['SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) {
    if (e[k]) out[k] = e[k]!
  }
  return out
}

/** Ruta como la devuelve el backend: `base` + partes separadas por `/`, con el separador del sistema. */
export function ruta(base: string, ...partes: string[]): string {
  return path.join(base, ...partes.flatMap((p) => p.split('/')))
}

/** Regla de permiso como la arma el backend (`Edit(//abs)`; en Windows `Edit(//C:/…)`). */
export function regla(herramienta: string, p: string): string {
  return `${herramienta}(//${p.replace(/\\/g, '/').replace(/^\/+/, '')})`
}

export const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Espera hasta que `cond` se cumpla (sincrónica o asíncrona); devuelve si se cumplió. */
export async function esperar(cond: () => boolean | Promise<boolean>, segundos = 5): Promise<boolean> {
  const limite = Date.now() + segundos * 1000
  while (Date.now() < limite) {
    if (await cond()) return true
    await dormir(25)
  }
  return await cond()
}

export function vivo(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

export const sinPrivate = (p: string) => (p.startsWith('/private/') ? p.slice(8) : p)
export const leerTexto = (ruta: string) => { try { return fs.readFileSync(ruta, 'utf8') } catch { return '' } }
export const existe = (ruta: string) => fs.existsSync(ruta)
export function escribir(texto: string, ruta: string) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true })
  fs.writeFileSync(ruta, texto)
}
export const listar = (ruta: string): string[] => { try { return fs.readdirSync(ruta).sort() } catch { return [] } }
export const str = (v: unknown): string => (typeof v === 'string' ? v : '')
export const dict = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
export const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [])

/** Como `String.capitalized` de Foundation: mayúscula al inicio de cada palabra (separadas por no letras). */
export function capitalizar(s: string): string {
  return s.replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
}

function puertoLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port
      s.close(() => resolve(p))
    })
  })
}
