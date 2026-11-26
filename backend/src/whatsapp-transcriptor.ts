// Transcriptor de notas de voz de WhatsApp (docs/plan-secretaria.md, fase S4): proceso hijo que lanza `whatsapp.ts`
// cuando hay audios para transcribir y que se apaga solo cuando no tiene trabajo. Todo pasa en la compu: Whisper (por
// defecto el modelo base, ~80 MB, se baja la primera vez a `HQ_WA_MODELOS`) con Transformers.js y onnxruntime.
//
// Entorno: HQ_WA_MODELOS (carpeta de modelos), HQ_WA_CLAVE (opcional: los audios están cifrados con ella),
// HQ_WA_MODELO (opcional, por defecto onnx-community/whisper-base) y HQ_WA_IDIOMA (por defecto spanish; «auto» detecta el
// idioma de cada audio: Transformers.js no lo hace solo, si no se le dice `language` transcribe como si fuera inglés).
import fs from 'node:fs'
import process from 'node:process'
import { descifrarBytes, type ATranscriptor, type DeTranscriptor } from './whatsapp-mapeo.js'

const enviar = (m: DeTranscriptor) => { try { process.send?.(m) } catch {} }
if (!process.send) {
  console.error('whatsapp-transcriptor: se lanza desde el backend (canal IPC)')
  process.exit(1)
}

const CLAVE = /^[0-9a-f]{64}$/i.test(process.env.HQ_WA_CLAVE ?? '') ? Buffer.from(process.env.HQ_WA_CLAVE!, 'hex') : undefined
const MODELO = process.env.HQ_WA_MODELO || 'onnx-community/whisper-base'
const IDIOMA = process.env.HQ_WA_IDIOMA || 'spanish'
const detectaIdioma = IDIOMA === 'auto'
/** Si no se puede detectar el idioma de un audio, se transcribe como español (para eso es la app). */
const idiomaPorDefecto = 'es'
/** Más de 10 minutos de audio no se transcribe (tarda y gasta memoria). */
const maxSegundos = 10 * 60

type Reconocedor = (audio: Float32Array, op: Record<string, unknown>) => Promise<{ text?: string } | { text?: string }[]>
type Motor = { asr: Reconocedor; detectar: (audio: Float32Array) => Promise<string> }
let reconocedor: Promise<Motor | undefined> | undefined

/** Carga el motor y el modelo una sola vez. Si falta el motor (no está instalado), avisa y queda inútil. */
function cargar(): Promise<Motor | undefined> {
  reconocedor ??= (async () => {
    try {
      const t = await import('@huggingface/transformers')
      if (process.env.HQ_WA_MODELOS) t.env.cacheDir = process.env.HQ_WA_MODELOS
      // progreso de la descarga (la primera vez): lo bajado sobre el total de todos los archivos del modelo
      const archivos = new Map<string, { bajado: number; total: number }>()
      let ultimo = -1, ultimoEnvio = 0
      const asr = await t.pipeline('automatic-speech-recognition', MODELO, {
        dtype: 'q8',
        progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status !== 'progress' || !p.file || !p.total) return
          archivos.set(p.file, { bajado: p.loaded ?? 0, total: p.total })
          let bajado = 0, total = 0
          for (const a of archivos.values()) { bajado += a.bajado; total += a.total }
          const n = Math.floor((bajado / total) * 100)
          if (n !== ultimo && Date.now() - ultimoEnvio > 1000) { ultimo = n; ultimoEnvio = Date.now(); enviar({ tipo: 'cargando', progreso: n }) }
        },
      })
      enviar({ tipo: 'listo' })
      return { asr: asr as unknown as Reconocedor, detectar: (audio) => detectarIdioma(t, asr, audio) }
    } catch (e) {
      enviar({ tipo: 'sin_motor', error: e instanceof Error ? e.message : String(e) })
      return undefined
    }
  })()
  return reconocedor
}

/** Idioma de un audio, con el mismo modelo: un solo paso del decodificador sobre los primeros 30 s, y gana el token de idioma con
 *  más puntaje. Devuelve el código de Whisper («es», «en»…). */
async function detectarIdioma(t: typeof import('@huggingface/transformers'), asr: unknown, audio: Float32Array): Promise<string> {
  try {
    const a = asr as { model: any; processor: any }
    const gc = a.model.generation_config
    const { input_features } = await a.processor(audio.subarray(0, 30 * 16000))
    const inicio = new t.Tensor('int64', BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1])
    const { logits } = await a.model.forward({ input_features, decoder_input_ids: inicio })
    let mejor = idiomaPorDefecto, puntaje = -Infinity
    for (const [token, id] of Object.entries(gc.lang_to_id as Record<string, number>)) {
      const v = logits.data[id] as number
      if (v > puntaje) { puntaje = v; mejor = token.replace(/^<\||\|>$/g, '') }
    }
    return mejor
  } catch {
    return idiomaPorDefecto
  }
}

/** OGG/Opus (las notas de voz de WhatsApp) a 16 kHz mono, como lo espera Whisper. */
async function decodificar(datos: Buffer): Promise<Float32Array> {
  const { OggOpusDecoder } = await import('ogg-opus-decoder')
  const dec = new OggOpusDecoder()
  await dec.ready
  try {
    const { channelData, sampleRate } = await dec.decodeFile(new Uint8Array(datos))
    const canales = channelData.filter((c) => c && c.length > 0)
    if (canales.length === 0) throw new Error('el audio está vacío')
    const largo = canales[0]!.length
    const mono = new Float32Array(largo)
    for (const c of canales) for (let i = 0; i < largo; i++) mono[i]! += (c[i] ?? 0) / canales.length
    if (largo / sampleRate > maxSegundos) throw new Error('el audio dura más de 10 minutos')
    const razon = sampleRate / 16000
    const out = new Float32Array(Math.floor(largo / razon))
    for (let i = 0; i < out.length; i++) {
      const x = i * razon, j = Math.floor(x), f = x - j
      out[i] = (mono[j] ?? 0) * (1 - f) + (mono[j + 1] ?? 0) * f
    }
    return out
  } finally {
    dec.free()
  }
}

// Una a la vez: el modelo ocupa memoria y CPU.
let cola: Promise<void> = Promise.resolve()

function transcribir(t: Extract<ATranscriptor, { tipo: 'transcribir' }>) {
  cola = cola.then(async () => {
    try {
      if (!/ogg|opus/i.test(t.mime)) throw new Error(`formato de audio no soportado (${t.mime})`)
      const motor = await cargar()
      if (!motor) return
      const audio = await decodificar(descifrarBytes(fs.readFileSync(t.archivo), CLAVE))
      const r = await motor.asr(audio, { language: detectaIdioma ? await motor.detectar(audio) : IDIOMA, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 })
      const texto = (Array.isArray(r) ? r.map((x) => x.text ?? '').join(' ') : r.text ?? '').replace(/\s+/g, ' ').trim()
      enviar({ tipo: 'texto', chat: t.chat, id: t.id, texto })
    } catch (e) {
      enviar({ tipo: 'fallo', chat: t.chat, id: t.id, error: e instanceof Error ? e.message : String(e) })
    }
  })
}

process.on('message', (m: ATranscriptor) => {
  if (m?.tipo === 'transcribir') transcribir(m)
  else if (m?.tipo === 'salir') void cola.finally(() => process.exit(0))
})
process.on('disconnect', () => process.exit(0))
