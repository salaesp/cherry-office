// Tailscale para el acceso desde el celular (docs/plan-celular.md, opción A): la app de escritorio levanta el servidor
// local y lo publica en la red de Tailscale con `tailscale serve`, que da https con certificado válido (el navegador
// solo deja usar el micrófono así) y deja entrar solo a los dispositivos de esa red. Acá: encontrar el comando, leer
// el estado y el nombre de la máquina, y publicar o despublicar el puerto. Lo que no corre comandos es puro (con tests).
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'

/** Dónde suele estar el comando `tailscale` en cada sistema (el primero que exista). */
export function candidatos(plataforma: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (plataforma === 'darwin') {
    return [
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale', // la app de Mac (App Store o standalone) sirve de CLI
      '/opt/homebrew/bin/tailscale',
      '/usr/local/bin/tailscale',
    ]
  }
  if (plataforma === 'win32') {
    const pf = [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files'].filter((x): x is string => !!x)
    return [...new Set(pf.map((d) => path.win32.join(d, 'Tailscale', 'tailscale.exe')))]
  }
  return ['/usr/bin/tailscale', '/usr/local/bin/tailscale', '/usr/sbin/tailscale']
}

export function buscarComando(plataforma: NodeJS.Platform = process.platform, existe: (f: string) => boolean = fs.existsSync,
  env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.HQ_TAILSCALE_BIN) return env.HQ_TAILSCALE_BIN
  return candidatos(plataforma, env).find((f) => existe(f))
}

export type EstadoTailscale =
  | { estado: 'listo'; nombre: string }
  | { estado: 'apagado' } // instalado pero sin sesión o desconectado
  | { estado: 'sin-nombre' } // conectado pero sin MagicDNS (no hay nombre para el https)

/** Lee `tailscale status --json`. */
export function interpretarStatus(json: string): EstadoTailscale {
  let s: { BackendState?: unknown; Self?: { DNSName?: unknown } }
  try { s = JSON.parse(json) } catch { return { estado: 'apagado' } }
  if (s.BackendState !== 'Running') return { estado: 'apagado' }
  const dns = typeof s.Self?.DNSName === 'string' ? s.Self.DNSName.replace(/\.$/, '').toLowerCase() : ''
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dns)) return { estado: 'sin-nombre' }
  return { estado: 'listo', nombre: dns }
}

/** Si `tailscale serve` falla porque la red no tiene HTTPS o Serve habilitado, Tailscale da un link para habilitarlo. */
export function linkHabilitar(salida: string): string | undefined {
  const m = /https:\/\/login\.tailscale\.com\/[^\s"'<>]+/.exec(salida)
  return m ? m[0] : undefined
}

export type Publicacion = { ok: true } | { ok: false; habilitar?: string; error: string }

type Ejecutar = (bin: string, args: string[], ms: number) => Promise<{ codigo: number; salida: string }>

const ejecutar: Ejecutar = (bin, args, ms) => new Promise((resolve) => {
  execFile(bin, args, { timeout: ms, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    const codigo = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
    resolve({ codigo, salida: `${stdout ?? ''}\n${stderr ?? ''}` })
  })
})

export class Tailscale {
  constructor(readonly bin: string, private readonly correr: Ejecutar = ejecutar) {}

  async estado(): Promise<EstadoTailscale> {
    const r = await this.correr(this.bin, ['status', '--json'], 10_000)
    // sin sesión, `status --json` igual imprime el JSON (con BackendState NeedsLogin) aunque salga con error
    return interpretarStatus(r.salida.slice(r.salida.indexOf('{')))
  }

  /** `tailscale serve --bg <puerto>`: https://<nombre>/ → http://127.0.0.1:<puerto>, y queda aunque se cierre la app. */
  async publicar(puerto: number): Promise<Publicacion> {
    // Si la red no tiene Serve habilitado, el comando se queda esperando a que se habilite: se corta antes y se
    // devuelve el link que imprimió.
    const r = await this.correr(this.bin, ['serve', '--bg', String(puerto)], 20_000)
    if (r.codigo === 0 && !linkHabilitar(r.salida)) return { ok: true }
    const habilitar = linkHabilitar(r.salida)
    return { ok: false, ...(habilitar ? { habilitar } : {}), error: limpiar(r.salida) || 'Tailscale no pudo publicar la oficina.' }
  }

  /** Saca la publicación del puerto 443 (la que puso `publicar`). */
  async despublicar(): Promise<void> {
    await this.correr(this.bin, ['serve', '--https=443', 'off'], 10_000)
  }
}

function limpiar(s: string): string {
  return s.split('\n').map((x) => x.trim()).filter((x) => x !== '').slice(0, 4).join(' ').slice(0, 400)
}

/** QR (como <svg>) con la dirección para abrir la oficina en el celular. */
export async function qrSvg(texto: string): Promise<string | undefined> {
  try { return await QRCode.toString(texto, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }) } catch { return undefined }
}
