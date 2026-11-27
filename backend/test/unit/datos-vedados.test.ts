// La carpeta de datos de la app (hq.db, WhatsApp, memoria de la secretaría) no la puede leer ni escribir ningún agente:
// todas las corridas de claude con herramientas de archivos llevan reglas `--disallowedTools` con su ruta.
// Con el claude falso solo se ve que las reglas viajan; que Claude Code las aplique no se puede verificar acá.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test, onTestFinished } from 'vitest'
import { fijarAvisoDatos, vedadasDatos } from '../../src/datos-vedados.js'
import { argumentos, contexto, regla } from '../../src/permisos.js'
import { programadorDe } from '../../src/programador.js'
import { secretariaDe } from '../../src/secretaria.js'
import { whatsappDe } from '../../src/whatsapp.js'
import { EventEmitter } from 'node:events'
import { Sandbox, esperar } from '../support/sandbox.js'
import { arrancar, llamar, oficina } from '../support/en-proceso.js'

const reglasDe = (datos: string) => ['Read', 'Glob', 'Grep', 'Edit', 'Write'].map((h) => regla(h, datos + '/**'))
const vedadasEn = (args: string[]) => { const i = args.indexOf('--disallowedTools'); if (i < 0) return []; const out: string[] = []; for (const a of args.slice(i + 1)) { if (a.startsWith('--')) break; out.push(a) } return out }

describe('vedadasDatos', () => {
  test('veda Read, Glob, Grep, Edit y Write con la ruta absoluta de datos (y Bash que la nombre)', () => {
    const v = vedadasDatos('/home/ana/datos', ['/home/ana/Oficinas/o'])
    expect(v).toEqual([...reglasDe('/home/ana/datos'), 'Bash(*/home/ana/datos*)'])
    expect(v).toContain('Read(//home/ana/datos/**)')
    expect(vedadasDatos('/home/ana/datos', ['/home/ana/Oficinas/o'], false)).toEqual(reglasDe('/home/ana/datos'))
  })

  test('si la carpeta de datos contiene a la oficina no veda nada y avisa en el log (una sola vez)', () => {
    const avisos: string[] = []
    fijarAvisoDatos((m) => avisos.push(m))
    expect(vedadasDatos('/home/ana/datos', ['/home/ana/datos/oficinas/o'])).toEqual([])
    expect(vedadasDatos('/home/ana/datos', ['/home/ana/datos'])).toEqual([])
    expect(vedadasDatos('/home/ana/datos', ['/home/ana/datos/oficinas/o'])).toEqual([])
    expect(avisos.length).toBe(2)
    expect(avisos[0]).toMatch(/no se veda a los agentes/)
  })

  test('si la oficina contiene a la carpeta de datos, veda solo esa subcarpeta', () => {
    expect(vedadasDatos('/home/ana/o/datos', ['/home/ana/o'], false)).toEqual(reglasDe('/home/ana/o/datos'))
  })

  test('un prefijo parecido no cuenta como contenido', () => {
    expect(vedadasDatos('/home/ana/datos', ['/home/ana/datos-viejos/o'], false)).toEqual(reglasDe('/home/ana/datos'))
  })

  test('si la carpeta de datos es un enlace, veda también el destino real', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vedar-'))
    onTestFinished(() => fs.rmSync(d, { recursive: true, force: true }))
    fs.mkdirSync(path.join(d, 'real'))
    fs.symlinkSync(path.join(d, 'real'), path.join(d, 'enlace'))
    const v = vedadasDatos(path.join(d, 'enlace'), [], false)
    expect(v).toContain(regla('Read', path.join(d, 'enlace') + '/**'))
    expect(v).toContain(regla('Read', fs.realpathSync(path.join(d, 'real')) + '/**'))
  })
})

describe('las corridas llevan las reglas vedadas', () => {
  test('un chat, una tarea, una revisión de la secretaría, un turno de reunión y una consulta', async () => {
    const sb = new Sandbox()
    const b = arrancar(sb)
    onTestFinished(() => b.shutdown())
    const carpeta = await oficina(b, ['marce', 'sofia'])
    const datos = b.servicios.config.datosDir
    const esperadas = reglasDe(datos)
    const act = b.servicios.oficinas.activa()!

    // chat: los argumentos que arma permisos.ts
    const def = act.oficina.agentes.find((a) => a.id === 'marce')!
    const ctx = contexto(act, def, { config: b.servicios.config })
    const chat = argumentos(b.servicios.config, ctx, { agente: 'marce', mensaje: 'hola', sid: 's1', flag: '--session-id' })
    expect(vedadasEn(chat)).toEqual(expect.arrayContaining(esperadas))
    expect(chat.indexOf('--disallowedTools')).toBeLessThan(chat.indexOf('--'))

    // tarea (encargo): corre con los argumentos del programador
    expect((await llamar(b, 'POST', '/api/tareas', { agente: 'marce', nombre: 'Informe', consigna: 'Armá el informe', dias: [1, 2, 3, 4, 5, 6, 7], hora: '08:00', zona: 'America/Argentina/Buenos_Aires' })).status).toBe(200)
    expect((await llamar(b, 'POST', '/api/tareas/informe/correr', {})).status).toBe(202)
    expect(await esperar(() => sb.llamadasCrudas.some((a) => (a[a.length - 1] ?? '').includes('Armá el informe')), 15)).toBe(true)
    const tarea = sb.llamadasCrudas.find((a) => (a[a.length - 1] ?? '').includes('Armá el informe'))!
    expect(vedadasEn(tarea)).toEqual(expect.arrayContaining(esperadas))
    expect(programadorDe(b.servicios)).toBeDefined()

    // turno de reunión / consulta (solo lectura, sin carril)
    await b.servicios.runner.turnoSoloLectura({ agente: 'marce', prompt: 'TURNO_REUNION', cwd: carpeta })
    const turno = sb.llamadasCrudas.find((a) => (a[a.length - 1] ?? '') === 'TURNO_REUNION')!
    expect(vedadasEn(turno)).toEqual(expect.arrayContaining(esperadas))
    expect(vedadasEn(turno)).toContain('mcp__claude_ai_*')

    // corrida con Read para describir imágenes
    const { correrConLectura } = await import('../../src/biblioteca.js')
    await correrConLectura(b.servicios.runner, { prompt: 'IMAGEN', cwd: carpeta, dirs: [carpeta], timeout: 30 })
    const img = sb.llamadasCrudas.find((a) => (a[a.length - 1] ?? '') === 'IMAGEN')!
    expect(vedadasEn(img)).toEqual(expect.arrayContaining(esperadas))
  })

  test('la revisión de la secretaría', async () => {
    const sb = new Sandbox()
    const b = arrancar(sb)
    onTestFinished(() => b.shutdown())
    await oficina(b, ['marce', 'sofia'])
    class Captura extends EventEmitter { send() { return true } kill() { this.emit('exit', 1); return true } }
    const capturas: Captura[] = []
    b.servicios.huecos.whatsappHost = { lanzar: () => { const c = new Captura(); capturas.push(c); return c as never } }
    await llamar(b, 'POST', '/api/whatsapp/vincular', { aceptoRiesgo: true })
    const MAMA = '5491155551234@s.whatsapp.net'
    const c = capturas[0]!
    c.emit('message', { tipo: 'estado', estado: 'conectado', numero: '5491100000001@s.whatsapp.net' })
    c.emit('message', { tipo: 'chats', chats: [{ jid: MAMA, grupo: false, agenda: 'Mamá' }] })
    await llamar(b, 'PUT', '/api/whatsapp/chats/' + encodeURIComponent(MAMA), { elegido: true })
    await llamar(b, 'PUT', '/api/secretaria', { agente: 'sofia', fuentes: [{ id: 'whatsapp', cada: { valor: 1, unidad: 'horas' }, chats: [MAMA] }] })
    c.emit('message', { tipo: 'mensaje', m: { id: 'm1', chat: MAMA, de: MAMA, propio: false, ts: Math.floor(Date.now() / 1000) - 300, tipo: 'texto', texto: 'turno el jueves' } })
    const sec = secretariaDe(b.servicios)!
    const r = await sec.revisar()
    await esperar(() => sec.store.una(r!.id)?.estado !== 'corriendo')
    expect(whatsappDe(b.servicios)).toBeDefined()
    const ll = sb.llamadasCrudas[sb.llamadasCrudas.length - 1]!
    expect(vedadasEn(ll)).toEqual(expect.arrayContaining(reglasDe(b.servicios.config.datosDir)))
  })
})
