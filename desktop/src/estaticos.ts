// Estáticos de la oficina para el esquema hq:// (como HQSchemeHandler.swift + la lista blanca de ServidorDev).
// Empaquetada: <resources>/oficina (con vendor/ adentro). Sin empaquetar: oficina/ (con vendor/) del repo.
import fs from 'node:fs'
import path from 'node:path'
import { mime } from '../../backend/src/servidor-dev.js'

// manifest.webmanifest, sw.js e iconos/: la oficina instalable en el celular (docs/plan-celular.md)
const estaticos = new Set(['index.html', 'logo-prospera.svg', 'manifest.webmanifest', 'sw.js'])

export type Raices = { ui: string; vendor: string }

export function raices(empaquetada: boolean, resources: string, repo: string): Raices {
  if (empaquetada) return { ui: path.join(resources, 'oficina'), vendor: path.join(resources, 'oficina', 'vendor') }
  return { ui: path.join(repo, 'oficina'), vendor: path.join(repo, 'oficina', 'vendor') }
}

/** Archivo a servir para una ruta (ya decodificada), solo de la lista blanca. undefined = 404. */
export function archivo(r: Raices, ruta: string): string | undefined {
  let rel = ruta === '/' ? 'index.html' : ruta.slice(1)
  if (!ruta.startsWith('/') || rel.includes('\0') || rel.includes('\\') || rel.split('/').includes('..')) return undefined
  let base: string
  if (estaticos.has(rel) || rel.startsWith('ui/') || rel.startsWith('iconos/')) base = r.ui
  else if (rel.startsWith('vendor/')) {
    base = r.vendor
    rel = rel.slice('vendor/'.length)
  } else return undefined
  try {
    const f = fs.realpathSync.native(path.join(base, rel))
    const b = fs.realpathSync.native(base)
    if (!f.startsWith(b + path.sep) || !fs.statSync(f).isFile()) return undefined
    return f
  } catch {
    return undefined
  }
}

export { mime }
