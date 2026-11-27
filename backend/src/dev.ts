// Servidor de desarrollo: la interfaz de la oficina en el navegador con el backend TypeScript.
//
//   cd backend && npm run dev            → http://localhost:8765
//
// Variables: PORT (8765), HQ_HOME (carpeta personal alternativa; tests), HQ_DATA_DIR, HQ_OFICINAS_DIR, CLAUDE_BIN,
// HQ_CONFIG y las demás de Config. HQ_UI_DIR apunta a otra carpeta `oficina/` (por defecto la del repo). HQ_HOSTS: nombres
// extra por los que se entra, separados por comas (p. ej. `alfred.tu-red.ts.net` detrás de `tailscale serve`, que da https y
// así el navegador deja usar el micrófono); por defecto solo localhost.
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crearActualizador } from './actualizar-web.js'
import { createBackend } from './backend.js'
import { Config } from './config.js'
import { ServidorDev } from './servidor-dev.js'

const env = process.env
// dist/src/dev.js o src/dev.ts → raíz del repo
const aqui = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(aqui, aqui.includes(`${path.sep}dist${path.sep}`) ? '../../..' : '../..')
const ui = env.HQ_UI_DIR ? path.resolve(env.HQ_UI_DIR) : path.join(repo, 'oficina')
const vendor = path.join(repo, 'oficina/vendor')
const puerto = Number(env.PORT) > 0 ? Number(env.PORT) : 8765
const home = env.HQ_HOME || os.homedir()

let backend: ReturnType<typeof createBackend>
try {
  backend = createBackend({ config: Config.load(home, env), env })
} catch (e) {
  process.stderr.write(`oficina-dev: no pude arrancar el backend: ${e}\n`)
  process.exit(1)
}

// Solo la versión web (un clon git con actualizar.sh) se actualiza desde la interfaz; la app de escritorio usa las releases.
const actualizador = crearActualizador({ repo, datosDir: backend.config.datosDir, env, procesosVivos: () => backend.runner.procesosVivos })
if (actualizador) backend.servicios.router.registrarExtra(actualizador)

const hostsExtra = (env.HQ_HOSTS ?? '').split(',').map((x) => x.trim()).filter((x) => x !== '')
const servidor = new ServidorDev({ router: backend.router, raizUI: ui, raizVendor: vendor, puerto, hostsExtra })
try {
  await servidor.arrancar()
} catch (e) {
  process.stderr.write(`oficina-dev: no pude escuchar en el puerto ${puerto}: ${e}\n`)
  await backend.shutdown()
  process.exit(1)
}
console.log(`Oficina (desarrollo) en http://localhost:${puerto}  ·  datos: ${backend.config.datosDir}  ·  Ctrl+C para salir`)

// Ctrl+C / kill: mata los claude en curso y cierra la base antes de salir.
let saliendo = false
for (const s of ['SIGINT', 'SIGTERM'] as const) {
  process.on(s, async () => {
    if (saliendo) return
    saliendo = true
    await servidor.cerrar()
    await backend.shutdown()
    process.exit(0)
  })
}
