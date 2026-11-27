// HQ_HOSTS (ServidorDev.hostsExtra): entrar por otro nombre, p. ej. detrás de `tailscale serve` con https, sin aflojar la
// defensa por defecto (solo localhost como Host y como Origin de las escrituras).
import { describe, expect, test } from 'vitest'
import { ServidorDev } from '../../src/servidor-dev.js'

const router = { handle: async () => ({ status: 200, json: Buffer.from('{}') }) }
const srv = (hostsExtra?: string[]) => new ServidorDev({ router, raizUI: '/nada', raizVendor: '/nada', puerto: 8765, ...(hostsExtra ? { hostsExtra } : {}) })
const post = (s: ServidorDev, host: string, origin: string) =>
  s.manejar('POST', '/api/chat', { host, origin, 'content-type': 'application/json' }, Buffer.from('{}')).then((r) => r.status)
const get = (s: ServidorDev, host: string) => s.manejar('GET', '/api/estado', { host }, Buffer.alloc(0)).then((r) => r.status)

describe('HQ_HOSTS', () => {
  test('por defecto, solo localhost', async () => {
    const s = srv()
    expect(await get(s, 'localhost:8765')).toBe(200)
    expect(await get(s, 'alfred:8765')).toBe(403)
    expect(await post(s, 'localhost:8765', 'http://alfred:8765')).toBe(403)
  })

  test('un nombre sin puerto vale con y sin el puerto, como Host y como Origin por http y https', async () => {
    const s = srv(['Alfred.tu-red.ts.net', 'alfred'])
    for (const h of ['alfred.tu-red.ts.net', 'alfred.tu-red.ts.net:8765', 'alfred:8765', 'alfred']) expect(await get(s, h), h).toBe(200)
    expect(await post(s, 'alfred.tu-red.ts.net', 'https://alfred.tu-red.ts.net')).toBe(200)
    // tailscale serve reescribe el Host a localhost; el Origin sigue siendo el https
    expect(await post(s, 'localhost:8765', 'https://alfred.tu-red.ts.net')).toBe(200)
    expect(await post(s, 'alfred:8765', 'http://alfred:8765')).toBe(200)
    expect(await post(s, 'alfred:8765', 'https://otro.ts.net')).toBe(403)
    expect(await get(s, 'otro.ts.net')).toBe(403)
  })

  test('con puerto vale tal cual; lo que no es un nombre se ignora', async () => {
    const s = srv(['alfred:9000', 'mal nombre', 'http://x', ''])
    expect(await get(s, 'alfred:9000')).toBe(200)
    expect(await get(s, 'alfred')).toBe(403)
    expect(await get(s, 'mal nombre')).toBe(403)
  })
})
