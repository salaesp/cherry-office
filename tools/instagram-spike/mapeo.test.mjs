import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { clasificar, limpiarCuenta, mapearPerfil, resumir } from './mapeo.mjs'

const crudo = fs.readFileSync(new URL('./fixtures/perfil.json', import.meta.url), 'utf8')

test('limpiarCuenta acepta nombre, @nombre y URL', () => {
  assert.equal(limpiarCuenta('@Cafeteria.Ejemplo'), 'cafeteria.ejemplo')
  assert.equal(limpiarCuenta('https://www.instagram.com/cafeteria_ejemplo/?hl=es'), 'cafeteria_ejemplo')
  assert.equal(limpiarCuenta('no vale con espacios'), undefined)
  assert.equal(limpiarCuenta(''), undefined)
})

test('clasificar distingue cada caso', () => {
  assert.equal(clasificar({ status: 200, cuerpo: crudo }), 'ok')
  assert.equal(clasificar({ status: 200, cuerpo: JSON.stringify({ data: { user: { is_private: true } } }) }), 'privada')
  assert.equal(clasificar({ status: 200, cuerpo: JSON.stringify({ data: { user: null } }) }), 'no_existe')
  assert.equal(clasificar({ status: 404, cuerpo: '' }), 'no_existe')
  assert.equal(clasificar({ status: 429, cuerpo: '' }), 'bloqueo')
  assert.equal(clasificar({ status: 400, cuerpo: '{"message":"Please wait a few minutes before you try again.","status":"fail"}' }), 'bloqueo')
  assert.equal(clasificar({ status: 401, cuerpo: '{"message":"","require_login":true}' }), 'login')
  assert.equal(clasificar({ status: 302, location: 'https://www.instagram.com/accounts/login/', cuerpo: '' }), 'login')
  assert.equal(clasificar({ status: 200, cuerpo: '<html>' }), 'raro')
})

test('mapearPerfil saca tipos, métricas y hashtags', () => {
  const p = mapearPerfil(JSON.parse(crudo))
  assert.equal(p.cuenta, 'cafeteria.ejemplo')
  assert.equal(p.seguidores, 10000)
  assert.equal(p.profesional, true)
  assert.equal(p.hayMas, true)
  const [reel, carrusel, foto] = p.publicaciones
  assert.equal(reel.tipo, 'reel')
  assert.equal(reel.reproducciones, 50000)
  assert.deepEqual(reel.hashtags, ['#cafe', '#latteart'])
  assert.deepEqual(reel.menciones, ['@barista.uno'])
  assert.equal(reel.url, 'https://www.instagram.com/p/AAA/')
  assert.equal(carrusel.tipo, 'carrusel')
  assert.equal(carrusel.piezas, 3)
  assert.equal(foto.tipo, 'foto')
  assert.equal(foto.likes, null, 'likes ocultos (-1) quedan en null')
  assert.equal(foto.fijada, true)
  assert.equal(foto.texto, '')
})

test('resumir: interacción por tipo, frecuencia sin fijadas, hashtags sin distinguir mayúsculas', () => {
  const r = resumir(mapearPerfil(JSON.parse(crudo)))
  assert.equal(r.tipos.reel.interaccionPct, 10)
  assert.equal(r.tipos.carrusel.interaccionPct, 3)
  assert.equal(r.porSemana, 1) // 2 no fijadas separadas 7 días
  assert.deepEqual(r.hashtags[0], { h: '#cafe', n: 2 })
  assert.equal(r.mejor.url, 'https://www.instagram.com/p/AAA/')
})

test('leerPagina saca la descripción y cuenta publicaciones embebidas', async () => {
  const { leerPagina } = await import('./variantes.mjs')
  const html = '<meta property="og:description" content="283M seguidores, 160 seguidos, 30K publicaciones - Ver fotos y videos de National Geographic (&#064;natgeo)" />'
    + '<script>{"code":"DAbcdEFgh12","x":1}{"shortcode":"CXyz_123-ab"}{"code":"DAbcdEFgh12"}</script>'
  const p = leerPagina(html)
  assert.match(p.descripcion, /283M seguidores.*\(@natgeo\)/)
  assert.equal(p.publicacionesEnLaPagina, 2)
  assert.equal(p.pideLogin, false)
  assert.equal(leerPagina('<a href="/accounts/login/">Entrar</a>').pideLogin, true)
})
