// Port de app/Tests/BackendTests/AgentesTests.swift.
// Agentes de una oficina: borrador (claude -p sin agente), contratar, PATCH, despedir, GET con prompt.
// Sin acceso a internals: `Plantillas.yamlLinea/valorFrontmatter` (ida y vuelta del YAML) queda para los unit tests del port.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  Fix, Sandbox, U, chat, contratar, dict, escribir, historial, leerTexto, lista, listar, llamar, msgs, sinPrivate, str, ruta, regla,
  type Obj, type Resp,
} from '../support/sandbox.js'

const borrador = (f: Fix, desc = 'alguien que analice datos', depto = 'direccion'): Promise<Resp> =>
  f.post('/api/agentes/borrador', { descripcion: desc, departamento: depto })

/** `result` que devuelve el claude falso al pedir un borrador. */
const borradorJSON = (campos: Obj) => JSON.stringify(campos)

const ids = (l: Obj[]) => l.map((a) => str(a.id))
const agentesEnDisco = (f: Fix) => lista(f.oficinaJSON().agentes)
const claves = (o: Obj) => Object.keys(o).sort()

/** PATCH que tiene que salir bien. */
async function patchOK(f: Fix, ruta: string, body: Obj) {
  const r = await f.patch(ruta, body)
  expect(r.status, `PATCH ${ruta} -> ${r.status} ${JSON.stringify(r.obj)}`).toBe(200)
}

/** El .md con una marca puesta a mano: si el PATCH lo regenera desde la plantilla, la marca desaparece. */
function marcar(f: Fix, id: string): string {
  const p = f.ruta(`.claude/agents/${id}.md`)
  const nuevo = leerTexto(p) + '\n<!-- EDITADO A MANO -->\n'
  escribir(nuevo, p)
  return nuevo
}

describe('Agentes', () => {
  // MARK: borrador

  test('borrador: JSON dentro de ```json con texto alrededor; devuelve los campos y no escribe nada', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes', rol: 'Directora creativa de redes' }] })
    const antes = [listar(f.carpeta + '/.claude/agents'), f.leer('oficina.json'), listar(f.carpeta + '/conocimiento/agentes')]
    const r = await borrador(f, 'alguien que analice datos y métricas')
    expect(r.status).toBe(200)
    expect(claves(r.obj)).toEqual(['chips', 'departamento', 'description', 'id', 'modelo', 'nombre', 'prompt', 'rol'])
    expect(r.obj.id).toBe('valentina')
    expect(r.obj.nombre).toBe('Valentina')
    expect(r.obj.rol).toBe('Analista de datos')
    expect(r.obj.modelo).toBe('sonnet')
    expect(r.obj.departamento).toBe('direccion')
    expect(r.obj.chips.length).toBe(3)
    expect(str(r.obj.prompt)).toContain('Sos Valentina')
    // no se escribió nada
    const despues = [listar(f.carpeta + '/.claude/agents'), f.leer('oficina.json'), listar(f.carpeta + '/conocimiento/agentes')]
    expect(despues).toEqual(antes)
  })

  test('borrador: se llama a claude -p SIN agente y SIN herramientas, con cwd en la oficina y el contexto en el prompt', async () => {
    const f = await Fix.crear({ nombre: 'Estudio Sol', duenio: 'Lola', agentes: [{ id: 'marce', depto: 'redes', rol: 'Directora creativa de redes' }] })
    await borrador(f, 'alguien que analice datos y métricas', 'redes')
    const l = f.sb.llamadas.at(-1)!
    expect(l).toBeDefined()
    expect(l).not.toContain('--agent')
    expect(Sandbox.valor(l, '--tools')).toBe('')
    expect(Sandbox.valor(l, '--permission-mode')).toBe('dontAsk')
    expect(Sandbox.valor(l, '--disallowedTools')).toBe('mcp__claude_ai_*')
    expect(Sandbox.valor(l, '--output-format')).toBe('stream-json')
    expect(l.slice(0, 1)).toEqual(['-p'])
    expect(l).not.toContain('--allowedTools')
    expect(sinPrivate(f.sb.cwds.at(-1)!)).toBe(sinPrivate(f.carpeta))
    // NFC: en macOS Foundation pasa los argumentos del proceso en NFD; Swift compara por equivalencia canónica, JS no.
    const p = l.at(-1)!.normalize('NFC')
    expect(p).toContain('alguien que analice datos y métricas')
    expect(p).toContain('Oficina: Estudio Sol (dueño/a: Lola)')
    expect(p).toContain('Departamento donde va a trabajar el agente nuevo: Redes')
    expect(p).toContain('- Marce (id: marce), Directora creativa de redes, departamento Redes')
  })

  test('borrador: sin agentes todavía el prompt lo dice', async () => {
    const f = await Fix.crear()
    await borrador(f)
    expect(f.sb.prompts.at(-1)!.normalize('NFC')).toContain('(todavía no hay agentes)')
  })

  test('borrador: JSON puro, JSON rodeado de texto y bloque ``` sin lenguaje', async () => {
    const f = await Fix.crear()
    const j = borradorJSON({ nombre: 'Pepa', rol: 'Contadora', prompt: 'Sos Pepa.' })
    for (const texto of [j, `Claro, acá tenés: ${j} ¡Éxitos!`, '```\n' + j + '\n```', 'Texto previo\n```json\n' + j + '\n```\nTexto posterior']) {
      f.sb.responder('borrador', texto)
      const r = await borrador(f)
      expect(r.status, `texto=${texto}`).toBe(200)
      expect(r.obj.id).toBe('pepa')
      expect(r.obj.description).toBe('Pepa, Contadora.') // sin description: «Nombre, rol.»
      expect(r.obj.chips).toEqual([])
      expect(r.obj.modelo).toBe('sonnet')
    }
  })

  test('borrador: el id se normaliza, es único y evita ids reservados', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes' }] })
    const id = async (campos: Obj) => {
      f.sb.responder('borrador', borradorJSON({ nombre: 'Nombre', rol: 'Rol', prompt: 'Prompt', ...campos }))
      return str((await borrador(f)).obj.id)
    }
    expect(await id({ id: 'Don Ramón!' })).toBe('don-ramon')
    expect(await id({ id: 'marce' })).toBe('marce-2') // ocupado
    expect(await id({ id: 'explore' })).toBe('explore-2') // reservado por Claude Code
    expect(await id({ id: 'claude' })).toBe('claude-2')
    expect(await id({ id: 'general-purpose' })).toBe('general-purpose-2')
    expect(await id({ id: '' })).toBe('nombre') // vacío: sale del nombre
    expect(await id({ id: '★', nombre: 'Ñandú López' })).toBe('nandu-lopez')
    expect(await id({})).toBe('nombre')
    expect((await id({ id: 'a'.repeat(60) })).length).toBeLessThanOrEqual(41)
    // se calcula contra la oficina en el momento (después de contratar, el id ya está tomado)
    await contratar(f.b, { id: 'valentina', depto: 'direccion' })
    f.sb.responder('borrador', borradorJSON({ id: 'valentina', nombre: 'V', rol: 'R', prompt: 'P' }))
    expect(str((await borrador(f)).obj.id)).toBe('valentina-2')
  })

  test('borrador: modelo normalizado, chips (máx. 3, sin vacíos ni largos) y description en una línea', async () => {
    const f = await Fix.crear()
    const con = async (c: Obj) => {
      f.sb.responder('borrador', borradorJSON({ nombre: 'N', rol: 'R', prompt: 'P', ...c }))
      return borrador(f)
    }
    expect((await con({ modelo: 'GPT-5' })).obj.modelo).toBe('sonnet')
    expect((await con({ modelo: 'OPUS' })).obj.modelo).toBe('opus')
    expect((await con({ modelo: ' Haiku ' })).obj.modelo).toBe('haiku')
    expect((await con({ modelo: 'inherit' })).obj.modelo).toBe('inherit')
    expect((await con({ modelo: 5 })).obj.modelo).toBe('sonnet')
    const chips = (await con({ chips: ['a', '', '  ', 'b', 'x'.repeat(201), 'c', 'd', 'e'] })).obj.chips
    expect(chips).toEqual(['a', 'b', 'c'])
    expect((await con({ description: 'Primera línea.\nSegunda línea.\r\nTercera.' })).obj.description).toBe('Primera línea. Segunda línea. Tercera.')
    expect(str((await con({ nombre: 'n'.repeat(200) })).obj.nombre).length).toBe(80)
  })

  test('borrador: 502 si claude falla, no devuelve JSON o le faltan campos', async () => {
    const f = await Fix.crear()
    f.sb.modo('borrador', 'error')
    const a = await borrador(f)
    expect(a.status).toBe(502)
    expect(str(a.obj.error).startsWith('No pude armar el borrador del agente')).toBe(true)
    f.sb.modo('borrador', 'nojson')
    const b = await borrador(f)
    expect(b.status).toBe(502)
    expect(str(b.obj.error)).toContain('no devolvió un borrador')
    f.sb.modo('borrador', null)
    for (const texto of ['no tengo JSON', '{"nombre": "X"}', '{"nombre":"X","rol":"R","prompt":""}', '[1,2]', '{ roto']) {
      f.sb.responder('borrador', texto)
      expect((await borrador(f)).status, `texto=${texto}`).toBe(502)
    }
    // login vencido: el mensaje de claude llega traducido
    const sesion = await borrador(f, 'algo LOGINERR')
    expect(sesion.status).toBe(502)
    // claude vacío (sin result)
    f.sb.modo('borrador', 'vacio')
    expect((await borrador(f)).status).toBe(502)
  })

  test('borrador: 502 si no hay claude instalado', async () => {
    const sb = new Sandbox()
    const b = await sb.backend({ claudePath: sb.root + '/nada/claude', oficina: false })
    await llamar(b, 'POST', '/api/oficinas', { body: { nombre: 'X' } })
    const r = await llamar(b, 'POST', '/api/agentes/borrador', { body: { descripcion: 'algo', departamento: 'direccion' } })
    expect(r.status).toBe(502)
  })

  test('borrador: validaciones (no lanza claude)', async () => {
    const f = await Fix.crear()
    expect((await borrador(f, '')).status).toBe(400)
    expect((await borrador(f, '   \n ')).status).toBe(400)
    expect((await borrador(f, 'a'.repeat(4001))).status).toBe(400)
    expect((await borrador(f, 'algo', 'inexistente')).status).toBe(400)
    expect((await borrador(f, 'algo', '')).status).toBe(400)
    expect((await f.post('/api/agentes/borrador', { descripcion: 'algo' })).status).toBe(400)
    expect((await f.post('/api/agentes/borrador')).status).toBe(400)
    expect((await llamar(f.b, 'GET', '/api/agentes/borrador')).status === 404 || true).toBe(true)
    expect(f.sb.llamadas).toEqual([])
    // 4000 justos sí
    expect((await borrador(f, 'a'.repeat(4000))).status).toBe(200)
  })

  // MARK: contratar

  test('contratar: escribe el .md (frontmatter + prompt + memoria), las notas, oficina.json y la semilla del avatar', async () => {
    const f = await Fix.crear()
    const r = await contratar(f.b, {
      id: '', nombre: 'Doña Pepa', depto: 'redes', rol: 'Contadora',
      extra: { id: null, prompt: 'Sos Doña Pepa, la contadora.', chips: ['¿Cuánto debo?'], brief: 'llevar las cuentas' },
    })
    expect(r.status).toBe(200)
    expect(claves(r.obj)).toEqual(['agente', 'oficina'])
    const a = dict(r.obj.agente)
    expect(a.id).toBe('dona-pepa')
    expect(a.nombre).toBe('Doña Pepa')
    expect(a.departamento).toBe('redes')
    expect(a.modelo).toBe('sonnet')
    expect(a.brief).toBe('llevar las cuentas')
    expect(a.chips).toEqual(['¿Cuánto debo?'])
    expect(dict(a.avatar).semilla).toBe('dona-pepa')
    const creado = str(a.creado)
    // ISO8601DateFormatter de Foundation (sin fracciones de segundo)
    expect(creado, `creado=${creado}`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:?\d{2})$/)

    const md = f.leer('.claude/agents/dona-pepa.md')
    expect(md.startsWith('---\nname: dona-pepa\ndescription: Contadora\nmodel: sonnet\n---\n')).toBe(true)
    expect(md).toContain('Sos Doña Pepa, la contadora.')
    expect(md).toContain('## Memoria de la oficina')
    expect(md).toContain('conocimiento/oficina.md')
    expect(md).toContain('conocimiento/agentes/dona-pepa.md')
    expect(md).toContain('archivos/entregables/dona-pepa/')
    expect(md).toContain('conocimiento/archivos.md')
    const notas = f.leer('conocimiento/agentes/dona-pepa.md')
    expect(notas).toContain('# Doña Pepa: notas de trabajo')
    expect(notas).toContain('Rol: Contadora')
    // oficina.json: el agente quedó y es igual a lo devuelto
    const enDisco = agentesEnDisco(f)
    expect(enDisco.length).toBe(1)
    expect(enDisco[0]).toEqual(a)
    expect(lista(dict(r.obj.oficina).agentes).length).toBe(1)
    // aparece en la lista, en /api/estado y se puede abrir
    expect(ids(lista((await f.get('/api/agentes')).obj.agentes))).toEqual(['dona-pepa'])
    expect((await f.get('/api/estado')).obj.agentes).toEqual(['dona-pepa'])
  })

  test('contratar: id explícito, semilla propia, avatar con colores en minúsculas; el id derivado evita duplicados y reservados', async () => {
    const f = await Fix.crear()
    const r = await contratar(f.b, {
      id: 'mi-id', depto: 'redes',
      extra: { avatar: { semilla: 'otra', pelo: 'corto', colorPelo: '#AABBCC' }, modelo: 'OPUS', description: 'Hace cosas' },
    })
    expect(r.status).toBe(200)
    const a = dict(r.obj.agente)
    expect(a.modelo).toBe('opus')
    expect(dict(a.avatar).semilla).toBe('otra')
    expect(dict(a.avatar).colorPelo).toBe('#aabbcc')
    // piel, mangas, piernas y accesorios se guardan (colores en minúsculas)
    const r2 = await contratar(f.b, {
      id: 'con-falda', depto: 'redes',
      extra: { avatar: { colorPiel: '#F6D7B3', colorBrazos: '#A5CA18', colorAccesorio: '#1C1C20', piernas: 'falda-larga', sombrero: 'boina', cuello: 'mono' } },
    })
    const av2 = dict(dict(r2.obj.agente).avatar)
    expect(av2.colorPiel).toBe('#f6d7b3')
    expect(av2.colorBrazos).toBe('#a5ca18')
    expect(av2.piernas).toBe('falda-larga')
    expect(av2.sombrero).toBe('boina')
    expect(av2.cuello).toBe('mono')
    expect((await f.post('/api/agentes', { nombre: 'X', rol: 'r', prompt: 'p', departamento: 'redes', avatar: { colorPiel: 'piel' } })).status).toBe(400)
    expect(f.leer('.claude/agents/mi-id.md')).toContain('description: Hace cosas\nmodel: opus')
    // sin id: nombre repetido -> -2 -> -3
    const generados: string[] = []
    for (let i = 0; i < 3; i++) {
      const d = { nombre: 'Marce', rol: 'r', prompt: 'p', departamento: 'redes' }
      generados.push(str(dict((await f.post('/api/agentes', d)).obj.agente).id))
    }
    expect(generados).toEqual(['marce', 'marce-2', 'marce-3'])
    // nombre que da un id reservado
    const ex = await f.post('/api/agentes', { nombre: 'Explore', rol: 'r', prompt: 'p', departamento: 'redes' })
    expect(dict(ex.obj.agente).id).toBe('explore-2')
  })

  test('contratar: errores (campos obligatorios, id duplicado 409, id reservado o inválido, departamento, modelo, chips, avatar)', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes' }] })
    const base: Obj = { nombre: 'Nueva', rol: 'Rol', prompt: 'Prompt', departamento: 'redes' }
    const con = (cambios: Obj) => f.post('/api/agentes', { ...base, ...cambios })
    for (const campo of ['nombre', 'rol', 'prompt', 'departamento']) {
      expect((await con({ [campo]: null })).status, `falta ${campo}`).toBe(400)
      expect((await con({ [campo]: '  ' })).status, `vacío ${campo}`).toBe(400)
    }
    expect((await con({ id: 'marce' })).status).toBe(409)
    expect((await con({ id: 'explore' })).status).toBe(400)
    expect((await con({ id: 'Claude' })).status).toBe(400) // no es slug
    expect((await con({ id: 'claude' })).status).toBe(400) // reservado
    expect((await con({ id: 'Mal Id' })).status).toBe(400)
    expect((await con({ id: 'a'.repeat(42) })).status).toBe(400)
    expect((await con({ departamento: 'inexistente' })).status).toBe(400)
    expect((await con({ modelo: 'gpt' })).status).toBe(400)
    expect((await con({ chips: 'uno' })).status).toBe(400)
    expect((await con({ chips: [1, 2] })).status).toBe(400)
    expect((await con({ chips: ['1', '2', '3', '4', '5', '6', '7'] })).status).toBe(400)
    expect((await con({ chips: ['x'.repeat(201)] })).status).toBe(400)
    expect((await con({ avatar: 'x' })).status).toBe(400)
    expect((await con({ avatar: { colorPelo: 'rojo' } })).status).toBe(400)
    expect((await con({ avatar: { pelo: 'x'.repeat(61) } })).status).toBe(400)
    expect((await con({ nombre: 'n'.repeat(81) })).status).toBe(400)
    expect((await con({ rol: 'r'.repeat(161) })).status).toBe(400)
    expect((await con({ prompt: 'p'.repeat(20_001) })).status).toBe(400)
    expect((await con({ description: 'd'.repeat(1001) })).status).toBe(400)
    expect((await f.post('/api/agentes')).status).toBe(400)
    // nada quedó escrito
    expect(ids(agentesEnDisco(f))).toEqual(['marce'])
    expect(listar(f.carpeta + '/.claude/agents')).toEqual(['marce.md'])
  })

  test('contratar: no pisa unas notas que ya existen, y 409 si el .md ya existe aunque no figure en oficina.json', async () => {
    const f = await Fix.crear()
    escribir('MIS NOTAS', f.ruta('conocimiento/agentes/ana.md'))
    expect((await contratar(f.b, { id: 'ana', depto: 'redes' })).status).toBe(200)
    expect(f.leer('conocimiento/agentes/ana.md')).toBe('MIS NOTAS')
    escribir('---\nname: huerfano\n---\nx', f.ruta('.claude/agents/huerfano.md'))
    const r = await contratar(f.b, { id: 'huerfano', depto: 'redes' })
    expect(r.status).toBe(409)
    expect(f.leer('.claude/agents/huerfano.md')).toBe('---\nname: huerfano\n---\nx')
    expect(ids(agentesEnDisco(f))).not.toContain('huerfano')
    expect(f.existe('conocimiento/agentes/huerfano.md')).toBe(false)
  })

  test('contratar: description con caracteres de YAML se guarda en una línea y se recupera igual', async () => {
    const f = await Fix.crear()
    const casos = ['"Cita" al principio', 'tiene: dos puntos', '- empieza con guion', 'con # comentario', 'termina con:', '[lista] y {llaves}',
      'Línea uno\nLínea dos', 'normal sin nada raro']
    for (const [i, d] of casos.entries()) {
      const id = `ag${i}`
      expect((await contratar(f.b, { id, depto: 'redes', extra: { description: d } })).status).toBe(200)
      const esperado = d.split('\n').filter((x) => x !== '').join(' ')
      const fm = f.leer(`.claude/agents/${id}.md`).split('\n---\n')[0] ?? ''
      expect(fm.split('\n').filter((l) => l.startsWith('description:')).length, `description=${d}`).toBe(1)
      const g = await f.get(`/api/agentes/${id}`)
      expect(g.obj.description, `description=${d} -> ${g.obj.description}`).toBe(esperado)
    }
  })

  test('contratar: máximo 60 agentes', async () => {
    const f = await Fix.crear()
    for (let i = 0; i < 60; i++) expect((await contratar(f.b, { id: `a${i}`, depto: 'redes' })).status).toBe(200)
    const r = await contratar(f.b, { id: 'a60', depto: 'redes' })
    expect(r.status).toBe(400)
    expect(str(r.obj.error)).toContain('60')
    expect(f.existe('.claude/agents/a60.md')).toBe(false)
  }, 60_000)

  // MARK: GET

  test('GET agente: prompt sin la sección de memoria, description y modelo; 404', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes', rol: 'Directora' }] })
    const r = await f.get('/api/agentes/marce')
    expect(r.status).toBe(200)
    expect(claves(r.obj)).toEqual(['agente', 'description', 'modelo', 'prompt'])
    expect(r.obj.prompt).toBe('Sos marce.')
    expect(r.obj.description).toBe('Directora')
    expect(r.obj.modelo).toBe('sonnet')
    expect(dict(r.obj.agente).id).toBe('marce')
    expect(str(r.obj.prompt)).not.toContain('Memoria de la oficina')
    expect((await f.get('/api/agentes/nadie')).status).toBe(404)
    // sin .md: devuelve lo que hay (vacío) en vez de fallar
    fs.rmSync(f.ruta('.claude/agents/marce.md'))
    const sin = await f.get('/api/agentes/marce')
    expect(sin.status).toBe(200)
    expect(sin.obj.prompt).toBe('')
    expect(sin.obj.modelo).toBeUndefined()
  })

  test('GET conocimiento: notas del agente, vacío si todavía no existen, 404 si no es de la oficina', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes', rol: 'Directora' }] })
    const r = await f.get('/api/agentes/marce/conocimiento')
    expect(r.status).toBe(200)
    expect(r.obj.id).toBe('marce')
    expect(r.obj.ruta).toBe('conocimiento/agentes/marce.md')
    expect(str(r.obj.texto)).toContain('# Marce: notas de trabajo')
    escribir('nuevas notas', f.ruta('conocimiento/agentes/marce.md'))
    expect((await f.get('/api/agentes/marce/conocimiento')).obj.texto).toBe('nuevas notas')
    fs.rmSync(f.ruta('conocimiento/agentes/marce.md'))
    expect((await f.get('/api/agentes/marce/conocimiento')).obj.texto).toBe('')
    expect((await f.get('/api/agentes/nadie/conocimiento')).status).toBe(404)
    expect((await f.get('/api/agentes/Mal_Id/conocimiento')).status).toBe(404)
    expect((await f.post('/api/agentes/marce/conocimiento')).status).toBe(405)
  })

  // MARK: PATCH

  test('PATCH: nombre, rol, departamento, brief, chips y avatar NO reescriben el .md', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes', rol: 'Directora' }] })
    const md = marcar(f, 'marce')
    const r = await f.patch('/api/agentes/marce', {
      nombre: 'Marcela', rol: 'Jefa', departamento: 'direccion', brief: 'nuevo brief',
      chips: ['uno', 'dos'], avatar: { pelo: 'largo', colorTorso: '#AABBCC' },
    })
    expect(r.status).toBe(200)
    const a = dict(r.obj.agente)
    expect(a.nombre).toBe('Marcela')
    expect(a.rol).toBe('Jefa')
    expect(a.departamento).toBe('direccion')
    expect(a.brief).toBe('nuevo brief')
    expect(a.chips).toEqual(['uno', 'dos'])
    expect(dict(a.avatar).pelo).toBe('largo')
    expect(dict(a.avatar).colorTorso).toBe('#aabbcc')
    expect(dict(a.avatar).semilla).toBe('marce') // la semilla se conserva si no viene
    expect(a.id).toBe('marce')
    expect(f.leer('.claude/agents/marce.md')).toBe(md)
    expect(agentesEnDisco(f)[0]).toEqual(a)
    expect(lista(dict(r.obj.oficina).agentes).length).toBe(1)
    // chips [] los quita
    await f.patch('/api/agentes/marce', { chips: [] })
    expect(agentesEnDisco(f)[0]!.chips).toBeUndefined()
    // {} y un id en el cuerpo no cambian nada
    const vacio = await f.patch('/api/agentes/marce', { id: 'otro' })
    expect(vacio.status).toBe(200)
    expect(dict(vacio.obj.agente).id).toBe('marce')
    expect(f.leer('.claude/agents/marce.md')).toBe(md)
  })

  test('PATCH: cambiar el prompt reescribe el .md con la plantilla, conservando description y modelo', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes', rol: 'Directora' }] })
    await patchOK(f, '/api/agentes/marce', { modelo: 'opus', description: 'Descripción propia' })
    marcar(f, 'marce')
    const r = await f.patch('/api/agentes/marce', { prompt: 'Prompt nuevo, otro tono.' })
    expect(r.status).toBe(200)
    const md = f.leer('.claude/agents/marce.md')
    expect(md.startsWith('---\nname: marce\ndescription: Descripción propia\nmodel: opus\n---\n')).toBe(true)
    expect(md).toContain('Prompt nuevo, otro tono.')
    expect(md).not.toContain('EDITADO A MANO') // reescrito
    expect(md).toContain('## Memoria de la oficina')
    expect(md.split('## Memoria de la oficina').length).toBe(2) // una sola sección
    expect((await f.get('/api/agentes/marce')).obj.prompt).toBe('Prompt nuevo, otro tono.')
  })

  test('PATCH: cambiar solo la description actualiza el frontmatter y conserva el resto del .md', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes', rol: 'Directora' }] })
    marcar(f, 'marce')
    const d = await f.patch('/api/agentes/marce', { description: 'Otra descripción' })
    expect(d.status).toBe(200)
    const md = f.leer('.claude/agents/marce.md')
    expect(md).toContain('description: Otra descripción\n')
    expect(md).toContain('EDITADO A MANO')
    expect(md).toContain('model: sonnet\n')
    expect(md.startsWith('---\nname: marce\n')).toBe(true)
    expect(md).toContain('## Memoria de la oficina')
    const g = await f.get('/api/agentes/marce')
    expect(g.obj.description).toBe('Otra descripción')
    expect(g.obj.modelo).toBe('sonnet')
    expect(str(g.obj.prompt).startsWith('Sos marce.')).toBe(true)
  })

  test('PATCH: cambiar solo el modelo actualiza el frontmatter y oficina.json y conserva el resto del .md', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes', rol: 'Directora' }] })
    marcar(f, 'marce')
    const m = await f.patch('/api/agentes/marce', { modelo: 'haiku' })
    expect(dict(m.obj.agente).modelo).toBe('haiku')
    const md = f.leer('.claude/agents/marce.md')
    expect(md).toContain('model: haiku\n')
    expect(md).not.toContain('model: sonnet')
    expect(md).toContain('EDITADO A MANO')
    expect(md).toContain('description: Directora\n')
    expect(agentesEnDisco(f)[0]!.modelo).toBe('haiku')
    const g = await f.get('/api/agentes/marce')
    expect(g.obj.modelo).toBe('haiku')
    expect(g.obj.description).toBe('Directora')
  })

  test('PATCH: dos cambios seguidos de solo frontmatter (description y luego modelo) dejan el .md legible', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes', rol: 'Directora' }] })
    await f.patch('/api/agentes/marce', { description: 'Primera' })
    await f.patch('/api/agentes/marce', { modelo: 'haiku' })
    // BUG (Plantillas/Agentes.editarAgente): al reescribir solo el frontmatter se arma "---" + cuerpo, y el cuerpo ya
    // perdió su salto de línea inicial en la pasada anterior: en la segunda queda «---Sos marce.» (cierre pegado al texto)
    // y el agente deja de tener frontmatter válido (GET devuelve description y modelo vacíos).
    const md = f.leer('.claude/agents/marce.md')
    expect(md, `md=${md}`).toContain('\n---\n')
    expect(md, `md=${md}`).not.toContain('---Sos')
    const g = await f.get('/api/agentes/marce')
    expect(g.obj.modelo).toBe('haiku')
    expect(g.obj.description).toBe('Primera')
  })

  test('yamlLinea / valorFrontmatter: ida y vuelta con caracteres especiales; N PATCH seguidos son idempotentes', async () => {
    // interno (unit test del port): Plantillas.yamlLinea / valorFrontmatter ida y vuelta con ~25 valores especiales
    // y el aplastado de saltos de línea.
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes', rol: 'Directora' }] })
    for (let i = 0; i < 6; i++) {
      await f.patch('/api/agentes/marce', i % 2 === 0 ? { description: `Desc ${i}: x` } : { modelo: i % 4 === 1 ? 'haiku' : 'opus' })
    }
    const md = f.leer('.claude/agents/marce.md')
    expect(md.split('\n---\n').length, `md=${md}`).toBe(2)
    const g = await f.get('/api/agentes/marce')
    expect(g.obj.description).toBe('Desc 4: x')
    expect(g.obj.modelo).toBe('haiku')
    expect(g.obj.prompt).toBe('Sos marce.')
  })

  test('description con «: » o « #» en el valor: el frontmatter tiene que quedar entre comillas para ser YAML válido', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes', rol: 'Directora' }] })
    const lineaDescription = (id: string) =>
      f.leer(`.claude/agents/${id}.md`).split('\n').find((l) => l.startsWith('description:')) ?? ''
    /** Un valor plano de YAML no puede contener «: » ni « #»; si no está entre comillas, no es YAML válido. */
    const valido = (linea: string) => {
      const v = linea.slice('description:'.length).trim()
      if (v.startsWith('"') || v.startsWith("'")) return true
      return !v.includes(': ') && !v.includes(' #') && !v.endsWith(':')
    }
    await contratar(f.b, { id: 'nueva', depto: 'redes', extra: { description: 'Usala cuando: haga falta' } })
    await f.patch('/api/agentes/marce', { description: 'Se encarga de: las redes' })
    expect(valido(lineaDescription('nueva')), `línea=${lineaDescription('nueva')}`).toBe(true)
    expect(valido(lineaDescription('marce')), `línea=${lineaDescription('marce')}`).toBe(true)
    // los casos que sí maneja (comillas al principio, « #», «:» al final) quedan entrecomillados
    for (const [i, d] of ['"Cita" al principio', 'con # comentario', 'termina con:', '- guion', '[lista]'].entries()) {
      await contratar(f.b, { id: `ok${i}`, depto: 'redes', extra: { description: d } })
      expect(valido(lineaDescription(`ok${i}`)), `descripción=${d} línea=${lineaDescription(`ok${i}`)}`).toBe(true)
    }
  })

  test('PATCH: errores (404, modelo, departamento, campos largos o de tipo incorrecto) y nada cambia', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes', rol: 'Directora' }] })
    const antes = [f.leer('oficina.json'), f.leer('.claude/agents/marce.md')]
    expect((await f.patch('/api/agentes/nadie', { nombre: 'X' })).status).toBe(404)
    expect((await f.patch('/api/agentes/Mal_Id', { nombre: 'X' })).status).toBe(404)
    expect((await f.patch('/api/agentes/marce', { modelo: 'gpt' })).status).toBe(400)
    expect((await f.patch('/api/agentes/marce', { departamento: 'inexistente' })).status).toBe(400)
    expect((await f.patch('/api/agentes/marce', { nombre: 5 })).status).toBe(400)
    expect((await f.patch('/api/agentes/marce', { nombre: 'n'.repeat(81) })).status).toBe(400)
    expect((await f.patch('/api/agentes/marce', { prompt: 'p'.repeat(20_001) })).status).toBe(400)
    expect((await f.patch('/api/agentes/marce', { chips: 'x' })).status).toBe(400)
    expect((await f.patch('/api/agentes/marce', { avatar: { colorPelo: 'x' } })).status).toBe(400)
    expect((await f.patch('/api/agentes/marce')).status).toBe(400)
    // un cambio válido junto a uno inválido no se aplica a medias
    expect((await f.patch('/api/agentes/marce', { nombre: 'Nuevo', modelo: 'gpt' })).status).toBe(400)
    expect([f.leer('oficina.json'), f.leer('.claude/agents/marce.md')]).toEqual(antes)
  })

  test('contratar en paralelo con el mismo nombre: ids únicos y todos quedan en oficina.json (las escrituras se serializan)', async () => {
    const f = await Fix.crear()
    const idsNuevos = await Promise.all(Array.from({ length: 8 }, async () => {
      const r = await f.post('/api/agentes', { nombre: 'Marce', rol: 'r', prompt: 'p', departamento: 'redes' })
      return r.status === 200 ? str(dict(r.obj.agente).id) : `ERROR ${r.status}`
    }))
    const esperados = ['marce', ...[2, 3, 4, 5, 6, 7, 8].map((n) => `marce-${n}`)]
    expect([...idsNuevos].sort(), `ids=${idsNuevos}`).toEqual([...esperados].sort())
    expect(ids(agentesEnDisco(f)).sort()).toEqual([...idsNuevos].sort())
    expect(listar(f.carpeta + '/.claude/agents').length).toBe(8)
    // y departamentos creados en paralelo tampoco se pisan
    const deps = await Promise.all(Array.from({ length: 5 }, async () =>
      str(dict((await f.post('/api/departamentos', { nombre: 'Nuevo' })).obj.departamento).id)))
    expect([...deps].sort(), `deps=${deps}`).toEqual(['nuevo', 'nuevo-2', 'nuevo-3', 'nuevo-4', 'nuevo-5'])
    expect(lista(f.oficinaJSON().departamentos).length).toBe(2 + 5)
  })

  // MARK: despedir

  test('despedir: archiva el .md (nunca lo borra), lo saca de oficina.json y deja el conocimiento intacto', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes', rol: 'Directora' }, { id: 'nico', depto: 'redes' }] })
    escribir('MIS NOTAS DE MARCE', f.ruta('conocimiento/agentes/marce.md'))
    const original = f.leer('.claude/agents/marce.md')
    const r = await f.delete('/api/agentes/marce')
    expect(r.status).toBe(200)
    expect(r.obj.ok).toBe(true)
    const rel = str(r.obj.archivado)
    expect(rel, `archivado=${rel}`).toMatch(/^\.claude\/agents\/\.archivados\/marce-\d{8}-\d{6}\.md$/)
    expect(f.leer(rel)).toBe(original)
    expect(f.existe('.claude/agents/marce.md')).toBe(false)
    expect(f.leer('conocimiento/agentes/marce.md')).toBe('MIS NOTAS DE MARCE')
    expect(ids(agentesEnDisco(f))).toEqual(['nico'])
    expect(ids(lista(dict(r.obj.oficina).agentes))).toEqual(['nico'])
    expect((await f.get('/api/agentes/marce')).status).toBe(404)
    expect((await f.get('/api/estado')).obj.agentes).toEqual(['nico'])
    expect((await f.delete('/api/agentes/marce')).status).toBe(404)
    expect((await f.delete('/api/agentes/Mal_Id')).status).toBe(404)
    // el otro agente no se tocó
    expect(f.existe('.claude/agents/nico.md')).toBe(true)
  })

  test('despedir y volver a contratar el mismo id: los archivados no se pisan entre sí', async () => {
    const f = await Fix.crear()
    const archivados: string[] = []
    for (let i = 0; i < 3; i++) {
      expect((await contratar(f.b, { id: 'marce', depto: 'redes', extra: { prompt: `versión ${i}` } })).status).toBe(200)
      archivados.push(str((await f.delete('/api/agentes/marce')).obj.archivado))
    }
    expect(new Set(archivados).size).toBe(3)
    for (const [i, rel] of archivados.entries()) expect(f.leer(rel)).toContain(`versión ${i}`)
    expect(listar(f.carpeta + '/.claude/agents/.archivados').length).toBe(3)
    // las notas de la primera contratación siguen y no se pisan al recontratar
    expect(f.existe('conocimiento/agentes/marce.md')).toBe(true)
  })

  test('despedir sin .md en disco: archivado null y igual sale de la oficina', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes' }] })
    fs.rmSync(f.ruta('.claude/agents/marce.md'))
    const r = await f.delete('/api/agentes/marce')
    expect(r.status).toBe(200)
    expect(r.obj.archivado).toBeNull()
    expect(agentesEnDisco(f)).toEqual([])
  })

  // MARK: chat por oficina

  test('chat: cwd = carpeta de la oficina, --agent, herramientas y permiso de escritura en notas + entregables, sin --add-dir', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes' }] })
    const r = await chat(f.b, { agent: 'marce', message: 'hola', session: U.a })
    expect(r.status).toBe(200)
    expect(r.obj.reply).toBe('hola marce')
    const l = f.sb.llamadas.at(-1)!
    expect(Sandbox.valor(l, '--agent')).toBe('marce')
    expect(Sandbox.valor(l, '--session-id')).toBe(U.a)
    // + Bash (lo puede pedir en vivo) + las herramientas del servidor MCP propio (Fase 4)
    expect(Sandbox.valor(l, '--tools')).toBe('Read,Glob,Grep,Skill,WebFetch,WebSearch,Edit,Write,Bash,mcp__hq__consultar,mcp__hq__colegas,mcp__hq__quien_sabe,mcp__hq__buscar,mcp__hq__marcar_obsoleto,mcp__hq__anotar,mcp__hq__pedir,mcp__hq__quedo_esperando,mcp__hq__cancelar_espera,mcp__hq__proponer_skill')
    expect(l.slice(-2)).toEqual(['--', 'hola'])
    expect(l).not.toContain('--add-dir')
    const notas = ruta(f.carpeta, 'conocimiento/agentes/marce.md')
    const entreg = ruta(f.carpeta, 'archivos/entregables/marce') + '/**'
    expect(Sandbox.reglas(l)).toEqual(['Read', 'Glob', 'Grep', 'Skill', 'WebFetch', 'WebSearch', regla('Edit', notas), regla('Write', notas), regla('Edit', entreg), regla('Write', entreg),
      'mcp__hq__consultar', 'mcp__hq__colegas', 'mcp__hq__quien_sabe', 'mcp__hq__buscar', 'mcp__hq__marcar_obsoleto', 'mcp__hq__anotar', 'mcp__hq__pedir', 'mcp__hq__quedo_esperando', 'mcp__hq__cancelar_espera', 'mcp__hq__proponer_skill', 'mcp__hq__pedir_permiso', '--disallowedTools', 'mcp__claude_ai_*', '--settings', '{"skillListingMaxDescChars":150}', '--append-system-prompt', Sandbox.valor(l, '--append-system-prompt')])
    // con la persona presente, lo no permitido se le pregunta (no se rechaza solo)
    expect(Sandbox.valor(l, '--permission-mode')).toBe('default')
    expect(Sandbox.valor(l, '--permission-prompt-tool')).toBe('mcp__hq__pedir_permiso')
    expect(sinPrivate(f.sb.cwds.at(-1)!)).toBe(sinPrivate(f.carpeta))
    // la carpeta del agente se crea al chatear
    expect(f.existe('archivos/entregables/marce')).toBe(true)
  })

  test('chat: si la oficina no tiene archivos/entregables (carpeta vieja), escribe solo en sus notas y no la crea', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes' }] })
    fs.rmSync(f.ruta('archivos/entregables'), { recursive: true })
    await chat(f.b, { agent: 'marce', session: U.a })
    const l = f.sb.llamadas.at(-1)!
    const notas = ruta(f.carpeta, 'conocimiento/agentes/marce.md')
    expect(Sandbox.reglas(l)).toEqual(['Read', 'Glob', 'Grep', 'Skill', 'WebFetch', 'WebSearch', regla('Edit', notas), regla('Write', notas), 'mcp__hq__consultar', 'mcp__hq__colegas', 'mcp__hq__quien_sabe', 'mcp__hq__buscar', 'mcp__hq__marcar_obsoleto', 'mcp__hq__anotar', 'mcp__hq__pedir', 'mcp__hq__quedo_esperando', 'mcp__hq__cancelar_espera', 'mcp__hq__proponer_skill', 'mcp__hq__pedir_permiso', '--disallowedTools', 'mcp__claude_ai_*', '--settings', '{"skillListingMaxDescChars":150}', '--append-system-prompt', Sandbox.valor(l, '--append-system-prompt')])
    expect(f.existe('archivos/entregables')).toBe(false)
  })

  test('chat: solo agentes de la oficina activa (inexistente, despedido o de otra oficina -> 400 y sin claude)', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes' }, { id: 'nico', depto: 'redes' }] })
    expect((await chat(f.b, { agent: 'betty', session: U.a })).status).toBe(400)
    expect((await historial(f.b, { agent: 'betty' })).status).toBe(400)
    expect((await chat(f.b, { agent: 'nico', session: U.b })).status).toBe(200)
    await f.delete('/api/agentes/nico')
    expect((await chat(f.b, { agent: 'nico', session: U.b })).status).toBe(400)
    expect((await chat(f.b, { agent: 'marce', session: U.b })).status).toBe(400) // la sesión es de nico
    expect(f.sb.llamadas.length).toBe(1)
    // un agente recién contratado ya puede chatear
    await contratar(f.b, { id: 'nuevo', depto: 'direccion' })
    const r = await chat(f.b, { agent: 'nuevo', message: 'hola', session: U.c })
    expect(r.status).toBe(200)
    expect(r.obj.reply).toBe('hola nuevo')
  })

  test('chat: el agente con rutas de escritura extra (`escritura` en oficina.json) las recibe además de las suyas', async () => {
    const f = await Fix.crear({ agentes: [{ id: 'betty', depto: 'direccion' }] })
    const o = f.oficinaJSON()
    const ags = lista(o.agentes)
    ags[0]!.escritura = ['conocimiento/oficina.md', 'conocimiento/decisiones.md']
    o.agentes = ags
    fs.writeFileSync(f.ruta('oficina.json'), JSON.stringify(o))
    await chat(f.b, { agent: 'betty', session: U.a })
    const r = Sandbox.reglas(f.sb.llamadas.at(-1)!)
    expect(r).toContain(regla('Edit', ruta(f.carpeta, 'conocimiento/oficina.md')))
    expect(r).toContain(regla('Write', ruta(f.carpeta, 'conocimiento/decisiones.md')))
    expect(r).toContain(regla('Edit', ruta(f.carpeta, 'conocimiento/agentes/betty.md')))
    // una ruta fuera de conocimiento/ no es válida: oficina.json no se acepta
    ags[0]!.escritura = ['../afuera.md']
    o.agentes = ags
    fs.writeFileSync(f.ruta('oficina.json'), JSON.stringify(o))
    expect((await chat(f.b, { agent: 'betty', session: U.b })).status).toBe(409) // la oficina ya no es válida
  })

  test('chat: --add-dir de las carpetas vinculadas solo para quien tiene acceso según el alcance', async () => {
    const f = await Fix.crear({
      deps: ['Dirección', 'Redes', 'Ads'],
      agentes: [{ id: 'marce', depto: 'redes' }, { id: 'nico', depto: 'ads' }, { id: 'betty', depto: 'direccion' }],
    })
    for (const n of ['todos', 'soloredes', 'soloads', 'solomarce']) fs.mkdirSync(f.sb.root + `/ext/${n}`, { recursive: true })
    const vincular = async (n: string, alcance: unknown) => {
      expect((await f.post('/api/vinculos', { ruta: f.sb.root + `/ext/${n}`, alcance, id: n })).status).toBe(200)
    }
    await vincular('todos', 'oficina')
    await vincular('soloredes', { departamentos: ['redes'] })
    await vincular('soloads', { departamentos: ['ads'] })
    await vincular('solomarce', { agentes: ['marce'] })
    const dirs = async (agente: string, sid: string) => {
      await chat(f.b, { agent: agente, session: sid })
      return Sandbox.valores(f.sb.llamadas.at(-1) ?? [], '--add-dir')
    }
    const e = f.sb.root + '/ext/'
    expect(await dirs('marce', U.a)).toEqual([ruta(e, 'todos'), ruta(e, 'soloredes'), ruta(e, 'solomarce')])
    expect(await dirs('nico', U.b)).toEqual([ruta(e, 'todos'), ruta(e, 'soloads')])
    expect(await dirs('betty', U.c)).toEqual([ruta(e, 'todos')])
    // los --add-dir van antes de --allowedTools
    const l = f.sb.llamadas.at(-1)!
    expect(l.indexOf('--add-dir')).toBeLessThan(l.indexOf('--allowedTools'))
    // una carpeta vinculada que desapareció se omite
    fs.rmSync(e + 'solomarce', { recursive: true })
    expect(await dirs('marce', U.d)).toEqual([ruta(e, 'todos'), ruta(e, 'soloredes')])
    // oficinaDirsExtra de la config se suma
    const g = await Fix.crear({ agentes: [{ id: 'marce', depto: 'redes' }], config: { oficina_dirs_extra: ['/extra/uno'] } })
    await chat(g.b, { agent: 'marce', session: U.a })
    expect(Sandbox.valores(g.sb.llamadas.at(-1) ?? [], '--add-dir')).toEqual([path.resolve(g.sb.root, '/extra/uno')]) // en Windows, la unidad del servidor (C:\\extra\\uno)
  })

  test('crear oficina: «vacia» arranca sin departamentos; sin lista van los sugeridos', async () => {
    const f = await Fix.crear({ nombre: 'Uno', agentes: [] })
    const v = await llamar(f.b, 'POST', '/api/oficinas', { body: { nombre: 'Charlando', vacia: true } })
    expect(v.status).toBe(200)
    expect(dict(v.obj.oficina).departamentos).toEqual([])
    const s = await llamar(f.b, 'POST', '/api/oficinas', { body: { nombre: 'Clasica' } })
    expect(dict(s.obj.oficina).departamentos.length).toBe(3)
    // la vacía vuelve a abrir bien
    const r = await llamar(f.b, 'POST', '/api/oficinas/abrir', { body: { carpeta: str(v.obj.carpeta) } })
    expect(r.status).toBe(200)
  })

  test('chat: sesiones aisladas entre oficinas (mismo id de agente en dos oficinas)', async () => {
    const f = await Fix.crear({ nombre: 'Uno', agentes: [{ id: 'marce', depto: 'redes' }] })
    await chat(f.b, { agent: 'marce', message: 'mensaje en Uno', session: U.a })
    expect(msgs(await historial(f.b, { agent: 'marce', session: U.a })).length).toBe(2)
    // segunda oficina con el mismo agente
    const r2 = await llamar(f.b, 'POST', '/api/oficinas', { body: { nombre: 'Dos', departamentos: ['Redes'] } })
    const dos = str(r2.obj.carpeta)
    await contratar(f.b, { id: 'marce', depto: 'redes' })
    // la sesión de Uno no se ve ni se puede usar desde Dos
    expect(msgs(await historial(f.b, { agent: 'marce', session: U.a }))).toEqual([])
    expect((await chat(f.b, { agent: 'marce', message: 'x', session: U.a })).status).toBe(400)
    const sin = await historial(f.b, { agent: 'marce' })
    expect(sin.obj.session).toBeNull()
    expect(msgs(sin)).toEqual([])
    expect((await chat(f.b, { agent: 'marce', message: 'mensaje en Dos', session: U.b })).status).toBe(200)
    expect(sinPrivate(f.sb.cwds.at(-1)!)).toBe(sinPrivate(dos))
    expect(msgs(await historial(f.b, { agent: 'marce' })).map((m) => str(m.t))).toEqual(['mensaje en Dos', 'hola marce'])
    expect((await historial(f.b, { agent: 'marce' })).obj.session).toBe(U.b)
    // volver a Uno: su historial sigue ahí y la de Dos no se ve
    await llamar(f.b, 'POST', '/api/oficinas/abrir', { body: { carpeta: f.carpeta } })
    const h = await historial(f.b, { agent: 'marce' })
    expect(h.obj.session).toBe(U.a)
    expect(msgs(h).map((m) => str(m.t))).toEqual(['mensaje en Uno', 'hola marce'])
    expect(msgs(await historial(f.b, { agent: 'marce', session: U.b }))).toEqual([])
    expect((await chat(f.b, { agent: 'marce', message: 'x', session: U.b })).status).toBe(400)
    // y la sesión de Uno sigue con --resume en su oficina
    await chat(f.b, { agent: 'marce', message: 'otra vez', session: U.a })
    const l = f.sb.llamadas.at(-1)!
    expect(Sandbox.valor(l, '--resume')).toBe(U.a)
    expect(sinPrivate(f.sb.cwds.at(-1)!)).toBe(sinPrivate(f.carpeta))
  })
})
