import { describe, expect, test } from 'vitest'
import { CajaVivo, parsearEvento } from '../../src/stream.js'

const toolUse = (name: string, input: Record<string, unknown>) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })

describe('detalle de herramientas en el chat', () => {
  test('Bash: la descripción es el objetivo y el comando va en detalle', () => {
    const [e] = parsearEvento(toolUse('Bash', { command: 'ls -la archivos/ventas', description: 'Lista los archivos de ventas' }))
    expect(e).toEqual({ tipo: 'herramienta', nombre: 'Bash', objetivo: 'Lista los archivos de ventas', detalle: 'ls -la archivos/ventas' })
  })

  test('Grep: patrón y carpeta; WebFetch: URL completa', () => {
    const [g] = parsearEvento(toolUse('Grep', { pattern: 'TODO', path: 'src' }))
    expect(g).toMatchObject({ detalle: 'TODO  en  src' })
    const [w] = parsearEvento(toolUse('WebFetch', { url: 'https://example.com/a/b?c=1' }))
    expect(w).toMatchObject({ objetivo: 'example.com', detalle: 'https://example.com/a/b?c=1' })
  })

  test('Skill: el objetivo es el nombre de la skill (el chat dice «Usó la skill resumen-de-mails»)', () => {
    const [e] = parsearEvento(toolUse('Skill', { skill: 'resumen-de-mails' }))
    expect(e).toMatchObject({ tipo: 'herramienta', nombre: 'Skill', objetivo: 'resumen-de-mails' })
  })

  test('Read no lleva detalle; un comando larguísimo se recorta', () => {
    const [r] = parsearEvento(toolUse('Read', { file_path: '/x/oficina.md' }))
    expect(r).not.toHaveProperty('detalle')
    const [b] = parsearEvento(toolUse('Bash', { command: 'x'.repeat(2000) }))
    expect(b !== undefined && b.tipo === 'herramienta' ? b.detalle?.length : 0).toBe(600)
  })

  test('CajaVivo guarda el detalle en el paso', () => {
    const caja = new CajaVivo()
    const obs = caja.observador()
    for (const e of parsearEvento(toolUse('Bash', { command: 'git status' }))) obs(e)
    expect(caja.valor).toEqual([{ t: 'herramienta', nombre: 'Bash', detalle: 'git status' }])
  })
})
