// Port de app/Tests/BackendTests/RouterTests.swift.
// Diferencias por HTTP: el servidor dev pone sus propias guardas (Host/Origin/Content-Type, 40 MB) antes del router;
// ninguna de las aserciones de este archivo queda detrás de ellas.
import net from 'node:net'
import { describe, expect, test } from 'vitest'
import { Sandbox, U, chat, historial, llamar, msgs, type Backend, type Obj } from '../support/sandbox.js'

const invalido = 'pedido inválido'
const mensajeLogin = "Claude Code todavía no tiene la sesión iniciada. Usá «Iniciar sesión» en la app o corré 'claude auth login' en la Terminal."

/** Pedido con el método tal cual (Node mayusculiza `method` en http.request): socket crudo. */
function pedirCrudo(b: Backend, metodo: string, ruta: string): Promise<{ status: number; obj: Obj }> {
  return new Promise((resolve, reject) => {
    const s = net.connect(b.puerto, '127.0.0.1')
    let buf = ''
    s.on('data', (d) => { buf += d.toString() })
    s.on('error', reject)
    s.on('close', () => {
      const status = parseInt(buf.split(' ')[1] ?? '0', 10)
      const cuerpo = buf.split('\r\n\r\n').slice(1).join('\r\n\r\n')
      let obj: Obj = {}
      try { obj = JSON.parse(cuerpo) } catch {}
      resolve({ status, obj })
    })
    s.write(`${metodo} ${ruta} HTTP/1.1\r\nHost: localhost:${b.puerto}\r\nOrigin: ${b.base}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n`)
  })
}

describe('Router', () => {
  // MARK: /api/estado

  test('estado: forma exacta con claude y sesión iniciada', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    const r = await llamar(b, 'GET', '/api/estado')
    expect(r.status).toBe(200)
    expect(Object.keys(r.obj).sort()).toEqual(['agentes', 'app', 'auth', 'claude', 'claudePath', 'conectores_agentes', 'ia', 'modelos', 'modo_permisos', 'oficina', 'perfil', 'version'])
    expect(r.obj.app).toBe('prospera-hq')
    expect(r.obj.version).toBe('1.0.0')
    expect(r.obj.claude).toBe(true)
    expect(r.obj.auth).toBe(true)
    expect(r.obj.claudePath).toBe(sb.bin)
    expect(r.obj.agentes).toEqual(['betty', 'catalina', 'don-armando', 'marce', 'mario', 'nicolas', 'patricia', 'sofia'])
  })

  test('estado: auth=false cuando claude auth status falla', async () => {
    const sb = new Sandbox()
    sb.setAuth(false)
    const b = await sb.backend()
    const r = await llamar(b, 'GET', '/api/estado')
    expect(r.status).toBe(200)
    expect(r.obj.claude).toBe(true)
    expect(r.obj.auth).toBe(false)
  })

  test('estado: refleja agentes y versión de la config; ignora query y fragmento en el path', async () => {
    const sb = new Sandbox()
    const b = await sb.backend({ config: { agentes: ['zeta', 'alfa'] } })
    const r = await llamar(b, 'GET', '/api/estado?x=1#frag')
    expect(r.status).toBe(200)
    expect(r.obj.agentes).toEqual(['alfa', 'zeta'])
    // interno (unit test del port): `version` no tiene clave en config.json (solo se pisa desde Config en memoria o el bundle).
  })

  test('estado: sin claude encontrable -> claude=false, auth=null, claudePath=null', async () => {
    const sb = new Sandbox()
    // sin claudePath fijo (CLAUDE_BIN vacío): el resolver busca (rutas conocidas y shell de login)
    const b = await sb.backend({ claudePath: '' })
    const r = await llamar(b, 'GET', '/api/estado')
    if (r.obj.claudePath != null) {
      // En esta máquina hay un claude real instalado: no se puede simular su ausencia (igual que en Swift).
      console.warn(`omitido: hay un claude real localizable (${r.obj.claudePath}); el caso sin claude no se pudo simular`)
      return
    }
    expect(r.obj.claude).toBe(false)
    expect(r.obj.auth).toBeNull()
    expect(r.obj.claudePath).toBeNull()
  })

  // MARK: /api/historial

  test('historial: sin sesiones -> session null y msgs vacío', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    const r = await historial(b)
    expect(r.status).toBe(200)
    expect(Object.keys(r.obj).sort()).toEqual(['msgs', 'session'])
    expect(r.obj.session).toBeNull()
    expect(msgs(r)).toEqual([])
  })

  test('historial: sin session devuelve la última del agente con forma {r,t} y e solo en errores', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    await chat(b, { message: 'uno', session: U.a })
    await chat(b, { message: 'LOGINERR', session: U.a })
    const r = await historial(b)
    expect(r.status).toBe(200)
    expect(Object.keys(r.obj).sort()).toEqual(['msgs', 'session'])
    expect(r.obj.session).toBe(U.a)
    expect(msgs(r)).toEqual([
      { r: 'u', t: 'uno' },
      { r: 'a', t: 'hola betty' },
      { r: 'u', t: 'LOGINERR' },
      { r: 'a', t: 'No pude responder: ' + mensajeLogin, e: true },
    ])
  })

  test('historial: la última sesión es la que tuvo el mensaje más reciente', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    await chat(b, { message: 'en A', session: U.a })
    await chat(b, { message: 'en B', session: U.b })
    expect((await historial(b)).obj.session).toBe(U.b)
    await chat(b, { message: 'otra vez A', session: U.a })
    expect((await historial(b)).obj.session).toBe(U.a)
  })

  test('historial: con session devuelve solo msgs (sin clave session)', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    await chat(b, { message: 'hola', session: U.a })
    const r = await historial(b, { session: U.a })
    expect(r.status).toBe(200)
    expect(Object.keys(r.obj)).toEqual(['msgs'])
    expect(msgs(r)).toEqual([{ r: 'u', t: 'hola' }, { r: 'a', t: 'hola betty' }])
  })

  test('historial: session desconocida y válida -> msgs vacío; en mayúsculas se normaliza', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    expect(msgs(await historial(b, { session: U.c }))).toEqual([])
    await chat(b, { message: 'hola', session: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' })
    const r = await historial(b, { session: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
    expect(msgs(r).length).toBe(2)
    const r2 = await historial(b, { session: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' })
    expect(msgs(r2).length).toBe(2)
  })

  test('historial: session de otro agente -> 200 con msgs vacío (igual que server.py)', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    await chat(b, { agent: 'betty', message: 'secreto', session: U.a })
    const r = await historial(b, { agent: 'marce', session: U.a })
    expect(r.status).toBe(200)
    expect(r.obj).toEqual({ msgs: [] })
  })

  test('historial: agent faltante, desconocido o session inválida -> 400', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    const sinAgente = await llamar(b, 'GET', '/api/historial')
    expect(sinAgente.status).toBe(400)
    expect(sinAgente.obj.error).toBe(invalido)
    expect((await historial(b, { agent: 'nadie' })).status).toBe(400)
    expect((await historial(b, { agent: '' })).status).toBe(400)
    for (const s of ['', 'no-es-uuid', '11111111-1111-4111-8111-11111111111', '11111111-1111-4111-8111-1111111111111', 'gggggggg-1111-4111-8111-111111111111']) {
      const r = await llamar(b, 'GET', '/api/historial', { query: { agent: 'betty', session: s } })
      expect(r.status, `session=${s}`).toBe(400)
      expect(r.obj.error).toBe(invalido)
    }
  })

  // MARK: /api/sesiones

  test('sesiones: lista las charlas de la oficina, la más reciente primero, con título y último mensaje', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    expect((await llamar(b, 'GET', '/api/sesiones')).obj).toEqual({ sesiones: [] })
    await chat(b, { message: 'primera   charla\ncon betty', session: U.a })
    await chat(b, { agent: 'marce', message: 'hola marce', session: U.b })
    await chat(b, { message: 'sigo en la primera', session: U.a })
    const r = await llamar(b, 'GET', '/api/sesiones')
    expect(r.status).toBe(200)
    const ss = r.obj.sesiones as Obj[]
    expect(ss.map((s) => s.session)).toEqual([U.a, U.b])
    expect(ss[0]).toMatchObject({ agente: 'betty', titulo: 'primera charla con betty', ultimo: 'hola betty', de: 'a', n: 4 })
    expect(typeof ss[0]!.ts).toBe('number')
    expect(Object.keys(ss[0]!).sort()).toEqual(['agente', 'de', 'n', 'session', 'titulo', 'ts', 'ultimo'])
  })

  test('sesiones: ?agent= filtra; agente desconocido -> 400; títulos largos se recortan', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    await chat(b, { message: 'x'.repeat(500), session: U.a })
    await chat(b, { agent: 'marce', message: 'hola', session: U.b })
    const r = await llamar(b, 'GET', '/api/sesiones', { query: { agent: 'marce' } })
    expect((r.obj.sesiones as Obj[]).map((s) => s.session)).toEqual([U.b])
    const todas = (await llamar(b, 'GET', '/api/sesiones')).obj.sesiones as Obj[]
    expect(todas.find((s) => s.session === U.a)!.titulo).toBe('x'.repeat(400) + '…')
    expect((await llamar(b, 'GET', '/api/sesiones', { query: { agent: 'nadie' } })).status).toBe(400)
    expect((await llamar(b, 'POST', '/api/sesiones')).status).toBe(405)
  })

  // MARK: /api/chat

  test('chat: respuesta exacta {reply} y queda guardada', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    const r = await chat(b, { message: '  hola  ' })
    expect(r.status).toBe(200)
    expect(r.obj).toEqual({ reply: 'hola betty' })
    // el mensaje se guarda y se envía recortado
    expect(sb.llamadas.at(-1)?.at(-1)).toBe('hola')
    expect(msgs(await historial(b, { session: U.a }))[0]?.t).toBe('hola')
  })

  test("chat: sin respuesta de texto -> '(sin respuesta)' guardado y reply vacío", async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    const r = await chat(b, { message: 'VACIO' })
    expect(r.status).toBe(200)
    expect(r.obj.reply).toBe('')
    expect(msgs(await historial(b, { session: U.a })).at(-1)?.t).toBe('(sin respuesta)')
  })

  test.each([
    'nil', 'no json', '[]', '{}',
    '{"agent":"betty","message":"hola"}',
    '{"agent":"betty","session":"11111111-1111-4111-8111-111111111111"}',
    '{"message":"hola","session":"11111111-1111-4111-8111-111111111111"}',
    '{"agent":1,"message":"hola","session":"11111111-1111-4111-8111-111111111111"}',
    '{"agent":"betty","message":123,"session":"11111111-1111-4111-8111-111111111111"}',
    '{"agent":"betty","message":"hola","session":7}',
  ])('chat: cuerpo inválido -> 400 sin lanzar claude', async (cuerpo) => {
    const sb = new Sandbox()
    const b = await sb.backend()
    const r = await llamar(b, 'POST', '/api/chat', { body: cuerpo === 'nil' ? undefined : cuerpo })
    expect(r.status).toBe(400)
    expect(r.obj.error).toBe(invalido)
    expect(sb.llamadas).toEqual([])
  })

  test('chat: UUID inválido, agente desconocido o mensaje vacío -> 400', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    for (const s of ['', 'x', '11111111111141118111111111111111', '11111111-1111-4111-8111-11111111111z', ' 11111111-1111-4111-8111-111111111111']) {
      const r = await chat(b, { session: s })
      expect(r.status, `session=${s}`).toBe(400)
      expect(r.obj.error).toBe(invalido)
    }
    const ag = await chat(b, { agent: 'fantasma' })
    expect(ag.status).toBe(400)
    expect(ag.obj.error).toBe(invalido)
    expect((await chat(b, { agent: '../betty' })).status).toBe(400)
    for (const m of ['', '   ', '\n\t ']) {
      const r = await chat(b, { message: m })
      expect(r.status, 'mensaje vacío').toBe(400)
    }
    expect(sb.llamadas).toEqual([])
    // nada se guardó
    expect(msgs(await historial(b))).toEqual([])
  })

  test('chat: mensaje de 100001 caracteres -> 400; de 100000 -> ok', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    const r = await chat(b, { message: 'a'.repeat(100_001) })
    expect(r.status).toBe(400)
    expect(sb.llamadas).toEqual([])
    const ok = await chat(b, { message: 'a'.repeat(100_000) })
    expect(ok.status).toBe(200)
  })

  test('chat: cuerpo de más de 200000 bytes -> 413', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    const r = await llamar(b, 'POST', '/api/chat', { body: Buffer.alloc(200_001, 'x') })
    expect(r.status).toBe(413)
    expect(r.obj.error).toBe('pedido demasiado grande')
    // justo en el límite ya no es 413 (es 400 por no ser JSON)
    const lim = await llamar(b, 'POST', '/api/chat', { body: Buffer.alloc(200_000, 'x') })
    expect(lim.status).toBe(400)
    expect(sb.llamadas).toEqual([])
  })

  test('chat: sesión que pertenece a otro agente -> 400 y no lanza claude', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    await chat(b, { agent: 'betty', message: 'hola', session: U.a })
    const antes = sb.llamadas.length
    const r = await chat(b, { agent: 'marce', message: 'intruso', session: U.a })
    expect(r.status).toBe(400)
    expect(r.obj.error).toBe(invalido)
    expect(sb.llamadas.length).toBe(antes)
    expect(msgs(await historial(b, { agent: 'betty', session: U.a })).length).toBe(2)
  })

  test('chat: UUID en mayúsculas se guarda y se envía en minúsculas', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    const r = await chat(b, { session: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' })
    expect(r.status).toBe(200)
    const a = sb.llamadas.at(-1)!
    expect(a).toBeDefined()
    expect(a.includes('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe(true)
    expect(a.includes('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toBe(false)
  })

  test("chat: claude inexistente (ruta fija que no ejecuta) -> 500 'No pude ejecutar'", async () => {
    const sb = new Sandbox()
    const b = await sb.backend({ claudePath: sb.root + '/no-existe/claude' })
    const r = await chat(b)
    expect(r.status).toBe(500)
    expect(r.obj.error).toBe('No pude ejecutar Claude Code en esta compu.')
    // el error queda en el historial
    const h = msgs(await historial(b, { session: U.a }))
    expect(h.at(-1)?.e).toBe(true)
  })

  test("chat: sin claude -> 500 'No encontré Claude Code' y no se guarda nada", async () => {
    const sb = new Sandbox()
    const b = await sb.backend({ claudePath: '' })
    if ((await llamar(b, 'GET', '/api/estado')).obj.claudePath != null) {
      console.warn('omitido: hay un claude real localizable; el caso sin claude no se pudo simular')
      return
    }
    const r = await chat(b)
    expect(r.status).toBe(500)
    expect(r.obj.error).toBe('No encontré Claude Code en esta compu.')
    expect(msgs(await historial(b, { session: U.a }))).toEqual([])
  })

  // Cambio de contrato (oficinas): sin carpeta de oficina no hay oficina activa, así que el chat responde 409.
  test("chat: sin oficina abierta (carpeta inexistente) -> 409 'No hay una oficina abierta'", async () => {
    const sb = new Sandbox({ proyecto: false })
    const b = await sb.backend()
    const r = await chat(b)
    expect(r.status).toBe(409)
    expect(r.obj.error).toBe('No hay una oficina abierta')
    expect(sb.llamadas).toEqual([])
  })

  // MARK: rutas y métodos

  // '/' y '/index.html' los sirve la UI estática del servidor dev antes del router (200): no se alcanzan por HTTP.
  test.each(['/api', '/api/', '/api/otra', '/api/estado/', '/api/chat/x'])('404 para rutas desconocidas (incluye /api/ y estáticos)', async (path) => {
    const sb = new Sandbox()
    const b = await sb.backend()
    for (const m of ['GET', 'POST']) {
      const r = await llamar(b, m, path)
      expect(r.status, `${m} ${path}`).toBe(404)
      expect(r.obj, `${m} ${path}`).toEqual({ error: 'no' })
    }
  })

  test('405 con método equivocado', async () => {
    const sb = new Sandbox()
    const b = await sb.backend()
    const casos: [string, string][] = [
      ['POST', '/api/estado'], ['PUT', '/api/estado'], ['DELETE', '/api/estado'],
      ['POST', '/api/historial'], ['DELETE', '/api/historial'],
      ['GET', '/api/chat'], ['PUT', '/api/chat'], ['DELETE', '/api/chat'], ['HEAD', '/api/chat'],
    ]
    for (const [m, p] of casos) {
      // HEAD por socket crudo (el cliente de Node no tolera el cuerpo que el servidor manda en HEAD) y sin verificar cuerpo.
      const r = m === 'HEAD' ? await pedirCrudo(b, m, p) : await llamar(b, m, p)
      expect(r.status, `${m} ${p}`).toBe(405)
      if (m !== 'HEAD') expect(r.obj, `${m} ${p}`).toEqual({ error: 'método no permitido' })
    }
  })
})
