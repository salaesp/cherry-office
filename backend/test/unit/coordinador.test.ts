// Herramientas MCP del coordinador sin servidor HTTP (tokens de `mcp.tokens` y `consultas.herramientas` en proceso).
// Reescribe los tests `interno` de CoordinadorTests.swift.
import { describe, expect, test } from 'vitest'
import { HerramientasCoordinador, herramientasCoordinador, maxRespuesta, respuestaCoordinador } from '../../src/coordinador.js'
import { mcpDe } from '../../src/consultas.js'
import { corridasDe } from '../../src/parte.js'
import type { MCPHerramientas } from '../../src/mcp-protocolo.js'
import { Coordinador, Dependencias, HerramientasMCPAgente, Seguimiento, contexto, herramientaProponerSkill, herramientasMCP } from '../../src/permisos.js'
import { OficinaStore, type AgenteDef, type Oficina } from '../../src/oficina.js'
import { Sandbox, U, esperar } from '../support/sandbox.js'
import { arrancar, oficina } from '../support/en-proceso.js'

type O = Record<string, any>

async function preparar() {
  const sb = new Sandbox()
  const b = arrancar(sb)
  const carpeta = await oficina(b, ['marce', 'nico', { id: 'coordi', permisos: ['coordinador'] }])
  const s = b.servicios
  const mcp = mcpDe(s)!
  const tools = (agente: string, perfil: string, oficinaId = carpeta): MCPHerramientas => {
    const t = mcp.tokens.emitir({ oficina: oficinaId, agente, sid: U.a, perfil })
    return mcp.consultas.herramientas(t, { oficina: oficinaId, agente, sid: U.a, perfil })
  }
  return { sb, b, s, carpeta, tools }
}

const nombres = (h: MCPHerramientas) => h.definiciones.map((d) => d.name)
const objeto = (r: { texto: string } | undefined): O => { try { return JSON.parse(r?.texto ?? '') } catch { return {} } }

describe('Coordinador', () => {
  test('perfil: coordinador si tiene el permiso; herramientasMCP solo para él', () => {
    const marce: AgenteDef = { id: 'marce', nombre: 'Marce', rol: 'r', departamento: 'd' }
    const coordi: AgenteDef = { id: 'coordi', nombre: 'Coordi', rol: 'r', departamento: 'd', permisos: ['coordinador'] }
    const o: Oficina = { version: 1, nombre: 'O', duenio: 'D', departamentos: [], agentes: [marce, coordi] }
    expect(Coordinador.perfil(o, marce)).toBe('agente')
    expect(Coordinador.perfil(o, coordi)).toBe('coordinador')
    expect(Coordinador.herramientasMCP(o, marce)).toEqual([])
    expect(Coordinador.herramientasMCP(o, coordi)).toEqual(['mcp__hq__estado_oficina', 'mcp__hq__entregas', 'mcp__hq__corridas', 'mcp__hq__bloqueos', 'mcp__hq__encargar'])
    expect(HerramientasMCPAgente.lista(o, coordi)).toEqual([...herramientasMCP, ...Dependencias.herramientasMCP(), ...Coordinador.herramientasMCP(o, coordi), ...Seguimiento.herramientasMCP(o, coordi), herramientaProponerSkill])
    expect(HerramientasMCPAgente.lista(o, marce)).toEqual([...herramientasMCP, ...Dependencias.herramientasMCP(), ...Seguimiento.herramientasMCP(o, marce), herramientaProponerSkill])
  })

  test('el perfil agente no ve las herramientas del coordinador, ni siquiera llamándolas por nombre', async () => {
    const { tools, s, carpeta } = await preparar()
    const h = tools('marce', 'agente')
    expect(nombres(h)).toEqual(['colegas', 'consultar', 'quien_sabe', 'buscar', 'marcar_obsoleto', 'anotar', 'seguimiento', 'seguimientos', 'seguimiento_leer', 'ficha_anotar', 'ficha_leer', 'pedir', 'quedo_esperando', 'cancelar_espera', 'proponer_skill'])
    for (const n of Coordinador.nombresMCP) expect(await h.llamar(n, {})).toBeUndefined()
    const c = tools('coordi', 'coordinador')
    expect(nombres(c)).toEqual(['colegas', 'consultar', 'quien_sabe', 'buscar', 'marcar_obsoleto', 'anotar', 'seguimiento', 'seguimientos', 'seguimiento_leer', 'ficha_anotar', 'ficha_leer', 'estado_oficina', 'entregas', 'corridas', 'bloqueos', 'encargar', 'pedir', 'quedo_esperando', 'cancelar_espera', 'proponer_skill'])
    expect(herramientasCoordinador(s, 't', { oficina: carpeta, agente: 'marce', sid: U.a, perfil: 'agente' })).toBeUndefined()
  })

  test('estado_oficina, entregas, corridas y bloqueos devuelven JSON y respetan los filtros', async () => {
    const { tools, s, carpeta: c } = await preparar()
    for (let i = 1; i <= 35; i++) s.entregas.crear({ oficina: c, agente: i % 2 === 0 ? 'nico' : 'marce', origen: 'tarea', ref: 't', titulo: `Entrega ${i}`, texto: 'x' })
    s.entregas.marcar(c, 1, 'revisada')
    const st = corridasDe(s)
    st.corridaCrear({ oficina: c, flujo: 'f', nombre: 'Clase 1', contexto: 'ctx', definicion: '{"nombre":"F","pasos":[]}', estado: 'trabada' })
    st.corridaCrear({ oficina: c, flujo: 'f', nombre: 'Clase 0', contexto: '', definicion: '{"nombre":"F","pasos":[]}', estado: 'terminada' })
    const h = tools('coordi', 'coordinador')

    const est = objeto(await h.llamar('estado_oficina', {}))
    expect(est.desde).toBeDefined()
    expect(Array.isArray(est.bloqueos) && Array.isArray(est.flujos) && typeof est.paso === 'object').toBe(true)
    expect(est.flujos.length).toBe(1)
    // «para revisar» va aplanado: la lista y su total
    expect(Array.isArray(est.paraRevisar) && est.paraRevisarTotal === 34).toBe(true)

    let e = objeto(await h.llamar('entregas', {}))
    expect(e.entregas.length).toBe(10)
    e = objeto(await h.llamar('entregas', { limite: 500 }))
    expect(e.entregas.length).toBe(30)
    e = objeto(await h.llamar('entregas', { estado: 'revisada' }))
    expect(e.entregas.length).toBe(1)
    e = objeto(await h.llamar('entregas', { agente: 'nico', limite: 30 }))
    expect(e.entregas.length).toBe(17)
    expect(e.entregas.every((x: O) => x.agente === 'nico')).toBe(true)
    expect((await h.llamar('entregas', { estado: 'rara' }))?.esError).toBe(true)

    let cs = objeto(await h.llamar('corridas', {}))
    expect(cs.corridas.length === 2 && cs.corridas.every((x: O) => x.definicion === undefined)).toBe(true)
    cs = objeto(await h.llamar('corridas', { estado: 'abiertas' }))
    expect(cs.corridas.map((x: O) => x.nombre)).toEqual(['Clase 1'])
    expect(cs.corridas[0].contexto).toBe('ctx')
    cs = objeto(await h.llamar('corridas', { estado: 'terminada' }))
    expect(cs.corridas.map((x: O) => x.nombre)).toEqual(['Clase 0'])
    expect((await h.llamar('corridas', { estado: 'rara' }))?.esError).toBe(true)

    expect(Array.isArray(objeto(await h.llamar('bloqueos', {})).bloqueos)).toBe(true)
  })

  test('las respuestas no pasan de 12000 caracteres y siguen siendo JSON', async () => {
    const { tools, s, carpeta } = await preparar()
    const largo = 'palabra '.repeat(100)
    for (let i = 1; i <= 30; i++) s.entregas.crear({ oficina: carpeta, agente: 'marce', origen: 'tarea', ref: 't', titulo: `T${i}`, texto: largo })
    const h = tools('coordi', 'coordinador')
    const r = (await h.llamar('entregas', { limite: 30 }))!
    expect(r.esError).toBe(false)
    expect([...r.texto].length).toBeLessThanOrEqual(maxRespuesta)
    const o = objeto(r)
    expect(o.entregas.length > 0 && o.entregas.length < 30 && o.recortado === true).toBe(true)
    expect(respuestaCoordinador({ x: [1, 2] }).texto).toBe('{"x":[1,2]}')
    expect(HerramientasCoordinador).toBeDefined()
  })

  test('encargar crea una corrida coord:<8 hex> del agente pedido, con la consigna saneada y de quién viene; máximo 3 por token', async () => {
    const { tools, s, sb, carpeta } = await preparar()
    const h = tools('coordi', 'coordinador')
    const ids: string[] = []
    for (let i = 1; i <= 3; i++) {
      const r = (await h.llamar('encargar', { agente: 'nico', consigna: `Preparame el anuncio ${i}‮\u0007`, nombre: `Anuncio ${i}` }))!
      expect(r.esError, r.texto).toBe(false)
      const j = objeto(r)
      expect(j.tarea).toMatch(/^coord:[0-9a-f]{8}$/)
      expect(j.agente).toBe('nico')
      ids.push(j.tarea)
    }
    expect(new Set(ids).size).toBe(3)
    // cuarto: sin cupo
    const cuarto = (await h.llamar('encargar', { agente: 'nico', consigna: 'Uno más' }))!
    expect(cuarto.esError && cuarto.texto.includes('3 encargos')).toBe(true)
    expect(await esperar(() => s.entregas.lista(carpeta, { origen: 'encargo' }).length === 3)).toBe(true)
    const es = s.entregas.lista(carpeta, { origen: 'encargo' })
    expect(new Set(es.map((e) => e.ref))).toEqual(new Set(ids))
    expect(es.every((e) => e.agente === 'nico')).toBe(true)
    expect(sb.llamadas.length).toBe(3)
    const l = sb.llamadasConPrompt('Preparame el anuncio 1')[0]!
    const p = l[l.length - 1]!
    expect(p.includes('Coordi') && p.includes('no es un pedido directo del usuario')).toBe(true)
    expect(p.includes('‮') || p.includes('\u0007')).toBe(false)
    // el agente del encargo no es coordinador: no lleva las herramientas del coordinador
    expect(Sandbox.valor(l, '--tools')?.includes('encargar')).toBe(false)
    // el cupo es por token: otro token tiene el suyo
    const h2 = tools('coordi', 'coordinador')
    expect((await h2.llamar('encargar', { agente: 'marce', consigna: 'Hola' }))?.esError).toBe(false)
  })

  test('encargar: a sí mismo, agente inexistente y datos faltantes dan isError, sin lanzar claude ni gastar cupo', async () => {
    const { tools, sb, s, carpeta } = await preparar()
    const h = tools('coordi', 'coordinador')
    const yo = (await h.llamar('encargar', { agente: 'coordi', consigna: 'Hacelo vos' }))!
    expect(yo.esError && yo.texto.includes('vos mismo')).toBe(true)
    expect((await h.llamar('encargar', { agente: 'Coordi', consigna: 'Hacelo vos' }))?.esError).toBe(true)
    const nadie = (await h.llamar('encargar', { agente: 'fantasma', consigna: 'Hola' }))!
    expect(nadie.esError && nadie.texto.includes('fantasma')).toBe(true)
    expect((await h.llamar('encargar', { agente: 'nico' }))?.esError).toBe(true)
    expect((await h.llamar('encargar', { consigna: 'x' }))?.esError).toBe(true)
    expect(sb.llamadas).toEqual([])
    // el cupo sigue intacto: se pueden hacer los 3 (por nombre también se resuelve)
    for (const q of ['nico', 'Nico', 'marce']) expect((await h.llamar('encargar', { agente: q, consigna: 'Va' }))?.esError).toBe(false)
    expect((await h.llamar('encargar', { agente: 'nico', consigna: 'Va' }))?.esError).toBe(true)
    expect(await esperar(() => s.entregas.lista(carpeta, { origen: 'encargo' }).length === 3)).toBe(true)
  })

  test('con la oficina cerrada o cambiada las herramientas dan isError', async () => {
    const { tools, sb } = await preparar()
    const h = tools('coordi', 'coordinador', '/otra/oficina')
    const r = (await h.llamar('encargar', { agente: 'nico', consigna: 'Hola' }))!
    expect(r.esError && r.texto.includes('oficina')).toBe(true)
    for (const n of ['estado_oficina', 'entregas', 'corridas', 'bloqueos']) expect((await h.llamar(n, {}))?.esError, n).toBe(true)
    expect(sb.llamadas).toEqual([])
  })

  test('el contexto del coordinador emite el token con perfil coordinador; el del agente, con perfil agente', async () => {
    const { b, carpeta } = await preparar()
    const act = b.oficinas.activa()!
    const ag = (id: string) => act.oficina.agentes.find((a) => a.id === id)!
    expect(contexto(act, ag('coordi')).perfilMCP).toBe('coordinador')
    expect(contexto(act, ag('marce')).perfilMCP).toBe('agente')
    expect(OficinaStore.leer(carpeta).agentes.find((a) => a.id === 'coordi')?.permisos).toEqual(['coordinador'])
  })
})
