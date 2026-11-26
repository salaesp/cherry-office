// Rutas de /api/departamentos (POST crea; PATCH edita; DELETE borra, con `moverA` si hay agentes). Contrato en
// backend/API.md#departamentos. La lógica está en departamentos.ts; la pantalla que las llama, en oficina/ui/departamentos.js.
// Es una RutaNucleo (no un SubRouter) para conservar los 409 sin oficina abierta, el 404 de id mal formado y el 405.
import { ErrorAPI } from './errores.js'
import { objeto, objetoOpcional, type Obj } from './json.js'
import { ValidarAgenteExtra, departamentoJSON, oficinaJSON } from './oficina.js'
import type { Oficinas } from './oficinas.js'
import { borrarDepartamento, crearDepartamento, editarDepartamento } from './departamentos.js'
import { no404, no405, type RutaNucleo } from './router.js'
import { Slug, Validar } from './validar.js'

/** `mision` en un PATCH: clave ausente = undefined (no se toca); null o texto vacío la borran (""). */
export function misionPatch(d: Obj): string | undefined {
  if (!('mision' in d)) return undefined
  const v = d.mision
  if (v === null) return ''
  if (typeof v !== 'string') throw new ErrorAPI(400, '«mision» tiene que ser texto.')
  return Validar.texto(v, 'mision', ValidarAgenteExtra.maxMision, false) ?? ''
}

export function rutasDepartamentos({ oficinas }: { oficinas: Oficinas }): RutaNucleo {
  return async ({ method, partes, query, body }) => {
    const [, seccion, a2] = partes
    const n = partes.length
    if (seccion === 'departamentos' && n === 2) {
      if (method !== 'POST') return no405
      const d = objeto(body)
      const [dep, a] = crearDepartamento(oficinas, {
        id: Validar.texto(d.id, 'id', 41, false), nombre: Validar.texto(d.nombre, 'nombre', 60)!,
        color: Validar.texto(d.color, 'color', 7, false), mision: Validar.texto(d.mision, 'mision', ValidarAgenteExtra.maxMision, false),
      })
      return [200, { departamento: departamentoJSON(dep), oficina: oficinaJSON(a.oficina) }]
    }
    if (seccion === 'departamentos' && n === 3) {
      const id = a2!
      if (!Slug.valido(id)) return no404
      if (method === 'PATCH') {
        const d = objeto(body)
        const [dep, a] = editarDepartamento(oficinas, id, {
          nombre: Validar.texto(d.nombre, 'nombre', 60, false), color: Validar.texto(d.color, 'color', 7, false), mision: misionPatch(d),
        })
        return [200, { departamento: departamentoJSON(dep), oficina: oficinaJSON(a.oficina) }]
      }
      if (method === 'DELETE') {
        const d = objetoOpcional(body)
        const mover = typeof d.moverA === 'string' ? d.moverA : query.moverA
        const a = borrarDepartamento(oficinas, id, mover)
        return [200, { ok: true, oficina: oficinaJSON(a.oficina) }]
      }
      return no405
    }
    return null
  }
}
