// Rutas del núcleo para oficinas (Router.despachar de Swift): estado, oficinas, oficina, perfil y la lista de agentes
// (los departamentos viven en rutas-departamentos.ts). Contratar/editar/despedir agentes, chat e historial se suman al portar sus módulos.
import { clavesModelo, esConectoresAgentes, esMemoriaIA, esModoPermisos, modelosValidos, type ClaveModelo, type Config, type PreferenciasIA } from './config.js'
import { ErrorAPI } from './errores.js'
import { esObjeto, objeto, objetoOpcional, type Obj } from './json.js'
import { ValidarAgenteExtra, agenteJSON, departamentoJSON, oficinaJSON } from './oficina.js'
import { avatarValido, perfilJSON, type OficinaActiva, type Oficinas } from './oficinas.js'
import type { DepartamentoNuevo } from './departamentos.js'
import { no404, no405, type Resp, type RutaNucleo } from './router.js'
import { Slug, Validar } from './validar.js'
import { modoSkillsDe } from './skills.js'
import { Habilitados, type IAOficina } from './habilitados.js'

/** Lo que /api/estado necesita saber de claude (lo da el runner). */
export interface InfoClaude {
  /** Binario encontrado, o undefined. */
  claudePath(): string | undefined
  /** `claude auth status` (cacheado); undefined si no se pudo saber. */
  auth(): Promise<boolean | undefined>
}

export const sobreOficina = (a: OficinaActiva): Obj => ({ carpeta: a.carpeta, oficina: oficinaJSON(a.oficina) })

/** `modelos` de PUT /api/preferencias: `{creador?, internos?}` con sonnet, opus, haiku o inherit. */
function modelosPedidos(v: unknown): Partial<Record<ClaveModelo, string>> {
  if (!esObjeto(v)) throw new ErrorAPI(400, '«modelos» tiene que ser un objeto.')
  const r: Partial<Record<ClaveModelo, string>> = {}
  for (const [k, m] of Object.entries(v)) {
    if (!(clavesModelo as string[]).includes(k)) throw new ErrorAPI(400, `«modelos.${k}» no existe (${clavesModelo.join(', ')}).`)
    if (typeof m !== 'string' || !modelosValidos.has(m)) throw new ErrorAPI(400, `«modelos.${k}» tiene que ser sonnet, opus, haiku o inherit.`)
    r[k as ClaveModelo] = m
  }
  return r
}

/** `ia` de PUT /api/preferencias: `{esfuerzo?, skills?, memoria?, colegas?}` (solo lo que cambia). */
function iaPedida(v: unknown): Partial<PreferenciasIA> {
  if (!esObjeto(v)) throw new ErrorAPI(400, '«ia» tiene que ser un objeto.')
  const r: Partial<PreferenciasIA> = {}
  for (const [k, x] of Object.entries(v)) {
    if (k === 'esfuerzo') {
      if (typeof x !== 'string' || (x !== '' && !Validar.esfuerzos.has(x))) throw new ErrorAPI(400, '«ia.esfuerzo» tiene que ser "", low, medium, high, xhigh o max.')
      r.esfuerzo = x
    } else if (k === 'colegas' || k === 'mcpLocales') {
      if (typeof x !== 'boolean') throw new ErrorAPI(400, `«ia.${k}» tiene que ser verdadero o falso.`)
      r[k] = x
    } else if (k === 'skills') {
      const m = modoSkillsDe(x)
      if (!m) throw new ErrorAPI(400, '«ia.skills» tiene que ser resumidas, completas, agente o ninguna.')
      r.skills = m
    } else if (k === 'memoria') {
      if (!esMemoriaIA(x)) throw new ErrorAPI(400, '«ia.memoria» tiene que ser "completa" o "liviana".')
      r.memoria = x
    } else throw new ErrorAPI(400, `«ia.${k}» no existe (esfuerzo, skills, memoria, colegas, mcpLocales).`)
  }
  return r
}

/** `alAbrir`: ganchos al abrir una oficina (reclamar chats de Próspera, escanear vínculos), se suman al portar esos módulos.
 *  `ocupada`: si hay agentes trabajando en esa oficina (no se puede borrar mientras tanto). */
export function rutasOficinas({ config, oficinas, claude, alAbrir = [], ocupada = () => false }: {
  config: Config; oficinas: Oficinas; claude: InfoClaude; alAbrir?: ((a: OficinaActiva) => Promise<void>)[]
  ocupada?: (carpeta: string) => boolean
}): RutaNucleo {
  async function estado(): Promise<Obj> {
    const bin = claude.claudePath()
    const a = bin !== undefined ? ((await claude.auth()) ?? null) : null
    const act = oficinas.activa()
    return {
      app: 'prospera-hq', version: config.version, claude: bin !== undefined,
      agentes: (act?.oficina.agentes.map((x) => x.id) ?? []).sort(), auth: a,
      claudePath: bin ?? null, oficina: act ? act.resumen : null,
      perfil: perfilJSON(oficinas.perfilActual()), modo_permisos: config.modoPermisos ?? null,
      conectores_agentes: config.conectoresAgentes ?? 'por_agente',
      modelos: config.modelosEfectivos, ia: config.iaEfectiva,
    }
  }

  function crearOficina(body?: Buffer): Resp {
    const d = objeto(body)
    const nombre = Validar.texto(d.nombre, 'nombre', 80)!
    const duenio = Validar.texto(d.duenio, 'duenio', 80, false) ?? ''
    const carpeta = Validar.texto(d.carpeta, 'carpeta', 1024, false)
    let deps: DepartamentoNuevo[] | undefined
    if (d.departamentos !== undefined && d.departamentos !== null) {
      if (!Array.isArray(d.departamentos)) throw new ErrorAPI(400, '«departamentos» tiene que ser una lista.')
      deps = d.departamentos.map((x): DepartamentoNuevo => {
        if (typeof x === 'string') return { nombre: x }
        if (!esObjeto(x)) throw new ErrorAPI(400, 'Cada departamento es un texto o un objeto {nombre, color?}.')
        return { id: Validar.texto(x.id, 'id', 41, false), nombre: Validar.texto(x.nombre, 'nombre', 60)!, color: Validar.texto(x.color, 'color', 7, false) }
      })
    }
    const vacia = d.vacia === true
    return [200, sobreOficina(oficinas.crear({ nombre, duenio, carpeta, departamentos: deps, vacia }))]
  }

  return async ({ method, partes, query, body }) => {
    const [, seccion, a2] = partes
    const n = partes.length
    if (seccion === 'estado' && n === 2) return method === 'GET' ? [200, await estado()] : no405
    if (seccion === 'perfil' && n === 2) {
      if (method === 'GET') return [200, { perfil: perfilJSON(oficinas.perfilActual()) }]
      if (method === 'PUT') {
        const d = objeto(body)
        const nombre = Validar.texto(d.nombre, 'nombre', 80, false) ?? ''
        const [p, a] = oficinas.guardarPerfil({ nombre, avatar: avatarValido(d.avatar) })
        return [200, { perfil: perfilJSON(p), oficina: oficinaJSON(a.oficina) }]
      }
      return no405
    }
    if (seccion === 'preferencias' && n === 2) {
      const prefs = () => ({ modo_permisos: config.modoPermisos ?? null, conectores_agentes: config.conectoresAgentes ?? 'por_agente', modelos: config.modelosEfectivos, ia: config.iaEfectiva })
      if (method === 'GET') return [200, prefs()]
      if (method === 'PUT') {
        const d = objeto(body)
        const hayModo = d.modo_permisos !== undefined
        const hayConectores = d.conectores_agentes !== undefined
        const hayModelos = d.modelos !== undefined
        const hayIA = d.ia !== undefined
        if (!hayModo && !hayConectores && !hayModelos && !hayIA) throw new ErrorAPI(400, 'Falta «modo_permisos», «conectores_agentes», «modelos» o «ia».')
        const modelos = hayModelos ? modelosPedidos(d.modelos) : undefined
        const ia = hayIA ? iaPedida(d.ia) : undefined
        if (hayModo && !esModoPermisos(d.modo_permisos)) throw new ErrorAPI(400, '«modo_permisos» tiene que ser "auto" o "preguntar".')
        if (hayConectores && !esConectoresAgentes(d.conectores_agentes)) throw new ErrorAPI(400, '«conectores_agentes» tiene que ser "todos" o "por_agente".')
        if (esModoPermisos(d.modo_permisos)) oficinas.guardarModoPermisos(d.modo_permisos)
        if (esConectoresAgentes(d.conectores_agentes)) oficinas.guardarConectoresAgentes(d.conectores_agentes)
        if (modelos) oficinas.guardarModelos(modelos)
        if (ia) oficinas.guardarIA(ia)
        return [200, prefs()]
      }
      return no405
    }
    if (seccion === 'oficinas' && n === 2) {
      if (method === 'GET') return [200, { oficinas: oficinas.listar(), activa: oficinas.activa()?.carpeta ?? null }]
      if (method === 'POST') return crearOficina(body)
      return no405
    }
    if (seccion === 'oficinas' && n === 3 && a2 === 'abrir') {
      if (method !== 'POST') return no405
      const d = objeto(body)
      const a = oficinas.abrir(Validar.texto(d.carpeta, 'carpeta', 1024)!)
      for (const f of alAbrir) await f(a)
      return [200, sobreOficina(a)]
    }
    if (seccion === 'oficina' && n === 2) {
      if (method === 'GET') return [200, sobreOficina(oficinas.requerirActiva())]
      if (method === 'PATCH') {
        const d = objeto(body)
        const a = oficinas.editar(Validar.texto(d.nombre, 'nombre', 80, false), Validar.texto(d.duenio, 'duenio', 80, false))
        return [200, sobreOficina(a)]
      }
      if (method === 'DELETE') {
        const a = oficinas.requerirActiva()
        if (ocupada(a.carpeta)) throw new ErrorAPI(409, 'Hay agentes trabajando en esta oficina. Esperá a que terminen para borrarla.')
        oficinas.borrar(a.carpeta)
        return [200, { ok: true, carpeta: a.carpeta }]
      }
      return no405
    }
    if (seccion === 'oficina' && n === 3 && a2 === 'ia') {
      // `PUT /api/oficina/ia` {skills?, mcp?, conectores?}: lo habilitado para los agentes de la oficina. Cada clave:
      // ausente = no se toca; null = todo (sin tope); lista = solo eso ([] = nada).
      if (method !== 'PUT') return no405
      const d = objeto(body)
      for (const k of Object.keys(d)) if (k !== 'skills' && k !== 'mcp' && k !== 'conectores') throw new ErrorAPI(400, `«${k}» no existe (skills, mcp, conectores).`)
      const cambios: Partial<Record<keyof IAOficina, string[] | null>> = {}
      for (const k of ['skills', 'mcp', 'conectores'] as const) {
        const l = Habilitados.lista(d[k], k, { espacios: k === 'conectores' })
        if (l !== undefined) cambios[k] = l
      }
      const [, a] = oficinas.modificar((o) => {
        const ia: IAOficina = { ...(o.ia ?? {}) }
        for (const [k, l] of Object.entries(cambios) as [keyof IAOficina, string[] | null][]) { if (l === null) delete ia[k]; else ia[k] = l }
        if (Object.keys(ia).length === 0) delete o.ia
        else o.ia = ia
      })
      return [200, sobreOficina(a)]
    }
    if (seccion === 'agentes' && n === 2) {
      if (method === 'GET') return [200, { agentes: oficinas.requerirActiva().oficina.agentes.map(agenteJSON) }]
      if (method !== 'POST') return no405
      // POST (contratar) llega con el módulo de agentes
    }
    return null
  }
}
