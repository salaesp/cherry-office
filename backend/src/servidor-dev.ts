// Servidor de desarrollo (ServidorDev.swift): sirve la interfaz (`oficina/`) y `/api/*` en http://localhost:PUERTO.
// Defensas: solo escucha en 127.0.0.1, `Host` de loopback (contra DNS rebinding), `Origin` propio y
// `Content-Type: application/json` en las escrituras, estáticos en lista blanca con contención por realpath.
// Diferencia buscada con Swift: sin límite de tiempo por pedido (Swift cortaba a los 120 s y eso mataba chats largos).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { codificar } from './json.js'
import type { APIHandler, Query } from './router.js'

/** La biblioteca sube archivos en base64 dentro del JSON (25 MB → ~34 MB). */
export const maxCuerpo = 40 * 1024 * 1024
const estaticos = new Set(['index.html', 'logo-prospera.svg'])
const comunes = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

export type OpcionesServidor = {
  router: APIHandler
  /** La carpeta `oficina/` (index.html, ui/). */
  raizUI: string
  /** `oficina/vendor` (fuentes). */
  raizVendor: string
  puerto: number
  /** Nombres extra por los que se entra (HQ_HOSTS), p. ej. `alfred.tu-red.ts.net` detrás de `tailscale serve`: se
   *  aceptan como `Host` (con y sin el puerto) y como `Origin` por http y https. Por defecto, solo localhost. */
  hostsExtra?: string[]
}

export class ServidorDev {
  private server?: http.Server
  private readonly hosts: Set<string>
  private readonly origenes: Set<string>

  constructor(private readonly op: OpcionesServidor) {
    this.hosts = new Set([`localhost:${op.puerto}`, `127.0.0.1:${op.puerto}`])
    this.origenes = new Set([...this.hosts].map((h) => `http://${h}`))
    for (const x of op.hostsExtra ?? []) {
      const h = x.trim().toLowerCase()
      if (!/^[a-z0-9.-]+(:\d+)?$/.test(h)) continue
      for (const v of h.includes(':') ? [h] : [h, `${h}:${op.puerto}`]) {
        this.hosts.add(v)
        this.origenes.add(`http://${v}`)
        this.origenes.add(`https://${v}`)
      }
    }
  }

  /** Empieza a escuchar en 127.0.0.1:puerto. Rechaza si el puerto está ocupado. */
  arrancar(): Promise<void> {
    const server = http.createServer({ requestTimeout: 0, headersTimeout: 60_000, keepAliveTimeout: 0 }, (req, res) => {
      this.atender(req, res).catch(() => responder(res, 500, json({ error: 'error interno' })))
    })
    this.server = server
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.op.puerto, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
  }

  cerrar(): Promise<void> {
    const s = this.server
    this.server = undefined
    if (!s) return Promise.resolve()
    return new Promise((r) => {
      s.close(() => r())
      s.closeAllConnections()
    })
  }

  private async atender(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.headers['transfer-encoding'] !== undefined) return responder(res, 501, json({ error: 'pedido inválido' }), true)
    const largo = req.headers['content-length']
    if (largo !== undefined && !/^\d+$/.test(largo)) return responder(res, 400, json({ error: 'pedido inválido' }), true)
    if (Number(largo ?? 0) > maxCuerpo) return responder(res, 413, json({ error: 'pedido inválido' }), true)
    const cuerpo = await leerCuerpo(req)
    const r = await this.manejar(req.method ?? 'GET', req.url ?? '/', req.headers, cuerpo)
    responder(res, r.status, r)
  }

  /** Un pedido completo → la respuesta (sin red: lógica igual a ServidorDev.manejar). */
  async manejar(metodo: string, url: string, cabeceras: http.IncomingHttpHeaders, cuerpo: Buffer): Promise<Salida> {
    if (!this.hosts.has(String(cabeceras.host ?? '').toLowerCase())) return json({ error: 'host no permitido' }, 403)
    const q = url.indexOf('?')
    const ruta = decodificar(q >= 0 ? url.slice(0, q) : url)
    const query = parsearQuery(q >= 0 ? url.slice(q + 1) : '')
    if (ruta === '/api' || ruta.startsWith('/api/')) {
      if (metodo !== 'GET') {
        const o = cabeceras.origin
        if (!o || !this.origenes.has(o)) return json({ error: 'origen no permitido' }, 403)
        const ct = String(cabeceras['content-type'] ?? '')
        if (!ct.includes('application/json') && !(cuerpo.length === 0 && metodo === 'DELETE')) {
          return json({ error: 'se espera JSON' }, 415)
        }
      }
      const r = await this.op.router.handle(metodo, ruta, query, cuerpo.length === 0 ? undefined : cuerpo)
      return { status: r.status, tipo: 'application/json; charset=utf-8', cuerpo: r.json }
    }
    if (metodo !== 'GET' && metodo !== 'HEAD') return json({ error: 'método no permitido' }, 405)
    const f = this.archivo(ruta)
    let datos: Buffer
    try {
      if (!f) throw new Error()
      datos = fs.readFileSync(f)
    } catch {
      return json({ error: 'no' }, 404)
    }
    return { status: 200, tipo: mime(f!), cuerpo: metodo === 'HEAD' ? Buffer.alloc(0) : datos }
  }

  /** Archivo a servir para una ruta, solo de la lista blanca (index, logo, ui/, vendor/). undefined = 404. */
  archivo(ruta: string): string | undefined {
    let rel = ruta === '/' ? 'index.html' : ruta.slice(1)
    if (!ruta.startsWith('/') || rel.includes('\0') || rel.includes('\\') || rel.split('/').includes('..')) return undefined
    let base: string
    if (estaticos.has(rel) || rel.startsWith('ui/')) base = this.op.raizUI
    else if (rel.startsWith('vendor/')) {
      base = this.op.raizVendor
      rel = rel.slice('vendor/'.length)
    } else return undefined
    try {
      const f = fs.realpathSync.native(path.join(base, rel))
      const b = fs.realpathSync.native(base)
      if (!f.startsWith(b + path.sep) || !fs.statSync(f).isFile()) return undefined
      return f
    } catch {
      return undefined
    }
  }
}

type Salida = { status: number; tipo: string; cuerpo: Buffer }

function json(obj: unknown, status = 200): Salida {
  return { status, tipo: 'application/json; charset=utf-8', cuerpo: codificar(obj) }
}

function responder(res: http.ServerResponse, status: number, s: Salida, cortar = false) {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': s.tipo, 'Content-Length': s.cuerpo.length, Connection: 'close', ...comunes })
  res.end(s.cuerpo)
  // si no leímos el cuerpo (413/501), no esperar a que llegue entero
  if (cortar) res.on('finish', () => res.req.destroy())
}

function leerCuerpo(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = []
    req.on('data', (c: Buffer) => partes.push(c))
    req.on('end', () => resolve(Buffer.concat(partes)))
    req.on('error', reject)
  })
}

/** Como `removingPercentEncoding ?? ""` de Swift. */
function decodificar(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return ''
  }
}

export function parsearQuery(s: string): Query {
  const q: Query = {}
  for (const par of s.split('&')) {
    if (par === '') continue
    const i = par.indexOf('=')
    const dec = (x: string) => {
      const y = x.replace(/\+/g, ' ')
      try {
        return decodeURIComponent(y)
      } catch {
        return y
      }
    }
    q[dec(i >= 0 ? par.slice(0, i) : par)] = i >= 0 ? dec(par.slice(i + 1)) : ''
  }
  return q
}

export function mime(f: string): string {
  switch (path.extname(f).slice(1).toLowerCase()) {
    case 'html': return 'text/html; charset=utf-8'
    case 'js': return 'application/javascript; charset=utf-8'
    case 'css': return 'text/css; charset=utf-8'
    case 'json': return 'application/json; charset=utf-8'
    case 'svg': return 'image/svg+xml; charset=utf-8'
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'woff2': return 'font/woff2'
    case 'woff': return 'font/woff'
    case 'ttf': return 'font/ttf'
    case 'mpd': case 'ldr': case 'dat': case 'txt': case 'md': return 'text/plain; charset=utf-8'
    default: return 'application/octet-stream'
  }
}
