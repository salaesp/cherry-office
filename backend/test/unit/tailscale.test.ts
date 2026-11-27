// Tailscale para el acceso desde el celular: encontrar el comando, leer el estado y publicar el puerto (sin correr nada).
import { describe, expect, test } from 'vitest'
import { Tailscale, buscarComando, candidatos, interpretarStatus, linkHabilitar } from '../../src/tailscale.js'

describe('Tailscale', () => {
  test('busca el comando donde lo deja cada instalador', () => {
    expect(candidatos('darwin')[0]).toBe('/Applications/Tailscale.app/Contents/MacOS/Tailscale')
    expect(candidatos('win32', { ProgramFiles: 'D:\\Programas' })[0]).toBe('D:\\Programas\\Tailscale\\tailscale.exe')
    expect(buscarComando('linux', (f) => f === '/usr/local/bin/tailscale', {})).toBe('/usr/local/bin/tailscale')
    expect(buscarComando('linux', () => false, {})).toBeUndefined()
    expect(buscarComando('linux', () => false, { HQ_TAILSCALE_BIN: '/x/tailscale' })).toBe('/x/tailscale')
  })

  test('lee el estado y el nombre de la máquina', () => {
    const json = (o: unknown) => JSON.stringify(o)
    expect(interpretarStatus(json({ BackendState: 'Running', Self: { DNSName: 'Mi-Mac.tail1234.ts.net.' } })))
      .toEqual({ estado: 'listo', nombre: 'mi-mac.tail1234.ts.net' })
    expect(interpretarStatus(json({ BackendState: 'NeedsLogin', Self: { DNSName: '' } }))).toEqual({ estado: 'apagado' })
    expect(interpretarStatus(json({ BackendState: 'Stopped' }))).toEqual({ estado: 'apagado' })
    expect(interpretarStatus(json({ BackendState: 'Running', Self: { DNSName: '' } }))).toEqual({ estado: 'sin-nombre' })
    expect(interpretarStatus('no es json')).toEqual({ estado: 'apagado' })
  })

  test('encuentra el link para habilitar HTTPS', () => {
    const salida = 'Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=abc123\n'
    expect(linkHabilitar(salida)).toBe('https://login.tailscale.com/f/serve?node=abc123')
    expect(linkHabilitar('Available within your tailnet: https://mi-mac.ts.net/')).toBeUndefined()
  })

  test('publicar: ok, o el error con el link para habilitar', async () => {
    const llamadas: string[][] = []
    const ok = new Tailscale('ts', async (_b, args) => { llamadas.push(args); return { codigo: 0, salida: 'Available within your tailnet:\nhttps://mi-mac.ts.net/' } })
    expect(await ok.publicar(8765)).toEqual({ ok: true })
    expect(llamadas[0]).toEqual(['serve', '--bg', '8765'])
    const falta = new Tailscale('ts', async () => ({ codigo: 1, salida: 'Serve is not enabled on your tailnet.\nhttps://login.tailscale.com/f/serve?node=x' }))
    const r = await falta.publicar(8765)
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.habilitar).toBe('https://login.tailscale.com/f/serve?node=x')
    const estado = new Tailscale('ts', async () => ({ codigo: 1, salida: 'aviso\n{"BackendState":"Running","Self":{"DNSName":"a.b.ts.net."}}' }))
    expect(await estado.estado()).toEqual({ estado: 'listo', nombre: 'a.b.ts.net' })
  })
})
