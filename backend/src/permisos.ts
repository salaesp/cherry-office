// Permisos por agente y construcción del comando exacto de `claude` (Permisos.swift), más las piezas que usa:
// instrucciones (Instrucciones.swift), herramientas de conectores (ConectoresAgente), herramientas MCP propias
// (HerramientasMCPAgente) y el perfil de coordinador.
import fs from 'node:fs'
import path from 'node:path'
import { ClaudeRunner, type TurnoConPermiso } from './claude-runner.js'
import { Config, type MemoriaIA } from './config.js'
import { jsonCompacto } from './json-swift.js'
import { settingsSkills, type ModoSkills } from './skills.js'
import { Habilitados, prefijoMCP } from './habilitados.js'
import type { AgenteDef, AlcanceVinculo, Oficina } from './oficina.js'
import type { OficinaActiva } from './oficinas.js'
import { Validar, largo, prefijo } from './validar.js'

/** Carpeta de trabajo (cwd) y permisos de un agente dentro de su oficina (ContextoOficina de Swift). */
export type ContextoOficina = {
  carpeta: string
  escritura: string[]
  dirsExtra: string[]
  /** URL del servidor MCP de la oficina; undefined = el chat corre sin consultas a colegas. */
  mcpUrl?: string
  /** Texto para `--append-system-prompt`. */
  instrucciones?: string
  /** Herramientas MCP propias del agente; undefined equivale a `herramientasMCP`. */
  herramientasMCP?: string[]
  /** Herramientas base; undefined equivale a las de la config. */
  herramientasBase?: string
  /** Herramientas de conectores permitidas (`--allowedTools`). */
  permitidas: string[]
  /** Herramientas vedadas (`--disallowedTools`). */
  vedadas: string[]
  /** Perfil del token del servidor MCP: agente | coordinador | creador. */
  perfilMCP: string
  /** Reglas guardadas del agente (`AgenteDef.reglas`): van a `--allowedTools` en todas sus corridas. */
  reglas?: string[]
  /** Chat con la persona presente: lo no permitido se le pregunta (`--permission-prompt-tool`) en vez de rechazarse. */
  preguntar?: boolean
  /** Corrida sin la persona (tareas): Bash, Edit y Write visibles pero en `dontAsk`; lo no permitido se rechaza, queda en
   *  `permission_denials` y se guarda como pedido pendiente (permisos-tareas.ts). */
  anotarRechazos?: boolean
  /** Modo «todos los conectores» (preferencia de la app): el hijo espera a que se conecten aunque todavía no haya catálogo. */
  todosConectores?: boolean
  /** Modelo de esta corrida (`--model`): pisa el del `.md` del agente. undefined = el del `.md`. */
  modelo?: string
  /** Esfuerzo de esta corrida (`--effort`). undefined = el de la app (Ajustes › Consumo de IA) o el de Claude Code. */
  esfuerzo?: string
  /** Lo elegido en la charla o reunión; undefined = lo de Ajustes › Consumo de IA (`Config.ia`). */
  skills?: ModoSkills
  memoria?: MemoriaIA
  colegas?: boolean
  mcpLocales?: boolean
  /** Skills que puede usar el agente (oficina + ficha, habilitados.ts). undefined = todas (en modo `agente`: ninguna). */
  skillsElegidas?: string[]
  /** Servidores MCP de Claude Code que puede usar el agente (oficina + ficha). undefined = todos. */
  mcpElegidos?: string[]
}

/** Herramientas MCP para hablar con colegas (consultar, pedir, esperar): se sacan con «Consultar a colegas» apagado. */
export const herramientasColegas = ['consultar', 'colegas', 'quien_sabe', 'pedir', 'quedo_esperando', 'cancelar_espera'].map((n) => 'mcp__hq__' + n)

/** Se suma a las instrucciones con la memoria en modo liviano: la plantilla del agente le pide leer la memoria al empezar
 *  (verificado con el claude real: esto lo pisa y el mensaje sale en un solo viaje). */
export const textoMemoriaLiviana = '## Memoria (modo liviano)\nEn esta corrida NO leas al empezar conocimiento/oficina.md, conocimiento/indice.md ni conocimiento/decisiones.md. Respondé con lo que ya sabés; buscá (buscar) o leé un archivo puntual solo si lo que te piden no se puede resolver sin eso.'

/** Instrucciones + el aviso de memoria liviana si corresponde. */
export function conMemoria(instrucciones: string | undefined, memoria: MemoriaIA): string | undefined {
  if (memoria !== 'liviana') return instrucciones
  return instrucciones ? instrucciones + '\n\n' + textoMemoriaLiviana : textoMemoriaLiviana
}

/** Lo que vale en esta corrida: lo del contexto (charla, reunión o agente) o, si no, lo de la app. */
export function opcionesEfectivas(cfg: Config, ctx: ContextoOficina): { esfuerzo?: string; skills: ModoSkills; memoria: MemoriaIA; colegas: boolean; mcpLocales: boolean } {
  const g = cfg.iaEfectiva
  const esfuerzo = ctx.esfuerzo ?? (g.esfuerzo !== '' ? g.esfuerzo : undefined)
  return { ...(esfuerzo !== undefined ? { esfuerzo } : {}), skills: ctx.skills ?? g.skills, memoria: ctx.memoria ?? g.memoria, colegas: ctx.colegas ?? g.colegas,
    mcpLocales: ctx.mcpLocales ?? g.mcpLocales }
}

/** Skills de la corrida: undefined = todas; en modo `agente` sin lista, ninguna. */
function skillsDeCorrida(cfg: Config, ctx: ContextoOficina): string[] | undefined {
  const m = opcionesEfectivas(cfg, ctx).skills
  if (m === 'ninguna') return []
  return ctx.skillsElegidas ?? (m === 'agente' ? [] : undefined)
}

/** ¿La corrida lleva la herramienta Skill? No con `ninguna`, ni si la lista que queda está vacía. */
function conSkill(cfg: Config, ctx: ContextoOficina): boolean {
  const l = skillsDeCorrida(cfg, ctx)
  return l === undefined || l.length > 0
}

/** Reglas para vedar los servidores MCP de Claude Code que el agente no usa (los del catálogo que no están elegidos).
 *  Sin catálogo todavía, no se puede vedar por nombre: no se veda nada. */
function mcpVedados(cfg: Config, ctx: ContextoOficina): string[] {
  if (!ctx.mcpElegidos) return []
  const elegidos = new Set(ctx.mcpElegidos)
  return (cfg.mcpInstalados() ?? []).filter((n) => !elegidos.has(n)).map(prefijoMCP)
}

/** ¿Usa conectores de claude.ai? (`--strict-mcp-config` los dejaría afuera: con ellos no se aplica). */
const usaConectores = (ctx: ContextoOficina) => !!ctx.todosConectores || ctx.permitidas.some((p) => p.startsWith('mcp__claude_ai_'))

/** Herramientas MCP de la corrida (sin las de colegas si están apagadas). */
function mcpDe(cfg: Config, ctx: ContextoOficina): string[] {
  const l = ctx.herramientasMCP ?? herramientasMCP
  return opcionesEfectivas(cfg, ctx).colegas ? l : l.filter((h) => !herramientasColegas.includes(h))
}

/** Un servidor MCP de la cuenta (catálogo de conectores de claude.ai). */
export type ServidorConector = { nombre: string; prefijo: string; estado: string; herramientas: string[] }

/** Herramientas MCP del servidor propio (`hq`): consultar a un colega, ver quiénes son, saber quién sabe de un tema,
 *  buscar en lo que ya se sabe y marcar algo como desactualizado (estas tres las sirve conocimiento.ts). */
export const herramientasMCP = ['mcp__hq__consultar', 'mcp__hq__colegas', 'mcp__hq__quien_sabe', 'mcp__hq__buscar', 'mcp__hq__marcar_obsoleto', 'mcp__hq__anotar']
/** Variable de entorno con el token del servidor MCP (así no aparece en los argumentos del proceso). */
export const variableTokenMCP = 'HQ_MCP_TOKEN'
/** Lo que un agente puede pedir en un chat (además de lo que ya tiene): comandos y escribir archivos. */
export const herramientasPreguntables = ['Bash', 'Edit', 'Write']
/** Herramienta de `hq` que contesta los pedidos de permiso (`--permission-prompt-tool`). */
export const herramientaPermiso = 'mcp__hq__pedir_permiso'

export const esCoordinador = (a: AgenteDef) => a.permisos?.includes('coordinador') ?? false

export const Coordinador = {
  nombresMCP: ['estado_oficina', 'entregas', 'corridas', 'bloqueos', 'encargar'],
  perfil: (_o: Oficina, a: AgenteDef) => (esCoordinador(a) ? 'coordinador' : 'agente'),
  herramientasMCP: (_o: Oficina, a: AgenteDef) => (esCoordinador(a) ? Coordinador.nombresMCP.map((n) => 'mcp__hq__' + n) : []),
}

/** Herramientas de dependencias entre agentes (`pedir`, …): las ve todo agente, no solo un perfil. */
export const Dependencias = {
  nombresMCP: ['pedir', 'quedo_esperando', 'cancelar_espera'],
  herramientasMCP: () => Dependencias.nombresMCP.map((n) => 'mcp__hq__' + n),
}

export const Acciones = {
  herramientaPropuesta: 'mcp__hq__proponer_accion',
  /** Herramientas de actuar que el agente tiene asignadas (nombres completos). */
  actuar(a: AgenteDef): string[] {
    const out: string[] = []
    for (const h of (a.conectores ?? []).flatMap((c) => c.actuar)) if (!out.includes(h)) out.push(h)
    return out
  },
  herramientasMCP: (_o: Oficina, a: AgenteDef) => (Acciones.actuar(a).length === 0 ? [] : [Acciones.herramientaPropuesta]),
}

/** Prefijos del nombre corto de las herramientas que solo leen (también en camelCase); el resto actúa. */
export const prefijosLeer = ['list', 'get', 'search', 'read', 'find', 'fetch', 'download', 'query', 'lookup', 'suggest']

/** `leer` si el nombre corto empieza con uno de `prefijosLeer`; `actuar` si no. Ante la duda, actuar. */
export function clasificarHerramienta(corto: string): 'leer' | 'actuar' {
  const c = corto.toLowerCase()
  return prefijosLeer.some((p) => c.startsWith(p)) ? 'leer' : 'actuar'
}

/** Preferencia «todos los conectores para todos los agentes» (`conectores_agentes: "todos"` en config.json). */
export const TodosConectores = {
  activo: (cfg: Config | undefined) => cfg?.conectoresAgentes === 'todos',
  /** El agente como lo ven sus corridas: en modo «todos», con cada conector conectado de la cuenta asignado entero
   *  (las de leer, libres; las de actuar, por `proponer_accion` y la aprobación de la persona, como siempre). Sin el
   *  modo o sin catálogo, el agente tal cual. */
  agente(cfg: Config | undefined, a: AgenteDef, catalogo: ServidorConector[] | undefined, o?: Oficina): AgenteDef {
    // lo que la oficina no habilita no llega a ningún agente (habilitados.ts)
    if (!TodosConectores.activo(cfg) || !catalogo) return o ? Habilitados.conectoresAgente(o, a) : a
    const conectores = catalogo.filter((s) => s.estado === 'connected' && s.herramientas.length > 0 && (!o || Habilitados.conectorHabilitado(o, s.nombre))).map((s) => ({
      servidor: s.nombre,
      leer: s.herramientas.filter((h) => clasificarHerramienta(cortoHerramienta(h)) === 'leer'),
      actuar: s.herramientas.filter((h) => clasificarHerramienta(cortoHerramienta(h)) === 'actuar'),
    }))
    return { ...a, conectores }
  },
}

/** Leer los chats de WhatsApp elegidos (whatsapp.ts): solo los agentes con el permiso «whatsapp». */
export const WhatsAppAgente = {
  permiso: 'whatsapp',
  nombresMCP: ['whatsapp_chats', 'whatsapp_leer', 'whatsapp_imagen', 'whatsapp_buscar'],
  /** Permiso general: lee todos los chats elegidos. */
  puede: (a: AgenteDef) => a.permisos?.includes('whatsapp') ?? false,
  /** Chats de la fuente WhatsApp de la secretaría, si este agente la atiende (secretaria.ts); undefined si no. */
  chatsSecretaria(o: Oficina, a: AgenteDef): string[] | undefined {
    const sec = o.secretaria
    if (!sec || sec.agente !== a.id || sec.activa === false || !Array.isArray(sec.fuentes)) return undefined
    const f = (sec.fuentes as unknown[]).find((x) => typeof x === 'object' && x !== null && (x as { id?: unknown }).id === 'whatsapp') as { chats?: unknown } | undefined
    if (!f) return undefined
    return Array.isArray(f.chats) ? f.chats.filter((c): c is string => typeof c === 'string') : []
  },
  herramientasMCP: (o: Oficina, a: AgenteDef) =>
    (WhatsAppAgente.puede(a) || WhatsAppAgente.chatsSecretaria(o, a) !== undefined ? WhatsAppAgente.nombresMCP.map((n) => 'mcp__hq__' + n) : []),
}

/** La memoria privada de la secretaría (secretaria-memoria.ts): solo para quien atiende la secretaría, en las revisiones y
 *  en la charla. Los demás agentes no tienen estas herramientas. */
export const MemoriaSecretariaAgente = {
  nombresMCP: [
    'memoria_diario_anotar', 'memoria_diario_leer', 'memoria_dia_resumir', 'memoria_semana_resumir', 'memoria_tema', 'memoria_temas',
    'memoria_tema_leer', 'memoria_ficha', 'memoria_ficha_leer', 'memoria_buscar', 'memoria_sugerir_compartir',
  ],
  /** ¿Este agente atiende la secretaría? (aunque esté en pausa: la memoria sigue siendo suya). */
  atiende: (o: Oficina, a: AgenteDef) => o.secretaria !== undefined && o.secretaria.agente === a.id,
  herramientasMCP: (o: Oficina, a: AgenteDef) => (MemoriaSecretariaAgente.atiende(o, a) ? MemoriaSecretariaAgente.nombresMCP.map((n) => 'mcp__hq__' + n) : []),
}

export const HerramientasMCPAgente = {
  lista(o: Oficina, a: AgenteDef): string[] {
    const out: string[] = []
    for (const h of [...herramientasMCP, ...Dependencias.herramientasMCP(), ...Coordinador.herramientasMCP(o, a), ...Acciones.herramientasMCP(o, a), ...WhatsAppAgente.herramientasMCP(o, a), ...MemoriaSecretariaAgente.herramientasMCP(o, a)]) if (!out.includes(h)) out.push(h)
    return out
  },
}

/** Nombre corto de una herramienta MCP (lo que sigue al último `__`). */
export function cortoHerramienta(nombre: string): string {
  const i = nombre.lastIndexOf('__')
  return i < 0 ? nombre : nombre.slice(i + 2)
}

export const ConectoresAgente = {
  /** Herramientas permitidas (leer + las de actuar aprobadas en esta corrida) y vedadas (el resto del catálogo). */
  herramientas(_o: Oficina, a: AgenteDef, catalogo: ServidorConector[] | undefined, actuar: string[]): { permitidas: string[]; vedadas: string[] } {
    const asignados = a.conectores ?? []
    const actuarAsignadas = new Set(asignados.flatMap((c) => c.actuar))
    const permitidas: string[] = []
    for (const h of [...asignados.flatMap((c) => c.leer), ...actuar.filter((x) => actuarAsignadas.has(x))]) if (!permitidas.includes(h)) permitidas.push(h)
    if (permitidas.length === 0) return { permitidas: [], vedadas: ['mcp__claude_ai_*'] }
    if (!catalogo) return { permitidas, vedadas: [] }
    const normalizar = (s: string) => { let t = s.trim().toLowerCase(); if (t.startsWith('claude.ai ')) t = t.slice('claude.ai '.length); return t }
    const nombres = new Set(asignados.map((c) => normalizar(c.servidor)))
    const vedadas: string[] = []
    for (const srv of catalogo) {
      const asignado = nombres.has(normalizar(srv.nombre)) || permitidas.some((p) => p.startsWith(srv.prefijo + '__'))
      if (!asignado) vedadas.push(srv.prefijo)
      else for (const h of srv.herramientas) if (!permitidas.includes(h)) vedadas.push(h)
    }
    return { permitidas, vedadas }
  },
}

/** Instrucciones inyectadas con `--append-system-prompt`: reglas, límites, conectores y rol de coordinador. */
export const Instrucciones = {
  maxCaracteres: 8000,
  /** `conMCP`: el agente corre con el servidor MCP de la oficina (chat, tareas, encargos): se le explica cómo pedirle algo a un colega. */
  /** `todos`: modo «todos los conectores»: se nombran los servidores sin listar cada herramienta (pueden ser cientos). */
  /** `enApp`: la respuesta la lee una persona en la app (chat, tareas, reuniones), no un colega: se le cuenta qué puede mostrar. */
  vistaEnApp: '## Cómo se ve lo que respondés\n'
    + 'Tu respuesta se muestra en la app de la oficina, que dibuja más que texto. Si te piden ver algo (una página, un diseño, una imagen, un gráfico), mostralo acá en vez de pasar un enlace o levantar un servidor local:\n'
    + '- Imágenes: `![descripción](ruta)` con la ruta de un archivo dentro de la carpeta de la oficina (relativa o absoluta) o una URL https.\n'
    + '- Páginas, gráficos y diagramas: un bloque de código ```html, ```svg o ```mermaid se ve como vista previa que se abre con un clic. El HTML tiene que ser autocontenido: estilos y scripts en línea, imágenes en línea (data:) o por https; no carga archivos locales ni llega a localhost.\n'
    + '- Los archivos que escribís dentro de la carpeta de la oficina aparecen como tarjetas al pie de tu respuesta; las imágenes y los .html, .svg y .mmd se abren ahí mismo.',
  para(o: Oficina, a: AgenteDef, { conMCP = false, todos = false, enApp = conMCP }: { conMCP?: boolean; todos?: boolean; enApp?: boolean } = {}): string | undefined {
    const d = o.duenio.trim()
    const jefe = d === '' ? 'la persona' : d
    const secciones: string[] = []
    const limpio = (s: string) => s.trim()

    const reglas = (o.reglas ?? []).map((r) => limpio(typeof (r as { texto?: unknown }).texto === 'string' ? (r as { texto: string }).texto : '')).filter((x) => x !== '')
    if (reglas.length > 0) secciones.push('## Reglas de la oficina\n' + reglas.map((r) => '- ' + r).join('\n'))

    const solo = (a.limites?.solo ?? []).map(limpio).filter((x) => x !== '')
    const proponer = (a.limites?.proponer ?? []).map(limpio).filter((x) => x !== '')
    const conectores = a.conectores ?? []
    const actuaConectores = conectores.some((c) => c.actuar.length > 0)
    if (solo.length > 0 || proponer.length > 0 || actuaConectores || reglas.length > 0) {
      const l = ['## Tus límites']
      if (solo.length > 0) l.push('Hacés solo: ' + solo.join('; ') + '.')
      if (proponer.length > 0) l.push(`Dejás como propuesta y esperás la aprobación de ${jefe}: ` + proponer.join('; ') + '.')
      l.push('Nunca hacés directo nada que salga de la oficina (mandar un mail, crear un evento, publicar, gastar): lo dejás como propuesta.')
      secciones.push(l.join('\n'))
    }

    const c: string[] = []
    if (todos) {
      const nombres = conectores.map((x) => x.servidor)
      if (nombres.length > 0) c.push('Tenés todos los conectores de la cuenta: ' + nombres.join(', ') + '. Leer y buscar, libre.')
      if (conectores.some((x) => x.actuar.length > 0)) c.push(`Para actuar con ellos (mandar, crear, publicar, borrar) usá la herramienta proponer_accion: ${jefe} la aprueba y recién ahí se ejecuta.`)
    }
    const leen = todos ? [] : conectores.filter((x) => x.leer.length > 0)
    if (leen.length > 0) c.push('Podés leer con: ' + leen.map((x) => `${x.servidor} (${x.leer.map(cortoHerramienta).join(', ')})`).join('; ') + '.')
    const actuan = todos ? [] : conectores.filter((x) => x.actuar.length > 0)
    if (actuan.length > 0) {
      c.push('Para actuar con ' + actuan.map((x) => `${x.servidor} (${x.actuar.map(cortoHerramienta).join(', ')})`).join('; ')
        + ` usá la herramienta proponer_accion: ${jefe} la aprueba y recién ahí se ejecuta.`)
    }
    if (c.length > 0) secciones.push('## Conectores\n' + c.join('\n'))

    if (esCoordinador(a)) {
      secciones.push('## Sos coordinador/a de la oficina\n'
        + 'Ves entregas, flujos y bloqueos de todos (herramientas estado_oficina, entregas, corridas, bloqueos) y podés repartir encargos (encargar). No hacés el trabajo de otros: lo pedís.')
    }
    if (conMCP) {
      secciones.push('## Si te falta algo de un colega\n'
        + 'Consultalo (consultar); si no lo tiene, pedíselo con pedir. Entregá lo que puedas marcando lo que falta y llamá a quedo_esperando: cuando tu colega entregue, la oficina te vuelve a encargar la versión completa.')
    }
    const trabajo = (o.carpetasTrabajo ?? []).filter((c) => alcanceIncluye(c.alcance, a)).map((c) => c.ruta)
    if (trabajo.length > 0) {
      secciones.push('## Carpetas de trabajo\n'
        + 'Además de la carpeta de la oficina, trabajás en: ' + trabajo.join(', ') + '. Ahí leés, editás y creás archivos (código, por ejemplo) como en la oficina, y la app muestra lo que escribas ahí (imágenes, páginas y tarjetas de archivos, con su ruta absoluta).')
    }
    // lo que la app dibuja (chat-rico.js): si no se le dice, el agente levanta un servidor o pasa un enlace en vez de mostrarlo
    if (enApp) secciones.push(Instrucciones.vistaEnApp)
    if (secciones.length === 0) return undefined
    const texto = secciones.join('\n\n')
    return largo(texto) > this.maxCaracteres ? prefijo(texto, this.maxCaracteres) : texto
  },
}

/** Catálogo de conectores de la cuenta (lo detecta el módulo de gobierno; hasta portarlo, ninguno). */
export type FuenteCatalogo = () => ServidorConector[] | undefined

// MARK: - modo sin oficina (legado de Próspera)

/** Rutas absolutas donde `agente` puede escribir (comodín "*" + las propias), `{id}` expandido. */
export function rutasEscritura(cfg: Config, agente: string): string[] {
  const out: string[] = []
  for (const r of [...(cfg.escritura['*'] ?? []), ...(cfg.escritura[agente] ?? [])]) {
    const r2 = r.replaceAll('{id}', agente)
    const abs = path.isAbsolute(r2) || r2 === '~' || r2.startsWith('~/')
    const p = Config.ruta(abs ? r2 : path.join(cfg.proyecto, r2), cfg.home)
    if (!out.includes(p)) out.push(p)
  }
  return out
}

/** `Edit(//abs/path)`: la doble barra marca una ruta absoluta para Claude Code. En Windows la ruta va con `/`
 *  (`Edit(//C:/Users/…)`): cómo la interpreta Claude Code queda para el spike de Windows (plan, riesgo 2). */
export function regla(herramienta: string, ruta: string): string {
  return `${herramienta}(//${ruta.replace(/\\/g, '/').replace(/^\/+/, '')})`
}

/** `--mcp-config` (JSON inline) del servidor `hq`: `Authorization: Bearer ${HQ_MCP_TOKEN}`, que claude expande. */
export function configMCP(url: string): string {
  return jsonCompacto({ mcpServers: { hq: { type: 'http', url, headers: { Authorization: `Bearer \${${variableTokenMCP}}` } } } })
}

// MARK: - oficinas

/** Dónde corre un agente de oficina y qué puede escribir (rutas absolutas). */
export function contexto(a: OficinaActiva, def: AgenteDef, { dirsExtra = [], actuar = [], catalogo, config }: { dirsExtra?: string[]; actuar?: string[]; catalogo?: ServidorConector[]; config?: Config } = {}): ContextoOficina {
  const todos = TodosConectores.activo(config)
  const agente = TodosConectores.agente(config, def, catalogo, a.oficina)
  const skillsElegidas = Habilitados.skills(a.oficina, def)
  const mcpElegidos = Habilitados.mcp(a.oficina, def)
  const rutas = [a.ruta(`conocimiento/agentes/${agente.id}.md`)]
  for (const r of agente.escritura ?? []) if (Validar.rutaEscrituraValida(r)) rutas.push(a.ruta(r))
  const e = entregables(a, agente.id)
  if (e) rutas.push(e)
  // carpetas de trabajo de su alcance: lee y escribe ahí como en la oficina
  const trabajo = dirsTrabajo(a.oficina, agente)
  for (const d of trabajo) rutas.push(d + '/**')
  // modo «todos» sin catálogo todavía (no se detectó): no se veda nada; lo que no está permitido se pregunta o se rechaza
  const { permitidas, vedadas } = todos && !catalogo ? { permitidas: [], vedadas: [] } : ConectoresAgente.herramientas(a.oficina, agente, catalogo, actuar)
  return {
    carpeta: a.carpeta, escritura: rutas, dirsExtra: [...dirsExtra, ...dirsVinculos(a.oficina, agente), ...trabajo],
    instrucciones: Instrucciones.para(a.oficina, agente, { conMCP: true, todos }), permitidas, vedadas,
    herramientasMCP: HerramientasMCPAgente.lista(a.oficina, agente), perfilMCP: Coordinador.perfil(a.oficina, agente),
    reglas: agente.reglas ?? [], preguntar: false, ...(todos ? { todosConectores: true } : {}),
    ...(esfuerzoDe(agente) !== undefined ? { esfuerzo: esfuerzoDe(agente) } : {}),
    ...(skillsElegidas !== undefined ? { skillsElegidas } : {}),
    ...(mcpElegidos !== undefined ? { mcpElegidos } : {}),
  }
}

/** El esfuerzo guardado de un agente si es válido (oficina.json se puede editar a mano); undefined = el de Claude Code. */
export function esfuerzoDe(a: AgenteDef): string | undefined {
  return a.esfuerzo !== undefined && Validar.esfuerzos.has(a.esfuerzo) ? a.esfuerzo : undefined
}

/** Patrón de escritura de `archivos/entregables/<id>/` (crea la carpeta del agente). undefined si la oficina no tiene
 *  la estructura de biblioteca. */
export function entregables(a: OficinaActiva, id: string): string | undefined {
  try {
    if (!fs.statSync(a.ruta('archivos/entregables')).isDirectory()) return undefined
  } catch {
    return undefined
  }
  const d = a.ruta(`archivos/entregables/${id}`)
  try {
    fs.mkdirSync(d, { recursive: true })
  } catch {}
  return d + '/**'
}

export function alcanceIncluye(al: AlcanceVinculo, a: AgenteDef): boolean {
  if (al === 'oficina') return true
  if ('departamentos' in al) return al.departamentos.includes(a.departamento)
  return al.agentes.includes(a.id)
}

/** Carpetas vinculadas a las que `agente` tiene acceso, para `--add-dir`. Solo las que existen. */
export function dirsVinculos(o: Oficina, agente: AgenteDef): string[] {
  const out: string[] = []
  for (const v of o.vinculos ?? []) {
    if (!alcanceIncluye(v.alcance, agente)) continue
    let dir = false
    try {
      dir = fs.statSync(v.ruta).isDirectory()
    } catch {}
    if (dir && !out.includes(v.ruta)) out.push(v.ruta)
  }
  return out
}

/** Carpetas de trabajo a las que `agente` tiene acceso (lectura y escritura, `--add-dir`). Solo las que existen. */
export function dirsTrabajo(o: Oficina, agente: AgenteDef): string[] {
  const out: string[] = []
  for (const c of o.carpetasTrabajo ?? []) {
    if (!alcanceIncluye(c.alcance, agente)) continue
    let dir = false
    try {
      dir = fs.statSync(c.ruta).isDirectory()
    } catch {}
    if (dir && !out.includes(c.ruta)) out.push(c.ruta)
  }
  return out
}

/** Herramientas base: las del contexto, o las del agente en la config, o las generales. */
function baseOficina(cfg: Config, ctx: ContextoOficina, agente: string): string {
  const b = ctx.herramientasBase ? ctx.herramientasBase : cfg.herramientasAgente[agente] || cfg.herramientas
  if (conSkill(cfg, ctx)) return b
  return b.split(',').map((x) => x.trim()).filter((x) => x !== '' && x !== 'Skill').join(',')
}

/** Pide permiso en vivo solo un chat con la persona presente y con el servidor MCP andando. */
export const puedePreguntar = (ctx: ContextoOficina) => (ctx.preguntar ?? false) && ctx.mcpUrl !== undefined

/** Modo automático (preferencia de toda la app): un clasificador de Claude Code revisa cada acción no permitida y la deja
 *  pasar o la frena. Lo frenado va a la tarjeta (chat, con `--permission-prompt-tool`) o a `permission_denials` (tareas). */
export const modoAuto = (cfg: Config) => cfg.modoPermisos === 'auto'

/** `--permission-mode` de una corrida: `auto` si la persona lo eligió; si no, `default` con la persona presente (se le
 *  pregunta) o `dontAsk` sin ella (se rechaza). */
export function modoPermiso(cfg: Config, conPersona: boolean): string {
  if (modoAuto(cfg)) return 'auto'
  return conPersona ? 'default' : 'dontAsk'
}

/** `--tools` de un agente de oficina: base + Edit,Write (si tiene alguna ruta) + las de sus reglas guardadas (Bash...)
 *  + Bash,Edit,Write si puede pedir permiso, anota rechazos o corre en modo automático + las MCP si hay servidor. */
export function herramientasOficina(cfg: Config, ctx: ContextoOficina, agente: string): string {
  let h = baseOficina(cfg, ctx, agente)
  const lista = h.split(',').map((x) => x.trim())
  const sumar = (n: string) => { if (!lista.includes(n)) { lista.push(n); h += ',' + n } }
  if (ctx.escritura.length > 0) { h += ',Edit,Write'; lista.push('Edit', 'Write') }
  for (const r of ctx.reglas ?? []) { const i = r.indexOf('('); if (i >= 0) sumar(r.slice(0, i)) }
  if (puedePreguntar(ctx) || ctx.anotarRechazos || modoAuto(cfg)) for (const n of herramientasPreguntables) sumar(n)
  if (ctx.mcpUrl !== undefined) h += ',' + mcpDe(cfg, ctx).join(',')
  return h
}

/** Argumentos (sin el binario) de un chat de oficina. Orden fijo; `--` antes del mensaje. */
export function argumentos(cfg: Config, ctx: ContextoOficina, p: { agente: string; mensaje: string; sid: string; flag: string }): string[] {
  const a = ['-p', '--agent', p.agente, p.flag, p.sid, ...ClaudeRunner.formatoSalida]
  a.push('--tools', herramientasOficina(cfg, ctx, p.agente))
  // con la persona presente: la herramienta que le pregunta (en auto, solo lo que frena el clasificador); sin ella, lo no
  // permitido se rechaza (en auto, solo lo que frena el clasificador)
  a.push('--permission-mode', modoPermiso(cfg, puedePreguntar(ctx)))
  if (puedePreguntar(ctx)) a.push('--permission-prompt-tool', herramientaPermiso)
  if (ctx.mcpUrl !== undefined) a.push('--mcp-config', configMCP(ctx.mcpUrl))
  for (const d of ctx.dirsExtra) a.push('--add-dir', d)
  a.push('--allowedTools')
  for (const h of baseOficina(cfg, ctx, p.agente).split(',').map((x) => x.trim())) if (h !== '') a.push(h)
  for (const r of ctx.escritura) for (const h of ['Edit', 'Write']) a.push(regla(h, r))
  a.push(...(ctx.reglas ?? []))
  if (ctx.mcpUrl !== undefined) a.push(...mcpDe(cfg, ctx))
  if (puedePreguntar(ctx)) a.push(herramientaPermiso)
  a.push(...ctx.permitidas)
  const op = opcionesEfectivas(cfg, ctx)
  // MCP del Claude Code de la persona apagados (o ninguno elegido): solo el servidor de la oficina (salvo que use
  // conectores de claude.ai, que --strict-mcp-config dejaría afuera); con algunos elegidos, se vedan los demás
  const sinMCPLocales = !op.mcpLocales || (ctx.mcpElegidos !== undefined && ctx.mcpElegidos.length === 0)
  const estricto = sinMCPLocales && !usaConectores(ctx)
  const vedadas = [...ctx.vedadas]
  if (op.mcpLocales && !estricto) for (const v of mcpVedados(cfg, ctx)) if (!vedadas.includes(v)) vedadas.push(v)
  if (vedadas.length > 0) a.push('--disallowedTools', ...vedadas)
  if (estricto) a.push('--strict-mcp-config')
  const ajustes = conSkill(cfg, ctx) ? settingsSkills(op.skills, skillsDeCorrida(cfg, ctx), cfg.skillsInstaladas()) : undefined
  if (ajustes) a.push('--settings', jsonCompacto(ajustes))
  const instrucciones = conMemoria(ctx.instrucciones, op.memoria)
  if (instrucciones) a.push('--append-system-prompt', instrucciones)
  if (ctx.modelo !== undefined) a.push(...ClaudeRunner.argsModelo(ctx.modelo))
  a.push(...ClaudeRunner.argsEsfuerzo(op.esfuerzo))
  return [...a, '--', p.mensaje]
}

/** Milisegundos que claude espera una herramienta MCP cuando pide permiso en vivo: por defecto corta a los 60 s
 * («The operation timed out»), y la persona puede tardar más (docs/aprendizajes.md). 15 min, más que cualquier turno. */
export const esperaHerramientaMCP = '900000'

/** Variables extra del hijo: con conectores de claude.ai asignados hay que esperar a que se conecten; si pide permiso
 * en vivo, claude tiene que esperar a la persona más de 60 s. */
export function entorno(ctx: ContextoOficina): Record<string, string> {
  const e: Record<string, string> = {}
  if (ctx.todosConectores || ctx.permitidas.some((p) => p.startsWith('mcp__claude_ai_'))) e.MCP_CONNECTION_NONBLOCKING = 'false'
  if (puedePreguntar(ctx)) e.MCP_TOOL_TIMEOUT = esperaHerramientaMCP
  return e
}

/** Permiso en vivo para un turno de reunión (`turnoSoloLectura`): las herramientas de las reglas guardadas del agente +
 *  las que puede pedir (Bash, Edit, Write), sus reglas en `--allowedTools`, y el servidor MCP con el token interactivo. */
export function turnoConPermiso(p: { mcpUrl: string; token: string; reglas?: string[] }): TurnoConPermiso {
  const herramientas: string[] = []
  const sumar = (n: string) => { if (n !== '' && !herramientas.includes(n)) herramientas.push(n) }
  for (const r of p.reglas ?? []) { const i = r.indexOf('('); if (i > 0) sumar(r.slice(0, i)) }
  for (const n of herramientasPreguntables) sumar(n)
  return {
    herramientas, permitidas: [...(p.reglas ?? [])], herramientaPermiso, mcpConfig: configMCP(p.mcpUrl),
    env: { [variableTokenMCP]: p.token, MCP_TOOL_TIMEOUT: esperaHerramientaMCP },
  }
}
