// Rutas de las skills propias de cada agente (skills-propias.ts), sus propuestas y cómo nacen:
// - `GET/POST /api/agentes/<id>/skills`, `GET/PUT/DELETE /api/agentes/<id>/skills/<nombre>`: la ficha del agente.
// - `DELETE /api/agentes/<id>/propuestas-skill/<pid>`: descartar una propuesta (aceptarla = POST con `propuesta`).
// - `POST /api/chat/skill` {agent, session}: lee una charla y arma un borrador de skill (no guarda nada; la persona lo
//   revisa en la interfaz y recién ahí lo guarda con POST). Como «Sacar tareas», corre aparte (`correrSinAgente`).
// - herramienta MCP `proponer_skill`: el agente sugiere una skill suya; queda como propuesta y como aviso «te necesita».
import { ClaudeError } from './claude-runner.js'
import { ChatTareas } from './chat-tareas.js'
import { mcpDe, sanear } from './consultas.js'
import { ErrorAPI } from './errores.js'
import { esObjeto, objeto, type Obj } from './json.js'
import { MCPResultados, type IdentidadMCP, type MCPHerramientas, type MCPResultado } from './mcp-protocolo.js'
import { OficinaStore, type AgenteDef, type Oficina } from './oficina.js'
import type { OficinaActiva } from './oficinas.js'
import { atrapar, no405, type Query, type SubRouter } from './router.js'
import { registrarModulo, type Servicios } from './servicios.js'
import { Propuestas, SkillsPropias } from './skills-propias.js'
import type { Mensaje } from './store.js'
import { CajaCosto } from './stream.js'
import { Slug, largo, prefijo, uuidValido } from './validar.js'

export const ChatSkill = {
  marca: 'Sos quien convierte una charla en una skill',

  prompt(p: { oficina: Oficina; agente: AgenteDef; mensajes: Mensaje[]; existentes: string[] }): string {
    const { oficina: of, agente: a } = p
    const persona = of.duenio === '' ? 'la persona dueña de la oficina' : of.duenio
    const ya = p.existentes.length > 0 ? `\n${a.nombre} ya tiene estas skills: ${p.existentes.join(', ')}. No repitas una; si la charla mejora una de esas, usá su mismo nombre.` : ''
    return `${ChatSkill.marca} de Claude Code para un agente de la oficina «${of.nombre}». ${persona} charló con ${a.nombre} (${a.rol}) y quiere guardar lo que sirve de esa charla como una skill de ${a.nombre}: instrucciones que va a leer la próxima vez que le pidan algo parecido.${ya}

Charla:
${ChatTareas.transcripcion(p.mensajes, of, a)}

Devolvé SOLO un objeto JSON estricto (sin texto antes ni después, sin bloques de código) con esta forma:
{"nombre": "nombre-de-la-skill", "descripcion": "cuándo usarla", "contenido": "las instrucciones en markdown"}
Si en la charla no hay nada que valga la pena repetir (un procedimiento, un formato, criterios, pasos), devolvé {"nada": "por qué, en una frase"}.
Reglas:
- "nombre": en minúsculas, con números y guiones, sin acentos (por ejemplo "resumen-semanal-de-ventas"), hasta ${SkillsPropias.maxNombre} caracteres.
- "descripcion": una o dos frases que digan QUÉ hace y CUÁNDO usarla («Usala cuando te pidan…»): el agente la ve en una lista y por eso decide si la carga. Hasta ${SkillsPropias.maxDescripcion} caracteres.
- "contenido": quien la lea NO vio la charla. Escribí el procedimiento completo y general (no solo el caso de esta charla): pasos, criterios, formato de lo que se entrega, datos fijos que se mencionaron (nombres, direcciones, plantillas) y errores a evitar que hayan salido en la charla. Usá títulos y listas de markdown. Nada de datos sensibles (contraseñas, números de tarjeta). Hasta 6000 caracteres.`
  },

  /** Respuesta del modelo → borrador; `{nada}` si no hay nada para guardar; undefined si no se puede leer. */
  parsear(t: string): { nombre: string; descripcion: string; contenido: string } | { nada: string } | undefined {
    const i = t.indexOf('{')
    const j = t.lastIndexOf('}')
    if (i < 0 || j <= i) return undefined
    let o: unknown
    try { o = JSON.parse(t.slice(i, j + 1)) } catch { return undefined }
    if (!esObjeto(o)) return undefined
    if (typeof o.nada === 'string' && typeof o.contenido !== 'string') return { nada: o.nada.trim() }
    const contenido = typeof o.contenido === 'string' ? o.contenido.trim() : ''
    if (contenido === '') return undefined
    const descripcion = (typeof o.descripcion === 'string' ? o.descripcion : '').replace(/\s+/g, ' ').trim()
    const nombre = SkillsPropias.slug(typeof o.nombre === 'string' ? o.nombre : '') || 'skill-nueva'
    return { nombre, descripcion: prefijo(descripcion, SkillsPropias.maxDescripcion), contenido: prefijo(contenido, SkillsPropias.maxContenido) }
  },
}

/** Skills de Claude Code instaladas por la persona (sin las propias de esta oficina): sus nombres no se pueden usar. */
const ocupados = (s: Servicios, carpeta: string) => {
  const propias = new Set(SkillsPropias.listar(carpeta).map((x) => x.nombre))
  return (s.runner.skills.lista ?? []).filter((x) => !propias.has(x))
}

function requerirAgente(act: OficinaActiva, id: string): AgenteDef {
  const def = Slug.valido(id) ? act.oficina.agentes.find((a) => a.id === id) : undefined
  if (!def) throw new ErrorAPI(404, 'No existe ese agente.')
  return def
}

/** Lo que muestra la ficha: sus skills y las propuestas sin revisar. */
function listado(carpeta: string, agente: string): Obj {
  const skills = SkillsPropias.delAgente(carpeta, agente)
  const nombres = new Set(skills.map((x) => x.nombre))
  return {
    skills: skills.map(SkillsPropias.json),
    propuestas: Propuestas.delAgente(carpeta, agente).map((p) => Propuestas.json(p, nombres.has(p.nombre))),
  }
}

export class SkillsRouter implements SubRouter {
  private readonly timeout: number
  private readonly enCurso = new Set<string>()

  constructor(private readonly s: Servicios) {
    const n = Number(s.env.HQ_CHAT_TAREAS_TIMEOUT)
    this.timeout = s.env.HQ_CHAT_TAREAS_TIMEOUT !== undefined && s.env.HQ_CHAT_TAREAS_TIMEOUT !== '' && Number.isFinite(n) ? n : 180
  }

  async handle(method: string, path: string, _q: Query, body?: Buffer) {
    if (path === '/api/chat/skill') return atrapar(() => (method === 'POST' ? this.desdeCharla(body) : Promise.resolve(no405)))
    const p = path.split('/').slice(1)
    if (p[0] !== 'api' || p[1] !== 'agentes' || p.length < 4 || (p[3] !== 'skills' && p[3] !== 'propuestas-skill')) return null
    return atrapar(async () => {
      const act = this.s.oficinas.requerirActiva()
      const def = requerirAgente(act, p[2]!)
      if (p[3] === 'propuestas-skill') {
        if (p.length !== 5) return [404, { error: 'no' }]
        if (method !== 'DELETE') return no405
        if (!Propuestas.quitar(act.carpeta, def.id, p[4]!)) throw new ErrorAPI(404, 'No existe esa propuesta.')
        this.s.log.info(`skills: propuesta descartada agente=${def.id}`)
        return [200, listado(act.carpeta, def.id)]
      }
      if (p.length === 4) {
        if (method === 'GET') return [200, listado(act.carpeta, def.id)]
        if (method !== 'POST') return no405
        const d = objeto(body)
        const propuesta = typeof d.propuesta === 'string' ? d.propuesta : undefined
        const existente = SkillsPropias.leer(act.carpeta, typeof d.nombre === 'string' ? d.nombre.trim() : '')
        // aceptar una propuesta que mejora una skill que ya tiene: se reescribe
        const nueva = !(propuesta !== undefined && existente?.agente === def.id)
        const sk = SkillsPropias.guardar(act.carpeta, def.id, d, { nueva, ocupados: ocupados(this.s, act.carpeta) })
        if (propuesta !== undefined) Propuestas.quitar(act.carpeta, def.id, propuesta)
        this.s.log.info(`skills: ${nueva ? 'creada' : 'actualizada'} agente=${def.id} nombre=${sk.nombre}${propuesta ? ' (propuesta)' : ''}`)
        return [200, { skill: SkillsPropias.json(sk), ...listado(act.carpeta, def.id) }]
      }
      if (p.length !== 5) return [404, { error: 'no' }]
      const nombre = p[4]!
      switch (method) {
        case 'GET': {
          const sk = SkillsPropias.leer(act.carpeta, nombre)
          if (!sk || sk.agente !== def.id) throw new ErrorAPI(404, 'No existe esa skill.')
          return [200, { skill: SkillsPropias.json(sk) }]
        }
        case 'PUT': {
          const sk = SkillsPropias.guardar(act.carpeta, def.id, { ...objeto(body), nombre }, { nueva: false })
          return [200, { skill: SkillsPropias.json(sk), ...listado(act.carpeta, def.id) }]
        }
        case 'DELETE':
          SkillsPropias.borrar(act.carpeta, def.id, nombre)
          this.s.log.info(`skills: borrada agente=${def.id} nombre=${nombre}`)
          return [200, listado(act.carpeta, def.id)]
        default: return no405
      }
    })
  }

  /** `POST /api/chat/skill` {agent, session} → {borrador: {nombre, descripcion, contenido}} o {borrador: null, motivo}. */
  private async desdeCharla(body?: Buffer): Promise<[number, Obj]> {
    const { store, runner, oficinas, log } = this.s
    const act = oficinas.requerirActiva()
    const b = objeto(body)
    const def = typeof b.agent === 'string' ? act.oficina.agentes.find((a) => a.id === b.agent) : undefined
    if (!def || typeof b.session !== 'string' || !uuidValido(b.session)) return [400, { error: 'pedido inválido' }]
    const sid = b.session.toLowerCase()
    if (store.agenteDe(sid) !== def.id || store.oficinaDe(sid) !== act.carpeta) return [404, { error: 'No encontré esa charla.' }]
    const mensajes = store.mensajes(sid).filter((m) => !m.e)
    if (!mensajes.some((m) => m.r === 'u')) return [200, { borrador: null, motivo: 'La charla todavía está vacía.' }]
    const clave = act.carpeta + '\u001f' + sid
    if (this.enCurso.has(clave)) return [409, { error: 'Ya estoy leyendo esta charla.' }]
    this.enCurso.add(clave)
    const caja = new CajaCosto()
    try {
      const existentes = SkillsPropias.delAgente(act.carpeta, def.id).map((x) => x.nombre)
      let t: string
      try {
        t = await runner.correrSinAgente(ChatSkill.prompt({ oficina: act.oficina, agente: def, mensajes, existentes }), { timeout: this.timeout, cwd: act.carpeta, obs: caja.observador() })
      } catch (e) {
        if (e instanceof ClaudeError) return [502, { error: e.mensaje }]
        throw e
      }
      const r = ChatSkill.parsear(t)
      if (!r) return [502, { error: 'No pude leer el borrador de la skill. Probá de nuevo.' }]
      if ('nada' in r) return [200, { borrador: null, motivo: r.nada || 'En esta charla no encontré un procedimiento para guardar.' }]
      log.info(`chat-skill agente=${def.id} sid=${sid.slice(0, 8)} nombre=${r.nombre}`)
      return [200, { borrador: { ...r, existente: existentes.includes(r.nombre) } }]
    } finally {
      this.enCurso.delete(clave)
      store.registrarCosto({ oficina: act.carpeta, agente: def.id, origen: 'chat-skill', ref: sid, costo: caja.valor })
    }
  }
}

// MARK: - herramienta MCP

export class HerramientasSkills implements MCPHerramientas {
  constructor(private readonly s: Servicios, private readonly token: string, private readonly identidad: IdentidadMCP) {}

  get definiciones(): Obj[] {
    return [{
      name: 'proponer_skill',
      description: `Propone guardar una skill tuya (instrucciones que vas a leer la próxima vez que te pidan algo parecido): un procedimiento que se repite, un formato que te pidieron, criterios para decidir. NO la crea: la persona la revisa, la puede corregir y recién ahí existe. Si ya tenés una skill con ese nombre, es una propuesta para mejorarla. Máximo ${SkillsPropias.maxPorCorrida} por mensaje.`,
      inputSchema: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'en minúsculas con guiones, sin acentos (p. ej. "informe-semanal-de-ventas")' },
          descripcion: { type: 'string', description: 'qué hace y cuándo usarla, en una o dos frases («Usala cuando…»)' },
          contenido: { type: 'string', description: 'las instrucciones completas en markdown: pasos, criterios, formato, datos fijos. Quien la lea no vio esta charla.' },
          motivo: { type: 'string', description: 'por qué conviene guardarla, en una frase' },
        },
        required: ['nombre', 'descripcion', 'contenido'],
      },
    }]
  }

  async llamar(nombre: string, args: Obj): Promise<MCPResultado | undefined> {
    if (nombre !== 'proponer_skill') return undefined
    const carpeta = this.identidad.oficina
    let o: Oficina
    try { o = OficinaStore.leer(carpeta) } catch { return MCPResultados.error('No pude leer la oficina.') }
    const ag = o.agentes.find((a) => a.id === this.identidad.agente)
    if (!ag) return MCPResultados.error('No pude leer la oficina.')
    let v: { nombre: string; descripcion: string; contenido: string }
    try {
      v = SkillsPropias.validar({ nombre: typeof args.nombre === 'string' ? SkillsPropias.slug(args.nombre) : '', descripcion: args.descripcion, contenido: args.contenido })
    } catch (e) {
      return MCPResultados.error(e instanceof ErrorAPI ? e.mensaje : 'La propuesta no es válida.')
    }
    const existente = SkillsPropias.leer(carpeta, v.nombre)
    if (existente && existente.agente !== ag.id) return MCPResultados.error('Otro agente ya tiene una skill con ese nombre. Elegí otro.')
    if (!existente && ocupados(this.s, carpeta).includes(v.nombre)) return MCPResultados.error('Ya hay una skill instalada con ese nombre. Elegí otro.')
    const tokens = mcpDe(this.s)?.tokens
    if (tokens && !tokens.tomar(this.token, SkillsPropias.claveCupo, SkillsPropias.maxPorCorrida)) {
      return MCPResultados.error(`Ya propusiste ${SkillsPropias.maxPorCorrida} skills en este mensaje y no podés proponer más.`)
    }
    let motivo = sanear(typeof args.motivo === 'string' ? args.motivo : '').trim()
    if (largo(motivo) > SkillsPropias.maxMotivo) motivo = prefijo(motivo, SkillsPropias.maxMotivo)
    try {
      Propuestas.crear(carpeta, { agente: ag.id, ...v, motivo, ...(this.identidad.sid !== '' ? { sid: this.identidad.sid } : {}) })
    } catch (e) {
      return MCPResultados.error(e instanceof ErrorAPI ? e.mensaje : 'No pude guardar la propuesta.')
    }
    this.s.log.info(`skills: propuesta agente=${ag.id} nombre=${v.nombre}`)
    const jefe = o.duenio.trim() === '' ? 'la persona' : o.duenio.trim()
    return MCPResultados.ok(`Propuesta de skill «${v.nombre}» guardada${existente ? ' (mejora la que ya tenés)' : ''}: ${jefe} la revisa y, si la acepta, la vas a tener desde el próximo mensaje. Todavía no existe.`)
  }
}

export function instalar(s: Servicios) {
  s.router.registrarExtra(new SkillsRouter(s))
  mcpDe(s)?.registrarHerramientas((s2, token, identidad) => (identidad.perfil === 'creador' ? undefined : new HerramientasSkills(s2, token, identidad)))
  // propuestas sin revisar: «te necesita» hasta que se guarden o se descarten
  s.avisos.fuentes.push((_st, oficina) => {
    const ps = Propuestas.lista(oficina)
    if (ps.length === 0) return []
    let o: Oficina | undefined
    try { o = OficinaStore.leer(oficina) } catch { return [] }
    return ps.map((p) => {
      const ag = o!.agentes.find((a) => a.id === p.agente)
      return { id: `skill:${p.id}`, tipo: 'skill', agente: p.agente, ref: p.id, creado: p.creada, texto: `${ag?.nombre ?? 'Un agente'} propone guardar la skill «${p.nombre}»` }
    })
  })
}

registrarModulo('skills-propias', 79, instalar)
