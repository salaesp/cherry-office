// Departamentos de la oficina: paleta, límites y crear / editar / borrar (Oficinas.swift, sección departamentos).
// Dónde está el resto: rutas HTTP en rutas-departamentos.ts (/api/departamentos, contrato en API.md#departamentos),
// pantalla en oficina/ui/departamentos.js, y el Creador (creador.ts) las usa al aplicar tarjetas de departamento.
// Son funciones sueltas sobre `Oficinas` (como agentes.ts); de oficinas.ts solo se importan tipos para no crear un ciclo.
import { ErrorAPI } from './errores.js'
import { ValidarAgenteExtra, type Departamento } from './oficina.js'
import type { Oficinas, OficinaActiva } from './oficinas.js'
import { Slug, Validar, largo } from './validar.js'

export type DepartamentoNuevo = { id?: string; nombre: string; color?: string; mision?: string }

const paleta = ['#ee6da6', '#a88bd6', '#f0a35b', '#e6c22e', '#4aa0dc', '#5fbf8a', '#d9684f', '#7f8fa6']
export const departamentosSugeridos = ['Dirección', 'Comunicación', 'Operaciones']
export const maxDepartamentos = 12

export function armarDepartamento(p: DepartamentoNuevo, indice: number, usados: Set<string>): Departamento {
  const n = p.nombre.trim()
  if (n === '' || largo(n) > 60) throw new ErrorAPI(400, 'El nombre del departamento es obligatorio (hasta 60 caracteres).')
  const color = p.color ?? paleta[indice % paleta.length]!
  if (!Validar.colorHex(color)) throw new ErrorAPI(400, 'El color tiene que ser tipo #a88bdc.')
  let id: string
  if (p.id !== undefined) {
    if (!Slug.valido(p.id)) throw new ErrorAPI(400, 'Id de departamento inválido (usá minúsculas, números y guiones).')
    if (usados.has(p.id)) throw new ErrorAPI(409, 'Ya hay un departamento con ese id.')
    id = p.id
  } else {
    id = Slug.unico(n, usados, 'depto')
  }
  const mision = p.mision?.trim()
  ValidarAgenteExtra.mision(mision)
  const d: Departamento = { id, nombre: n, color: color.toLowerCase() }
  if (mision) d.mision = mision
  return d
}

export function crearDepartamento(oficinas: Oficinas, p: DepartamentoNuevo): [Departamento, OficinaActiva] {
  return oficinas.modificar((o) => {
    if (o.departamentos.length >= maxDepartamentos) throw new ErrorAPI(400, `Máximo ${maxDepartamentos} departamentos.`)
    const d = armarDepartamento(p, o.departamentos.length, new Set(o.departamentos.map((x) => x.id)))
    o.departamentos.push(d)
    return d
  })
}

export function editarDepartamento(
  oficinas: Oficinas, id: string, cambios: { nombre?: string; color?: string; mision?: string },
): [Departamento, OficinaActiva] {
  return oficinas.modificar((o) => {
    const d = o.departamentos.find((x) => x.id === id)
    if (!d) throw new ErrorAPI(404, 'No existe ese departamento.')
    if (cambios.nombre !== undefined) {
      const n = cambios.nombre.trim()
      if (n === '' || largo(n) > 60) throw new ErrorAPI(400, 'El nombre del departamento es obligatorio (hasta 60 caracteres).')
      d.nombre = n
    }
    if (cambios.color !== undefined) {
      if (!Validar.colorHex(cambios.color)) throw new ErrorAPI(400, 'El color tiene que ser tipo #a88bdc.')
      d.color = cambios.color.toLowerCase()
    }
    if (cambios.mision !== undefined) {
      const m = cambios.mision.trim()
      ValidarAgenteExtra.mision(m)
      if (m === '') delete d.mision
      else d.mision = m
    }
    return { ...d }
  })
}

/** Borra el departamento. Con agentes adentro exige `moverA` (otro departamento existente). */
export function borrarDepartamento(oficinas: Oficinas, id: string, moverA?: string): OficinaActiva {
  return oficinas.modificar((o) => {
    if (!o.departamentos.some((x) => x.id === id)) throw new ErrorAPI(404, 'No existe ese departamento.')
    if (o.departamentos.length <= 1) throw new ErrorAPI(409, 'La oficina necesita al menos un departamento.')
    const adentro = o.agentes.filter((a) => a.departamento === id)
    if (adentro.length > 0) {
      if (!moverA) throw new ErrorAPI(409, `El departamento tiene ${adentro.length} agente(s). Elegí a qué departamento moverlos (moverA).`)
      if (moverA === id || !o.departamentos.some((x) => x.id === moverA)) {
        throw new ErrorAPI(400, 'El departamento de destino (moverA) no existe o es el mismo.')
      }
      for (const a of adentro) a.departamento = moverA
    }
    o.departamentos = o.departamentos.filter((x) => x.id !== id)
  })[1]
}
