// El Creador sin servidor HTTP: reescribe los tests `interno` de CreadorTests.swift (definiciones de las herramientas, conectores
// con catálogo, aplicar con una tarjeta que falla, prompt, VersionCreador, token revocado).
import { describe, expect, test } from 'vitest'
import { catalogoDe } from '../../src/conectores.js'
import { mcpDe } from '../../src/consultas.js'
import { Creador, creadorDe, objetoDe } from '../../src/creador.js'
import type { MCPHerramientas } from '../../src/mcp-protocolo.js'
import { OficinaStore } from '../../src/oficina.js'
import { creadorMD } from '../../src/plantillas.js'
import { Sandbox, U, esperar } from '../support/sandbox.js'
import { arrancar, llamar } from '../support/en-proceso.js'

type O = Record<string, any>

const texto = 'Quiero un departamento de Ventas. Hay una Analista que mira los números. La regla es no inventar datos. '
  + 'Cada lunes a las 08:00 arma la agenda. Cada mes revisa las métricas.'
const ANALISTA = 'Hay una Analista que mira los números'
const VENTAS = 'Quiero un departamento de Ventas'
const agenteDatos = (): O => ({ nombre: 'Valeria', rol: 'Analista', departamento: 'redes', prompt: 'Sos Valeria, analista de números.' })

async function banco(agentes: string[] = []) {
  const sb = new Sandbox()
  const b = arrancar(sb)
  const r = await llamar(b, 'POST', '/api/oficinas', { nombre: 'Taller', duenio: 'Ana', departamentos: ['Dirección', 'Redes'] })
  const carpeta = String(r.obj.carpeta)
  for (const id of agentes) {
    const c = await llamar(b, 'POST', '/api/agentes', { id, nombre: id, rol: 'Analista', prompt: `Sos ${id}.`, departamento: 'redes' })
    expect(c.status).toBe(200)
  }
  const s = b.servicios
  s.store.asegurarSesion(U.a, 'creador', carpeta)
  s.store.agregar(U.a, 'u', texto)
  const mcp = mcpDe(s)!
  const ident = { oficina: carpeta, agente: 'creador', sid: U.a, perfil: 'creador' }
  const token = mcp.tokens.emitir(ident)
  const h: MCPHerramientas = mcp.consultas.herramientas(token, ident)
  const llamarH = async (nombre: string, args: O = {}) => {
    const x = await h.llamar(nombre, args)
    return x ? { texto: x.texto, error: x.esError } : { texto: '(no existe)', error: true }
  }
  const tarjeta = (r: { texto: string }): O => { try { return JSON.parse(r.texto) } catch { return {} } }
  const proponer = async (tipo: string, origen: string, datos: O = {}, { accion = 'crear', ref, objetivo }: { accion?: string; ref?: string; objetivo?: string } = {}) => {
    const a: O = { accion, origen, datos }
    if (ref !== undefined) a.ref = ref
    if (objetivo !== undefined) a.objetivo = objetivo
    const r = await llamarH('proponer_' + tipo, a)
    return { t: tarjeta(r), error: r.error, texto: r.texto }
  }
  const faltantes = (t: O): string[] => (t.faltantes ?? []).map((x: O) => x.campo)
  const pregunta = (t: O): string => t.faltantes?.[0]?.pregunta ?? ''
  return { sb, b, s, carpeta, mcp, token, h, llamarH, proponer, faltantes, pregunta, tarjetas: () => creadorDe(s).tarjetas.lista(carpeta) }
}

describe('El Creador (en proceso)', () => {
  test('las 10 herramientas, con prefijo mcp__hq__ y su esquema', async () => {
    const { h } = await banco()
    const defs = h.definiciones as O[]
    expect(defs.map((d) => 'mcp__hq__' + d.name)).toEqual(Creador.nombresMCP)
    expect(Creador.nombresMCP).toEqual(['ver_oficina', 'listar_conectores', 'proponer_departamento', 'proponer_agente', 'proponer_flujo', 'proponer_regla',
      'proponer_conector', 'proponer_tarea', 'marcar_faltante', 'descartar_tarjeta'].map((n) => `mcp__hq__${n}`))
    for (const d of defs) expect(d.inputSchema.type).toBe('object')
    expect(defs.find((d) => d.name === 'proponer_agente')!.inputSchema.required).toEqual(['accion', 'origen'])
  })

  test('el perfil agente no ve las herramientas del Creador y el creador no ve las de hq', async () => {
    const { mcp, carpeta, h } = await banco()
    const t = mcp.tokens.emitir({ oficina: carpeta, agente: 'x', sid: U.b, perfil: 'agente' })
    const a = mcp.consultas.herramientas(t, { oficina: carpeta, agente: 'x', sid: U.b, perfil: 'agente' })
    expect((a.definiciones as O[]).map((d) => d.name)).toEqual(['colegas', 'consultar', 'quien_sabe', 'buscar', 'marcar_obsoleto', 'anotar', 'pedir', 'quedo_esperando', 'cancelar_espera', 'proponer_skill'])
    expect(await a.llamar('proponer_regla', {})).toBeUndefined()
    expect(await h.llamar('colegas', {})).toBeUndefined()
  })

  test('un conector no disponible queda en borrador con «Conectá X en claude.ai»', async () => {
    const b = await banco(['val'])
    const catalogo = catalogoDe(b.s)!
    catalogo.fijar([
      { nombre: 'Google Calendar', prefijo: 'mcp__claude_ai_Google_Calendar', estado: 'connected', herramientas: ['mcp__claude_ai_Google_Calendar__list_events'] },
      { nombre: 'Notion', prefijo: 'mcp__claude_ai_Notion', estado: 'needs-auth', herramientas: [] },
    ])
    const cal = await b.proponer('conector', ANALISTA, { agente: 'val', servidor: 'Google Calendar', leer: ['mcp__claude_ai_Google_Calendar__list_events'] })
    expect(cal.t.estado, cal.texto).toBe('lista')
    const notion = await b.proponer('conector', ANALISTA, { agente: 'val', servidor: 'Notion', leer: ['mcp__claude_ai_Notion__search'] })
    expect(notion.t.estado).toBe('borrador')
    expect(b.pregunta(notion.t)).toContain('Conectá Notion en claude.ai')
    const insta = await b.proponer('conector', ANALISTA, { agente: 'val', servidor: 'Instagram', leer: ['mcp__claude_ai_Instagram__feed'] })
    expect(insta.t.estado).toBe('borrador')
    expect(b.pregunta(insta.t)).toContain('Conectá Instagram en claude.ai')
    // una herramienta mal escrita es un error de formato
    const mal = await b.proponer('conector', ANALISTA, { agente: 'val', servidor: 'Google Calendar', leer: ['list_events'] })
    expect(mal.error).toBe(true)
    // sin catálogo detectado tampoco se puede dar por disponible
    catalogo.limpiar()
    const sin = await b.proponer('conector', ANALISTA, { agente: 'val', servidor: 'Google Calendar', leer: ['mcp__claude_ai_Google_Calendar__list_events'] })
    expect(sin.t.estado).toBe('borrador')
  })

  test('listar_conectores: sin catálogo avisa; con catálogo lista los servidores', async () => {
    const b = await banco()
    const sin = JSON.parse((await b.llamarH('listar_conectores')).texto)
    expect(sin.detectado).toBe(false)
    expect(sin.nota).not.toBe('')
    catalogoDe(b.s)!.fijar([{ nombre: 'Gmail', prefijo: 'mcp__claude_ai_Gmail', estado: 'connected', herramientas: ['mcp__claude_ai_Gmail__search_threads'] }])
    const con = JSON.parse((await b.llamarH('listar_conectores')).texto)
    expect(con.detectado).toBe(true)
    expect(con.servidores.map((x: O) => x.nombre)).toEqual(['Gmail'])
    expect(con.servidores[0].disponible).toBe(true)
  })

  test('VersionCreador sube con cada cambio y /api/actividad la refleja', async () => {
    const b = await banco()
    const { version } = creadorDe(b.s)
    const v0 = version.valor(b.carpeta)
    const r = await b.proponer('departamento', VENTAS, { nombre: 'Ventas' })
    const v1 = version.valor(b.carpeta)
    expect(v1).toBeGreaterThan(v0)
    await b.llamarH('descartar_tarjeta', { id: r.t.id })
    expect(version.valor(b.carpeta)).toBeGreaterThan(v1)
    // un intento que falla no la sube
    const v2 = version.valor(b.carpeta)
    await b.proponer('departamento', 'inventado', { nombre: 'X' })
    expect(version.valor(b.carpeta)).toBe(v2)
    const act = await llamar(b.b, 'GET', '/api/actividad')
    expect(act.obj.creadorVersion).toBe(v2)
    // por oficina
    expect(version.valor('/otra')).toBe(0)
    expect(version.subir('/otra')).toBe(1)
  })

  test('el cupo de escrituras por mensaje es de 80; leer no lo gasta', async () => {
    const b = await banco()
    for (let i = 0; i < Creador.maxEscrituras; i++) await b.llamarH('descartar_tarjeta', { id: 't1' })
    const r = await b.llamarH('descartar_tarjeta', { id: 't1' })
    expect(r.error && r.texto.includes(String(Creador.maxEscrituras))).toBe(true)
    expect((await b.llamarH('ver_oficina')).error).toBe(false)
    // otro token, otro cupo
    const ident = { oficina: b.carpeta, agente: 'creador', sid: U.a, perfil: 'creador' }
    const h2 = b.mcp.consultas.herramientas(b.mcp.tokens.emitir(ident), ident)
    expect((await h2.llamar('descartar_tarjeta', { id: 't1' }))!.texto).toContain('No existe la tarjeta')
  })

  test('aplicar: una tarjeta que falla queda en error y las demás siguen; una que depende de ella también falla', async () => {
    const b = await banco(['val'])
    const dep = await b.proponer('departamento', VENTAS, { nombre: 'Ventas' })
    const reg = await b.proponer('regla', 'La regla es no inventar datos', { texto: 'No inventes datos.' })
    // una tarjeta lista cuyo departamento desaparece antes de aplicar (se fuerza editando la tabla)
    const ag = await b.proponer('agente', ANALISTA, agenteDatos())
    const tarea = await b.proponer('tarea', 'Cada lunes a las 08:00 arma la agenda',
      { agente: 'tarjeta:' + ag.t.id, nombre: 'Agenda', consigna: 'Armá', dias: [1], hora: '08:00' })
    const { tarjetas } = creadorDe(b.s)
    const t = tarjetas.una(b.carpeta, ag.t.id)!
    const dd = objetoDe(t.datos)
    dd.departamento = 'ya-no-existe'
    t.datos = Creador.json(dd)
    tarjetas.guardar(t)
    const r = await llamar(b.b, 'POST', '/api/creador/aplicar', { ids: [dep.t.id, reg.t.id, ag.t.id, tarea.t.id] })
    expect(r.status).toBe(200)
    const res = r.obj.resultados as O[]
    expect(res.map((x) => x.ok === true)).toEqual([true, true, false, false])
    expect(res[2]!.error).not.toBe('')
    expect(res[3]!.error).toContain(ag.t.id)
    const tj = b.tarjetas()
    const del = tj.find((x) => x.id === ag.t.id)!
    expect(del.estado).toBe('error')
    expect(del.error).toBeDefined()
    expect(tj.find((x) => x.id === dep.t.id)!.estado).toBe('creada')
    const o = OficinaStore.leer(b.carpeta)
    expect(o.departamentos.some((d) => d.id === 'ventas')).toBe(true)
    expect(o.reglas?.length).toBe(1)
    expect(o.agentes.some((a) => a.id === 'valeria')).toBe(false)
  })

  test('el prompt del Creador es genérico y pide proponer, citar y preguntar', () => {
    const md = creadorMD({ version: 1, nombre: 'Taller', duenio: 'Ana', departamentos: [], agentes: [] })
    expect(md.startsWith('---\nname: creador\n')).toBe(true)
    expect(md).toContain('model: sonnet')
    for (const clave of ['ver_oficina', 'marcar_faltante', 'tarjeta:<id>', 'TEXTUAL', '3 preguntas', 'nunca creás']) expect(md, clave).toContain(clave)
    expect(md).not.toContain('Betty')
    expect(md).not.toContain('Próspera')
    expect(md).toContain('Sos el Creador de la oficina «Taller»')
    // el nombre va en una sola línea
    expect(creadorMD({ version: 1, nombre: 'A\nB', duenio: '', departamentos: [], agentes: [] })).toContain('«A B»')
  })

  test('el chat: la sesión es del creador, el token MCP se revoca al terminar y la actividad queda libre', async () => {
    const b = await banco()
    b.sb.llamadasCreador([{ name: 'proponer_departamento', arguments: { accion: 'crear', origen: 'un departamento de ventas', datos: { nombre: 'Ventas' } } }])
    const sid = U.b
    const r = await llamar(b.b, 'POST', '/api/creador/chat', { message: 'CREADOR_LLAMAR quiero un departamento de ventas', session: sid })
    expect(r.status, JSON.stringify(r.obj)).toBe(202)
    expect(await esperar(async () => (await llamar(b.b, 'GET', '/api/creador/estado', undefined, { session: sid })).obj.corriendo === false, 20)).toBe(true)
    expect(b.s.store.agenteDe(sid)).toBe('creador')
    // el único token vivo es el del banco (el del chat se revocó)
    expect(b.mcp.tokens.activos).toBe(1)
    expect((b.s.runner.actividad.json(b.carpeta).agentes as O).creador).toBeUndefined()
    const v = (await llamar(b.b, 'GET', '/api/creador/estado', undefined, { session: sid })).obj.version
    expect(v).toBe(creadorDe(b.s).version.valor(b.carpeta))
    // cerrar el backend espera la corrida de fondo: no deja promesas colgadas
    await b.b.shutdown()
  })
})
