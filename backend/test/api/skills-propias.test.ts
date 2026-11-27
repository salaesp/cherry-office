// Skills propias de cada agente (`.claude/skills/<nombre>/SKILL.md` en la carpeta de la oficina): ABM desde la ficha, cómo
// llegan a las corridas (siempre para su agente, apagadas para los demás), al despedir, «Convertir en skill» desde una
// charla y las propuestas que hace el agente con `proponer_skill`.
import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { Fix, Sandbox, chat, dict, llamar, lista, str, type Obj } from '../support/sandbox.js'

const fix = () => Fix.crear({ deps: ['Dirección'], agentes: [{ id: 'sofia', depto: 'direccion', rol: 'Secretaria' }, { id: 'marce', depto: 'direccion', rol: 'Analista' }], env: { HQ_PROGRAMADOR: '0' } })
const skill: Obj = { nombre: 'resumen-de-mails', descripcion: 'Usala cuando te pidan el resumen de los mails del día.', contenido: '# Resumen\n\n1. Leé los mails.\n2. Agrupalos por tema.' }
const corridaDe = (f: Fix, agente: string) => f.sb.llamadas.filter((a) => Sandbox.valor(a, '--agent') === agente).at(-1)!
const settings = (a: string[]) => { const v = Sandbox.valor(a, '--settings'); return v ? JSON.parse(v) as Obj : undefined }
const herramientas = (a: string[]) => (Sandbox.valor(a, '--tools') ?? '').split(',')
const chatear = (f: Fix, agent: string, message = 'hola') => f.post('/api/chat', { agent, session: randomUUID(), message })

describe('Skills propias', () => {
  test('ABM: se guardan como skill de proyecto con el agente en el frontmatter; cada agente ve solo las suyas', async () => {
    const f = await fix()
    const r = await f.post('/api/agentes/sofia/skills', skill)
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    expect(lista(r.obj.skills).map((x) => x.nombre)).toEqual(['resumen-de-mails'])
    const md = f.leer('.claude/skills/resumen-de-mails/SKILL.md')
    expect(md).toContain('name: resumen-de-mails')
    expect(md).toContain('description: Usala cuando te pidan el resumen de los mails del día.')
    expect(md).toContain('metadata:\n  oficina-agente: sofia')
    expect(md).toContain('2. Agrupalos por tema.')
    expect(lista((await f.get('/api/agentes/marce/skills')).obj.skills)).toEqual([])
    expect(str(dict((await f.get('/api/agentes/sofia/skills/resumen-de-mails')).obj.skill).contenido)).toContain('Leé los mails')
    // editar
    const e = await f.put('/api/agentes/sofia/skills/resumen-de-mails', { descripcion: 'Otra descripción: con dos puntos', contenido: 'Nuevo' })
    expect(e.status, JSON.stringify(e.obj)).toBe(200)
    expect(dict(e.obj.skill)).toEqual({ nombre: 'resumen-de-mails', descripcion: 'Otra descripción: con dos puntos', contenido: 'Nuevo' })
    // repetidos y ajenos
    expect((await f.post('/api/agentes/sofia/skills', skill)).status).toBe(409)
    expect((await f.post('/api/agentes/marce/skills', skill)).status).toBe(409)
    expect((await f.put('/api/agentes/marce/skills/resumen-de-mails', skill)).status).toBe(404)
    expect((await f.delete('/api/agentes/marce/skills/resumen-de-mails')).status).toBe(404)
    // borrar
    const d = await f.delete('/api/agentes/sofia/skills/resumen-de-mails')
    expect(d.status).toBe(200)
    expect(f.existe('.claude/skills/resumen-de-mails')).toBe(false)
  })

  test('valida nombre, descripción e instrucciones; agente inexistente 404', async () => {
    const f = await fix()
    expect((await f.post('/api/agentes/sofia/skills', { ...skill, nombre: 'Con Mayúsculas' })).status).toBe(400)
    expect((await f.post('/api/agentes/sofia/skills', { ...skill, nombre: '-mal' })).status).toBe(400)
    expect((await f.post('/api/agentes/sofia/skills', { ...skill, descripcion: '  ' })).status).toBe(400)
    expect((await f.post('/api/agentes/sofia/skills', { ...skill, contenido: '' })).status).toBe(400)
    expect((await f.post('/api/agentes/nadie/skills', skill)).status).toBe(404)
    // una skill instalada en Claude Code con ese nombre
    await f.get('/api/skills')
    expect((await f.post('/api/agentes/sofia/skills', { ...skill, nombre: 'pdf' })).status).toBe(409)
  })

  test('corridas: van siempre para su agente (aunque elija otras o la oficina acote) y apagadas para los demás', async () => {
    const f = await fix()
    await f.get('/api/skills')
    expect((await f.post('/api/agentes/sofia/skills', skill)).status).toBe(200)
    // no se ofrecen en la lista general para elegir
    expect((await f.get('/api/skills')).obj.skills).toEqual(['docx', 'pdf', 'xlsx'])
    // por defecto (resumidas, todas): la de sofia está, la de marce se apaga
    await chatear(f, 'sofia')
    expect(settings(corridaDe(f, 'sofia'))).toEqual({ skillListingMaxDescChars: 150 })
    await chatear(f, 'marce')
    expect(settings(corridaDe(f, 'marce'))).toEqual({ skillListingMaxDescChars: 150, skillOverrides: { 'resumen-de-mails': 'off' } })
    // modo «agente» sin nada elegido: sofia igual tiene la herramienta Skill (por su skill propia); marce, no
    await llamar(f.b, 'PUT', '/api/preferencias', { body: { ia: { skills: 'agente' } } })
    await chatear(f, 'sofia', 'otra')
    let a = corridaDe(f, 'sofia')
    expect(herramientas(a)).toContain('Skill')
    expect(settings(a)).toEqual({ skillOverrides: { docx: 'off', pdf: 'off', xlsx: 'off' } })
    await chatear(f, 'marce', 'otra')
    expect(herramientas(corridaDe(f, 'marce'))).not.toContain('Skill')
    // la oficina acota a pdf: sofia tiene pdf y la suya
    await llamar(f.b, 'PUT', '/api/preferencias', { body: { ia: { skills: 'completas' } } })
    await llamar(f.b, 'PUT', '/api/oficina/ia', { body: { skills: ['pdf'] } })
    await chatear(f, 'sofia', 'acotada')
    a = corridaDe(f, 'sofia')
    expect(settings(a)).toEqual({ skillOverrides: { docx: 'off', xlsx: 'off' } })
    // «ninguna»: tampoco la propia
    await llamar(f.b, 'PUT', '/api/preferencias', { body: { ia: { skills: 'ninguna' } } })
    await chatear(f, 'sofia', 'nada')
    expect(herramientas(corridaDe(f, 'sofia'))).not.toContain('Skill')
  })

  test('despedir: las skills se archivan con el agente y sus propuestas se descartan', async () => {
    const f = await fix()
    expect((await f.post('/api/agentes/sofia/skills', skill)).status).toBe(200)
    const r = await f.delete('/api/agentes/sofia')
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    expect(f.existe('.claude/skills/resumen-de-mails')).toBe(false)
    const fs = await import('node:fs')
    const archivados = fs.readdirSync(f.ruta('.claude/agents/.archivados'))
    const dir = archivados.find((x) => x.startsWith('sofia-skills-'))
    expect(dir).toBeDefined()
    expect(f.existe(`.claude/agents/.archivados/${dir}/resumen-de-mails/SKILL.md`)).toBe(true)
  })

  test('Convertir en skill: lee la charla y devuelve un borrador sin guardar nada; charla ajena 404; sin nada para guardar', async () => {
    const f = await fix()
    const session = randomUUID()
    expect((await f.post('/api/chat', { agent: 'sofia', session, message: 'Armemos el calendario de diciembre' })).status).toBe(200)
    const r = await f.post('/api/chat/skill', { agent: 'sofia', session })
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    expect(dict(r.obj.borrador)).toMatchObject({ nombre: 'calendario-mensual', descripcion: 'Usala cuando te pidan armar el calendario de publicaciones de un mes.', existente: false })
    expect(str(dict(r.obj.borrador).contenido)).toContain('Repartí los reels')
    expect(f.existe('.claude/skills')).toBe(false)
    const prompt = f.sb.prompts.find((p) => p.includes('Sos quien convierte una charla en una skill')) ?? ''
    expect(prompt).toContain('Armemos el calendario de diciembre')
    expect((await f.post('/api/chat/skill', { agent: 'marce', session })).status).toBe(404)
    expect((await f.post('/api/chat/skill', { agent: 'sofia' })).status).toBe(400)
    f.sb.responder('chatskill', JSON.stringify({ nada: 'Fue un saludo.' }))
    const n = await f.post('/api/chat/skill', { agent: 'sofia', session })
    expect(n.obj).toEqual({ borrador: null, motivo: 'Fue un saludo.' })
    expect(dict((await f.get('/api/costos')).obj.origenes)['chat-skill']).toBeGreaterThan(0)
  })

  test('proponer_skill: queda como propuesta y aviso; aceptarla la crea, descartarla la saca', async () => {
    const f = await fix()
    f.sb.llamadasCreador([
      { name: 'proponer_skill', arguments: { nombre: 'Agenda Semanal', descripcion: 'Usala cuando te pidan la agenda de la semana.', contenido: '1. Mirá el calendario.', motivo: 'Me la pidieron tres lunes seguidos.' } },
      { name: 'proponer_skill', arguments: { nombre: 'sin-descripcion', descripcion: '', contenido: 'x' } },
      { name: 'proponer_skill', arguments: { nombre: 'otra', descripcion: 'Otra.', contenido: 'y' } },
      { name: 'proponer_skill', arguments: { nombre: 'tercera', descripcion: 'Tercera.', contenido: 'z' } },
    ])
    expect((await chat(f.b, { agent: 'sofia', message: 'CREADOR_LLAMAR', session: randomUUID() })).status).toBe(200)
    const salidas = f.sb.salidasCreador.map((s) => dict(s.result))
    expect(salidas.map((s) => s.isError === true)).toEqual([false, true, false, true])
    expect(str(lista(salidas[0]!.content)[0]!.text)).toContain('«agenda-semanal»')
    expect(str(lista(salidas[3]!.content)[0]!.text)).toContain('no podés proponer más')
    // la ficha la muestra; el aviso «te necesita» también
    const l = await f.get('/api/agentes/sofia/skills')
    const ps = lista(l.obj.propuestas)
    expect(ps.map((p) => p.nombre)).toEqual(['agenda-semanal', 'otra'])
    expect(ps[0]).toMatchObject({ motivo: 'Me la pidieron tres lunes seguidos.', cambio: false })
    const avisos = lista((await f.get('/api/avisos')).obj.avisos).filter((a) => a.tipo === 'skill')
    expect(avisos.map((a) => str(a.texto))).toEqual(['Sofia propone guardar la skill «agenda-semanal»', 'Sofia propone guardar la skill «otra»'])
    expect(f.existe('.claude/skills/agenda-semanal')).toBe(false)
    // aceptar (corregida): se crea y la propuesta sale
    const ok = await f.post('/api/agentes/sofia/skills', { nombre: 'agenda-semanal', descripcion: 'Corregida.', contenido: '1. Mirá el calendario.', propuesta: str(ps[0]!.id) })
    expect(ok.status, JSON.stringify(ok.obj)).toBe(200)
    expect(lista(ok.obj.propuestas).map((p) => p.nombre)).toEqual(['otra'])
    expect(f.leer('.claude/skills/agenda-semanal/SKILL.md')).toContain('description: Corregida.')
    // descartar
    expect((await f.delete(`/api/agentes/sofia/propuestas-skill/${str(ps[1]!.id)}`)).status).toBe(200)
    expect((await f.delete(`/api/agentes/sofia/propuestas-skill/${str(ps[1]!.id)}`)).status).toBe(404)
    expect(lista((await f.get('/api/avisos')).obj.avisos).filter((a) => a.tipo === 'skill')).toEqual([])
    expect(f.existe('.claude/skills-propuestas.json')).toBe(false)
  })

  test('proponer_skill sobre una skill que ya tiene: es un cambio y aceptarlo la reescribe; la de otro agente, no', async () => {
    const f = await fix()
    expect((await f.post('/api/agentes/sofia/skills', skill)).status).toBe(200)
    f.sb.llamadasCreador([
      { name: 'proponer_skill', arguments: { nombre: 'resumen-de-mails', descripcion: 'Mejorada.', contenido: 'Con un paso más.' } },
    ])
    expect((await chat(f.b, { agent: 'sofia', message: 'CREADOR_LLAMAR', session: randomUUID() })).status).toBe(200)
    const p = lista((await f.get('/api/agentes/sofia/skills')).obj.propuestas)[0]!
    expect(p.cambio).toBe(true)
    const r = await f.post('/api/agentes/sofia/skills', { nombre: 'resumen-de-mails', descripcion: 'Mejorada.', contenido: 'Con un paso más.', propuesta: str(p.id) })
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    expect(f.leer('.claude/skills/resumen-de-mails/SKILL.md')).toContain('Con un paso más.')
    // marce no puede proponer una con el nombre de la de sofia
    const antes = f.sb.salidasCreador.length
    f.sb.llamadasCreador([{ name: 'proponer_skill', arguments: { nombre: 'resumen-de-mails', descripcion: 'Mía.', contenido: 'x' } }])
    expect((await chat(f.b, { agent: 'marce', message: 'CREADOR_LLAMAR', session: randomUUID() })).status).toBe(200)
    expect(dict(f.sb.salidasCreador[antes]!.result).isError).toBe(true)
  })

  test('el agente tiene proponer_skill y sabe para qué sirve', async () => {
    const f = await fix()
    await chatear(f, 'sofia')
    const a = corridaDe(f, 'sofia')
    expect(herramientas(a)).toContain('mcp__hq__proponer_skill')
    expect(Sandbox.reglas(a)).toContain('mcp__hq__proponer_skill')
    expect(Sandbox.valor(a, '--append-system-prompt')).toContain('proponer_skill')
  })
})
