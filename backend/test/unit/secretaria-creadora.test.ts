// Cambios en la oficina desde la charla (secretaria-creadora.ts, docs/plan-secretaria-creadora.md): quien atiende la secretaría
// tiene las herramientas del Creador, y los demás agentes solo proponer tareas, mientras le responden a la persona en una charla; sus tarjetas van debajo de la respuesta,
// en lo que espera a la persona y en el borrador del Creador, y se aplican con /api/creador/aplicar. Sin red: el claude falso
// responde y, cuando el mensaje lleva MCP_LLAMAR, hace las llamadas que se le dejan.
import { describe, expect, test } from 'vitest'
import { mcpDe } from '../../src/consultas.js'
import { delegacionesDe } from '../../src/delegar.js'
import { OficinaStore } from '../../src/oficina.js'
import { CambiosCharla, HerramientasMCPAgente } from '../../src/permisos.js'
import { Creador } from '../../src/creador.js'
import { herramientasCambiosCharla, instruccionesCreadora } from '../../src/secretaria-creadora.js'
import { Sandbox } from '../support/sandbox.js'
import { arrancar, llamar, oficina } from '../support/en-proceso.js'

const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'
const pedido = 'Necesito a alguien que lleve la facturación: que todos los lunes mire los mails de proveedores y me arme la lista de lo que hay que pagar.'

async function preparar() {
  const sb = new Sandbox()
  const b = arrancar(sb)
  const carpeta = await oficina(b, ['sofia', 'nico'])
  // sofia atiende la secretaría
  b.servicios.oficinas.modificar((o) => { o.secretaria = { agente: 'sofia', activa: true, fuentes: [] } })
  const chat = (message: string, { agent = 'sofia', session = S1 } = {}) => llamar(b, 'POST', '/api/chat', { agent, session, message })
  const tarjetas = async (session = S1) => (await llamar(b, 'GET', '/api/charlas/tarjetas', undefined, { session })).obj
  return { sb, b, carpeta, chat, tarjetas }
}

const agente = {
  name: 'proponer_agente',
  arguments: {
    accion: 'crear', origen: 'alguien que lleve la facturación',
    datos: { id: 'lucia', nombre: 'Lucía', rol: 'Facturación', departamento: 'direccion', prompt: 'Revisás las facturas de proveedores y armás la lista de pagos.' },
  },
}
const tarea = {
  name: 'proponer_tarea',
  arguments: {
    accion: 'crear', origen: 'todos los lunes mire los mails de proveedores',
    datos: { agente: 'tarjeta:t1', nombre: 'Lista de pagos', consigna: 'Armá la lista de pagos de la semana.', dias: [1], hora: '09:00' },
  },
}

describe('armar la oficina desde la charla', () => {
  test('propone en la charla: tarjetas debajo de la respuesta, en lo que espera y en el borrador; aprobar contrata y programa', async () => {
    const { sb, b, carpeta, chat, tarjetas } = await preparar()
    sb.llamadasMCP('sofia', [agente, tarea])
    expect((await chat('MCP_LLAMAR ' + pedido)).status).toBe(200)
    const salidas = sb.salidasMCP('sofia') as any[]
    expect(salidas.map((x) => x.result.isError ?? false)).toEqual([false, false])

    const r = await tarjetas()
    expect(r.cambios).toHaveLength(2)
    // turno 1: debajo de la primera respuesta (mensaje 0 de la persona, 1 de sofia)
    expect(r.cambios[0]).toMatchObject({ id: 't1', tipo: 'agente', accion: 'crear', estado: 'lista', sid: S1, turno: 1 })
    expect(r.cambios[1]).toMatchObject({ id: 't2', tipo: 'tarea', estado: 'lista', turno: 1 })
    expect((await tarjetas(S2)).cambios).toEqual([])

    const pend = (await llamar(b, 'GET', '/api/charlas/pendientes')).obj
    expect(pend.cambios).toHaveLength(1)
    expect(pend.cambios[0]).toMatchObject({ agente: 'sofia', session: S1 })
    expect(pend.cambios[0].tarjetas.map((t: any) => t.id)).toEqual(['t1', 't2'])
    expect((await llamar(b, 'GET', '/api/actividad')).obj.teEsperan).toBe(1)

    const borr = (await llamar(b, 'GET', '/api/creador/borrador')).obj
    expect(borr.tarjetas.map((t: any) => [t.id, t.deCharla, t.charla])).toEqual([['t1', 'sofia', S1], ['t2', 'sofia', S1]])

    const ap = await llamar(b, 'POST', '/api/creador/aplicar', { ids: ['t1', 't2'] })
    expect(ap.status).toBe(200)
    expect(ap.obj.resultados.every((x: any) => x.ok)).toBe(true)
    const o = OficinaStore.leer(carpeta)
    expect(o.agentes.some((a) => a.id === 'lucia')).toBe(true)
    expect(o.tareas?.find((t) => t.nombre === 'Lista de pagos')).toMatchObject({ agente: 'lucia', dias: [1], hora: '09:00' })
    expect((await llamar(b, 'GET', '/api/charlas/pendientes')).obj.cambios).toEqual([])
    expect((await llamar(b, 'GET', '/api/actividad')).obj.teEsperan).toBe(0)
    expect((await tarjetas()).cambios.map((t: any) => t.estado)).toEqual(['creada', 'creada'])
  })

  test('descartada no cuenta ni se muestra', async () => {
    const { sb, b, chat, tarjetas } = await preparar()
    sb.llamadasMCP('sofia', [agente])
    await chat('MCP_LLAMAR ' + pedido)
    expect((await llamar(b, 'DELETE', '/api/creador/tarjetas/t1')).status).toBe(200)
    expect((await tarjetas()).cambios).toEqual([])
    expect((await llamar(b, 'GET', '/api/actividad')).obj.teEsperan).toBe(0)
  })

  test('la cita tiene que estar en lo que dijo la persona en esa charla', async () => {
    const { sb, chat, tarjetas } = await preparar()
    sb.llamadasMCP('sofia', [{ ...agente, arguments: { ...agente.arguments, origen: 'contraten un community manager' } }])
    await chat('MCP_LLAMAR ' + pedido)
    const s = sb.salidasMCP('sofia') as any[]
    expect(s[0].result.isError).toBe(true)
    expect(s[0].result.content[0].text).toContain('Citá textual')
    expect((await tarjetas()).cambios).toEqual([])
  })

  test('otro agente no puede contratar, pero sí proponer una tarea en su charla', async () => {
    const { sb, b, carpeta, chat, tarjetas } = await preparar()
    const tareaNico = { name: 'proponer_tarea', arguments: { accion: 'crear', origen: 'todos los lunes mire los mails de proveedores',
      datos: { agente: 'nico', nombre: 'Lista de pagos', consigna: 'Armá la lista de pagos de la semana.', dias: [1], hora: '09:00' } } }
    sb.llamadasMCP('nico', [agente, tareaNico])
    await chat('MCP_LLAMAR ' + pedido, { agent: 'nico' })
    const s = sb.salidasMCP('nico') as any[]
    expect(s[0]?.result?.isError ?? s[0]?.error).toBeTruthy()
    expect(s[1].result.isError ?? false).toBe(false)
    const c = (await tarjetas()).cambios
    expect(c.map((t: any) => [t.tipo, t.estado, t.turno])).toEqual([['tarea', 'lista', 1]])
    expect((await llamar(b, 'GET', '/api/charlas/pendientes')).obj.cambios[0]).toMatchObject({ agente: 'nico', session: S1 })
    expect((await llamar(b, 'POST', '/api/creador/aplicar', { ids: [c[0].id] })).obj.resultados[0].ok).toBe(true)
    expect(OficinaStore.leer(carpeta).tareas?.find((t) => t.nombre === 'Lista de pagos')).toMatchObject({ agente: 'nico', dias: [1] })
  })

  test('desde una charla solo se tocan las tarjetas de esa charla', async () => {
    const { sb, chat, tarjetas } = await preparar()
    sb.llamadasMCP('sofia', [agente])
    await chat('MCP_LLAMAR ' + pedido)
    sb.llamadasMCP('sofia', [{ name: 'descartar_tarjeta', arguments: { id: 't1' } },
      { name: 'marcar_faltante', arguments: { ref: 't1', campo: 'rol', pregunta: '¿Qué rol?' } },
      { ...agente, arguments: { ...agente.arguments, ref: 't1' } }])
    await chat('MCP_LLAMAR ' + pedido, { session: S2 })
    const s = (sb.salidasMCP('sofia') as any[]).slice(-3)
    expect(s.every((x) => x.result.isError)).toBe(true)
    expect(s[0].result.content[0].text).toContain('no es de esta charla')
    expect((await tarjetas()).cambios[0]).toMatchObject({ id: 't1', estado: 'lista' })
  })
})

describe('cuándo existen las herramientas', () => {
  test('todas para la secretaría y solo tareas para los demás, mientras le responden a la persona en esa charla', async () => {
    const { b, carpeta } = await preparar()
    const s = b.servicios
    const d = delegacionesDe(s)!
    const id = (agente: string, sid = S1) => ({ oficina: carpeta, agente, sid, perfil: 'agente', interactivo: true })
    expect(herramientasCambiosCharla(s, 't', id('sofia'))).toBeUndefined()   // revisión, reporte, tarea: sin la persona
    d.empezarCharla(carpeta, 'sofia', S1)
    d.empezarCharla(carpeta, 'nico', S1)
    expect(herramientasCambiosCharla(s, 't', id('sofia'))?.definiciones.map((x: any) => x.name)).toEqual(Creador.nombresCortos)
    expect(herramientasCambiosCharla(s, 't', id('sofia', S2))).toBeUndefined()
    expect(herramientasCambiosCharla(s, 't', id('nico'))?.definiciones.map((x) => x.name)).toEqual(CambiosCharla.nombresTodos)
    d.terminarCharla(carpeta, 'sofia', S1)
    expect(herramientasCambiosCharla(s, 't', id('sofia'))).toBeUndefined()
  })

  test('el servidor MCP las compone con las de hq solo en la charla', async () => {
    const { b, carpeta } = await preparar()
    const mcp = mcpDe(b.servicios)!
    const ident = { oficina: carpeta, agente: 'sofia', sid: S1, perfil: 'agente', interactivo: true }
    expect(mcp.consultas.herramientas(mcp.tokens.emitir(ident), ident).definiciones.map((x) => x.name)).not.toContain('proponer_agente')
    delegacionesDe(b.servicios)!.empezarCharla(carpeta, 'sofia', S1)
    const nombres = mcp.consultas.herramientas(mcp.tokens.emitir(ident), ident).definiciones.map((x) => x.name)
    expect(nombres).toContain('proponer_agente')
    expect(nombres).toContain('delegar')
    expect(new Set(nombres).size).toBe(nombres.length)   // sin nombres repetidos
  })

  test('los nombres permitidos: los del Creador para la secretaría, los de tareas para los demás', async () => {
    const { b, carpeta } = await preparar()
    expect(CambiosCharla.nombresSecretaria).toEqual(Creador.nombresCortos)
    expect(CambiosCharla.nombresTodos.every((n) => Creador.nombresCortos.includes(n))).toBe(true)
    const o = OficinaStore.leer(carpeta)
    const sofia = o.agentes.find((a) => a.id === 'sofia')!, nico = o.agentes.find((a) => a.id === 'nico')!
    expect(HerramientasMCPAgente.lista(o, sofia)).toEqual(expect.arrayContaining(Creador.nombresMCP))
    expect(HerramientasMCPAgente.lista(o, nico)).not.toContain('mcp__hq__proponer_agente')
    expect(HerramientasMCPAgente.lista(o, nico)).toContain('mcp__hq__proponer_tarea')
    void b
  })

  test('la secretaría recibe las de armar la oficina; los demás, las de tareas', async () => {
    const { sb, chat, b, carpeta } = await preparar()
    await chat('hola')
    let l = sb.llamadas.at(-1)!
    expect(l[l.indexOf('--append-system-prompt') + 1]).toContain('## Armar la oficina')
    expect(l.join(' ')).toContain('mcp__hq__proponer_agente')
    await chat('hola', { agent: 'nico', session: S2 })
    l = sb.llamadas.at(-1)!
    expect(l[l.indexOf('--append-system-prompt') + 1]).not.toContain('## Armar la oficina')
    expect(l[l.indexOf('--append-system-prompt') + 1]).toContain('## Tareas programadas')
    const o = OficinaStore.leer(carpeta)
    expect(instruccionesCreadora(o, o.agentes.find((a) => a.id === 'sofia')!)).toContain('armar y cambiar la oficina')
    void b
  })
})

describe('toda oficina nueva viene con secretaría', () => {
  test('POST /api/oficinas con «secretaria» la contrata en el mismo paso; sin ese campo, no', async () => {
    const sb = new Sandbox()
    const b = arrancar(sb)
    const r = await llamar(b, 'POST', '/api/oficinas', { nombre: 'Estudio', duenio: 'Ana', vacia: true, secretaria: { nombre: 'Sofía' } })
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    const o = OficinaStore.leer(String(r.obj.carpeta))
    const sec = o.agentes.find((a) => a.id === o.secretaria?.agente)!
    expect(sec).toMatchObject({ nombre: 'Sofía', rol: 'Secretaría' })
    expect(sec.chips?.[0]).toBe('Armemos el equipo')
    // lo que devuelve la API ya la trae
    expect(r.obj.oficina.agentes.map((a: any) => a.id)).toContain(sec.id)
    const sin = await llamar(b, 'POST', '/api/oficinas', { nombre: 'Otra', duenio: 'Ana', vacia: true })
    expect(OficinaStore.leer(String(sin.obj.carpeta)).secretaria).toBeUndefined()
  })

  test('sin nombre, se llama «Secretaría»', async () => {
    const sb = new Sandbox()
    const b = arrancar(sb)
    const r = await llamar(b, 'POST', '/api/oficinas', { nombre: 'Estudio', duenio: 'Ana', secretaria: {} })
    const o = OficinaStore.leer(String(r.obj.carpeta))
    expect(o.agentes.find((a) => a.id === o.secretaria?.agente)?.nombre).toBe('Secretaría')
  })
})

describe('sumarle cosas a lo que ya existe', () => {
  async function conLimites() {
    const x = await preparar()
    x.b.servicios.oficinas.modificar((o) => {
      const n = o.agentes.find((a) => a.id === 'nico')!
      n.limites = { solo: ['Contestar consultas de precios'], proponer: ['Mandar presupuestos'] }
      n.conectores = [{ servidor: 'Gmail', leer: ['mcp__claude_ai_Gmail__search_threads'], actuar: [] }]
    })
    return x
  }
  const pedidoLimites = 'que Nico también pueda contestar mails de proveedores sin preguntarme'

  test('ver_detalle trae la definición completa: instrucciones, límites y conectores con sus herramientas', async () => {
    const { sb, chat } = await conLimites()
    sb.llamadasMCP('sofia', [{ name: 'ver_detalle', arguments: { tipo: 'agente', id: 'nico' } }, { name: 'ver_detalle', arguments: { tipo: 'flujo', id: 'nada' } }])
    await chat('MCP_LLAMAR ' + pedidoLimites)
    const s = sb.salidasMCP('sofia') as any[]
    const d = JSON.parse(s[0].result.content[0].text)
    expect(d).toMatchObject({ id: 'nico', prompt: 'Sos nico.', limites: { solo: ['Contestar consultas de precios'], proponer: ['Mandar presupuestos'] } })
    expect(d.conectores[0]).toMatchObject({ servidor: 'Gmail', leer: ['mcp__claude_ai_Gmail__search_threads'] })
    expect(d.avatar).toBeUndefined()
    expect(s[1].result.isError).toBe(true)
  })

  test('un «modificar» que quita algo de una lista avisa qué quita; con la lista completa, no', async () => {
    const { sb, chat, tarjetas } = await conLimites()
    const modificar = (solo: string[], ref?: string) => ({ name: 'proponer_agente', arguments: {
      accion: 'modificar', objetivo: 'nico', origen: 'contestar mails de proveedores sin preguntarme', ...(ref ? { ref } : {}),
      datos: { limites: { solo, proponer: ['Mandar presupuestos'] } } } })
    sb.llamadasMCP('sofia', [modificar(['Contestar mails de proveedores']), modificar(['Contestar consultas de precios', 'Contestar mails de proveedores'], 't1')])
    await chat('MCP_LLAMAR ' + pedidoLimites)
    const s = (sb.salidasMCP('sofia') as any[]).map((x) => JSON.parse(x.result.content[0].text))
    expect(s[0].aviso).toContain('limites.solo («Contestar consultas de precios»)')
    expect(s[0].aviso).toContain('ver_detalle')
    expect(s[1].aviso).toBeUndefined()
    expect((await tarjetas()).cambios[0].datos.limites.solo).toEqual(['Contestar consultas de precios', 'Contestar mails de proveedores'])
  })

  test('la tarjeta de un «modificar» lleva cómo está hoy (antes) y lo que se quita, en la charla y en Propuestas', async () => {
    const { sb, b, chat, tarjetas } = await conLimites()
    sb.llamadasMCP('sofia', [{ name: 'proponer_agente', arguments: { accion: 'modificar', objetivo: 'nico', origen: 'contestar mails de proveedores sin preguntarme',
      datos: { limites: { solo: ['Contestar mails de proveedores'], proponer: ['Mandar presupuestos'] } } } }])
    await chat('MCP_LLAMAR ' + pedidoLimites)
    const t = (await tarjetas()).cambios[0]
    expect(t.antes).toMatchObject({ id: 'nico', prompt: 'Sos nico.', limites: { solo: ['Contestar consultas de precios'] } })
    expect(t.quita).toEqual([{ campo: 'limites.solo', quita: ['Contestar consultas de precios'] }])
    expect((await llamar(b, 'GET', '/api/creador/borrador')).obj.tarjetas[0].quita).toEqual(t.quita)
    expect((await llamar(b, 'GET', '/api/charlas/pendientes')).obj.cambios[0].tarjetas[0].quita).toEqual(t.quita)
  })
})
