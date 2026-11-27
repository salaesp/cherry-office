// Skills de Claude Code en las corridas de los agentes. La herramienta Skill le muestra al modelo la lista de skills y
// plugins de la persona en cada llamada, y eso pesa (medido con el claude real: ~7 mil tokens con 40 skills). Modos:
// - `resumidas`: todas, con la descripción recortada (`skillListingMaxDescChars`): menos de la mitad y las sigue eligiendo
//   bien (probado pidiendo una presentación y una planilla).
// - `completas`: todas, tal cual (como era antes).
// - `agente`: solo las elegidas (ficha del agente u oficina, habilitados.ts); sin ninguna elegida, sin Skill.
// En todos los modos, si la oficina o el agente acotan la lista, las demás van con `skillOverrides: off`.
// - `ninguna`: sin la herramienta Skill.
// Las reglas `--disallowedTools Skill(x)` NO achican la lista (probado): por eso va con `--settings`.
import fs from 'node:fs'
import path from 'node:path'
import { esObjeto } from './json.js'

export type ModoSkills = 'resumidas' | 'completas' | 'agente' | 'ninguna'
export const modosSkills: ModoSkills[] = ['resumidas', 'completas', 'agente', 'ninguna']
export const esModoSkills = (v: unknown): v is ModoSkills => typeof v === 'string' && (modosSkills as string[]).includes(v)
/** Los booleanos de la primera versión de «Consumo de IA»: prendidas = completas, apagadas = ninguna. */
export function modoSkillsDe(v: unknown): ModoSkills | undefined {
  if (esModoSkills(v)) return v
  if (v === true) return 'completas'
  if (v === false) return 'ninguna'
  return undefined
}

/** Caracteres de la descripción de cada skill en modo `resumidas`. */
export const largoResumido = 150

/** Nombres que vio la última corrida en su `system/init` (skills instaladas, servidores MCP de Claude Code), guardados en
 *  un archivo de la carpeta de datos (`skills.json`, `mcp-locales.json`). Hacen falta para apagar lo que no está elegido
 *  (skillOverrides y las reglas de MCP van por nombre). */
export class CatalogoNombres {
  private nombres?: string[]
  constructor(private readonly archivo?: string, private readonly clave = 'skills') {
    if (!archivo) return
    try {
      const o: unknown = JSON.parse(fs.readFileSync(archivo, 'utf8'))
      const l = esObjeto(o) ? o[clave] : undefined
      if (Array.isArray(l) && l.every((x) => typeof x === 'string')) this.nombres = l as string[]
    } catch {}
  }
  get lista(): string[] | undefined { return this.nombres ? [...this.nombres] : undefined }
  fijar(l: string[]) {
    const n = [...new Set(l.filter((x) => typeof x === 'string' && x !== ''))].sort()
    if (this.nombres && n.length === this.nombres.length && n.every((x, i) => x === this.nombres![i])) return
    this.nombres = n
    if (!this.archivo) return
    try {
      fs.mkdirSync(path.dirname(this.archivo), { recursive: true })
      fs.writeFileSync(this.archivo, JSON.stringify({ [this.clave]: n }))
    } catch {}
  }
}

/** Skills instaladas (`skills.json`). */
export class CatalogoSkills extends CatalogoNombres {
  constructor(archivo?: string) { super(archivo, 'skills') }
}

/** `--settings` de una corrida, o undefined si no hace falta. `elegidas` = las que puede usar el agente (lo de la oficina
 *  y su ficha, habilitados.ts, más sus skills propias); undefined = todas. El llamador ya sacó la herramienta Skill si no
 *  queda ninguna (o con `agente` sin lista). Con lista y catálogo, las demás van `off`; en `resumidas`, además, la
 *  descripción recortada. `apagar`: las skills propias de otros agentes de la oficina, siempre `off` (no hace falta el
 *  catálogo: se sabe su nombre por la carpeta de la oficina). */
export function settingsSkills(modo: ModoSkills, elegidas: string[] | undefined, catalogo: string[] | undefined, apagar: string[] = []): Record<string, unknown> | undefined {
  const r: Record<string, unknown> = {}
  if (modo === 'resumidas') r.skillListingMaxDescChars = largoResumido
  const off: Record<string, string> = {}
  if (elegidas !== undefined) {
    // sin catálogo todavía (primera corrida): resumidas, y la próxima ya sabe cuáles apagar
    if (!catalogo) r.skillListingMaxDescChars = largoResumido
    else for (const s of catalogo) if (!elegidas.includes(s)) off[s] = 'off'
  }
  for (const s of apagar) if (!elegidas?.includes(s)) off[s] = 'off'
  if (Object.keys(off).length > 0) r.skillOverrides = off
  return Object.keys(r).length > 0 ? r : undefined
}
