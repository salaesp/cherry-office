// Audio de la persona (docs/plan-recados.md, U1): `POST /api/audio/transcribir` recibe un WAV (la interfaz graba con Web Audio
// y manda PCM 16 kHz mono, así no depende del formato de cada navegador) y devuelve el texto. Usa el mismo transcriptor local
// que las notas de voz de WhatsApp (Whisper en la compu): el audio no sale de la máquina. El archivo se escribe cifrado en una
// carpeta temporal de la carpeta de datos y se borra apenas termina.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { sanear } from './consultas.js'
import { ErrorAPI } from './errores.js'
import { esObjeto, objeto } from './json.js'
import { atrapar, no404, no405, type Query, type Resp, type SubRouter } from './router.js'
import { registrarModulo, type Servicios } from './servicios.js'
import { prefijo } from './validar.js'
import { cifrarBytes } from './whatsapp-mapeo.js'
import { whatsappDe } from './whatsapp.js'

export const LimitesAudio = {
  /** Segundos de audio (WAV 16 kHz mono, 16 bits: 32 KB por segundo). */
  maxSegundos: 5 * 60,
  minSegundos: 0.3,
}

/** Duración de un WAV PCM de 16 bits; undefined si no lo es. */
export function leerWav(b: Buffer): { canales: number; frecuencia: number; segundos: number } | undefined {
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return undefined
  let i = 12, fmt: { canales: number; frecuencia: number; bits: number; formato: number } | undefined
  while (i + 8 <= b.length) {
    const id = b.toString('ascii', i, i + 4), n = b.readUInt32LE(i + 4)
    if (id === 'fmt ' && i + 24 <= b.length) fmt = { formato: b.readUInt16LE(i + 8), canales: b.readUInt16LE(i + 10), frecuencia: b.readUInt32LE(i + 12), bits: b.readUInt16LE(i + 22) }
    else if (id === 'data') {
      if (!fmt || fmt.formato !== 1 || fmt.bits !== 16 || fmt.canales < 1 || fmt.frecuencia < 8000) return undefined
      const bytes = Math.min(n, b.length - i - 8)
      return { canales: fmt.canales, frecuencia: fmt.frecuencia, segundos: bytes / (2 * fmt.canales * fmt.frecuencia) }
    }
    i += 8 + n + (n % 2)
  }
  return undefined
}

/** Prefijo con el que va al agente un mensaje que salió de un audio (y con el que la interfaz lo reconoce). */
export const marcaNotaDeVoz = '(nota de voz) '

export class Audio {
  /** Lo pone el módulo de WhatsApp (su transcriptor); los tests lo reemplazan. */
  transcribir?: (archivo: string) => Promise<string>

  constructor(private readonly s: Servicios) {}

  private get dir() { return path.join(this.s.config.datosDir, 'audio-tmp') }

  /** Transcribe un WAV. 400 si no es WAV PCM de 16 bits o es muy corto o muy largo; 503 sin transcriptor. */
  async texto(wav: Buffer): Promise<string> {
    const info = leerWav(wav)
    if (!info) throw new ErrorAPI(400, 'El audio tiene que ser WAV PCM de 16 bits.')
    if (info.segundos > LimitesAudio.maxSegundos) throw new ErrorAPI(400, `El audio dura más de ${LimitesAudio.maxSegundos / 60} minutos.`)
    if (info.segundos < LimitesAudio.minSegundos) throw new ErrorAPI(400, 'El audio está vacío.')
    const tr = this.transcribir
    if (!tr) throw new ErrorAPI(503, 'No hay transcriptor de audio en esta instalación.')
    fs.mkdirSync(this.dir, { recursive: true })
    const archivo = path.join(this.dir, `${Date.now()}-${randomUUID().slice(0, 8)}.wav`)
    const c = whatsappDe(this.s)?.claveMedios()
    fs.writeFileSync(archivo, cifrarBytes(wav, c ? Buffer.from(c, 'hex') : undefined))
    try {
      const t = sanear(await tr(archivo)).replace(/\s+/g, ' ').trim()
      if (t === '') throw new ErrorAPI(422, 'No se entendió nada en el audio.')
      return t
    } catch (e) {
      if (e instanceof ErrorAPI) throw e
      throw new ErrorAPI(503, 'No pude transcribir el audio: ' + prefijo(e instanceof Error ? e.message : String(e), 200))
    } finally {
      try { fs.rmSync(archivo, { force: true }) } catch {}
    }
  }

  /** Lo que haya quedado de una transcripción cortada (la app se cerró). */
  limpiar() { try { fs.rmSync(this.dir, { recursive: true, force: true }) } catch {} }
}

/** El audio viaja en base64 en el JSON: 5 minutos de WAV 16 kHz son ~13 MB. */
const maxCuerpoAudio = 16 * 1024 * 1024

export class AudioRouter implements SubRouter {
  constructor(private readonly audio: Audio) {}

  async handle(method: string, p: string, _q: Query, body?: Buffer) {
    if (p !== '/api/audio/transcribir') return p.startsWith('/api/audio/') ? atrapar(async () => no404) : null
    return atrapar(async (): Promise<Resp> => {
      if (method !== 'POST') return no405
      const b = objeto(body, maxCuerpoAudio)
      if (typeof b.wav !== 'string' && !(esObjeto(b.audio) && typeof b.audio.wav === 'string')) throw new ErrorAPI(400, 'Falta «wav» (el audio en base64).')
      const b64 = typeof b.wav === 'string' ? b.wav : String((b.audio as { wav: string }).wav)
      const texto = await this.audio.texto(Buffer.from(b64.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64'))
      return [200, { texto }]
    })
  }
}

export const audioDe = (s: Servicios) => s.huecos.audio as Audio | undefined

export function instalar(s: Servicios) {
  const a = new Audio(s)
  s.huecos.audio = a
  const wa = whatsappDe(s)
  if (wa) a.transcribir = (archivo) => wa.transcribirArchivo(archivo)
  s.router.registrarExtra(new AudioRouter(a))
  s.alArrancar.push(() => a.limpiar())
}

registrarModulo('audio', 79, instalar)
