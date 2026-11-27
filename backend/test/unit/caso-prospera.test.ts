// Reescribe los tests `interno` de CasoProsperaTests.swift con un backend en proceso (test/support/en-proceso.ts):
// el caso completo (tarjetas del caso de Juli → mapeo esperado → aplicar → flujo F1), los ganchos cruzados (flujo, acción
// propuesta y encargo del coordinador a la vez) y el orden de los routers (gobierno antes que entregas).
// Todo con el claude falso.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { mcpDe } from '../../src/consultas.js'
import { catalogoDe } from '../../src/conectores.js'
import { creadorDe } from '../../src/creador.js'
import { programadorDe } from '../../src/programador.js'
import { OficinaStore } from '../../src/oficina.js'
import type { MCPHerramientas } from '../../src/mcp-protocolo.js'
import { Sandbox, U, esperar, raizRepo } from '../support/sandbox.js'
import { arrancar, llamar, oficina } from '../support/en-proceso.js'

type O = Record<string, any>

const textoOriginal = fs.readFileSync(path.join(raizRepo, 'docs/caso-prospera/texto-original.md'), 'utf8')

const calendar = {
  nombre: 'Google Calendar', prefijo: 'mcp__claude_ai_Google_Calendar', estado: 'connected',
  herramientas: ['mcp__claude_ai_Google_Calendar__list_calendars', 'mcp__claude_ai_Google_Calendar__list_events', 'mcp__claude_ai_Google_Calendar__create_event'],
}
const notionSrv = { nombre: 'Notion', prefijo: 'mcp__claude_ai_Notion', estado: 'needs-auth', herramientas: [] }

/** Departamentos y agentes de la oficina de Próspera con la que arranca el caso. */
const departamentosCaso = [
  { id: 'dir', nombre: 'Dirección' },
  { id: 'redes', nombre: 'Redes y estrategia digital' },
  { id: 'ads', nombre: 'Ads' },
  { id: 'clases', nombre: 'Clases de PRÓSPERAS' },
  { id: 'video', nombre: 'Edición de video' },
]
const agentesCaso = [
  { id: 'betty', nombre: 'Betty', rol: 'PM y directora del equipo', departamento: 'dir' },
  { id: 'don-armando', nombre: 'Don Armando', rol: 'Editor de videos de PRÓSPERAS', departamento: 'video' },
  { id: 'mario', nombre: 'Mario', rol: 'Editor de reels', departamento: 'video' },
  { id: 'marce', nombre: 'Marce', rol: 'Directora creativa de redes', departamento: 'redes' },
  { id: 'catalina', nombre: 'Doña Catalina', rol: 'Social Media Manager', departamento: 'redes' },
  { id: 'patricia', nombre: 'Patricia', rol: 'Community Manager', departamento: 'redes' },
  { id: 'sofia', nombre: 'Doña Sofía', rol: 'Creadora de las clases de PRÓSPERAS', departamento: 'clases' },
  { id: 'nicolas', nombre: 'Nicolás Mora', rol: 'Ads (Meta Ads)', departamento: 'ads' },
]

/** Oficina de Próspera armada por la API, con la sesión del Creador que tiene el texto de Juli como mensaje `u`. */
async function armar(texto = textoOriginal) {
  const sb = new Sandbox()
  const b = arrancar(sb)
  const r = await llamar(b, 'POST', '/api/oficinas', { nombre: 'Próspera HQ', duenio: 'Juli', departamentos: departamentosCaso })
  expect(r.status, `crear oficina: ${JSON.stringify(r.obj)}`).toBe(200)
  for (const a of agentesCaso) {
    const c = await llamar(b, 'POST', '/api/agentes', { ...a, prompt: `Sos ${a.nombre}, ${a.rol}.` })
    expect(c.status, `contratar ${a.id}: ${JSON.stringify(c.obj)}`).toBe(200)
  }
  const carpeta = String(r.obj.carpeta)
  const s = b.servicios
  s.store.asegurarSesion(U.a, 'creador', carpeta)
  s.store.agregar(U.a, 'u', texto)
  const mcp = mcpDe(s)!
  const ident = { oficina: carpeta, agente: 'creador', sid: U.a, perfil: 'creador' }
  const h: MCPHerramientas = mcp.consultas.herramientas(mcp.tokens.emitir(ident), ident)
  const llamarH = async (nombre: string, args: O = {}) => {
    const x = await h.llamar(nombre, args)
    return x ? { texto: x.texto, error: x.esError } : { texto: '(no existe)', error: true }
  }
  const tarjeta = (x: { texto: string }): O => { try { return JSON.parse(x.texto) } catch { return {} } }
  const prop = async (tipo: string, accion: string, p: { origen: string; objetivo?: string; ref?: string; datos?: O }) => {
    const a: O = { accion, origen: p.origen, datos: p.datos ?? {} }
    if (p.ref !== undefined) a.ref = p.ref
    if (p.objetivo !== undefined) a.objetivo = p.objetivo
    const x = await llamarH('proponer_' + tipo, a)
    return { t: tarjeta(x), error: x.error, texto: x.texto }
  }
  const faltantes = (t: O): string[] => (t.faltantes ?? []).map((x: O) => x.campo)
  const pregunta = (t: O): string => t.faltantes?.[0]?.pregunta ?? ''
  const leerOficina = (): O => JSON.parse(fs.readFileSync(path.join(carpeta, 'oficina.json'), 'utf8'))
  return {
    sb, b, s, carpeta, prop, llamarH, tarjeta, faltantes, pregunta, leerOficina,
    get: (ruta: string, query?: Record<string, string>) => llamar(b, 'GET', ruta, undefined, query),
    post: (ruta: string, body?: unknown) => llamar(b, 'POST', ruta, body ?? {}),
    tarjetas: () => creadorDe(s).tarjetas.lista(carpeta),
  }
}

describe('Caso Próspera de punta a punta (en proceso)', () => {
  test('las tarjetas del caso coinciden con el mapeo, aplicarlas deja la oficina válida y F1 llega al paso de la persona', async () => {
    const b = await armar()
    const { prop, llamarH, tarjeta, faltantes, pregunta, carpeta, sb } = b
    catalogoDe(b.s)!.fijar([calendar, notionSrv])
    const agentesJSON = (ids: string[]) => (b.leerOficina().agentes as O[]).filter((a) => ids.includes(a.id))
    const intactosAntes = agentesJSON(['catalina', 'patricia', 'mario'])
    const mdAntes = ['catalina', 'patricia', 'mario'].map((x) => fs.readFileSync(path.join(carpeta, `.claude/agents/${x}.md`), 'utf8'))
    const videoAntes = (b.leerOficina().departamentos as O[]).find((d) => d.id === 'video')
    expect(intactosAntes.length === 3 && videoAntes !== undefined).toBe(true)

    // --- departamentos
    const d2 = await prop('departamento', 'modificar', {
      origen: 'Su misión es convertir tu conocimiento en experiencias educativas de calidad, especialmente para PRÓSPERAS.',
      objetivo: 'clases',
      datos: { nombre: 'Departamento de educación', mision: 'Convertir el conocimiento de Juli en experiencias educativas de calidad, especialmente para PRÓSPERAS.' },
    })
    expect(d2.t.estado, `D2: ${d2.texto}`).toBe('lista')
    // D1: el texto no le da misión: queda en borrador con la pregunta, no con un valor inventado
    const d1 = await prop('departamento', 'modificar', { origen: 'Dirección y operaciones', objetivo: 'dir', datos: { nombre: 'Dirección y operaciones' } })
    expect(d1.t.estado).toBe('lista')
    const d1m = tarjeta(await llamarH('marcar_faltante', { ref: d1.t.id, campo: 'mision', pregunta: '¿Cuál es la misión de Dirección y operaciones?' }))
    expect(d1m.estado).toBe('borrador')
    expect(faltantes(d1m)).toEqual(['mision'])
    expect(d1m.datos.mision).toBeUndefined()

    // --- agentes
    const orA1 = 'garantizar que Cherry Glow avance de manera organizada, con prioridades claras y sin depender de que vos recuerdes absolutamente todo.'
    const a1 = await prop('agente', 'modificar', {
      origen: orA1, objetivo: 'betty',
      datos: {
        rol: 'Chief of Staff',
        limites: { solo: ['Armar la agenda, la planificación, el tablero y el reporte de bloqueos'], proponer: ['Modificar fechas o prioridades estratégicas', 'Crear o mover eventos'] },
      },
    })
    expect(a1.t.estado, `A1: ${a1.texto}`).toBe('lista')
    // falta saber si reparte encargos sola (P7): queda en borrador hasta que Juli conteste
    const a1m = tarjeta(await llamarH('marcar_faltante', { ref: a1.t.id, campo: 'permisos', pregunta: '¿La Chief of Staff reparte encargos sola o te los propone?' }))
    expect(a1m.estado).toBe('borrador')
    expect(faltantes(a1m)).toEqual(['permisos'])

    const a2 = await prop('agente', 'modificar', {
      origen: 'diseñar clases que realmente enseñen algo y ayuden a las alumnas a implementar lo aprendido.', objetivo: 'sofia',
      datos: {
        rol: 'Directora académica y diseñadora instruccional',
        limites: { solo: ['Investigar, redactar el plan, la ficha, el guion y los materiales'], proponer: ['El plan curricular y cada guion'] },
      },
    })
    expect(a2.t.estado, `A2: ${a2.texto}`).toBe('lista')

    // A3: no tiene nombre ni instrucciones en el texto
    const orA3 = 'transformar los guiones en presentaciones visuales, atractivas y fáciles de utilizar al grabar.'
    const a3 = await prop('agente', 'crear', { origen: orA3, datos: { rol: 'Diseñadora de presentaciones educativas', departamento: 'clases' } })
    expect(a3.t.estado, `A3: ${a3.texto}`).toBe('borrador')
    expect(faltantes(a3.t)).toEqual(['nombre', 'prompt'])

    const a8 = await prop('agente', 'modificar', {
      origen: 'evaluar qué está funcionando comercialmente y dónde conviene invertir recursos.', objetivo: 'nicolas',
      datos: { rol: 'Analista de performance y crecimiento', limites: { proponer: ['Cambiar presupuestos o campañas activas'] } },
    })
    expect(a8.t.estado, `A8: ${a8.texto}`).toBe('lista')
    const orA9 = 'desarrollar anuncios persuasivos, claros y adaptados a cada producto.'
    const a9 = await prop('agente', 'crear', { origen: orA9, datos: { rol: 'Directora creativa de anuncios y copywriter ADS', departamento: 'ads' } })
    expect(a9.t.estado, `A9: ${a9.texto}`).toBe('borrador')
    expect(faltantes(a9.t)).toEqual(['nombre', 'prompt'])

    // --- las 6 reglas
    const reglas: [string, string][] = [
      ['Consultar las fuentes disponibles y no inventar métricas, tareas, testimonios ni resultados.',
        'Trabajá desde información real: consultá las fuentes disponibles y no inventes métricas, tareas, testimonios ni resultados.'],
      ['No limitarse a sugerencias cuando el agente tiene herramientas para producir el entregable.',
        'Entregá trabajo terminado: no te limites a sugerencias cuando tenés herramientas para producir el entregable.'],
      ['Voz, público, productos, posicionamiento y criterios comerciales.',
        'Respetá la identidad de Cherry Glow: voz, público, productos, posicionamiento y criterios comerciales.'],
      ['Cada rol tiene una responsabilidad definida y entrega su trabajo al siguiente.',
        'Evitá duplicaciones: cada rol tiene una responsabilidad definida y le entrega su trabajo al siguiente.'],
      ['Toda propuesta debe justificar su objetivo y prioridad.',
        'No crees trabajo innecesario: toda propuesta justifica su objetivo y su prioridad.'],
      ['Especialmente lanzamientos, inversión, promesas comerciales y publicación de contenidos.',
        'Juli toma las decisiones finales, en especial lanzamientos, inversión, promesas comerciales y publicación de contenidos.'],
    ]
    const rs: string[] = []
    for (const [origen, texto] of reglas) {
      const r = await prop('regla', 'crear', { origen, datos: { texto } })
      expect(r.t.estado, `regla: ${r.texto}`).toBe('lista')
      rs.push(r.t.id)
    }
    // R3: falta dónde está la identidad de la marca (K11, K12)
    const r3m = tarjeta(await llamarH('marcar_faltante', { ref: rs[2], campo: 'texto', pregunta: '¿Dónde está descrita la identidad de Cherry Glow (voz, público, productos)?' }))
    expect(r3m.estado).toBe('borrador')
    expect(faltantes(r3m)).toEqual(['texto'])

    // --- flujos
    const orF1 = 'diseño académico → PPT → grabación de Juli → edición → publicación'
    const pasosF1 = (aprobacionPPT?: boolean): O[] => {
      const ppt: O = { id: 'ppt', nombre: 'PPT', quien: 'tarjeta:' + a3.t.id, entrega: 'PowerPoint editable y notas de presentación' }
      if (aprobacionPPT !== undefined) ppt.aprobacion = aprobacionPPT
      return [
        { id: 'diseno', nombre: 'Diseño académico', quien: 'sofia', recibe: 'El tema de la clase y el plan curricular', entrega: 'Ficha de clase, guion completo, ejercicios y materiales', aprobacion: true },
        ppt,
        { id: 'grabacion', nombre: 'Grabación', quien: 'persona', recibeDe: ['diseno', 'ppt'], entrega: 'El archivo de la grabación', aprobacion: false },
        { id: 'plan', nombre: 'Plan de edición', quien: 'don-armando', recibeDe: ['grabacion', 'diseno', 'ppt'], entrega: 'Plan de edición y lista de correcciones', aprobacion: true },
        { id: 'render', nombre: 'Edición final', quien: 'don-armando', recibeDe: ['grabacion', 'plan'], entrega: 'Video final y .srt', aprobacion: true },
        { id: 'publicacion', nombre: 'Publicación', quien: 'persona', recibeDe: ['render'], entrega: 'Hecho', aprobacion: false },
      ]
    }
    // P9: la persona todavía no dijo si la PPT necesita su aprobación
    const f1 = await prop('flujo', 'crear', { origen: orF1, datos: { id: 'clase', nombre: 'Producción de una clase', pasos: pasosF1() } })
    expect(f1.error, `F1: ${f1.texto}`).toBe(false)
    expect(f1.t.estado, `F1: ${f1.texto}`).toBe('borrador')
    expect(faltantes(f1.t)).toEqual(['pasos[1].aprobacion'])

    const orF3 = 'diagnóstico → hipótesis → guiones ADS → prueba → resultados'
    const pasosF3 = (aprobacionPrueba?: boolean): O[] => {
      const prueba: O = { id: 'prueba', nombre: 'Prueba', quien: 'persona', entrega: 'Grabación y campaña lanzada' }
      if (aprobacionPrueba !== undefined) prueba.aprobacion = aprobacionPrueba
      return [
        { id: 'datos', nombre: 'Datos de campañas', quien: 'persona', entrega: 'Exportación o capturas de Meta Ads', aprobacion: false },
        { id: 'diagnostico', nombre: 'Diagnóstico', quien: 'nicolas', entrega: 'Diagnóstico de campañas', aprobacion: false },
        { id: 'hipotesis', nombre: 'Hipótesis', quien: 'nicolas', entrega: 'Plan de pruebas con hipótesis medibles', aprobacion: true },
        { id: 'guiones', nombre: 'Guiones ADS', quien: 'tarjeta:' + a9.t.id, entrega: 'Guiones, briefs de grabación y variantes', aprobacion: true },
        prueba,
        { id: 'resultados', nombre: 'Resultados', quien: 'nicolas', recibeDe: ['prueba', 'hipotesis'], esperaDias: 7, entrega: 'Resultados y próximas acciones', aprobacion: false },
      ]
    }
    const f3 = await prop('flujo', 'crear', { origen: orF3, datos: { id: 'anuncios', nombre: 'Optimización de anuncios', pasos: pasosF3() } })
    expect(f3.t.estado, `F3: ${f3.texto}`).toBe('borrador')
    expect(faltantes(f3.t)).toEqual(['pasos[4].aprobacion'])
    expect(f3.t.datos.pasos[0].quien, 'F3 empieza con el paso 0 de la persona').toBe('persona')

    // --- tareas
    const semanal = await prop('tarea', 'crear', {
      origen: 'Crear el calendario editorial semanal y mensual.',
      datos: { agente: 'marce', nombre: 'Calendario editorial semanal', consigna: 'Armá el calendario editorial de la semana.', dias: [1], hora: '09:00' },
    })
    expect(semanal.t.estado, `T8: ${semanal.texto}`).toBe('lista')
    const mensual = await prop('tarea', 'crear', {
      origen: 'Preparar revisiones semanales y mensuales de objetivos.',
      datos: { agente: 'betty', nombre: 'Revisión mensual de objetivos', consigna: 'Preparar la revisión mensual de objetivos.', hora: '09:00', periodicidad: 'mensual' },
    })
    expect(mensual.t.estado, `T4: ${mensual.texto}`).toBe('borrador')
    expect(faltantes(mensual.t)).toContain('periodicidad')

    // --- conectores: Calendar está sembrado como disponible, Notion no
    const orC = 'Revisar Google Calendar y Notion para organizar tu agenda diaria y semanal.'
    const cal = await prop('conector', 'crear', {
      origen: orC,
      datos: { agente: 'betty', servidor: 'Google Calendar', leer: ['mcp__claude_ai_Google_Calendar__list_events'], actuar: ['mcp__claude_ai_Google_Calendar__create_event'] },
    })
    expect(cal.t.estado, `C1: ${cal.texto}`).toBe('lista')
    const notion = await prop('conector', 'crear', { origen: orC, datos: { agente: 'betty', servidor: 'Notion', leer: ['mcp__claude_ai_Notion__notion-search'] } })
    expect(notion.t.estado, `C2: ${notion.texto}`).toBe('borrador')
    expect(pregunta(notion.t)).toContain('Conectá Notion en claude.ai')

    // --- nada se crea solo: hasta acá la oficina sigue igual
    const antes = OficinaStore.leer(carpeta)
    expect(antes.agentes.length).toBe(8)
    expect(antes.reglas).toBeUndefined()
    expect(antes.flujos).toBeUndefined()
    expect((antes.tareas ?? []).length).toBe(0)
    expect(antes.agentes.find((a) => a.id === 'betty')?.permisos).toBeUndefined()

    // aplicar con un borrador nombrado: 409 con sus faltantes, y no cambia nada
    const bloqueado = await b.post('/api/creador/aplicar', { ids: [d2.t.id, a3.t.id] })
    expect(bloqueado.status).toBe(409)
    expect((bloqueado.obj.borradores as O[]).map((x) => x.id)).toEqual([a3.t.id])
    expect(OficinaStore.leer(carpeta).departamentos.find((d) => d.id === 'clases')?.mision).toBeUndefined()

    // --- Juli contesta lo que faltaba (se actualiza la misma tarjeta con ref)
    const a1ok = await prop('agente', 'modificar', { origen: orA1, objetivo: 'betty', ref: a1.t.id, datos: { permisos: ['coordinador'] } })
    expect(a1ok.t.estado, `A1: ${a1ok.texto}`).toBe('lista')
    const a3ok = await prop('agente', 'crear', {
      origen: orA3, ref: a3.t.id,
      datos: { id: 'lucia', nombre: 'Lucía', prompt: 'Sos Lucía, diseñadora de presentaciones educativas de la oficina. Transformás los guiones aprobados en presentaciones claras.' },
    })
    expect(a3ok.t.estado, `A3: ${a3ok.texto}`).toBe('lista')
    const a9ok = await prop('agente', 'crear', {
      origen: orA9, ref: a9.t.id,
      datos: { id: 'camila', nombre: 'Camila', prompt: 'Sos Camila, directora creativa de anuncios y copywriter ADS de la oficina.' },
    })
    expect(a9ok.t.estado, `A9: ${a9ok.texto}`).toBe('lista')
    const r3ok = await prop('regla', 'crear', {
      origen: reglas[2]![0], ref: rs[2],
      datos: { texto: 'Respetá la identidad de Cherry Glow (voz, público, productos, posicionamiento y criterios comerciales) que está en el contexto maestro de la oficina.' },
    })
    expect(r3ok.t.estado, `R3: ${r3ok.texto}`).toBe('lista')
    const f1ok = await prop('flujo', 'crear', { origen: orF1, ref: f1.t.id, datos: { pasos: pasosF1(true) } })
    expect(f1ok.t.estado, `F1: ${f1ok.texto}`).toBe('lista')
    const f3ok = await prop('flujo', 'crear', { origen: orF3, ref: f3.t.id, datos: { pasos: pasosF3(false) } })
    expect(f3ok.t.estado, `F3: ${f3ok.texto}`).toBe('lista')

    // --- aplicar todas las listas (D1, Notion y la tarea mensual siguen en borrador y no se tocan)
    const ap = await b.post('/api/creador/aplicar', {})
    expect(ap.status, JSON.stringify(ap.obj)).toBe(200)
    const res = ap.obj.resultados as O[]
    expect(res.every((x) => x.ok === true), JSON.stringify(res)).toBe(true)
    const tj = b.tarjetas()
    const sinAplicar = [d1.t.id, notion.t.id, mensual.t.id]
    expect(sinAplicar.every((i) => tj.find((t) => t.id === i)?.estado === 'borrador')).toBe(true)
    expect(tj.filter((t) => t.estado === 'creada').length).toBe(tj.length - sinAplicar.length)

    // oficina.json es válido (OficinaStore.leer valida) y tiene lo pedido
    const o = OficinaStore.leer(carpeta)
    const ag = (id: string) => o.agentes.find((a) => a.id === id)
    expect(ag('betty')?.permisos).toEqual(['coordinador'])
    expect(ag('betty')?.rol).toBe('Chief of Staff')
    expect(ag('betty')?.limites?.proponer?.length).toBe(2)
    expect(ag('betty')?.conectores?.map((c) => c.servidor)).toEqual(['Google Calendar'])
    expect(ag('betty')?.conectores?.[0]?.actuar).toEqual(['mcp__claude_ai_Google_Calendar__create_event'])
    expect(o.reglas?.length).toBe(6)
    expect(o.reglas?.every((r) => (r.origen ?? '') !== '')).toBe(true)
    const clases = o.departamentos.find((d) => d.id === 'clases')
    expect(clases?.nombre).toBe('Departamento de educación')
    expect(clases?.mision).toContain('PRÓSPERAS')
    expect(o.departamentos.find((d) => d.id === 'dir')?.nombre, 'D1 sigue en borrador: no se renombró').toBe('Dirección')
    expect(ag('lucia')?.departamento).toBe('clases')
    expect(ag('camila')?.departamento).toBe('ads')
    const clase = o.flujos!.find((f) => f.id === 'clase')!
    expect(clase.pasos.length).toBe(6)
    expect(clase.pasos.map((p) => p.quien)).toEqual(['sofia', 'lucia', 'persona', 'don-armando', 'don-armando', 'persona'])
    expect(clase.pasos.map((p) => p.aprobacion)).toEqual([true, true, false, true, true, false])
    expect(clase.pasos[3]!.recibeDe).toEqual(['grabacion', 'diseno', 'ppt'])
    const anuncios = o.flujos!.find((f) => f.id === 'anuncios')!
    expect(anuncios.pasos.length === 6 && anuncios.pasos[0]!.quien === 'persona' && anuncios.pasos[3]!.quien === 'camila').toBe(true)
    expect(anuncios.pasos[5]!.esperaDias).toBe(7)
    expect(o.tareas?.map((t) => t.agente)).toEqual(['marce'])
    // los agentes que el texto no menciona y el departamento video siguen intactos, con sus archivos
    expect(agentesJSON(['catalina', 'patricia', 'mario'])).toEqual(intactosAntes)
    expect(['catalina', 'patricia', 'mario'].map((x) => fs.readFileSync(path.join(carpeta, `.claude/agents/${x}.md`), 'utf8'))).toEqual(mdAntes)
    expect((b.leerOficina().departamentos as O[]).find((d) => d.id === 'video')).toEqual(videoAntes)
    expect(o.agentes.length).toBe(10)

    // --- F1 con el motor: arranca, espera la aprobación del diseño y de la PPT, y llega al paso de la persona
    const corrida = await b.post('/api/flujos/clase/correr', { nombre: 'Clase 7', contexto: 'Tema: fracciones en el taller' })
    expect(corrida.status, JSON.stringify(corrida.obj)).toBe(200)
    const cid = Number(corrida.obj.corrida.id)
    const verCorrida = async (): Promise<O> => (await b.get(`/api/flujos/corridas/${cid}`)).obj
    const estado = async () => (await verCorrida()).corrida.estado as string
    const esperaEn = async (p: number, e: string) => { const c = (await verCorrida()).corrida; return c.paso === p && c.estado === e }
    const paso = async () => ((await verCorrida()).corrida.paso as number) ?? -1
    const entregaVigente = async (p: number) => {
      const ps = (await verCorrida()).pasos as O[]
      if (p >= ps.length) return 0
      const intentos = ps[p]!.intentos as O[]
      return Number(intentos.at(-1)?.entrega?.id ?? 0)
    }
    expect(await esperar(async () => (await estado()) === 'esperando_aprobacion', 15)).toBe(true)
    expect(await paso()).toBe(0)
    expect((await b.post(`/api/entregas/${await entregaVigente(0)}/revisada`)).status).toBe(200)
    expect(await esperar(() => esperaEn(1, 'esperando_aprobacion'), 15)).toBe(true)
    // el paso de Lucía (agente que se creó recién) corrió con su archivo y las reglas de la oficina
    expect(sb.llamadas.some((l) => Sandbox.valor(l, '--agent') === 'lucia')).toBe(true)
    const deLucia = sb.llamadas.filter((l) => Sandbox.valor(l, '--agent') === 'lucia').at(-1)!
    expect(Sandbox.valor(deLucia, '--permission-mode')).toBe('dontAsk')
    expect(deLucia.join(' '), 'las reglas de la oficina llegan a los agentes nuevos').toContain('Juli toma las decisiones finales')
    expect((await b.post(`/api/entregas/${await entregaVigente(1)}/revisada`)).status).toBe(200)
    expect(await esperar(async () => (await estado()) === 'esperando_persona', 15)).toBe(true)
    expect(await paso()).toBe(2)
    const av = ((await b.get('/api/avisos')).obj.avisos as O[]).find((a) => a.id === `flujo:${cid}`)
    expect(av?.texto).toBe('«Clase 7» te necesita: Grabación')
    // la grabación sube un archivo: el plan de edición recibe la grabación, el guion y la PPT (recibeDe de pasos anteriores)
    const hecho = await b.post(`/api/flujos/corridas/${cid}/hecho`, { nota: 'Grabada', archivos: [{ nombre: 'clase7.txt', base64: Buffer.from('video').toString('base64') }] })
    expect(hecho.status, JSON.stringify(hecho.obj)).toBe(200)
    expect(await esperar(() => esperaEn(3, 'esperando_aprobacion'), 15)).toBe(true)
    const plan = sb.llamadas.filter((l) => Sandbox.valor(l, '--agent') === 'don-armando').at(-1)!
    const consigna = plan.at(-1) ?? ''
    expect(consigna).toContain('Paso 4 de 6: Plan de edición')
    expect(consigna).toContain('Grabada')
    expect(consigna).toContain(`archivos/entregables/persona/${cid}-2/clase7.txt`)
    expect(consigna).toContain('hola sofia')
    expect(consigna).toContain('hola lucia')
  }, 60_000)

  test('flujo, acción propuesta y encargo del coordinador a la vez: cada gancho toca solo lo suyo', async () => {
    const crear = 'mcp__claude_ai_Google_Calendar__create_event', leer = 'mcp__claude_ai_Google_Calendar__list_events'
    const sb = new Sandbox()
    const b = arrancar(sb)
    const s = b.servicios
    catalogoDe(s)!.fijar([{ nombre: 'Google Calendar', prefijo: 'mcp__claude_ai_Google_Calendar', estado: 'connected', herramientas: [leer, crear] }])
    const carpeta = await oficina(b, ['coordi', 'sofia', 'nico'])
    const get = (ruta: string, query?: Record<string, string>) => llamar(b, 'GET', ruta, undefined, query)
    const post = (ruta: string, body?: unknown) => llamar(b, 'POST', ruta, body ?? {})
    const p = await llamar(b, 'PATCH', '/api/agentes/coordi', { permisos: ['coordinador'], conectores: [{ servidor: 'Google Calendar', leer: [leer], actuar: [crear] }] })
    expect(p.status, JSON.stringify(p.obj)).toBe(200)
    const fl = await post('/api/flujos', {
      nombre: 'Clase', pasos: [
        { id: 'diseno', nombre: 'Diseño', quien: 'sofia', entrega: 'Ficha', aprobacion: true },
        { id: 'grabacion', nombre: 'Grabación', quien: 'persona', entrega: 'Archivo' },
      ],
    })
    expect(fl.status, JSON.stringify(fl.obj)).toBe(200)
    const cid = Number((await post('/api/flujos/clase/correr', { nombre: 'Clase 7' })).obj.corrida.id)
    const estado = async () => ((await get(`/api/flujos/corridas/${cid}`)).obj.corrida.estado as string)
    expect(await esperar(async () => (await estado()) === 'esperando_aprobacion', 15)).toBe(true)

    // la acción propuesta por el coordinador y el encargo que repartió
    const mcp = mcpDe(s)!
    const ident = { oficina: carpeta, agente: 'coordi', sid: U.a, perfil: 'coordinador' }
    const h = mcp.consultas.herramientas(mcp.tokens.emitir(ident), ident)
    const nombres = (h.definiciones as O[]).map((d) => d.name)
    expect(nombres.includes('proponer_accion') && nombres.includes('delegar')).toBe(true)
    const acc = (await h.llamar('proponer_accion', { herramienta: crear, resumen: 'Crear la reunión', detalle: { titulo: 'Reunión' } }))!
    expect(acc.esError, acc.texto).toBe(false)
    const enc = (await h.llamar('delegar', { agente: 'nico', nombre: 'Informe', consigna: 'Preparame el informe de la semana con lo que entregó cada uno y dejalo en un archivo' }))!
    expect(enc.esError, enc.texto).toBe(false)
    expect(await esperar(() => s.entregas.lista(carpeta, { origen: 'encargo' }).length === 1, 15)).toBe(true)
    const todas = (await get('/api/entregas')).obj.entregas as O[]
    const entrega = (origen: string) => todas.find((x) => x.origen === origen)!
    const eFlujo = entrega('flujo'), eProp = entrega('propuesta'), eEnc = entrega('encargo')
    expect(eFlujo && eProp && eEnc).toBeTruthy()
    const accionDe = async () => (await get('/api/acciones', { entrega: String(eProp.id) })).obj.accion as O

    // revisar el encargo y la propuesta no mueve la corrida ni ejecuta la acción
    expect((await post(`/api/entregas/${eEnc.id}/revisada`)).status).toBe(200)
    expect((await post(`/api/entregas/${eProp.id}/revisada`)).status).toBe(200)
    expect(await estado()).toBe('esperando_aprobacion')
    expect((await accionDe()).estado).toBe('pendiente')
    // revisar la entrega del flujo avanza la corrida y no toca la acción
    expect((await post(`/api/entregas/${eFlujo.id}/revisada`)).status).toBe(200)
    expect(await esperar(async () => (await estado()) === 'esperando_persona', 15)).toBe(true)
    expect((await accionDe()).estado).toBe('pendiente')
    // aprobar la acción (aunque ya se la hubiera marcado «Listo») la ejecuta con esa sola herramienta y no mueve la corrida
    const ej = await post(`/api/entregas/${eProp.id}/ejecutar`)
    expect(ej.status, JSON.stringify(ej.obj)).toBe(202)
    expect(await esperar(async () => (await accionDe()).estado === 'hecha', 15)).toBe(true)
    expect(await estado()).toBe('esperando_persona')
    const correAccion = sb.llamadasConPrompt('exactamente esto').at(-1)!
    expect(Sandbox.reglas(correAccion)).toContain(crear)
    // la corrida del paso de flujo, en cambio, no tenía la herramienta de actuar
    const correPaso = sb.llamadasConPrompt('Paso 1 de 2')[0]!
    expect(Sandbox.reglas(correPaso)).not.toContain(crear)
    // el resultado queda en la propia propuesta: ejecutarla no deja una entrega aparte
    expect((await accionDe()).resultado).toBeTruthy()
    // tres cosas distintas, tres orígenes y una sola corrida abierta
    const origenes = new Set(((await get('/api/entregas')).obj.entregas as O[]).map((x) => x.origen))
    for (const o of ['flujo', 'propuesta', 'encargo']) expect(origenes.has(o), o).toBe(true)
    expect(origenes.has('accion')).toBe(false)
    expect(((await get('/api/actividad')).obj.corridas as O[]).length).toBe(1)
  }, 60_000)

  test('el router de gobierno atiende ejecutar y deja pasar el resto de /api/entregas', async () => {
    const sb = new Sandbox()
    const b = arrancar(sb)
    const s = b.servicios
    const carpeta = await oficina(b, ['sofia'])
    const act = s.oficinas.activa()!
    await programadorDe(s)!.encargarLibre(act, act.oficina.agentes.find((a) => a.id === 'sofia')!, { id: 'coord:abcd1234', nombre: 'Algo', consigna: 'Hacé algo' })
    expect(await esperar(() => s.entregas.lista(carpeta).length > 0, 15)).toBe(true)
    const id = s.entregas.lista(carpeta)[0]!.id
    // las rutas de entregas que no son del gobierno siguen andando
    expect((await llamar(b, 'GET', `/api/entregas/${id}`)).status).toBe(200)
    expect((await llamar(b, 'POST', `/api/entregas/${id}/revisada`, {})).status).toBe(200)
    expect((await llamar(b, 'POST', `/api/entregas/${id}/sin-revisar`, {})).status).toBe(200)
    expect((await llamar(b, 'GET', '/api/entregas', undefined, { estado: 'sin_revisar' })).status).toBe(200)
    // y las del gobierno las atiende el gobierno: una entrega sin acción da 404 propio, no el genérico de entregas
    const sin = await llamar(b, 'POST', `/api/entregas/${id}/ejecutar`, {})
    expect(sin.status, JSON.stringify(sin.obj)).toBe(404)
    expect(String(sin.obj.error)).toContain('acción')
    expect((await llamar(b, 'POST', `/api/entregas/${id}/descartar-accion`, {})).status).toBe(404)
    // el creador y el gobierno son routers «extra» y van antes que los de sección
    const extras = s.router.extras
    expect(extras.length).toBeGreaterThanOrEqual(2)
    expect(s.router.entregas).toBeDefined()
  }, 60_000)
})
