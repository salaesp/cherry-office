// Backend de la Oficina: arma las piezas y expone el contrato que usan los transportes.
// Etapa 2 (Electron) usa `createBackend` igual que el servidor dev: sin process.exit ni estado global acá adentro.
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { Avisos } from './avisos.js'
import { ClaudePathResolver } from './claude-locator.js'
import { ClaudeRunner } from './claude-runner.js'
import { Config } from './config.js'
import { Entregas } from './entregas.js'
import { ExploradorRouter } from './explorador.js'
import { TrabajoRouter } from './trabajo.js'
import { HQLog } from './log.js'
import './modulos.js'
import { validacionesExtra } from './oficina.js'
import { Oficinas } from './oficinas.js'
import { Router, type APIHandler } from './router.js'
import { infoClaude, rutasChat } from './rutas-chat.js'
import { rutasOficinas } from './rutas-oficinas.js'
import { modulosRegistrados, type Servicios } from './servicios.js'
import { Store } from './store.js'
import type { HostWhatsApp } from './whatsapp.js'

export type OpcionesBackend = {
  config: Config
  /** Binario de claude fijo (sin búsqueda). */
  claudePath?: string
  /** Entorno para los procesos hijos y las variables HQ_*. */
  env?: NodeJS.ProcessEnv
  /** Lo que pone la carcasa para WhatsApp: dónde está la captura empaquetada y la clave del llavero (whatsapp.ts). */
  whatsapp?: HostWhatsApp
}

export interface Backend {
  readonly config: Config
  readonly log: HQLog
  readonly store: Store
  readonly oficinas: Oficinas
  readonly runner: ClaudeRunner
  readonly servicios: Servicios
  readonly router: APIHandler
  /** Avisos nuevos (`'aviso'`, {aviso, nombre}): notificaciones nativas e insignia en la etapa 2. */
  readonly avisos: EventEmitter
  /** Mata los claude en curso y cierra la base. */
  shutdown(): Promise<void>
}

export function createBackend({ config, claudePath, env = process.env, whatsapp }: OpcionesBackend): Backend {
  const log = new HQLog(config.datosDir)
  const store = new Store(path.join(config.datosDir, 'hq.db'))
  const oficinas = new Oficinas(config, log)
  oficinas.alOlvidar.push((dir) => store.olvidarOficina(dir))
  const canal = new EventEmitter()
  const resolver = new ClaudePathResolver({ fijo: claudePath, explicito: config.claudeBin, env, home: config.home })
  const runner = new ClaudeRunner(config, resolver, log, { env })
  const avisos = new Avisos(store, canal)
  const entregas = new Entregas(store, avisos)

  const s: Servicios = {
    config, store, runner, oficinas, avisos, entregas, log, env, canal,
    router: undefined as unknown as Router,
    huecos: whatsapp ? { whatsappHost: whatsapp } : {}, alAbrir: [], validaciones: [], alCerrar: [], despuesDeProcesos: [], alArrancar: [],
  }
  const router = new Router(() => s.listo?.() ?? Promise.resolve())
  ;(s as { router: Router }).router = router

  router.explorador = new ExploradorRouter(config, oficinas, log)
  router.registrarExtra(new TrabajoRouter(oficinas, log))
  router.nucleo.push(rutasOficinas({ config, oficinas, claude: infoClaude(runner), alAbrir: s.alAbrir, ocupada: (c) => runner.actividad.vista(c).size > 0 }))
  router.nucleo.push(rutasChat({
    config, store, runner, oficinas, avisos, entregas, log,
    mcp: () => s.mcp?.(), permisosTareas: () => s.permisosTareas?.(), catalogo: () => s.catalogo?.(),
    corridas: (o) => s.corridas?.(o) ?? [], creadorVersion: (o) => s.creadorVersion?.(o) ?? 0,
  }))

  for (const m of modulosRegistrados()) m.instalar(s)
  // las validaciones de los módulos aplican a toda lectura/escritura de oficina.json
  validacionesExtra.length = 0
  validacionesExtra.push(...s.validaciones)

  s.alArrancar.unshift(() => oficinas.prepararActiva())
  log.info(`arranque oficinasDir=${config.oficinasDir} claude=${runner.claudePath ?? 'no'}`)
  void (async () => {
    for (const f of s.alArrancar) {
      try {
        await f()
      } catch (e) {
        log.error(`arranque: ${e instanceof Error ? e.message : e}`)
      }
    }
  })()
  // chequeo de arranque, sin bloquear
  void runner.authStatus(30)

  let cerrado = false
  return {
    config, log, store, oficinas, runner, servicios: s, router, avisos: canal,
    async shutdown() {
      if (cerrado) return
      cerrado = true
      for (const f of s.alCerrar) await f()
      await runner.shutdown()
      for (const f of s.despuesDeProcesos) await f()
      store.close()
      log.info('shutdown')
    },
  }
}
