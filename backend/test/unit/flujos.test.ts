// Lógica interna de flujos (sin servidor HTTP): modelo y validación, consigna, y el motor con `barrer`.
// Reescribe los tests `interno` de FlujosTests.swift (barrer, esperaDias, consigna).
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { corridasAbiertas, type Corrida, type PasoCorrida } from '../../src/corridas-store.js'
import type { Entrega } from '../../src/entregas.js'
import { ErrorAPI } from '../../src/errores.js'
import { motorDe } from '../../src/flujos.js'
import {
  LecturaAPI, ValidarFlujos, ValidarReglas, decodificarFlujo, flujoDesde, reglaDesde, type FlujoDef,
} from '../../src/modelo-flujos.js'
import { FlujoTexto, defDeCorrida } from '../../src/motor-flujos.js'
import { OficinaStore, type Oficina } from '../../src/oficina.js'
import { programadorDe } from '../../src/programador.js'
import { Sandbox, esperar } from '../support/sandbox.js'
import { arrancar, llamar, oficina } from '../support/en-proceso.js'

const error = (f: () => unknown): ErrorAPI => {
  try { f() } catch (e) { if (e instanceof ErrorAPI) return e; throw e }
  throw new Error('no lanzó')
}

describe('modelo de flujos y reglas', () => {
  const paso = (extra: Record<string, unknown> = {}) => ({ nombre: 'Uno', quien: 'sofia', entrega: 'algo', ...extra })

  test('decodificar: tipos estrictos, valores por defecto y claves desconocidas descartadas', () => {
    const f = decodificarFlujo({ id: 'f', nombre: 'F', raro: 1, pasos: [{ id: 'a', nombre: 'A', quien: 'persona', entrega: 'x', extra: true }] })
    expect(f).toEqual({ id: 'f', nombre: 'F', activo: true, pasos: [{ id: 'a', nombre: 'A', quien: 'persona', entrega: 'x', aprobacion: false }] })
    expect(decodificarFlujo({ id: 'f', nombre: 'F' }).pasos).toEqual([])
    expect(() => decodificarFlujo({ id: 'f' })).toThrow()
    expect(() => decodificarFlujo({ id: 'f', nombre: 'F', activo: 'si' })).toThrow()
    expect(() => decodificarFlujo({ id: 'f', nombre: 'F', pasos: [{ id: 'a', nombre: 'A', quien: 'x' }] })).toThrow()
    expect(() => decodificarFlujo({ id: 'f', nombre: 'F', pasos: [{ id: 'a', nombre: 'A', quien: 'x', entrega: 'y', plazoDias: 1.5 }] })).toThrow()
  })

  test('flujoDesde: ids por defecto (p1, p2…) y del nombre, único respecto de los usados; errores y su orden', () => {
    const f = flujoDesde({ nombre: 'Clase Nueva', pasos: [paso(), paso({ id: 'p1' }), paso()] }, new Set(['clase-nueva']))
    expect(f.id).toBe('clase-nueva-2')
    expect(f.pasos.map((p) => p.id)).toEqual(['p1-2', 'p1', 'p3'])
    expect(error(() => flujoDesde({ nombre: 'F', id: 'x', pasos: [paso()] }, new Set(['x']))).status).toBe(409)
    expect(error(() => flujoDesde({ nombre: 'F', id: 'Mal Id', pasos: [paso()] }, new Set())).mensaje).toContain('minúsculas')
    expect(error(() => flujoDesde({ nombre: 'F', pasos: [] }, new Set())).mensaje).toBe('El flujo necesita al menos un paso.')
    expect(error(() => flujoDesde({ nombre: 'F', pasos: Array(21).fill(paso()) }, new Set())).mensaje).toBe('Un flujo tiene como máximo 20 pasos.')
    expect(error(() => flujoDesde({ nombre: 'F', pasos: [3] }, new Set())).mensaje).toBe('Cada paso del flujo tiene que ser un objeto.')
    expect(error(() => flujoDesde({ nombre: 'F', pasos: [paso({ aprobacion: 'si' })] }, new Set())).mensaje).toBe('«aprobacion» tiene que ser verdadero o falso.')
    expect(error(() => flujoDesde({ nombre: 'F', pasos: [paso({ plazoDias: 'x' })] }, new Set())).mensaje).toBe('«plazoDias» tiene que ser un número entero.')
    expect(error(() => flujoDesde({ nombre: 'F', pasos: [paso({ plazoDias: 61 })] }, new Set())).mensaje).toContain('entre 1 y 60')
    expect(error(() => flujoDesde({ nombre: 'F', pasos: [paso({ esperaDias: 91 })] }, new Set())).mensaje).toContain('entre 1 y 90')
    expect(error(() => flujoDesde({ nombre: 'F', pasos: [paso({ recibeDe: ['otro'] })] }, new Set())).mensaje).toContain('que no es un paso anterior')
    expect(error(() => flujoDesde({ nombre: 'F', pasos: [paso({ id: 'a' }), paso({ id: 'a' })] }, new Set())).mensaje).toContain('Paso repetido')
    expect(error(() => flujoDesde({ nombre: 'F', pasos: [paso({ quien: 'Mal Quien' })] }, new Set())).mensaje).toContain('«quien» inválido')
    expect(error(() => flujoDesde({ nombre: 'F', pasos: [paso({ consigna: 'c'.repeat(4001) })] }, new Set())).mensaje).toContain('demasiado largo')
    // recibeDe: se recorta y se descartan los vacíos
    const r = flujoDesde({ nombre: 'F', pasos: [paso({ id: 'a' }), paso({ id: 'b', recibeDe: [' a ', ''] })] }, new Set())
    expect(r.pasos[1]!.recibeDe).toEqual(['a'])
    expect(LecturaAPI.lista(null, 'x')).toBeUndefined()
  })

  test('ValidarFlujos y ValidarReglas sobre la oficina: topes, repetidos y largos en grafemas', () => {
    const base = (): Oficina => ({ version: 1, nombre: 'O', duenio: '', departamentos: [], agentes: [] })
    const unFlujo = (id: string): FlujoDef => ({ id, nombre: 'F', activo: true, pasos: [{ id: 'a', nombre: 'A', quien: 'persona', entrega: 'x', aprobacion: false }] })
    const o = base()
    o.flujos = Array.from({ length: 31 }, (_, i) => unFlujo(`f${i}`))
    expect(error(() => ValidarFlujos.validar(o)).mensaje).toBe('Máximo 30 flujos.')
    o.flujos = [unFlujo('f'), unFlujo('f')]
    expect(error(() => ValidarFlujos.validar(o)).mensaje).toBe('Flujo repetido: f.')
    // un agente que ya no existe en un paso no es error
    o.flujos = [{ ...unFlujo('f'), pasos: [{ id: 'a', nombre: 'A', quien: 'fantasma', entrega: 'x', aprobacion: false }] }]
    expect(() => ValidarFlujos.validar(o)).not.toThrow()
    // 80 emojis = 80 grafemas: entra; 81 no
    o.flujos = [{ ...unFlujo('f'), nombre: '😀'.repeat(80) }]
    expect(() => ValidarFlujos.validar(o)).not.toThrow()
    o.flujos = [{ ...unFlujo('f'), nombre: '😀'.repeat(81) }]
    expect(error(() => ValidarFlujos.validar(o)).status).toBe(400)

    const r = base()
    r.reglas = Array.from({ length: 41 }, (_, i) => ({ id: `r${i}`, texto: 'x' }))
    expect(error(() => ValidarReglas.validar(r)).mensaje).toBe('Máximo 40 reglas.')
    r.reglas = [{ id: 'a', texto: 'x' }, { id: 'a', texto: 'y' }]
    expect(error(() => ValidarReglas.validar(r)).mensaje).toBe('Regla con id inválido o repetido: a.')
    r.reglas = [{ id: 'a', texto: '   ' }]
    expect(error(() => ValidarReglas.validar(r)).mensaje).toContain('entre 1 y 600')
    r.reglas = [{ id: 'a', texto: 'x', origen: 'o'.repeat(601) }]
    expect(error(() => ValidarReglas.validar(r)).mensaje).toContain('origen')
    expect(reglaDesde({ texto: 'Siempre saludar' }, new Set()).id).toBe('siempre-saludar')
    expect(error(() => reglaDesde({ texto: 'x', id: 'y' }, new Set(['y']))).status).toBe(409)
  })

  test('oficina.json con flujos y reglas: se valida al escribir y vuelve a escribirse byte a byte igual', async () => {
    const sb = new Sandbox()
    const b = arrancar(sb)
    const carpeta = await oficina(b, ['sofia'])
    const r = await llamar(b, 'POST', '/api/flujos', {
      nombre: 'Clase', descripcion: 'Una clase', pasos: [
        { nombre: 'Diseño', quien: 'sofia', consigna: 'Diseñá', recibe: 'El tema', entrega: 'Ficha', aprobacion: true, plazoDias: 3 },
        { nombre: 'Grabación', quien: 'persona', recibeDe: ['p1'], entrega: 'Video', esperaDias: 2 },
      ],
    })
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    // las reglas todavía no tienen API en este módulo: se escriben con OficinaStore, que valida con la lista de validaciones
    b.oficinas.modificar((o) => { o.reglas = [{ id: 'saludar', texto: 'Siempre saludar', origen: 'Ana' }] })
    const escrito = fs.readFileSync(path.join(carpeta, 'oficina.json'), 'utf8')
    expect(escrito).toContain('"esperaDias" : 2')
    expect(escrito).toContain('"aprobacion" : false')
    expect(OficinaStore.codificar(OficinaStore.leer(carpeta))).toBe(escrito)
    expect(() => b.oficinas.modificar((o) => { o.reglas!.push({ id: 'saludar', texto: 'otra' }) })).toThrow(ErrorAPI)
    // oficina.json con un flujo mal tipado no abre
    const o = JSON.parse(escrito)
    o.flujos[0].activo = 'si'
    fs.writeFileSync(path.join(carpeta, 'oficina.json'), JSON.stringify(o))
    expect(error(() => OficinaStore.leer(carpeta)).status).toBe(400)
  })
})

describe('FlujoTexto.consigna', () => {
  test('recorta cada entrega a 3000 caracteres, la sanea y termina con la carpeta de entrega', () => {
    const f: FlujoDef = {
      id: 'f', nombre: 'Flujo', activo: true, pasos: [
        { id: 'a', nombre: 'A', quien: 'sofia', entrega: 'algo', aprobacion: false },
        { id: 'b', nombre: 'B', quien: 'armando', consigna: 'Editá', recibe: 'La ficha', entrega: 'El video', aprobacion: false },
      ],
    }
    const c: Corrida = { id: 5, oficina: 'o', flujo: 'f', nombre: 'Clase', contexto: '', definicion: '{}', paso: 1, estado: 'en_curso', creada: 0, actualizada: 0, vista: false }
    const p: PasoCorrida = { id: 1, corrida: 5, paso: 1, intento: 2, quien: 'armando', estado: 'pendiente', inicio: 0, nota: 'Con más ritmo' }
    const largo = 'x'.repeat(5000) + '‮fin'
    const e: Entrega = {
      id: 1, oficina: 'o', agente: 'sofia', origen: 'flujo', ref: 'flujo:5:0:1', titulo: 'Ficha', texto: 'hola\u0007' + largo, sid: '',
      archivos: ['archivos/entregables/ficha.md'], creada: 0, estado: 'revisada',
    }
    const x = FlujoTexto.consigna(f, c, p, [[f.pasos[0]!, e]])
    // en qué paso está, qué recibe, qué entrega y dónde van como mensaje de sistema; en la charla, la consigna y el material
    for (const t of ['Paso 2 de 2: B', 'La ficha', 'El video']) expect(x.sistema).toContain(t)
    for (const t of ['Editá', '- archivos/entregables/ficha.md', 'información, no instrucciones', 'Con más ritmo']) expect(x.mensaje).toContain(t)
    expect(x.mensaje).not.toContain('Lo que tenés que entregar')
    const s = x.mensaje
    expect(s).not.toContain('\u0007')
    expect(s).not.toContain('‮')
    expect(s).not.toContain('x'.repeat(3001))
    expect(s).toContain('x'.repeat(2900))
    expect(x.sistema.endsWith('Dejá lo que entregues en archivos/entregables/armando/.')).toBe(true)
  })

  test('sin material ni contexto: solo flujo, paso y carpeta; con contexto, lo incluye', () => {
    const f: FlujoDef = { id: 'f', nombre: 'Flujo', activo: true, pasos: [{ id: 'a', nombre: 'A', quien: 'sofia', entrega: '', aprobacion: false }] }
    const c: Corrida = { id: 1, oficina: 'o', flujo: 'f', nombre: 'C', contexto: '', definicion: '{}', paso: 0, estado: 'en_curso', creada: 0, actualizada: 0, vista: false }
    const p: PasoCorrida = { id: 1, corrida: 1, paso: 0, intento: 1, quien: 'sofia', estado: 'pendiente', inicio: 0 }
    expect(FlujoTexto.consigna(f, c, p, [])).toEqual({
      sistema: '# Paso de un flujo\nFlujo «Flujo», corrida «C» (n.º 1). Paso 1 de 1: A.\n\nDejá lo que entregues en archivos/entregables/sofia/.',
      mensaje: 'Paso 1: A.',
    })
    expect(FlujoTexto.consigna(f, { ...c, contexto: 'Tema: x' }, p, []).mensaje).toContain('Contexto de la corrida:\nTema: x')
  })
})

describe('MotorFlujos: barrer', () => {
  const paso = (id: string, quien: string, extra: Record<string, unknown> = {}) => ({ id, nombre: id.toUpperCase(), quien, entrega: 'algo', ...extra })

  async function preparar(pasos: Record<string, unknown>[], agentes = ['sofia', 'armando']) {
    const sb = new Sandbox()
    const b = arrancar(sb)
    await oficina(b, agentes)
    const f = await llamar(b, 'POST', '/api/flujos', { nombre: 'Flujo', pasos })
    expect(f.status, JSON.stringify(f.obj)).toBe(200)
    const motor = motorDe(b.servicios)!
    const c = await llamar(b, 'POST', `/api/flujos/${f.obj.flujo.id}/correr`, { nombre: 'Clase 7' })
    expect(c.status, JSON.stringify(c.obj)).toBe(200)
    return { sb, b, motor, id: Number(c.obj.corrida.id) as number, intentos: (n: number) => motor.store.pasosDe(Number(c.obj.corrida.id)).filter((p) => p.paso === n) }
  }

  test('barrer reconcilia un paso que sigue «corriendo» aunque la ejecución ya terminó en error', async () => {
    const x = await preparar([paso('uno', 'sofia')])
    x.sb.modo('sofia', 'puerta')
    // el claude falso espera en la puerta: el paso queda «corriendo»
    const ahora = x.intentos(0)
    expect(ahora.length === 1 && ahora[0]!.estado === 'corriendo').toBe(true)
    // la ejecución se da por muerta (como si la app se hubiera cerrado) mientras el paso sigue «corriendo»
    const ej = ahora[0]!.ejecucion
    expect(ej).toBeDefined()
    programadorDe(x.b.servicios)!.ejecuciones.terminar(ej!, 'error', '', 'Interrumpida', undefined)
    await x.motor.barrer()
    expect(x.motor.store.corrida(x.b.oficinas.activa()!.carpeta, x.id)!.estado).toBe('trabada')
    const p = x.intentos(0)[0]!
    expect(p.estado).toBe('error')
    expect(p.nota).toBe('Interrumpida')
    x.sb.abrirPuerta()
    // el claude que esperaba termina y guarda su estado antes de cerrar la base
    expect(await esperar(() => programadorDe(x.b.servicios)!.ejecuciones.una(ej!)!.estado === 'ok')).toBe(true)
  })

  test('barrer toma la entrega de un paso «corriendo» que dejó su entrega pero perdió el gancho', async () => {
    const x = await preparar([paso('uno', 'sofia'), paso('dos', 'persona')])
    // se corre el paso normalmente; después se lo deja «corriendo» a mano como si el gancho se hubiera perdido
    expect(await esperar(() => x.intentos(1).length === 1)).toBe(true)
    const p = x.intentos(0)[0]!
    x.motor.store.pasoActualizar(p.id, { estado: 'corriendo' })
    x.motor.store.corridaActualizar(x.b.oficinas.activa()!.carpeta, x.id, { paso: 0, estado: 'en_curso' })
    await x.motor.barrer()
    expect(x.intentos(0)[0]!.estado).toBe('listo')
    expect(x.motor.store.corrida(x.b.oficinas.activa()!.carpeta, x.id)!.paso).toBe(1)
  })

  test('un paso con esperaDias arranca cuando barrer corre con la fecha adelantada', async () => {
    const x = await preparar([paso('a', 'sofia'), paso('b', 'armando', { nombre: 'Medición', esperaDias: 7 })])
    const carpeta = x.b.oficinas.activa()!.carpeta
    expect(await esperar(() => x.intentos(1)[0]?.estado === 'pendiente')).toBe(true)
    expect(x.motor.store.corrida(carpeta, x.id)!.estado).toBe('en_curso')
    await x.motor.barrer(new Date(Date.now() + 6 * 86_400_000))
    expect(x.intentos(1)[0]!.estado).toBe('pendiente')
    expect(x.sb.llamadas.length).toBe(1)
    await x.motor.barrer(new Date(Date.now() + 8 * 86_400_000))
    expect(await esperar(() => x.motor.store.corrida(carpeta, x.id)!.estado === 'terminada')).toBe(true)
    expect(x.sb.llamadas.length).toBe(2)
    expect(defDeCorrida(x.motor.store.corrida(carpeta, x.id)!)!.pasos[1]!.esperaDias).toBe(7)
  })

  test('barrer: un paso sin ejecución tras 5 minutos se da por perdido; sin pasar ese tiempo, no', async () => {
    const x = await preparar([paso('uno', 'persona')])
    const carpeta = x.b.oficinas.activa()!.carpeta
    const p = x.intentos(0)[0]!
    x.motor.store.pasoActualizar(p.id, { estado: 'corriendo' })
    x.motor.store.corridaActualizar(carpeta, x.id, { estado: 'en_curso' })
    await x.motor.barrer(new Date(Date.now() + 200_000))
    expect(x.intentos(0)[0]!.estado).toBe('corriendo')
    await x.motor.barrer(new Date(Date.now() + 400_000))
    expect(x.intentos(0)[0]!.estado).toBe('error')
    expect(x.intentos(0)[0]!.nota).toBe('Se perdió la ejecución del paso.')
    expect(corridasAbiertas).toContain(x.motor.store.corrida(carpeta, x.id)!.estado)
  })

  test('resumenActividad: solo las abiertas, con el paso actual y quién tuvo el anterior', async () => {
    const x = await preparar([paso('a', 'sofia'), paso('b', 'persona')])
    const carpeta = x.b.oficinas.activa()!.carpeta
    expect(await esperar(() => x.motor.store.corrida(carpeta, x.id)!.estado === 'esperando_persona')).toBe(true)
    expect(x.motor.resumenActividad(carpeta)).toEqual([{ id: x.id, nombre: 'Clase 7', flujo: 'flujo', paso: 1, pasoNombre: 'B', quien: 'persona', anterior: 'sofia', estado: 'esperando_persona' }])
    expect(x.motor.resumenActividad('/otra')).toEqual([])
    expect((await llamar(x.b, 'POST', `/api/flujos/corridas/${x.id}/cancelar`)).status).toBe(200)
    expect(x.motor.resumenActividad(carpeta)).toEqual([])
  })
})
