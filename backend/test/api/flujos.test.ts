// Port de app/Tests/BackendTests/FlujosTests.swift.
// Motor de flujos, corridas y API /api/flujos. Siempre con el claude falso y con HQ_PROGRAMADOR=0.
// Los tests que llaman a `motor.barrer`, a `store` o a `FlujoTexto.consigna` directamente quedan como test.skip.
import { describe, expect, test } from 'vitest'
import { Fix, Sandbox, contratar, dict, esperar, llamar, lista, str, type Obj, type Resp } from '../support/sandbox.js'

/** Flujo de 3 pasos: A (Sofía, con aprobación) → la persona → B (Armando, sin aprobación, recibe de la persona y de A). */
const pasos3: Obj[] = [
  { id: 'diseno', nombre: 'Diseño', quien: 'sofia', consigna: 'Diseñá la clase', recibe: 'El tema', entrega: 'Ficha y guion', aprobacion: true },
  { id: 'grabacion', nombre: 'Grabación', quien: 'persona', entrega: 'El archivo de la grabación' },
  { id: 'edicion', nombre: 'Edición', quien: 'armando', recibeDe: ['grabacion', 'diseno'], entrega: 'Video final', aprobacion: false },
]

// Los args del claude falso pueden llegar en NFD (Swift compara con equivalencia canónica): se normaliza.
const prompts = (f: Fix) => f.sb.prompts.map((p) => p.normalize('NFC'))
/** El mensaje de sistema de cada llamada (en qué flujo y paso está, qué entrega y dónde van ahí). */
const sistemas = (f: Fix) => f.sb.llamadas.map((a) => (Sandbox.valor(a, '--append-system-prompt') ?? '').normalize('NFC'))

const fix = () => Fix.crear({
  deps: ['Dirección'],
  agentes: [{ id: 'sofia', depto: 'direccion', rol: 'Directora académica' }, { id: 'armando', depto: 'direccion', rol: 'Editor' }],
  env: { HQ_PROGRAMADOR: '0' },
})

async function definir(f: Fix, pasos: Obj[] = pasos3, nombre = 'Clase'): Promise<string> {
  const r = await f.post('/api/flujos', { nombre, pasos })
  expect(r.status, JSON.stringify(r.obj)).toBe(200)
  return str(dict(r.obj.flujo).id)
}

async function correr(f: Fix, flujo: string, nombre = 'Clase 7', contexto?: string): Promise<number> {
  const d: Obj = { nombre }
  if (contexto !== undefined) d.contexto = contexto
  const r = await f.post(`/api/flujos/${flujo}/correr`, d)
  expect(r.status, JSON.stringify(r.obj)).toBe(200)
  return Number(dict(r.obj.corrida).id ?? 0)
}

const corrida = async (f: Fix, id: number): Promise<Obj> => dict((await f.get(`/api/flujos/corridas/${id}`)).obj.corrida)
const pasos = async (f: Fix, id: number): Promise<Obj[]> => lista((await f.get(`/api/flujos/corridas/${id}`)).obj.pasos)
async function intentos(f: Fix, id: number, paso: number): Promise<Obj[]> {
  const p = await pasos(f, id)
  return paso < p.length ? lista(p[paso]!.intentos) : []
}
const esperaEstado = async (f: Fix, id: number, estado: string) => esperar(async () => str((await corrida(f, id)).estado) === estado)
const post = (f: Fix, id: number, accion: string, body?: unknown): Promise<Resp> => f.post(`/api/flujos/corridas/${id}/${accion}`, body)
async function entregaVigente(f: Fix, id: number, paso: number): Promise<number> {
  const i = await intentos(f, id, paso)
  return Number(dict(i[i.length - 1]?.entrega).id ?? 0)
}

describe('Flujos: motor, corridas y API', () => {
  // MARK: el recorrido completo

  test('A con aprobación: espera; versión vieja no avanza; con cambios y revisando la vigente avanza; la persona; B; termina', async () => {
    const f = await fix()
    const flujo = await definir(f)
    const c = await correr(f, flujo, 'Clase 7', 'Tema: fracciones')

    // el paso A corre y su entrega deja la corrida esperando aprobación
    expect(await esperaEstado(f, c, 'esperando_aprobacion')).toBe(true)
    const a1 = await entregaVigente(f, c, 0)
    expect(a1).toBeGreaterThan(0)
    const e1 = dict((await f.get(`/api/entregas/${a1}`)).obj.entrega)
    expect(str(e1.origen) === 'flujo' && str(e1.agente) === 'sofia' && str(e1.ref) === `flujo:${c}:0:1`).toBe(true)
    expect(str(e1.titulo)).toBe('Clase 7 · Diseño')
    const paso0 = (await intentos(f, c, 0))[0]!
    expect(paso0).toBeDefined()
    expect(str(paso0.estado) === 'esperando_aprobacion' && (typeof paso0.costo === 'number' ? paso0.costo : 0) > 0).toBe(true)
    // el intento trae su conversación (para abrirla desde el flujo) y quién la tuvo
    expect(str(paso0.agente) === 'sofia' && str(paso0.sid).length === 36 && str(paso0.ejecucionEstado) === 'ok').toBe(true)
    expect(paso0.consultas == null).toBe(true)
    // la consigna llevó el flujo, el paso y el contexto, y termina con la carpeta de entrega
    const consigna = prompts(f)[0]!
    expect(consigna).toBeDefined()
    expect(consigna.includes('Diseñá la clase') && consigna.includes('Tema: fracciones')).toBe(true)
    // en qué paso está y dónde dejar la entrega van como mensaje de sistema, no en la charla
    const sis0 = sistemas(f)[0]!
    expect(sis0).toContain('Paso 1 de 3: Diseño')
    expect(sis0.endsWith('Dejá lo que entregues en archivos/entregables/sofia/.')).toBe(true)
    expect(consigna).not.toContain('Dejá lo que entregues')
    // la entrega aparece al filtrar las corridas por entrega
    const porEntrega = lista((await f.get('/api/flujos/corridas', { entrega: String(a1) })).obj.corridas)
    expect(porEntrega.map((x) => str(x.nombre))).toEqual(['Clase 7'])

    // pido cambios: nace una versión nueva y la anterior pasa a «cambios»
    expect((await f.post(`/api/entregas/${a1}/cambios`, { texto: 'Hacelo más corto' })).status).toBe(202)
    expect(await esperar(async () => (await entregaVigente(f, c, 0)) !== a1)).toBe(true)
    const a2 = await entregaVigente(f, c, 0)
    expect(str((await corrida(f, c)).estado)).toBe('esperando_aprobacion')
    // revisar la versión vieja: 409, y no avanza
    expect((await f.post(`/api/entregas/${a1}/revisada`)).status).toBe(409)
    expect(str((await corrida(f, c)).estado)).toBe('esperando_aprobacion')
    // revisar la vigente avanza hasta la persona
    expect((await f.post(`/api/entregas/${a2}/revisada`)).status).toBe(200)
    expect(await esperaEstado(f, c, 'esperando_persona')).toBe(true)
    expect(str((await intentos(f, c, 0))[0]!.estado)).toBe('listo')

    // el aviso «te necesita» aparece en /api/avisos y se marca como visto
    const av = lista((await f.get('/api/avisos')).obj.avisos).find((x) => str(x.id) === `flujo:${c}`)
    expect(av !== undefined && str(av.tipo) === 'flujo' && str(av.texto) === '«Clase 7» te necesita: Grabación').toBe(true)
    // y en /api/actividad la corrida abierta
    const act = lista((await f.get('/api/actividad')).obj.corridas)
    expect(act.length === 1 && str(act[0]!.pasoNombre) === 'Grabación' && str(act[0]!.quien) === 'persona' && str(act[0]!.anterior) === 'sofia').toBe(true)
    expect((await f.post('/api/avisos/visto', { id: `flujo:${c}` })).obj.vistos).toBe(1)
    expect(lista((await f.get('/api/avisos')).obj.avisos).some((x) => str(x.id) === `flujo:${c}`)).toBe(false)

    // «hecho» con un archivo y una nota: la persona entrega, la entrega queda revisada y pasa a B
    const b64 = Buffer.from('video').toString('base64')
    const h = await post(f, c, 'hecho', { nota: 'Grabé con el celular', archivos: [{ nombre: 'toma1.txt', base64: b64 }] })
    expect(h.status, JSON.stringify(h.obj)).toBe(200)
    expect(f.leer(`archivos/entregables/persona/${c}-1/toma1.txt`)).toBe('video')
    expect(await esperaEstado(f, c, 'terminada')).toBe(true)
    const ip = (await intentos(f, c, 1))[0]!
    expect(ip).toBeDefined()
    const ep = dict((await f.get(`/api/entregas/${Number(dict(ip.entrega).id ?? 0)}`)).obj.entrega)
    expect(str(ep.origen) === 'persona' && str(ep.agente) === '' && str(ep.estado) === 'revisada').toBe(true)
    expect(ep.archivos).toEqual([`archivos/entregables/persona/${c}-1/toma1.txt`])
    // recibeDe se ve en la consigna de B: lo de la persona y lo de A, no «el anterior» solamente
    const deB = prompts(f).at(-1)!
    expect(deB).toBeDefined()
    expect(sistemas(f).at(-1)).toContain('Paso 3 de 3: Edición')
    expect(deB.includes('Paso 3: Edición') && deB.includes('Grabé con el celular') && deB.includes(`archivos/entregables/persona/${c}-1/toma1.txt`)).toBe(true)
    expect(deB.includes('hola sofia')).toBe(true)
    expect(deB.indexOf('Paso «Grabación»'), 'respeta el orden de recibeDe').toBeLessThan(deB.indexOf('Paso «Diseño»'))
    expect(deB.indexOf('Paso «Grabación»')).toBeGreaterThanOrEqual(0)
    // la corrida terminó y dejó un aviso guardado
    const av2 = lista((await f.get('/api/avisos')).obj.avisos).find((x) => str(x.tipo) === 'flujo')
    expect(str(av2?.texto) === '«Clase 7» terminó' && str(av2?.ref) === String(c)).toBe(true)
    expect(lista((await f.get('/api/actividad')).obj.corridas)).toEqual([])
    // el detalle trae pasos con intentos y entregas
    const det = await pasos(f, c)
    expect(det.length === 3 && str(dict(det[0]!.def).nombre) === 'Diseño' && lista(det[0]!.intentos).length === 1).toBe(true)
    expect(dict(lista(det[2]!.intentos)[0]!.entrega).titulo).toBe('Clase 7 · Edición')
    // las terminadas salen en su filtro y no en las abiertas
    expect(lista((await f.get('/api/flujos/corridas')).obj.corridas)).toEqual([])
    expect(lista((await f.get('/api/flujos/corridas', { estado: 'terminadas' })).obj.corridas).length).toBe(1)
    expect(lista((await f.get('/api/flujos/corridas', { estado: 'todas', flujo: 'otro' })).obj.corridas)).toEqual([])
    // costo con origen «flujo»
    const costoFlujo = dict((await f.get('/api/costos')).obj.origenes).flujo
    expect(typeof costoFlujo === 'number' ? costoFlujo : 0).toBeGreaterThan(0)
  })

  // MARK: trabas

  test('un agente inexistente la deja trabada (sin asignar); contratarlo y reintentar la destraba', async () => {
    const f = await fix()
    const flujo = await definir(f, [{ id: 'uno', nombre: 'Uno', quien: 'fantasma', entrega: 'algo' }])
    const l = lista((await f.get('/api/flujos')).obj.flujos)
    expect(l.length === 1 && JSON.stringify(l[0]!.sinAsignar) === JSON.stringify(['uno'])).toBe(true)
    const c = await correr(f, flujo)
    expect(str((await corrida(f, c)).estado)).toBe('trabada')
    const p = (await intentos(f, c, 0))[0]!
    expect(p).toBeDefined()
    expect(str(p.estado) === 'error' && str(p.nota).includes('fantasma')).toBe(true)
    expect((await pasos(f, c))[0]!.sinAsignar).toBe(true)
    expect(f.sb.llamadas).toEqual([])

    // reintentar con la corrida trabada y el agente todavía ausente: vuelve a trabarse, con un intento más
    expect((await post(f, c, 'reintentar')).status).toBe(200)
    const dos = await intentos(f, c, 0)
    expect(str((await corrida(f, c)).estado) === 'trabada' && dos.length === 2).toBe(true)

    await contratar(f.b, { id: 'fantasma', depto: 'direccion' })
    expect((await post(f, c, 'reintentar')).status).toBe(200)
    expect(await esperaEstado(f, c, 'terminada')).toBe(true)
    const i = await intentos(f, c, 0)
    expect(i.length === 3 && str(i[2]!.estado) === 'listo' && str(i[2]!.quien) === 'fantasma').toBe(true)
    // ya no está trabada: reintentar de nuevo es 409
    expect((await post(f, c, 'reintentar')).status).toBe(409)
  })

  test('el modo error del claude falso deja el paso en error y la corrida trabada; reintentar con el agente sano la termina', async () => {
    const f = await fix()
    const flujo = await definir(f, [{ id: 'uno', nombre: 'Uno', quien: 'sofia', entrega: 'algo' }])
    f.sb.modo('sofia', 'error')
    const c = await correr(f, flujo)
    expect(await esperaEstado(f, c, 'trabada')).toBe(true)
    const p = (await intentos(f, c, 0))[0]!
    expect(p).toBeDefined()
    expect(str(p.estado) === 'error' && str(p.nota).includes('fallo raro')).toBe(true)
    expect(await esperar(async () => lista((await f.get('/api/avisos')).obj.avisos).some((x) => str(x.tipo) === 'error'))).toBe(true)
    f.sb.modo('sofia', null)
    expect((await post(f, c, 'reintentar')).status).toBe(200)
    expect(await esperaEstado(f, c, 'terminada')).toBe(true)
  })

  // interno: usa store.terminarEjecucion y motor.barrer() directamente (unit test del port).
  test.skip('barrer reconcilia un paso que sigue «corriendo» aunque la ejecución ya terminó en error', () => {})

  // MARK: espera, volver y acciones

  // interno: usa motor.barrer(ahora:) con la fecha adelantada (unit test del port).
  test.skip('un paso con esperaDias arranca cuando barrer corre con la fecha adelantada', () => {})

  test('volver reabre un paso anterior con un intento nuevo y la nota va en la consigna', async () => {
    const f = await fix()
    const flujo = await definir(f, [
      { id: 'a', nombre: 'A', quien: 'sofia', entrega: 'algo' },
      { id: 'p', nombre: 'Grabación', quien: 'persona', entrega: 'video' },
    ])
    const c = await correr(f, flujo)
    expect(await esperaEstado(f, c, 'esperando_persona')).toBe(true)
    expect((await post(f, c, 'volver', { paso: 1 })).status, 'igual al actual: se reabre').toBe(200)
    expect((await post(f, c, 'volver', { paso: 2 })).status).toBe(409)
    expect((await post(f, c, 'volver', { paso: -1 })).status).toBe(400)
    expect((await post(f, c, 'volver', {})).status).toBe(400)
    const r = await post(f, c, 'volver', { paso: 0, nota: 'Hacelo más corto' })
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    expect(dict(r.obj.corrida).paso).toBe(0)
    expect(await esperaEstado(f, c, 'esperando_persona')).toBe(true)
    const i = await intentos(f, c, 0)
    expect(i.length === 2 && str(i[1]!.estado) === 'listo' && str(i[1]!.nota) === 'Hacelo más corto').toBe(true)
    const ultimo = prompts(f).at(-1)
    expect(ultimo?.includes('Hacelo más corto')).toBe(true)
    expect(sistemas(f).at(-1)?.includes('Dejá lo que entregues en archivos/entregables/sofia/.')).toBe(true)
    // el paso de la persona quedó con dos intentos (el reabierto y el nuevo)
    expect((await intentos(f, c, 1)).length).toBeGreaterThanOrEqual(2)
  })

  test('acciones fuera de lugar responden 409 o 404; hecho valida los nombres de archivo', async () => {
    const f = await fix()
    const flujo = await definir(f, [
      { id: 'a', nombre: 'A', quien: 'persona', entrega: 'algo' },
      { id: 'b', nombre: 'B', quien: 'persona', entrega: 'otro' },
    ])
    const c = await correr(f, flujo)
    expect(await esperaEstado(f, c, 'esperando_persona')).toBe(true)
    expect((await post(f, c, 'reintentar')).status).toBe(409)
    expect((await post(f, 9999, 'hecho')).status).toBe(404)
    expect((await f.get('/api/flujos/corridas/9999')).status).toBe(404)
    const b64 = Buffer.from('x').toString('base64')
    for (const mal of ['../x.txt', 'a/b.txt', '..', 'n'.repeat(121)]) {
      const r = await post(f, c, 'hecho', { archivos: [{ nombre: mal, base64: b64 }] })
      expect(r.status, `${mal.slice(0, 10)}: ${JSON.stringify(r.obj)}`).toBe(400)
    }
    expect((await post(f, c, 'hecho', { archivos: [{ nombre: 'ok.txt', base64: '%%%no' }] })).status).toBe(400)
    expect(await esperaEstado(f, c, 'esperando_persona')).toBe(true)
    // hecho sin nada avanza; la siguiente espera a la persona; saltar la da por hecha; la corrida termina
    expect((await post(f, c, 'hecho')).status).toBe(200)
    const tras = await corrida(f, c)
    expect(str(tras.estado) === 'esperando_persona' && tras.paso === 1).toBe(true)
    const saltada = await post(f, c, 'saltar')
    expect(saltada.status === 200 && str(dict(saltada.obj.corrida).estado) === 'terminada').toBe(true)
    expect(str((await intentos(f, c, 1))[0]!.estado)).toBe('saltado')
    // una corrida terminada no admite nada más
    for (const a of ['hecho', 'saltar', 'cancelar', 'reintentar']) expect((await post(f, c, a)).status, a).toBe(409)
    expect((await post(f, c, 'volver', { paso: 0 })).status).toBe(409)

    // cancelar
    const c2 = await correr(f, flujo, 'Otra')
    expect(await esperaEstado(f, c2, 'esperando_persona')).toBe(true)
    const can = await post(f, c2, 'cancelar')
    expect(can.status === 200 && str(dict(can.obj.corrida).estado) === 'cancelada').toBe(true)
    expect(str((await intentos(f, c2, 0))[0]!.estado)).toBe('cancelado')
    expect((await post(f, c2, 'cancelar')).status).toBe(409)
    expect(lista((await f.get('/api/flujos/corridas', { estado: 'terminadas' })).obj.corridas).length).toBe(2)
  })

  // MARK: API de definiciones

  test("CRUD de flujos: crea, edita, borra; 'corridas' no sirve de id; sin oficina 409; validaciones", async () => {
    const f = await fix()
    const r = await f.post('/api/flujos', { nombre: 'Corridas', pasos: [{ nombre: 'Uno', quien: 'sofia', entrega: 'x' }] })
    expect(r.status).toBe(200)
    const id = str(dict(r.obj.flujo).id)
    expect(id !== 'corridas' && id !== '').toBe(true)
    expect(str(dict(r.obj.flujo).creado)).not.toBe('')
    expect((await f.post('/api/flujos', { nombre: 'Sin pasos', pasos: [] })).status).toBe(400)
    expect((await f.post('/api/flujos', { pasos: [{ nombre: 'Uno', quien: 'sofia', entrega: 'x' }] })).status).toBe(400)

    const p = await f.patch(`/api/flujos/${id}`, { nombre: 'Nuevo nombre', activo: false })
    expect(p.status === 200 && str(dict(p.obj.flujo).nombre) === 'Nuevo nombre' && dict(p.obj.flujo).activo === false).toBe(true)
    expect(lista(dict(p.obj.flujo).pasos).length).toBe(1)
    expect((await f.patch(`/api/flujos/${id}`, { pasos: [] })).status).toBe(400)
    expect((await f.patch('/api/flujos/nada', { nombre: 'x' })).status).toBe(404)
    // pausado: no se corre
    expect((await f.post(`/api/flujos/${id}/correr`, { nombre: 'x' })).status).toBe(409)
    expect((await f.patch(`/api/flujos/${id}`, { activo: true })).status).toBe(200)
    expect((await f.post(`/api/flujos/${id}/correr`, {})).status).toBe(400)
    expect((await f.post(`/api/flujos/${id}/correr`, { nombre: 'n'.repeat(81) })).status).toBe(400)
    expect((await f.post(`/api/flujos/${id}/correr`, { nombre: 'ok', contexto: 'c'.repeat(4001) })).status).toBe(400)
    expect((await f.post('/api/flujos/nada/correr', { nombre: 'x' })).status).toBe(404)

    expect((await f.delete(`/api/flujos/${id}`)).status).toBe(200)
    expect(lista((await f.get('/api/flujos')).obj.flujos)).toEqual([])
    expect((await f.delete(`/api/flujos/${id}`)).status).toBe(404)
    expect((await llamar(f.b, 'PUT', '/api/flujos')).status).toBe(405)

    const sin = await new Sandbox().backend({ env: { HQ_PROGRAMADOR: '0' }, oficina: false })
    expect((await llamar(sin, 'GET', '/api/flujos')).status).toBe(409)
    expect((await llamar(sin, 'GET', '/api/flujos/corridas')).status).toBe(409)
  })

  test('borrar el flujo no mata las corridas vivas: siguen con su copia de la definición', async () => {
    const f = await fix()
    const flujo = await definir(f, [
      { id: 'a', nombre: 'A', quien: 'persona', entrega: 'algo' },
      { id: 'b', nombre: 'B', quien: 'persona', entrega: 'otro' },
    ])
    const c = await correr(f, flujo)
    expect((await f.delete(`/api/flujos/${flujo}`)).status).toBe(200)
    expect((await post(f, c, 'hecho')).status).toBe(200)
    expect(str((await corrida(f, c)).pasoNombre)).toBe('B')
  })

  // MARK: seguir con otro flujo

  const unPaso = (nombre: string, quien: string): Obj[] => [{ id: 'p', nombre, quien, entrega: 'algo' }]
  const corridasDe = async (f: Fix, flujo: string, estado = 'todas'): Promise<Obj[]> => lista((await f.get('/api/flujos/corridas', { flujo, estado })).obj.corridas)

  test('siguiente: al terminar arranca el otro flujo con la última entrega como contexto, y toma su definición vigente', async () => {
    const f = await fix()
    const dev = await definir(f, [{ id: 'p', nombre: 'Primera versión', quien: 'armando', consigna: 'Desarrollá', entrega: 'El código' }], 'Desarrollo')
    const inv = (await f.post('/api/flujos', { nombre: 'Investigación', pasos: unPaso('Investigar', 'persona'), siguiente: dev }))
    expect(inv.status, JSON.stringify(inv.obj)).toBe(200)
    expect(dict(inv.obj.flujo).siguiente).toBe(dev)
    const idInv = str(dict(inv.obj.flujo).id)

    // se cambia el flujo de desarrollo DESPUÉS de definir la conexión: la corrida nueva usa la versión vigente
    expect((await f.patch(`/api/flujos/${dev}`, { pasos: [{ id: 'p', nombre: 'Segunda versión', quien: 'armando', consigna: 'Desarrollá mejor', entrega: 'El código' }] })).status).toBe(200)

    const c = await correr(f, idInv, 'Tema 1')
    expect(await corridasDe(f, dev)).toEqual([])
    expect((await post(f, c, 'hecho', { nota: 'Hallazgo: usar SQLite' })).status).toBe(200)
    expect(str((await corrida(f, c)).estado)).toBe('terminada')

    const hijas = await corridasDe(f, dev)
    expect(hijas.length).toBe(1)
    expect(str(hijas[0]!.nombre)).toBe('Tema 1 · Desarrollo')
    const ctx = str((await corrida(f, Number(hijas[0]!.id))).contexto)
    expect(ctx.includes('corrida «Tema 1»') && ctx.includes('Hallazgo: usar SQLite')).toBe(true)
    // el agente del primer paso la recibe en su consigna, con la definición nueva del flujo
    expect(await esperaEstado(f, Number(hijas[0]!.id), 'terminada')).toBe(true)
    const consigna = prompts(f).find((p) => p.includes('Segunda versión'))
    expect(consigna, 'la consigna usa la definición vigente').toBeDefined()
    expect(consigna!.includes('Hallazgo: usar SQLite') && consigna!.includes('Desarrollá mejor')).toBe(true)
  })

  test('siguiente: cancelar la corrida no arranca el siguiente; con el siguiente pausado o borrado avisa', async () => {
    const f = await fix()
    const dev = await definir(f, unPaso('Dev', 'persona'), 'Desarrollo')
    const inv = str(dict((await f.post('/api/flujos', { nombre: 'Investigación', pasos: unPaso('Investigar', 'persona'), siguiente: dev })).obj.flujo).id)

    const c1 = await correr(f, inv, 'Uno')
    expect((await post(f, c1, 'cancelar')).status).toBe(200)
    expect(await corridasDe(f, dev)).toEqual([])

    expect((await f.patch(`/api/flujos/${dev}`, { activo: false })).status).toBe(200)
    const c2 = await correr(f, inv, 'Dos')
    expect((await post(f, c2, 'hecho')).status).toBe(200)
    expect(str((await corrida(f, c2)).estado)).toBe('terminada')
    expect(await corridasDe(f, dev)).toEqual([])
    const av = lista((await f.get('/api/avisos')).obj.avisos).find((x) => str(x.tipo) === 'flujo' && str(x.texto).includes('pausado'))
    expect(av, 'avisa que el siguiente está pausado').toBeDefined()

    // si se borra el siguiente, el flujo queda sin conexión y la oficina sigue validando
    expect((await f.delete(`/api/flujos/${dev}`)).status).toBe(200)
    expect(dict((await f.get(`/api/flujos/${inv}`)).obj.flujo).siguiente).toBeUndefined()
    const c3 = await correr(f, inv, 'Tres')
    expect((await post(f, c3, 'hecho')).status).toBe(200)
    expect(str((await corrida(f, c3)).estado)).toBe('terminada')
  })

  test('siguiente: tiene que existir, no puede ser el mismo flujo ni formar un círculo; null lo saca', async () => {
    const f = await fix()
    const a = await definir(f, unPaso('A', 'persona'), 'Alfa')
    const b = str(dict((await f.post('/api/flujos', { nombre: 'Beta', pasos: unPaso('B', 'persona'), siguiente: a })).obj.flujo).id)
    expect((await f.post('/api/flujos', { nombre: 'Gamma', pasos: unPaso('G', 'persona'), siguiente: 'no-existe' })).status).toBe(400)
    expect((await f.patch(`/api/flujos/${a}`, { siguiente: a })).status).toBe(400)
    // a → b y b → a es un círculo
    expect((await f.patch(`/api/flujos/${a}`, { siguiente: b })).status).toBe(400)
    expect(dict((await f.get(`/api/flujos/${a}`)).obj.flujo).siguiente).toBeUndefined()
    const sacar = await f.patch(`/api/flujos/${b}`, { siguiente: null })
    expect(sacar.status === 200 && dict(sacar.obj.flujo).siguiente === undefined).toBe(true)
    expect((await f.patch(`/api/flujos/${a}`, { siguiente: b })).status).toBe(200)
  })

  // MARK: consigna

  // interno: llama a FlujoTexto.consigna con structs Swift (recorte a 3000, saneo, carpeta de entrega); unit test del port.
  test.skip('consigna: recorta cada entrega a 3000 caracteres, la sanea y termina con la carpeta de entrega', () => {})
})
