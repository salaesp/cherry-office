// Que ningún agente pueda tocar la carpeta de datos de la app (`config.datosDir`): ahí están hq.db (con los mensajes de
// WhatsApp), `whatsapp/` y `secretaria/` (la memoria privada). Las corridas de claude llevan `--allowedTools Read` sin ruta,
// así que una inyección en un mensaje podría pedirle a un agente que lea esos archivos si conoce la ruta. La defensa son
// reglas `--disallowedTools` con la ruta de datos, en TODA corrida que lance claude con herramientas de archivos. Las
// herramientas de la secretaría (`memoria_*`, WhatsApp) son MCP: no necesitan leer esa carpeta.
import fs from 'node:fs'
import path from 'node:path'

/** `Edit(//abs/path)`: la doble barra marca una ruta absoluta para Claude Code. En Windows la ruta va con `/`
 *  (`Edit(//C:/Users/…)`): cómo la interpreta Claude Code queda para el spike de Windows (plan, riesgo 2). */
export function regla(herramienta: string, ruta: string): string {
  return `${herramienta}(//${ruta.replace(/\\/g, '/').replace(/^\/+/, '')})`
}

/** Herramientas de archivos que se vedan sobre la carpeta de datos. */
export const herramientasArchivo = ['Read', 'Glob', 'Grep', 'Edit', 'Write']

let aviso: ((m: string) => void) | undefined
const avisados = new Set<string>()
/** Dónde van los avisos (el log de la app); el ClaudeRunner lo fija al crearse. */
export function fijarAvisoDatos(f: (m: string) => void) { aviso = f }

const sinCase = process.platform === 'win32' || process.platform === 'darwin'
const norm = (p: string) => { const r = path.resolve(p); return sinCase ? r.toLowerCase() : r }
/** `a` es `b` o está adentro de `b`. */
function adentro(a: string, b: string): boolean {
  const x = norm(a), y = norm(b)
  return x === y || x.startsWith(y.endsWith(path.sep) ? y : y + path.sep)
}
function real(p: string): string {
  try { return fs.realpathSync(p) } catch { return path.resolve(p) }
}

/** Rutas con las que hay que vedar la carpeta de datos: la configurada y, si es un enlace, su destino real. */
function rutasDatos(datosDir: string): string[] {
  const out = [path.resolve(datosDir)]
  const r = real(datosDir)
  if (norm(r) !== norm(out[0]!)) out.push(r)
  return out
}

/** Reglas de `--disallowedTools` que vedan leer, buscar y escribir la carpeta de datos (y `Bash` que la nombre, como
 *  mejora de mejor esfuerzo: no es una barrera, ver backend/API.md «Límites conocidos»). `carpetas` son las carpetas donde
 *  corre la corrida (la oficina): si la carpeta de datos las contiene (o es una de ellas) no se veda nada, porque se
 *  vedaría la oficina entera, y se avisa en el log. Si la oficina contiene a la de datos se veda igual esa subcarpeta. */
export function vedadasDatos(datosDir: string, carpetas: string[] = [], conBash = true): string[] {
  if (datosDir.trim() === '') return []
  const rutas = rutasDatos(datosDir)
  for (const c of carpetas) {
    if (c === '') continue
    const cs = [c, real(c)]
    if (rutas.some((d) => cs.some((x) => adentro(x, d)))) {
      const m = `Permisos: la carpeta de datos (${datosDir}) contiene a la de trabajo (${c}) o es la misma: no se veda a los agentes, porque se vedaría la oficina entera. Usá carpetas distintas.`
      if (!avisados.has(m)) { avisados.add(m); aviso?.(m) }
      return []
    }
  }
  const out: string[] = []
  for (const r of rutas) {
    for (const h of herramientasArchivo) out.push(regla(h, r + '/**'))
    if (conBash) {
      const f = r.replace(/\\/g, '/')
      out.push(`Bash(*${f}*)`)
      if (f !== r) out.push(`Bash(*${r}*)`)
    }
  }
  return out
}

/** Suma `extra` a `lista` sin repetir. */
export function sumarVedadas(lista: string[], extra: string[]): string[] {
  const out = [...lista]
  for (const v of extra) if (!out.includes(v)) out.push(v)
  return out
}
