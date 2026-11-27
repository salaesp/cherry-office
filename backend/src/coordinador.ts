// Rol de coordinador de la oficina (Coordinador.swift): un agente con el permiso «coordinador» ve entregas, flujos y bloqueos
// de todos (herramientas MCP `estado_oficina`, `entregas`, `corridas`, `bloqueos`). Para pasarle trabajo a un colega usa
// `delegar` (delegar.ts), que reemplazó a `encargar`: en una charla, como cualquiera; en sus corridas sin la persona, enseguida.
// `Coordinador.perfil/herramientasMCP` (nombres y perfil) viven en permisos.ts.
import { mcpDe, sanear } from './consultas.js'
import { corridaJSON, corridasAbiertas, estadosCorrida } from './corridas-store.js'
import { entregaJSON, estadosEntrega } from './entregas.js'
import { jsonCompacto } from './json-swift.js'
import { esObjeto, type Obj } from './json.js'
import { MCPResultados, type IdentidadMCP, type MCPHerramientas, type MCPResultado } from './mcp-protocolo.js'
import type { OficinaActiva } from './oficinas.js'
import { Parte, corridasDe } from './parte.js'
import { registrarModulo, type Servicios } from './servicios.js'
import { largo, prefijo } from './validar.js'

export const maxRespuesta = 12000
export const maxEntregas = 30

const sinOficina = () => MCPResultados.error('La oficina ya no está abierta.')

/** JSON de hasta `maxRespuesta` caracteres: si no entra, se van sacando elementos del final de la lista más larga. */
export function respuestaCoordinador(o0: Obj): MCPResultado {
  const o: Obj = { ...o0 }
  const texto = (x: Obj) => sanear(jsonCompacto(x))
  let t = texto(o)
  while (largo(t) > maxRespuesta) {
    let mayor: [string, number] | undefined
    for (const [k, v] of Object.entries(o)) if (Array.isArray(v) && v.length > 0 && v.length > (mayor?.[1] ?? 0)) mayor = [k, v.length]
    if (!mayor) return MCPResultados.ok(prefijo(t, maxRespuesta))
    const l = (o[mayor[0]] as unknown[]).slice(0, -1)
    o[mayor[0]] = l
    o.recortado = true
    t = texto(o)
  }
  return MCPResultados.ok(t)
}

/** Las herramientas del coordinador atadas a un token. */
export class HerramientasCoordinador implements MCPHerramientas {
  constructor(private readonly s: Servicios, _token: string, private readonly identidad: IdentidadMCP) {}

  get definiciones(): Obj[] {
    const obj = (props: Obj = {}, req: string[] = []): Obj => {
      const o: Obj = { type: 'object', properties: props }
      if (req.length > 0) o.required = req
      return o
    }
    return [
      {
        name: 'estado_oficina',
        description: 'El parte de la oficina de las últimas 24 horas: qué necesita a la persona, qué hay para revisar, flujos en curso, lo que se hizo, bloqueos y próximas tareas.',
        inputSchema: obj(),
      },
      {
        name: 'entregas',
        description: `Entregas de la oficina, de la más nueva a la más vieja (máximo ${maxEntregas}).`,
        inputSchema: obj({
          estado: { type: 'string', description: 'sin_revisar | revisada | cambios' },
          agente: { type: 'string', description: 'id del agente' },
          limite: { type: 'integer', description: `cuántas, hasta ${maxEntregas}` },
        }),
      },
      {
        name: 'corridas',
        description: 'Corridas de flujos de la oficina. Sin estado, todas; con «abiertas», las que siguen en marcha.',
        inputSchema: obj({ estado: { type: 'string', description: `abiertas | ${estadosCorrida.join(' | ')}` } }),
      },
      {
        name: 'bloqueos',
        description: 'Lo que está trabado: corridas esperando más de su plazo, entregas sin revisar hace días y tareas que fallaron.',
        inputSchema: obj(),
      },
    ]
  }

  async llamar(nombre: string, a: Obj): Promise<MCPResultado | undefined> {
    switch (nombre) {
      case 'estado_oficina': return this.estado()
      case 'entregas': return this.entregas(a)
      case 'corridas': return this.corridas(a)
      case 'bloqueos': return this.bloqueos()
      default: return undefined
    }
  }

  /** La oficina abierta, si es la del token. */
  private activa(): OficinaActiva | undefined {
    const act = this.s.oficinas.activa()
    return act && act.carpeta === this.identidad.oficina ? act : undefined
  }

  // MARK: lecturas

  private estado(): MCPResultado {
    const act = this.activa()
    if (!act) return sinOficina()
    const p = Parte.armar(this.s, act, new Date(Date.now() - 86_400_000))
    // la lista de «para revisar» va dentro de un objeto: se aplana para poder recortarla
    if (esObjeto(p.paraRevisar)) {
      const r = p.paraRevisar
      p.paraRevisarTotal = r.total
      p.paraRevisar = r.entregas ?? []
    }
    return respuestaCoordinador(p)
  }

  private entregas(a: Obj): MCPResultado {
    const act = this.activa()
    if (!act) return sinOficina()
    const estado = typeof a.estado === 'string' && a.estado !== '' ? a.estado : undefined
    if (estado !== undefined && !estadosEntrega.includes(estado)) return MCPResultados.error(`«estado» tiene que ser uno de: ${estadosEntrega.join(', ')}.`)
    const agente = typeof a.agente === 'string' && a.agente !== '' ? a.agente : undefined
    const l = typeof a.limite === 'number' ? Math.trunc(a.limite) : 10
    const limite = Math.max(1, Math.min(l, maxEntregas))
    return respuestaCoordinador({ entregas: this.s.entregas.lista(act.carpeta, { estado, agente, limite }).map(entregaJSON) })
  }

  private corridas(a: Obj): MCPResultado {
    const act = this.activa()
    if (!act) return sinOficina()
    const estado = typeof a.estado === 'string' && a.estado !== '' ? a.estado : undefined
    let estados: string[] | undefined
    if (estado !== undefined) {
      if (estado === 'abiertas') estados = corridasAbiertas
      else if (estadosCorrida.includes(estado)) estados = [estado]
      else return MCPResultados.error(`«estado» tiene que ser «abiertas» o uno de: ${estadosCorrida.join(', ')}.`)
    }
    const lista = corridasDe(this.s).corridas(act.carpeta, { estados, limite: 30 }).map((c) => {
      const j = corridaJSON(c)
      delete j.definicion
      j.contexto = prefijo(c.contexto, 300)
      return j
    })
    return respuestaCoordinador({ corridas: lista })
  }

  private bloqueos(): MCPResultado {
    const act = this.activa()
    if (!act) return sinOficina()
    return respuestaCoordinador({ bloqueos: Parte.bloqueos(this.s, act, new Date()) })
  }
}

/** Solo con el perfil coordinador del token: cualquier otro no ve estas herramientas. */
export const herramientasCoordinador = (s: Servicios, token: string, identidad: IdentidadMCP): MCPHerramientas | undefined =>
  identidad.perfil === 'coordinador' ? new HerramientasCoordinador(s, token, identidad) : undefined

registrarModulo('coordinador', 74, (s) => {
  mcpDe(s)?.registrarHerramientas(herramientasCoordinador)
})
