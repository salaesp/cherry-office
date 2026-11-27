// Eventos de `claude -p --output-format stream-json --verbose`, reducidos a lo que la oficina muestra (Stream.swift).
// Nunca llevan contenido de archivos ni resultados de herramientas: solo nombres de herramientas, un objetivo corto y,
// para el chat, un `detalle` de lo que se le pidió a la herramienta (el comando de Bash, la búsqueda, la URL).
// El único contenido es el texto que el agente le escribe a la persona (`texto.contenido`), que solo usa la vista en
// vivo del chat (CajaVivo); la actividad de la oficina lo ignora.
import path from 'node:path'
import { esObjeto } from './json.js'
import { largo, prefijo } from './validar.js'

export type EventoClaude =
  | { tipo: 'inicio'; sesion: string }
  | { tipo: 'pensando' }
  /** `detalle`: lo que se le pidió a la herramienta (comando, patrón, URL, encargo), hasta 600 caracteres. Solo el chat. */
  | { tipo: 'herramienta'; nombre: string; objetivo?: string; detalle?: string }
  /** Ruta de un archivo que el agente escribió (Write, Edit, NotebookEdit). Llega después de su `herramienta`. */
  | { tipo: 'archivo'; ruta: string }
  /** Un bloque de texto de la respuesta. `contenido` solo lo lee el chat en vivo; nunca va a /api/actividad. */
  | { tipo: 'texto'; contenido?: string }
  | { tipo: 'resultado'; costo?: number; error: boolean; tokens?: Tokens; ventanas?: Record<string, number> }
  /** Tamaño del contexto tras una llamada al modelo del agente principal (no de subagentes): lo que entró como entrada
   *  (sin caché + leído + escrito en la caché). Es lo que ocupa la charla, a diferencia de `resultado.tokens`, que suma
   *  todas las llamadas del turno. */
  | { tipo: 'contexto'; usados: number; modelo?: string }

/** Recibe los eventos de una corrida, en orden. */
export type Observador = (e: EventoClaude) => void

/** Herramientas que escriben un archivo (su ruta llega en `file_path` o `notebook_path`). */
const escritoras = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/** Eventos de una línea (una línea `assistant` puede traer varios bloques). Lo que no es JSON o no se conoce: []. */
export function parsearEvento(linea: string): EventoClaude[] {
  let o: unknown
  try {
    o = JSON.parse(linea)
  } catch {
    return []
  }
  if (!esObjeto(o) || typeof o.type !== 'string') return []
  switch (o.type) {
    case 'system':
      return o.subtype === 'init' && typeof o.session_id === 'string' ? [{ tipo: 'inicio', sesion: o.session_id }] : []
    case 'assistant': {
      const msg = esObjeto(o.message) ? o.message : {}
      const bloques = Array.isArray(msg.content) ? msg.content.filter(esObjeto) : []
      const ctx = o.parent_tool_use_id == null ? contextoDe(msg) : undefined
      const evs = bloques.flatMap((b): EventoClaude[] => {
        if (b.type === 'thinking') return [{ tipo: 'pensando' }]
        if (b.type === 'text') return [typeof b.text === 'string' && b.text !== '' ? { tipo: 'texto', contenido: b.text } : { tipo: 'texto' }]
        if (b.type !== 'tool_use' || typeof b.name !== 'string') return []
        const input = esObjeto(b.input) ? b.input : {}
        const her: EventoClaude = { tipo: 'herramienta', nombre: b.name, objetivo: objetivo(input) }
        const det = detalle(b.name, input)
        if (det !== undefined) her.detalle = det
        const out: EventoClaude[] = [her]
        const p = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
        if (escritoras.has(b.name) && p !== '') out.push({ tipo: 'archivo', ruta: p })
        return out
      })
      return ctx ? [ctx, ...evs] : evs
    }
    case 'result': {
      const r: EventoClaude = { tipo: 'resultado', costo: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : undefined, error: o.is_error === true, tokens: tokensDe(o.usage) }
      const v = ventanasDe(o.modelUsage)
      if (v) r.ventanas = v
      return [r]
    }
    default:
      return []
  }
}

/** Objetivo legible y corto de una herramienta: nombre de archivo, patrón, dominio o colega. Sin contenido. */
export function objetivo(input: Record<string, unknown>): string | undefined {
  const corto = (s: string) => (largo(s) > 60 ? prefijo(s, 59) + '…' : s)
  const s = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)
  const p = typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : undefined
  if (p) return corto(path.posix.basename(p.replace(/\\/g, '/')))
  if (s(input.pattern)) return corto(input.pattern as string)
  if (typeof input.url === 'string') {
    try {
      const h = new URL(input.url).hostname
      if (h) return corto(h)
    } catch {}
  }
  if (s(input.query)) return corto(input.query as string)
  if (s(input.colega)) return corto(input.colega as string)
  // Skill: el nombre de la skill que cargó
  if (s(input.skill)) return corto(input.skill as string)
  // Bash, Task, Agent: la descripción que el propio agente escribe («Lista los archivos de ventas»)
  if (s(input.description)) return corto(input.description as string)
  return undefined
}

/** Lo que se le pidió a una herramienta, para verlo en el chat: el comando de Bash, el patrón de Grep con su carpeta, la
 *  URL completa o el encargo a un subagente. Sin contenido de archivos; recortado a 600 caracteres. */
export function detalle(nombre: string, input: Record<string, unknown>): string | undefined {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)
  const corto = (t: string | undefined) => (t === undefined ? undefined : largo(t) > 600 ? prefijo(t, 599) + '…' : t)
  switch (nombre) {
    case 'Bash':
      return corto(s(input.command))
    case 'Grep':
    case 'Glob': {
      const pat = s(input.pattern)
      if (pat === undefined) return undefined
      const donde = s(input.path) ?? s(input.glob)
      return corto(donde !== undefined ? pat + '  en  ' + donde : pat)
    }
    case 'WebFetch':
      return corto(s(input.url))
    case 'Task':
    case 'Agent':
      return corto(s(input.prompt))
    default:
      return undefined
  }
}

/** Corta bytes en líneas completas (los chunks del pipe pueden partir una línea o un carácter UTF-8). */
export class CortadorLineas {
  private buf: Buffer = Buffer.alloc(0)
  constructor(private readonly alLinea: (l: string) => void) {}

  agregar(d: Buffer) {
    this.buf = this.buf.length === 0 ? d : Buffer.concat([this.buf, d])
    let i: number
    while ((i = this.buf.indexOf(0x0a)) >= 0) {
      const linea = this.buf.subarray(0, i)
      this.buf = this.buf.subarray(i + 1)
      if (linea.length > 0) this.alLinea(linea.toString('utf8'))
    }
  }

  /** Lo que quedó sin `\n` al final. */
  terminar() {
    if (this.buf.length > 0) {
      this.alLinea(this.buf.toString('utf8'))
      this.buf = Buffer.alloc(0)
    }
  }
}

/** Junta el costo de una o varias corridas. */
/** Tokens de una corrida (`usage` del `result`): entrada sin caché, leída de la caché, escrita en la caché y salida. */
export type Tokens = { entrada: number; cacheLeida: number; cacheEscrita: number; salida: number }

function tokensDe(u: unknown): Tokens | undefined {
  if (!esObjeto(u)) return undefined
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return { entrada: n(u.input_tokens), cacheLeida: n(u.cache_read_input_tokens), cacheEscrita: n(u.cache_creation_input_tokens), salida: n(u.output_tokens) }
}

/** `usage` de un mensaje `assistant` → tokens de entrada que ocupó (undefined si no lo trae o es 0). */
function contextoDe(msg: Record<string, unknown>): EventoClaude | undefined {
  const t = tokensDe(msg.usage)
  if (!t) return undefined
  const usados = t.entrada + t.cacheLeida + t.cacheEscrita
  if (!(usados > 0)) return undefined
  return typeof msg.model === 'string' && msg.model !== '' ? { tipo: 'contexto', usados, modelo: msg.model } : { tipo: 'contexto', usados }
}

/** `modelUsage` del `result` → ventana de contexto de cada modelo (`contextWindow`). */
function ventanasDe(mu: unknown): Record<string, number> | undefined {
  if (!esObjeto(mu)) return undefined
  const out: Record<string, number> = {}
  for (const [m, u] of Object.entries(mu)) if (esObjeto(u) && typeof u.contextWindow === 'number' && u.contextWindow > 0) out[m] = u.contextWindow
  return Object.keys(out).length > 0 ? out : undefined
}

/** Cuánto ocupa una charla: el contexto de la última llamada del agente y la ventana de su modelo. */
export type UsoContexto = { usados: number; ventana?: number }

/** Junta el último `contexto` del turno y, con el `resultado`, la ventana del modelo que lo usó. */
export class CajaContexto {
  private usados?: number
  private modelo?: string
  private ventana?: number
  get valor(): UsoContexto | undefined {
    if (this.usados === undefined) return undefined
    return this.ventana !== undefined ? { usados: this.usados, ventana: this.ventana } : { usados: this.usados }
  }
  observador(siguiente?: Observador): Observador {
    return (e) => {
      if (e.tipo === 'contexto') {
        this.usados = e.usados
        if (e.modelo !== undefined) this.modelo = e.modelo
      } else if (e.tipo === 'resultado' && e.ventanas) {
        const vs = Object.values(e.ventanas)
        // la del modelo del agente; si no aparece con ese nombre, la más grande (los subagentes suelen ser modelos chicos)
        this.ventana = (this.modelo !== undefined ? e.ventanas[this.modelo] : undefined) ?? Math.max(...vs)
      }
      siguiente?.(e)
    }
  }
}

export class CajaCosto {
  private total?: number
  private tok?: Tokens
  sumar(c?: number) { if (c !== undefined) this.total = (this.total ?? 0) + c }
  get valor() { return this.total }
  get tokens() { return this.tok }
  /** ` tokens=entrada/cache_leida/cache_escrita/salida` para el log (vacío si claude no los informó). Sirve para ver de
   *  dónde sale el consumo de una charla: una caché leída enorme es una charla larga; una salida enorme, mucho pensar. */
  tokensLog(): string {
    const t = this.tok
    return t ? ` tokens=${t.entrada}/${t.cacheLeida}/${t.cacheEscrita}/${t.salida}` : ''
  }
  /** Observador que suma el costo del `resultado` y reenvía todo a `siguiente`. */
  observador(siguiente?: Observador): Observador {
    return (e) => {
      if (e.tipo === 'resultado') {
        this.sumar(e.costo)
        if (e.tokens) {
          const a = this.tok ?? { entrada: 0, cacheLeida: 0, cacheEscrita: 0, salida: 0 }
          this.tok = { entrada: a.entrada + e.tokens.entrada, cacheLeida: a.cacheLeida + e.tokens.cacheLeida, cacheEscrita: a.cacheEscrita + e.tokens.cacheEscrita, salida: a.salida + e.tokens.salida }
        }
      }
      siguiente?.(e)
    }
  }
}

/** Junta las rutas de los archivos escritos, sin repetir y en orden. */
export class CajaArchivos {
  private rutas: string[] = []
  agregar(r: string) { if (!this.rutas.includes(r)) this.rutas.push(r) }
  get valor() { return [...this.rutas] }
  observador(siguiente?: Observador): Observador {
    return (e) => {
      if (e.tipo === 'archivo') this.agregar(e.ruta)
      siguiente?.(e)
    }
  }
}

/** Un paso de la respuesta en vivo del chat: un bloque de texto, una herramienta o un archivo escrito. */
export type PasoVivo =
  | { t: 'texto'; c: string }
  | { t: 'herramienta'; nombre: string; objetivo?: string; detalle?: string }
  | { t: 'archivo'; ruta: string }

/** Lo que el agente va haciendo en un chat, en orden, para mostrarlo mientras escribe (como Claude Code).
 *  Guarda el texto que le escribe a la persona y los nombres de herramientas con su objetivo corto, nunca resultados. */
export class CajaVivo {
  static readonly maxPasos = 400
  private pasos: PasoVivo[] = []
  /** Sube con cada cambio: el front pide de nuevo solo si cambió. */
  version = 0
  get valor(): PasoVivo[] { return [...this.pasos] }
  agregar(p: PasoVivo) {
    if (this.pasos.length >= CajaVivo.maxPasos) this.pasos.splice(0, 1)
    this.pasos.push(p)
    this.version++
  }
  observador(siguiente?: Observador): Observador {
    return (e) => {
      if (e.tipo === 'texto' && e.contenido !== undefined) this.agregar({ t: 'texto', c: e.contenido })
      else if (e.tipo === 'herramienta') {
        const p: PasoVivo = { t: 'herramienta', nombre: e.nombre }
        if (e.objetivo !== undefined) p.objetivo = e.objetivo
        if (e.detalle !== undefined) p.detalle = e.detalle
        this.agregar(p)
      }
      else if (e.tipo === 'archivo') this.agregar({ t: 'archivo', ruta: e.ruta })
      siguiente?.(e)
    }
  }
}
