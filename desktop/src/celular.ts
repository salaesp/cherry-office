// Acceso desde el celular (docs/plan-celular.md, opción A). Con la opción prendida en Ajustes › Celular:
// - levanta el mismo servidor del modo desarrollo (ServidorDev) en 127.0.0.1, con el router que ya usa la ventana (un solo
//   backend, una sola base: la ventana y el celular no se pisan);
// - lo publica en la red de Tailscale con `tailscale serve` (https con certificado válido, solo para los dispositivos de
//   esa red) y acepta ese nombre como Host y Origin;
// - evita que la compu se suspenda mientras está prendida (si no, el celular no llega);
// - da la dirección y un QR para abrirla en el celular e instalarla.
// Lo prendido se recuerda (userData/celular.json) y se vuelve a levantar al abrir la app.
import fs from 'node:fs'
import path from 'node:path'
import { powerSaveBlocker } from 'electron'
import type { APIHandler } from '../../backend/src/router.js'
import { ServidorDev } from '../../backend/src/servidor-dev.js'
import { Tailscale, buscarComando, qrSvg } from '../../backend/src/tailscale.js'
import type { Raices } from './estaticos.js'

export type EstadoCelular = {
  prendido: boolean
  estado: 'apagado' | 'probando' | 'sin-tailscale' | 'tailscale-apagado' | 'sin-nombre' | 'falta-https' | 'error' | 'listo'
  url?: string
  /** <svg> con el QR de `url` */
  qr?: string
  /** link de Tailscale para habilitar HTTPS/Serve en la red (estado falta-https) */
  habilitar?: string
  error?: string
}

type Guardado = { prendido?: boolean; puerto?: number }

const PUERTO = 8765
const INTENTOS = 10 // 8765…8774 si el puerto está ocupado (p. ej. por el modo desarrollo)

export class AccesoCelular {
  private servidor?: ServidorDev
  private puerto?: number
  private nombre?: string
  private bloqueo?: number
  private actual: EstadoCelular = { prendido: false, estado: 'apagado' }
  private enCurso?: Promise<EstadoCelular>

  constructor(private readonly op: { router: APIHandler; raices: Raices; carpeta: string; alCambiar?: () => void }) {
    this.actual.prendido = this.leer().prendido === true
  }

  estado(): EstadoCelular { return this.actual }

  /** Al abrir la app: si quedó prendido, lo vuelve a levantar (sin esperar). */
  iniciar() { if (this.actual.prendido) void this.probar() }

  async prender(): Promise<EstadoCelular> {
    this.guardar({ prendido: true })
    this.actual = { prendido: true, estado: 'probando' }
    return this.probar()
  }

  async apagar(): Promise<EstadoCelular> {
    this.guardar({ prendido: false })
    await this.bajar(true)
    this.poner({ prendido: false, estado: 'apagado' })
    return this.actual
  }

  /** Revisa Tailscale y levanta o publica lo que falte. Si ya hay una revisión en curso, espera esa. */
  probar(): Promise<EstadoCelular> {
    if (!this.actual.prendido) return Promise.resolve(this.actual)
    this.enCurso ??= this.revisar().finally(() => { this.enCurso = undefined })
    return this.enCurso
  }

  /** Al salir de la app: cierra el servidor (la publicación de Tailscale queda; el celular ve «sin conexión»). */
  async cerrar() { await this.bajar(false) }

  private async revisar(): Promise<EstadoCelular> {
    const bin = buscarComando()
    if (!bin) return this.falla({ estado: 'sin-tailscale' })
    const ts = new Tailscale(bin)
    let e
    try { e = await ts.estado() } catch { return this.falla({ estado: 'sin-tailscale' }) }
    if (e.estado === 'apagado') return this.falla({ estado: 'tailscale-apagado' })
    if (e.estado === 'sin-nombre') return this.falla({ estado: 'sin-nombre' })
    try {
      await this.levantar(e.nombre)
    } catch (err) {
      return this.falla({ estado: 'error', error: `No pude abrir el servidor local: ${err instanceof Error ? err.message : err}` })
    }
    const pub = await ts.publicar(this.puerto!)
    if (!pub.ok) {
      return this.falla(pub.habilitar ? { estado: 'falta-https', habilitar: pub.habilitar } : { estado: 'error', error: pub.error })
    }
    if (this.bloqueo === undefined || !powerSaveBlocker.isStarted(this.bloqueo)) this.bloqueo = powerSaveBlocker.start('prevent-app-suspension')
    const url = `https://${e.nombre}/`
    this.poner({ prendido: true, estado: 'listo', url, qr: await qrSvg(url + '?movil=1#/bandeja') })
    return this.actual
  }

  /** Servidor local en 127.0.0.1 que acepta el nombre de Tailscale. Si el nombre cambió, lo vuelve a armar. */
  private async levantar(nombre: string) {
    if (this.servidor && this.nombre === nombre) return
    await this.servidor?.cerrar()
    this.servidor = undefined
    const preferido = this.leer().puerto ?? PUERTO
    const puertos = [preferido, ...Array.from({ length: INTENTOS }, (_, i) => PUERTO + i).filter((p) => p !== preferido)]
    let ultimo: unknown
    for (const puerto of puertos) {
      const s = new ServidorDev({ router: this.op.router, raizUI: this.op.raices.ui, raizVendor: this.op.raices.vendor, puerto, hostsExtra: [nombre] })
      try {
        await s.arrancar()
        this.servidor = s
        this.puerto = puerto
        this.nombre = nombre
        this.guardar({ puerto })
        return
      } catch (err) { ultimo = err }
    }
    throw ultimo instanceof Error ? ultimo : new Error('todos los puertos ocupados')
  }

  private async bajar(despublicar: boolean) {
    if (this.bloqueo !== undefined && powerSaveBlocker.isStarted(this.bloqueo)) powerSaveBlocker.stop(this.bloqueo)
    this.bloqueo = undefined
    await this.servidor?.cerrar().catch(() => {})
    this.servidor = undefined
    this.nombre = undefined
    if (despublicar) {
      const bin = buscarComando()
      if (bin) await new Tailscale(bin).despublicar().catch(() => {})
    }
  }

  private async falla(e: Omit<EstadoCelular, 'prendido'>): Promise<EstadoCelular> {
    await this.bajar(false)
    this.poner({ prendido: true, ...e })
    return this.actual
  }

  private poner(e: EstadoCelular) {
    this.actual = e
    this.op.alCambiar?.()
  }

  private archivo() { return path.join(this.op.carpeta, 'celular.json') }
  private leer(): Guardado {
    try { return JSON.parse(fs.readFileSync(this.archivo(), 'utf8')) as Guardado } catch { return {} }
  }
  private guardar(cambios: Guardado) {
    try { fs.writeFileSync(this.archivo(), JSON.stringify({ ...this.leer(), ...cambios })) } catch {}
  }
}
