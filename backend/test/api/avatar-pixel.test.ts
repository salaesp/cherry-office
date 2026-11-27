// Avatar de la oficina pixel: las claves `px*` guardan la apariencia pixel junto a las de LEGO de antes.
import { describe, expect, test } from 'vitest'
import { Fix, llamar } from '../support/sandbox.js'

const fix = () => Fix.crear({ deps: ['Dirección'], agentes: [{ id: 'marce', depto: 'direccion', rol: 'Directora' }], env: { HQ_PROGRAMADOR: '0' } })

describe('Avatar pixel', () => {
  test('el avatar guarda las claves pixel junto a las de LEGO', async () => {
    const f = await fix()
    const r = await llamar(f.b, 'PATCH', '/api/agentes/marce', { body: { avatar: { pelo: 'pelo-corto', pxPelo: 'bob', pxArriba: 'campera', pxAbajo: 'pollera', pxAccesorio: 'gorra', colorTorso: '#E2574C' } } })
    expect(r.status).toBe(200)
    const av = (await llamar(f.b, 'GET', '/api/agentes/marce')).obj.agente.avatar
    expect(av).toMatchObject({ pelo: 'pelo-corto', pxPelo: 'bob', pxArriba: 'campera', pxAbajo: 'pollera', pxAccesorio: 'gorra', colorTorso: '#e2574c' })
  })
})
