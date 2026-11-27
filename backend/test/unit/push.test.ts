// Avisos push al celular: cifrado (RFC 8291) descifrado del lado del teléfono, firma VAPID, qué se avisa y cuándo.
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { AvisosPush, ClavesVapid, cifrar, enSilencio, queAvisar } from '../../src/push.js'

const hkdf = (sal: Buffer, ikm: Buffer, info: Buffer, n: number) =>
  createHmac('sha256', createHmac('sha256', sal).update(ikm).digest()).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, n)

/** Lo que hace el navegador al recibir: descifrar con su clave privada y el secreto «auth». */
function descifrar(cuerpo: Buffer, ua: ReturnType<typeof createECDH>, auth: Buffer): string {
  const sal = cuerpo.subarray(0, 16), largo = cuerpo[20]!, asPub = cuerpo.subarray(21, 21 + largo), datos = cuerpo.subarray(21 + largo)
  const secreto = ua.computeSecret(asPub)
  const ikm = hkdf(auth, secreto, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32)
  const d = createDecipheriv('aes-128-gcm', hkdf(sal, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hkdf(sal, ikm, Buffer.from('Content-Encoding: nonce\0'), 12))
  d.setAuthTag(datos.subarray(datos.length - 16))
  const plano = Buffer.concat([d.update(datos.subarray(0, datos.length - 16)), d.final()])
  expect(plano[plano.length - 1]).toBe(2) // delimitador del último registro
  return plano.subarray(0, plano.length - 1).toString('utf8')
}

function telefono() {
  const ua = createECDH('prime256v1'); ua.generateKeys()
  const auth = randomBytes(16)
  return { ua, auth, sus: { endpoint: 'https://push.ejemplo.test/abc', p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } }
}

describe('push', () => {
  test('el teléfono descifra lo que se le manda', () => {
    const t = telefono()
    const cuerpo = cifrar(Buffer.from('{"titulo":"Hola ñandú"}'), t.sus)
    expect(cuerpo.readUInt32BE(16)).toBe(4096)
    expect(descifrar(cuerpo, t.ua, t.auth)).toBe('{"titulo":"Hola ñandú"}')
  })

  test('vector de prueba del RFC 8291 (sección 5 y apéndice A)', () => {
    const as = createECDH('prime256v1')
    as.setPrivateKey(Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'))
    const sus = { endpoint: 'https://push.ejemplo.test/x', p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' }
    const cuerpo = cifrar(Buffer.from('When I grow up, I want to be a watermelon'), sus, as, Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'))
    expect(cuerpo.toString('base64url')).toBe('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN')
  })

  test('VAPID: JWT ES256 firmado con la clave de la instalación, para el origen del endpoint', () => {
    const n = ClavesVapid.nuevas()
    const c = new ClavesVapid(n.d, n.publica)
    const h = c.autorizacion('https://web.push.apple.com/QGv/xyz', 'https://ejemplo.test', 1_700_000_000_000)
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!
    expect(m[4]).toBe(n.publica.toString('base64url'))
    const claims = JSON.parse(Buffer.from(m[2]!, 'base64url').toString())
    expect(claims).toEqual({ aud: 'https://web.push.apple.com', exp: 1_700_000_000 + 12 * 3600, sub: 'https://ejemplo.test' })
    const pub = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: n.publica.subarray(1, 33).toString('base64url'), y: n.publica.subarray(33).toString('base64url') } })
    expect(verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3]!, 'base64url'))).toBe(true)
  })

  test('qué se avisa: permisos, preguntas, flujos, entregas y respuestas; no las esperas entre agentes', () => {
    const nombre = (id: string) => ({ marce: 'Marce', nico: 'Nicolás' } as Record<string, string>)[id] ?? id
    const m = queAvisar({
      avisos: [{ id: 'a1', tipo: 'respuesta', agente: 'marce', texto: 'Listo' }, { id: 'espera:3', tipo: 'espera', agente: 'nico', texto: 'x' },
        { id: 'flujo:7', tipo: 'flujo', agente: '', texto: 'Alta de cliente' }],
      permisos: [{ id: 'p9', agente: 'nico', herramienta: 'Bash', detalle: 'curl x' }],
      teEsperan: 2, entregasSinRevisar: 0,
    }, nombre)
    const t = [...m.values()].map((x) => x.titulo)
    expect(t).toEqual(['Marce te respondió', 'Te toca en un flujo', 'Nicolás necesita tu permiso', 'Te esperan en la Bandeja'])
    expect(m.get('permiso:p9')).toMatchObject({ texto: 'Bash · curl x', permiso: 'p9', acciones: true })
    expect(m.get('aviso:a1:Listo')!.url).toBe('/?movil=1#/equipo/marce')
  })

  test('no molestar, cruzando la medianoche', () => {
    const a = (h: number, m = 0) => new Date(2026, 0, 1, h, m)
    const s = { desde: 23 * 60, hasta: 8 * 60 }
    expect(enSilencio(s, a(23, 30))).toBe(true)
    expect(enSilencio(s, a(3))).toBe(true)
    expect(enSilencio(s, a(8))).toBe(false)
    expect(enSilencio({ desde: 13 * 60, hasta: 14 * 60 }, a(13, 10))).toBe(true)
    expect(enSilencio(undefined, a(3))).toBe(false)
  })

  test('mira la actividad: la primera vez no avisa, después solo lo nuevo; un 410 borra la suscripción', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'))
    let act: object = { avisos: [{ id: 'a1', tipo: 'respuesta', agente: 'marce', texto: 'viejo' }], permisos: [] }
    const router = { handle: async () => ({ status: 200, json: Buffer.from(JSON.stringify(act)) }) }
    const enviados: { url: string; headers: Record<string, string>; body: Uint8Array }[] = []
    let estado = 201
    const push = new AvisosPush({ dir, router: () => router, nombre: (id) => id, cadaMs: 60_000,
      fetch: async (url, init) => { enviados.push({ url, headers: init.headers, body: init.body }); return { status: estado, text: async () => '' } } })
    const t = telefono()
    push.suscribir({ suscripcion: { endpoint: t.sus.endpoint, keys: { p256dh: t.sus.p256dh, auth: t.sus.auth } }, nombre: 'Celu de Ana' })
    push.parar() // sin temporizador: se mira a mano
    expect(await push.mirar()).toBe(0)
    expect(await push.mirar()).toBe(0)
    act = { avisos: [{ id: 'a1', tipo: 'respuesta', agente: 'marce', texto: 'viejo' }], permisos: [{ id: 'p1', agente: 'marce', descripcion: 'Mandar un mail' }] }
    expect(await push.mirar()).toBe(1)
    expect(enviados).toHaveLength(1)
    expect(enviados[0]!.headers['Content-Encoding']).toBe('aes128gcm')
    expect(enviados[0]!.headers.Authorization).toMatch(/^vapid t=/)
    expect(JSON.parse(descifrar(Buffer.from(enviados[0]!.body), t.ua, t.auth))).toMatchObject({ titulo: 'marce necesita tu permiso', texto: 'Mandar un mail', permiso: 'p1' })
    // las claves quedan guardadas: otra instancia usa la misma
    expect(new AvisosPush({ dir, router: () => router, nombre: (id) => id }).clavePublica()).toBe(push.clavePublica())
    expect(push.suscripciones()).toEqual([expect.objectContaining({ nombre: 'Celu de Ana' })])
    estado = 410
    act = { avisos: [], permisos: [], teEsperan: 1 }
    await push.mirar()
    expect(push.suscripciones()).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('valida la suscripción', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'))
    const push = new AvisosPush({ dir, router: () => ({ handle: async () => ({ status: 500, json: Buffer.from('{}') }) }), nombre: (id) => id })
    expect(() => push.suscribir({})).toThrow(/endpoint/)
    expect(() => push.suscribir({ suscripcion: { endpoint: 'http://x.test/a', keys: {} } })).toThrow(/https/)
    expect(() => push.suscribir({ suscripcion: { endpoint: 'https://x.test/a', keys: { p256dh: 'corta', auth: 'x' } } })).toThrow(/claves/)
    push.parar()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
