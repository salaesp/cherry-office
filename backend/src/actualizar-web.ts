// Actualizar la versión web desde la propia interfaz: trae lo último de la rama del clon (normalmente main), recompila
// y reinicia, corriendo `actualizar.sh`. Es lo mismo que hacer `bash actualizar.sh` en la máquina, pero con un botón.
// La app de escritorio no lo usa (se actualiza desde las releases): solo lo registra el servidor web (dev.ts), y solo si
// el backend corre desde un clon git con `actualizar.sh`. `HQ_SIN_ACTUALIZACIONES=1` lo apaga.
//
//   GET  /api/actualizacion → versión actual, commits nuevos en el remoto, si hay cambios locales y cómo terminó la última
//   POST /api/actualizacion → arranca `actualizar.sh` (202). El script reinicia el backend, así que corre desacoplado:
//                             con systemd, en una unidad aparte (`systemd-run`); si no, en su propia sesión (setsid).
//
// La salida del script queda en `<datos>/actualizar-web.log` y su código de salida en `actualizar-web.fin`.
import { execFile, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { atrapar, no405, type Query, type RespuestaAPI, type SubRouter } from './router.js'

export type OpcionesActualizador = {
  /** Raíz del clon (donde están `.git` y `actualizar.sh`). */
  repo: string
  /** Carpeta de datos: ahí va el log de la última actualización. */
  datosDir: string
  env?: NodeJS.ProcessEnv
  /** Procesos de claude corriendo ahora (se cortan al reiniciar). */
  procesosVivos?: () => number
}

/** Pasado este tiempo sin `.fin`, una corrida se da por perdida (el script se cayó sin escribirlo). */
const maxCorrida = 15 * 60_000

/** El actualizador, o undefined si esta instalación no se puede actualizar así (sin git, sin script, Windows, apagado). */
export function crearActualizador(op: OpcionesActualizador): ActualizadorWeb | undefined {
  const env = op.env ?? process.env
  if (env.HQ_SIN_ACTUALIZACIONES === '1' || process.platform === 'win32') return undefined
  if (!fs.existsSync(path.join(op.repo, '.git')) || !fs.existsSync(path.join(op.repo, 'actualizar.sh'))) return undefined
  try {
    return new ActualizadorWeb(op)
  } catch {
    return undefined   // git no está o el clon no tiene commits
  }
}

export class ActualizadorWeb implements SubRouter {
  private readonly env: NodeJS.ProcessEnv
  private readonly log: string
  private readonly fin: string
  /** El commit con el que arrancó este proceso: el `git pull` cambia el del disco antes de reiniciar, y la página tiene que
   *  recargarse recién cuando responde el servidor nuevo. */
  private readonly arranque: string

  constructor(private readonly op: OpcionesActualizador) {
    this.env = op.env ?? process.env
    this.arranque = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: op.repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    this.log = path.join(op.datosDir, 'actualizar-web.log')
    this.fin = path.join(op.datosDir, 'actualizar-web.fin')
  }

  async handle(method: string, p: string, _query: Query, _body?: Buffer): Promise<RespuestaAPI | null> {
    if (p !== '/api/actualizacion') return null
    return atrapar(async () => {
      if (method === 'GET') return [200, await this.estado()]
      if (method === 'POST') return this.arrancar()
      return no405
    })
  }

  private git(args: string[], timeout = 10_000): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd: this.op.repo, timeout, env: { ...this.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' } },
        (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim()))
    })
  }

  /** Corriendo = hay log de una corrida reciente sin `.fin`. */
  private corriendo(): boolean {
    try {
      const st = fs.statSync(this.log)
      return !fs.existsSync(this.fin) && Date.now() - st.mtimeMs < maxCorrida
    } catch {
      return false
    }
  }

  private ultima() {
    let salida: string
    try {
      salida = fs.readFileSync(this.log, 'utf8')
    } catch {
      return null
    }
    let codigo: number | null = null
    let terminada: number | null = null
    try {
      codigo = Number(fs.readFileSync(this.fin, 'utf8').trim())
      terminada = fs.statSync(this.fin).mtimeMs
    } catch { /* todavía corre, o se cortó */ }
    const lineas = salida.trimEnd().split('\n')
    return { codigo, ok: codigo === 0, terminada, salida: lineas.slice(-40).join('\n') }
  }

  async estado() {
    const commit = this.arranque
    const [version, fecha, rama] = await Promise.all([
      this.git(['describe', '--tags', '--always', commit]),
      this.git(['log', '-1', '--format=%cI', commit]),
      this.git(['rev-parse', '--abbrev-ref', 'HEAD']),
    ])
    const locales = (await this.git(['status', '--porcelain', '--untracked-files=no'])) !== ''
    let nuevos: { commit: string; titulo: string; fecha: string }[] = []
    let error: string | null = null
    let remoto: string | null = null
    try {
      remoto = await this.git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
      const [origen, ...resto] = remoto.split('/')
      await this.git(['fetch', '--quiet', origen!, resto.join('/')], 30_000)
      const log = await this.git(['log', '--format=%h%x09%cI%x09%s', `${commit}..@{u}`])
      nuevos = log === '' ? [] : log.split('\n').map((l) => {
        const [c, f, ...t] = l.split('\t')
        return { commit: c!, fecha: f!, titulo: t.join('\t') }
      })
    } catch (e) {
      error = remoto ? `No pude buscar cambios: ${(e as Error).message}` : `La rama ${rama} no sigue a ninguna rama remota.`
    }
    return {
      actual: { commit, version, fecha, rama }, remoto, nuevos, error, cambiosLocales: locales,
      corriendo: this.corriendo(), procesosVivos: this.op.procesosVivos?.() ?? 0, ultima: this.ultima(),
    }
  }

  private arrancar(): [number, Record<string, unknown>] {
    if (this.corriendo()) return [409, { error: 'Ya se está actualizando.' }]
    fs.mkdirSync(this.op.datosDir, { recursive: true })
    fs.rmSync(this.fin, { force: true })
    fs.writeFileSync(this.log, `Actualización pedida desde la web, ${new Date().toLocaleString('es-AR')}\n`)
    const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
    const script = `bash ./actualizar.sh >> ${q(this.log)} 2>&1; echo $? > ${q(this.fin)}`
    // Con systemd, un `systemctl restart` mata todo el cgroup del servicio, script incluido: va en una unidad aparte.
    if (this.env.INVOCATION_ID && this.hay('systemd-run')) {
      const hijo = spawn('systemd-run', [
        '--user', '--collect', '--quiet', `--unit=cherry-office-actualizar-${Date.now()}`, `--working-directory=${this.op.repo}`,
        ...['PATH', 'HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'].filter((k) => this.env[k]).map((k) => `--setenv=${k}=${this.env[k]}`),
        'bash', '-c', script,
      ], { stdio: 'ignore', detached: true })
      hijo.on('error', () => fs.writeFileSync(this.fin, '127'))
      hijo.unref()
    } else {
      const hijo = spawn('bash', ['-c', script], { cwd: this.op.repo, stdio: 'ignore', detached: true, env: this.env })
      hijo.on('error', () => fs.writeFileSync(this.fin, '127'))
      hijo.unref()
    }
    return [202, { ok: true }]
  }

  private hay(bin: string): boolean {
    return (this.env.PATH ?? '').split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, bin)))
  }
}
