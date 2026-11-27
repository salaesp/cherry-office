// Port de app/Tests/BackendTests/CoordinadorTests.swift.
// Coordinador: perfil, herramientas MCP (`mcp__hq__estado_oficina`, `entregas`, `corridas`, `bloqueos`; `delegar` reemplazó a `encargar`) y permisos.
// Los tests que emiten tokens MCP en proceso (b.mcp.tokens / consultas.herramientas), usan el store o llaman a Coordinador/Permisos
// directamente quedan como test.skip (unit tests del port).
import { describe, expect, test } from 'vitest'
import { Fix, Sandbox, U, chat, contratar, lista, str } from '../support/sandbox.js'

async function fix(): Promise<Fix> {
  const f = await Fix.crear({
    deps: ['Dirección'],
    agentes: [{ id: 'marce', depto: 'direccion', rol: 'Directora' }, { id: 'nico', depto: 'direccion', rol: 'Anuncios' }],
    env: { HQ_PROGRAMADOR: '0' },
  })
  const c = await contratar(f.b, { id: 'coordi', depto: 'direccion', rol: 'Coordinadora', extra: { permisos: ['coordinador'] } })
  expect(c.status, `contratar coordinador: ${JSON.stringify(c.obj)}`).toBe(200)
  return f
}

const nombresMCP = ['estado_oficina', 'entregas', 'corridas', 'bloqueos', 'delegar']

describe('Coordinador', () => {
  // MARK: perfil y lista

  // interno: Coordinador.perfil / herramientasMCP / HerramientasMCPAgente.lista sobre structs Swift (unit test del port).
  test.skip('perfil: coordinador si tiene el permiso; herramientasMCP solo para él', () => {})

  // interno: emite tokens con b.mcp.tokens y llama a h.llamar / Coordinador.herramientas en proceso.
  test.skip('el perfil agente no ve las herramientas del coordinador, ni siquiera llamándolas por nombre', () => {})

  // MARK: lecturas

  // interno: siembra entregas y corridas con b.store y llama a las herramientas MCP en proceso.
  test.skip('estado_oficina, entregas, corridas y bloqueos devuelven JSON y respetan los filtros', () => {})

  // interno: siembra entregas con b.store, llama a h.llamar y a HerramientasCoordinador.respuesta.
  test.skip('las respuestas no pasan de 12000 caracteres y siguen siendo JSON', () => {})

  // MARK: encargar

  // interno: herramienta MCP `encargar` en proceso con tokens de b.mcp.tokens y entregas leídas del store.
  test.skip('encargar crea una corrida coord:<8 hex> del agente pedido, con la consigna saneada y de quién viene; máximo 3 por token', () => {})

  // interno: herramienta MCP `encargar` en proceso con tokens de b.mcp.tokens.
  test.skip('encargar: a sí mismo, agente inexistente y datos faltantes dan isError, sin lanzar claude ni gastar cupo', () => {})

  // interno: token emitido a mano para una oficina inexistente y herramientas MCP en proceso.
  test.skip('con la oficina cerrada o cambiada las herramientas dan isError', () => {})

  // MARK: chat y permisos

  test('el chat del coordinador lleva las herramientas del coordinador en --tools y --allowedTools; el de un agente común, no', async () => {
    const f = await fix()
    const r = await chat(f.b, { agent: 'coordi', message: 'hola', session: U.a })
    expect(r.status).toBe(200)
    const l = f.sb.llamadas.at(-1)!
    expect(l).toBeDefined()
    const tools = Sandbox.valor(l, '--tools')!
    expect(tools).toBeDefined()
    for (const n of nombresMCP) {
      expect(tools.includes('mcp__hq__' + n)).toBe(true)
      expect(Sandbox.reglas(l).includes('mcp__hq__' + n)).toBe(true)
    }
    expect(Sandbox.reglas(l).includes('mcp__hq__encargar')).toBe(false)
    expect(tools.endsWith('mcp__hq__consultar,mcp__hq__colegas,mcp__hq__quien_sabe,mcp__hq__buscar,mcp__hq__marcar_obsoleto,mcp__hq__anotar,mcp__hq__delegar,mcp__hq__preguntar,mcp__hq__pedir,mcp__hq__quedo_esperando,mcp__hq__cancelar_espera,mcp__hq__estado_oficina,mcp__hq__entregas,mcp__hq__corridas,mcp__hq__bloqueos,mcp__hq__seguimiento,mcp__hq__seguimientos,mcp__hq__seguimiento_leer,mcp__hq__ficha_anotar,mcp__hq__ficha_leer,mcp__hq__proponer_skill')).toBe(true)
    // interno (unit test del port): b.mcp.tokens.activos == 0

    await chat(f.b, { agent: 'marce', message: 'hola', session: U.b })
    const m = f.sb.llamadas.at(-1)!
    expect(Sandbox.valor(m, '--tools')?.includes('estado_oficina')).toBe(false)
    expect(Sandbox.reglas(m).includes('mcp__hq__estado_oficina')).toBe(false)
  })

  // interno: Permisos.contexto(...).perfilMCP sobre la oficina activa en proceso (por HTTP se ve en --tools: test anterior).
  test.skip('el contexto del coordinador emite el token con perfil coordinador; el del agente, con perfil agente', () => {})

  test('PATCH /api/agentes/:id acepta permisos, limites y conectores, y los valida', async () => {
    const f = await fix()
    const r = await f.patch('/api/agentes/marce', {
      permisos: ['coordinador'],
      limites: { solo: ['Diseñar fichas'], proponer: ['Cambiar el plan'] },
      conectores: [{ servidor: 'Google Calendar', leer: ['mcp__claude_ai_Google_Calendar__list_events'], actuar: [] }],
    })
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    const ag = lista(f.oficinaJSON().agentes).find((a) => str(a.id) === 'marce')
    expect(ag?.permisos).toEqual(['coordinador'])
    expect(ag?.limites?.solo).toEqual(['Diseñar fichas'])
    expect(str(lista(ag?.conectores)[0]?.servidor)).toBe('Google Calendar')
    // interno (unit test del port): oficinas.activa().oficina.agente("marce").esCoordinador == true
    // inválidos
    expect((await f.patch('/api/agentes/marce', { permisos: ['jefe'] })).status).toBe(400)
    expect((await f.patch('/api/agentes/marce', { conectores: [{ servidor: 'X', leer: ['mcp__hq__encargar'], actuar: [] }] })).status).toBe(400)
    // quitarlo
    expect((await f.patch('/api/agentes/marce', { permisos: [] })).status).toBe(200)
    const sin = lista(f.oficinaJSON().agentes).find((a) => str(a.id) === 'marce')
    expect(sin?.permisos ?? []).toEqual([])
  })
})
