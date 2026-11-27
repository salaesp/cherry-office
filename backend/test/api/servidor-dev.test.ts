// Port de app/Tests/BackendTests/ServidorDevTests.swift.
// Aquí el servidor es el de verdad (por HTTP): el router «Eco» de Swift no existe, así que las aserciones que leían
// el eco (método, ruta, query y cuerpo que recibió el router) quedan como `// interno` y se verifica solo lo que
// se ve desde afuera (qué guardias pasan o rechazan).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { Sandbox, escribir, leerTexto, raizRepo, type Backend } from '../support/sandbox.js'

/** Como Swift: ui = proyecto/oficina (index.html, ui/app.js, server.py), y una carpeta fuera de la lista blanca. */
async function servidor(): Promise<{ b: Backend; sb: Sandbox }> {
  const sb = new Sandbox()
  const ui = path.join(sb.proyecto, 'oficina')
  for (const d of [path.join(ui, 'ui'), path.join(sb.proyecto, 'secreto')]) fs.mkdirSync(d, { recursive: true })
  escribir('<html>', path.join(ui, 'index.html'))
  escribir('x()', path.join(ui, 'ui/app.js'))
  escribir('no', path.join(ui, 'server.py'))
  escribir('no', path.join(sb.proyecto, 'secreto/x.txt'))
  // HQ_UI_DIR: otra carpeta `oficina/` (ver app/Sources/Dev/main.swift)
  const b = await sb.backend({ oficina: false, env: { HQ_UI_DIR: ui } })
  return { b, sb }
}

/** Pedido con la ruta tal cual (sin el encodeURI de `b.pedir`: hace falta mandar `..` y `%2e` crudos). */
function crudo(b: Backend, metodo: string, ruta: string, headers: Record<string, string> = {}): Promise<{ status: number; texto: string; cabeceras: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: b.puerto, method: metodo, path: ruta, headers: { Host: `localhost:${b.puerto}`, ...headers }, agent: false },
      (res) => {
        const partes: Buffer[] = []
        res.on('data', (c) => partes.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, texto: Buffer.concat(partes).toString('utf8'), cabeceras: res.headers }))
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('Servidor de desarrollo (oficina-dev)', () => {
  test('estáticos: index, ui/, vendor/; nada fuera de la lista blanca ni con ..', async () => {
    const { b } = await servidor()
    const g = async (ruta: string) => { const r = await crudo(b, 'GET', ruta); return [r.status, r.texto] as const }
    expect(await g('/')).toEqual([200, '<html>'])
    expect(await g('/ui/app.js')).toEqual([200, 'x()'])
    // vendor/: Swift armaba su propia carpeta de vendor; aquí es la real del repo (oficina/vendor)
    const vendor = path.join(raizRepo, 'oficina/vendor/poppins.css')
    const v = await crudo(b, 'GET', '/vendor/poppins.css')
    expect(v.status).toBe(200)
    expect(v.texto).toBe(leerTexto(vendor))
    expect((await g('/server.py'))[0]).toBe(404)
    expect((await g('/ui/../server.py'))[0]).toBe(404)
    expect((await g('/ui/%2e%2e/%2e%2e/secreto/x.txt'))[0]).toBe(404)
    expect((await g('/ui'))[0]).toBe(404)
    expect((await crudo(b, 'POST', '/ui/app.js', { Origin: b.base })).status).toBe(405)
    expect(String((await crudo(b, 'GET', '/ui/app.js')).cabeceras['content-type'])).toContain('application/javascript')
  })

  test('Host de loopback obligatorio (contra DNS rebinding)', async () => {
    const { b } = await servidor()
    expect((await b.pedir('GET', '/', { headers: { Host: 'evil.com' } })).status).toBe(403)
    expect((await b.pedir('GET', '/api/estado', { headers: { Host: 'localhost:9999' } })).status).toBe(403)
    expect((await b.pedir('GET', '/', { headers: { Host: `127.0.0.1:${b.puerto}` } })).status).toBe(200)
  })

  test('API: GET pasa con query; escrituras exigen Origin propio y JSON', async () => {
    const { b } = await servidor()
    // pasan las guardias (el router real contesta algo distinto de 403/415: aquí 409, no hay oficina)
    const pasa = (st: number) => expect([403, 415]).not.toContain(st)
    const g = await b.pedir('GET', '/api/entregas', { query: { estado: 'sin_revisar', agente: 'mar ce' } })
    pasa(g.status)
    expect(g.status).toBe(409)
    // interno (unit test del port): el router recibe método GET, ruta "/api/entregas" y query {estado: "sin_revisar", agente: "mar ce"} (decodificada: %20 → espacio)
    // sin Origin: el cliente lo manda siempre, así que se arma el pedido a mano
    const sin = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: b.puerto, method: 'POST', path: '/api/chat', agent: false,
          headers: { Host: `localhost:${b.puerto}`, 'Content-Type': 'application/json', 'Content-Length': '2' } },
        (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)) },
      )
      req.on('error', reject)
      req.end('{}')
    })
    expect(sin).toBe(403)
    expect((await b.pedir('POST', '/api/chat', { body: '{}', headers: { Origin: 'http://evil.com' } })).status).toBe(403)
    expect((await b.pedir('POST', '/api/chat', { body: '{}', headers: { 'Content-Type': 'text/plain' } })).status).toBe(415)
    const ok = await b.pedir('POST', '/api/chat', { body: '{"a":1}' })
    pasa(ok.status)
    // interno (unit test del port): con el router Eco, POST /api/chat con cuerpo {"a":1} devuelve 200 y el cuerpo llega tal cual al router
    // DELETE sin cuerpo y sin Content-Type pasa las guardias
    const del = await b.pedir('DELETE', '/api/tareas/x', { headers: { 'Content-Type': '' } })
    pasa(del.status)
  })
})
