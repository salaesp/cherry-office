// Actualizar la versión web desde la interfaz (actualizar-web.ts): ve los commits nuevos de la rama remota y corre
// `actualizar.sh` desacoplado, dejando la salida y el código en la carpeta de datos.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { crearActualizador } from '../../src/actualizar-web.js'

const tmps: string[] = []
afterEach(() => { for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** Un remoto pelado, un clon con `actualizar.sh` falso y un segundo clon para empujar commits nuevos. */
function armar(script = 'echo actualizado; exit 0') {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'act-web-'))
  tmps.push(raiz)
  const remoto = path.join(raiz, 'remoto.git'), repo = path.join(raiz, 'repo'), otro = path.join(raiz, 'otro')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remoto])
  git(raiz, 'clone', '-q', remoto, repo)
  git(repo, 'checkout', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'actualizar.sh'), script + '\n')
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'inicio'); git(repo, 'push', '-q', '-u', 'origin', 'main')
  git(raiz, 'clone', '-q', remoto, otro)
  const datos = path.join(raiz, 'datos')
  return { repo, otro, datos, env: { PATH: process.env.PATH, HOME: raiz } as NodeJS.ProcessEnv }
}
const pedir = (a: NonNullable<ReturnType<typeof crearActualizador>>, m: string) =>
  a.handle(m, '/api/actualizacion', {}).then((r) => ({ status: r!.status, json: JSON.parse(r!.json.toString()) }))

describe('actualizar la versión web', () => {
  test('sin clon git o apagado, no hay actualizador', () => {
    const { repo, datos, env } = armar()
    expect(crearActualizador({ repo: path.dirname(repo) + '/nada', datosDir: datos, env })).toBeUndefined()
    expect(crearActualizador({ repo, datosDir: datos, env: { ...env, HQ_SIN_ACTUALIZACIONES: '1' } })).toBeUndefined()
    expect(crearActualizador({ repo, datosDir: datos, env })).toBeDefined()
  })

  test('muestra los commits nuevos del remoto', async () => {
    const { repo, otro, datos, env } = armar()
    const a = crearActualizador({ repo, datosDir: datos, env })!
    let r = await pedir(a, 'GET')
    expect(r.status).toBe(200)
    expect(r.json.actual.rama).toBe('main')
    expect(r.json.nuevos).toEqual([])
    fs.writeFileSync(path.join(otro, 'x.txt'), 'x'); git(otro, 'add', '.'); git(otro, 'commit', '-qm', 'algo nuevo'); git(otro, 'push', '-q')
    r = await pedir(a, 'GET')
    expect(r.json.nuevos.map((c: { titulo: string }) => c.titulo)).toEqual(['algo nuevo'])
    expect(r.json.cambiosLocales).toBe(false)
    expect((await a.handle('PUT', '/api/actualizacion', {}))!.status).toBe(405)
    expect(await a.handle('GET', '/api/otra', {})).toBeNull()
  })

  test('corre actualizar.sh y deja la salida y el código', async () => {
    const { repo, datos, env } = armar('echo paso uno; echo se rompió >&2; exit 3')
    const a = crearActualizador({ repo, datosDir: datos, env })!
    expect((await pedir(a, 'POST')).status).toBe(202)
    let r = await pedir(a, 'GET')
    for (let i = 0; i < 50 && r.json.corriendo; i++) { await new Promise((ok) => setTimeout(ok, 100)); r = await pedir(a, 'GET') }
    expect(r.json.corriendo).toBe(false)
    expect(r.json.ultima.codigo).toBe(3)
    expect(r.json.ultima.ok).toBe(false)
    expect(r.json.ultima.salida).toContain('paso uno')
    expect(r.json.ultima.salida).toContain('se rompió')
  })
})
