// JSON-RPC 2.0 de MCP, tokens por corrida e identidad (MCPProtocolo.swift). Lógica pura, sin red.
// Formato verificado con el claude real en docs/aprendizajes.md (Fase 4).
import { randomBytes } from 'node:crypto'
import { esObjeto, type Obj } from './json.js'

/** Resultado de una herramienta MCP: texto y si es un error de la herramienta (`isError`). */
export type MCPResultado = { texto: string; esError: boolean; imagenes?: { datos: string; mime: string }[] }
export const MCPResultados = {
  ok: (texto: string): MCPResultado => ({ texto, esError: false }),
  /** Texto más imágenes (base64), que el agente ve como tales (contenido `image` de MCP). */
  conImagenes: (texto: string, imagenes: { datos: string; mime: string }[]): MCPResultado => ({ texto, esError: false, imagenes }),
  error: (texto: string): MCPResultado => ({ texto, esError: true }),
}

/** Las herramientas que ofrece el servidor (ya atadas a quien llama). */
export interface MCPHerramientas {
  /** Definiciones para `tools/list`. */
  readonly definiciones: Obj[]
  /** undefined = no existe esa herramienta. */
  llamar(nombre: string, argumentos: Obj): Promise<MCPResultado | undefined>
}

/** Concatena las definiciones y llama a la primera parte que reconoce la herramienta. */
export class HerramientasCompuestas implements MCPHerramientas {
  constructor(private readonly partes: MCPHerramientas[]) {}
  get definiciones(): Obj[] { return this.partes.flatMap((p) => p.definiciones) }
  async llamar(nombre: string, argumentos: Obj): Promise<MCPResultado | undefined> {
    for (const p of this.partes) {
      const r = await p.llamar(nombre, argumentos)
      if (r !== undefined) return r
    }
    return undefined
  }
}

export class HerramientasVacias implements MCPHerramientas {
  readonly definiciones: Obj[] = []
  async llamar(): Promise<MCPResultado | undefined> { return undefined }
}

/** Versiones del protocolo que sabemos atender, de la más nueva a la más vieja. */
export const versionesMCP = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

type Id = string | number

function codificar(o: Obj): string { return JSON.stringify(o) }
const resultado = (id: Id, r: unknown) => codificar({ jsonrpc: '2.0', id, result: r })
const errorRPC = (id: Id | null, codigo: number, mensaje: string) => codificar({ jsonrpc: '2.0', id, error: { code: codigo, message: mensaje } })

/** Procesa un mensaje JSON-RPC. undefined = notificación (o respuesta ajena): el transporte contesta 202 sin cuerpo. */
export async function procesarMCP(cuerpo: Buffer | string, herramientas: MCPHerramientas): Promise<string | undefined> {
  let crudo: unknown
  try {
    crudo = JSON.parse(typeof cuerpo === 'string' ? cuerpo : cuerpo.toString('utf8'))
  } catch {
    return errorRPC(null, -32700, 'JSON inválido')
  }
  // como JSONSerialization sin fragmentos: un escalar suelto no es JSON válido
  if (crudo === null || typeof crudo !== 'object') return errorRPC(null, -32700, 'JSON inválido')
  if (!esObjeto(crudo)) return errorRPC(null, -32600, 'Pedido inválido')
  const m = crudo
  if (typeof m.method !== 'string') return undefined // respuestas del cliente: se ignoran
  if (m.id === undefined || m.id === null) return undefined // notificación (p. ej. notifications/initialized)
  const id = m.id as Id
  const params: Obj = esObjeto(m.params) ? m.params : {}
  switch (m.method) {
    case 'initialize': {
      const pedida = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      return resultado(id, {
        protocolVersion: versionesMCP.includes(pedida) ? pedida : versionesMCP[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'hq', version: '1' },
      })
    }
    case 'ping':
      return resultado(id, {})
    case 'tools/list':
      return resultado(id, { tools: herramientas.definiciones })
    case 'tools/call': {
      if (typeof params.name !== 'string') return errorRPC(id, -32602, 'Falta el nombre de la herramienta')
      const args: Obj = esObjeto(params.arguments) ? params.arguments : {}
      const r = await herramientas.llamar(params.name, args)
      if (r === undefined) return errorRPC(id, -32602, `Herramienta desconocida: ${params.name}`)
      const res: Obj = { content: [{ type: 'text', text: r.texto }, ...(r.imagenes ?? []).map((i) => ({ type: 'image', data: i.datos, mimeType: i.mime }))] }
      if (r.esError) res.isError = true
      return resultado(id, res)
    }
    default:
      return errorRPC(id, -32601, `Método no soportado: ${m.method}`)
  }
}

/** Quién llama: la oficina, el agente y la conversación a la que pertenece el token. */
export type IdentidadMCP = {
  oficina: string
  agente: string
  sid: string
  /** agente | coordinador | creador: decide qué herramientas ofrece el servidor. */
  perfil: string
  /** Chat con la persona presente: el token ofrece `pedir_permiso` (`--permission-prompt-tool`). */
  interactivo?: boolean
}

/** Tokens por corrida: token (32 bytes aleatorios, hex) -> identidad y consultas que le quedan.
 *  Se emiten al empezar un chat y se revocan al terminar. */
export class MCPTokens {
  static readonly consultasPorMensaje = 3
  private readonly tokens = new Map<string, { identidad: IdentidadMCP; restantes: number; usados: Map<string, number> }>()

  emitir(p: { oficina: string; agente: string; sid: string; perfil?: string; consultas?: number; interactivo?: boolean }): string {
    const t = randomBytes(32).toString('hex')
    this.tokens.set(t, {
      identidad: { oficina: p.oficina, agente: p.agente, sid: p.sid, perfil: p.perfil ?? 'agente', interactivo: p.interactivo ?? false },
      restantes: p.consultas ?? MCPTokens.consultasPorMensaje,
      usados: new Map(),
    })
    return t
  }

  revocar(token: string) { this.tokens.delete(token) }

  identidad(token: string): IdentidadMCP | undefined { return this.tokens.get(token)?.identidad }

  /** Gasta una consulta del token. false si ya no le quedan (o si el token ya no existe). */
  tomarConsulta(token: string): boolean {
    const e = this.tokens.get(token)
    if (!e || e.restantes <= 0) return false
    e.restantes -= 1
    return true
  }

  /** Cupo genérico: gasta una unidad de `clave` (máximo `max` por token). false si ya no queda (o si el token no existe). */
  tomar(token: string, clave: string, max: number): boolean {
    const e = this.tokens.get(token)
    if (!e) return false
    const n = e.usados.get(clave) ?? 0
    if (n >= max) return false
    e.usados.set(clave, n + 1)
    return true
  }

  get activos(): number { return this.tokens.size }
}
