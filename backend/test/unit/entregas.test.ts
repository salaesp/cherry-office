// Lógica pura de entregas (suite «Entregas: lógica pura» de EntregasTests.swift).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { ArchivosEntrega, TextoEntrega } from '../../src/entregas.js'

test('relativos: solo lo de adentro de la oficina, sin notas internas ni rutas con ..', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-entregas-'))
  try {
    const rels = ArchivosEntrega.relativos([
      path.join(carpeta, 'archivos', 'entregables', 'a.md'),
      'archivos/entregables/a.md',
      path.join(carpeta, 'archivos', 'entregables', 'b.md'),
      path.join(carpeta, '.claude', 'notas.md'),
      path.join(carpeta, 'conocimiento', 'agentes', 'marce.md'),
      path.join(os.tmpdir(), 'afuera.md'),
      path.join(carpeta, '..', 'otra', 'x.md'),
      path.join(carpeta, 'archivos', 'borrador.md'),
    ], carpeta)
    expect(rels).toEqual(['archivos/entregables/a.md', 'archivos/entregables/b.md', 'archivos/borrador.md'])
    expect(ArchivosEntrega.enEntregables(rels)).toEqual(['archivos/entregables/a.md', 'archivos/entregables/b.md'])
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true })
  }
})

test('el resumen saca las marcas de markdown: títulos con «:» y viñetas separadas con «·»', () => {
  expect(TextoEntrega.resumen('Gastaste **$ 10**.\n\n## Lo más grande\n- Súper: $ 6\n- Nafta: $ 4\n\n> Lo separo por tarjeta.'))
    .toBe('Gastaste $ 10. Lo más grande: Súper: $ 6 · Nafta: $ 4 Lo separo por tarjeta.')
  expect(TextoEntrega.resumen('Hecho.\n1. uno\n2) dos\n- [x] tres')).toBe('Hecho. uno · dos · tres')
})

test('resumen y título recortan y aplanan saltos de línea', () => {
  expect(TextoEntrega.resumen('uno\n\ndos\r\ntres  ')).toBe('uno dos tres')
  const largo = 'a'.repeat(400)
  const r = TextoEntrega.resumen(largo)
  expect([...r].length).toBe(280)
  expect(r.endsWith('…')).toBe(true)
  const t = TextoEntrega.titulo('x'.repeat(100))
  expect([...t].length).toBe(70)
  expect(t.endsWith('…')).toBe(true)
  expect(TextoEntrega.titulo('corto\notro')).toBe('corto otro')
})
