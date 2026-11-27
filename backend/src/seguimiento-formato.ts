// Formato de los temas en seguimiento y las fichas (personas y cosas): `.md` con título, campos `Clave: valor` y secciones
// `## …`. Lo comparten la memoria privada de la secretaría (secretaria-memoria.ts) y el seguimiento de cada agente
// (seguimiento.ts). Funciones puras, sin disco ni `Servicios`. El formato está en backend/API.md.
import { sanear } from './consultas.js'
import { diaLocal } from './memoria-estructura.js'
import { largo, plegar, prefijo } from './validar.js'

export const estados = ['abierto', 'esperando', 'resuelto', 'descartado'] as const
export type Estado = (typeof estados)[number]
export const tiposFicha = ['persona', 'cosa'] as const
export type TipoFicha = (typeof tiposFicha)[number]
export const abiertos: Estado[] = ['abierto', 'esperando']

export const pad = (n: number) => String(n).padStart(2, '0')
export const unaLinea = (t: string) => sanear(t).replace(/\s+/g, ' ').trim()
const dia = 86400000

// MARK: - fechas (días como `AAAA-MM-DD`, semanas ISO como `AAAA-Www`)

export const reDia = /^\d{4}-\d{2}-\d{2}$/
const reSemana = /^\d{4}-W\d{2}$/
const aUTC = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y!, m! - 1, dd!) }
const deUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const diaValido = (d: string) => reDia.test(d) && deUTC(aUTC(d)) === d
export const diasEntre = (a: string, b: string) => Math.round((aUTC(b) - aUTC(a)) / dia)
export const sumarDias = (d: string, n: number) => deUTC(aUTC(d) + n * dia)

/** Semana ISO (lunes a domingo) del día: `2026-W48`. */
export function semanaDe(d: string): string {
  const t = aUTC(d)
  const dow = (new Date(t).getUTCDay() + 6) % 7
  const jueves = t + (3 - dow) * dia
  const y = new Date(jueves).getUTCFullYear()
  const n = Math.floor((jueves - Date.UTC(y, 0, 1)) / dia / 7) + 1
  return `${y}-W${pad(n)}`
}

/** Lunes y domingo de una semana ISO. */
export function rangoSemana(sem: string): { desde: string; hasta: string } {
  const y = Number(sem.slice(0, 4)), w = Number(sem.slice(6))
  const ene4 = Date.UTC(y, 0, 4)
  const lunes1 = ene4 - ((new Date(ene4).getUTCDay() + 6) % 7) * dia
  const lunes = lunes1 + (w - 1) * 7 * dia
  return { desde: deUTC(lunes), hasta: deUTC(lunes + 6 * dia) }
}
export const semanaValida = (s: string) => reSemana.test(s) && Number(s.slice(6)) >= 1 && Number(s.slice(6)) <= 53 && semanaDe(rangoSemana(s).desde) === s

const reFecha = /^(\d{4}-\d{2}-\d{2})( \d{2}:\d{2})?$/
export function fechaValida(f: string): boolean {
  const m = reFecha.exec(f)
  if (!m || !diaValido(m[1]!)) return false
  if (m[2]) { const [h, mi] = m[2].trim().split(':').map(Number); if (h! > 23 || mi! > 59) return false }
  return true
}

// MARK: - documentos .md (título, campos `Clave: valor`, secciones `## …`)

export type Seccion = { nombre: string; lineas: string[] }
export type Doc = { titulo: string; campos: Record<string, string>; secciones: Seccion[] }
export const clave = (k: string) => plegar(k).trim()

export function parsearDoc(texto: string, claves: string[]): Doc {
  const ls = texto.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  while (i < ls.length && ls[i]!.trim() === '') i++
  let titulo = ''
  if (i < ls.length && /^#\s+/.test(ls[i]!)) titulo = ls[i++]!.replace(/^#\s+/, '').trim()
  const campos: Record<string, string> = {}
  let j = i
  while (j < ls.length && ls[j]!.trim() === '') j++
  let hubo = false
  while (j < ls.length) {
    const m = /^([^:\n]{1,20}):[ \t]*(.*)$/.exec(ls[j]!)
    const k = m ? clave(m[1]!) : ''
    if (!m || !claves.includes(k)) break
    campos[k] = m[2]!.trim(); hubo = true; j++
  }
  if (hubo) i = j
  const secciones: Seccion[] = []
  let actual: Seccion = { nombre: '', lineas: [] }
  for (; i < ls.length; i++) {
    const m = /^##\s+(.*)$/.exec(ls[i]!)
    if (m) { secciones.push(actual); actual = { nombre: m[1]!.trim(), lineas: [] }; continue }
    actual.lineas.push(ls[i]!)
  }
  secciones.push(actual)
  const limpias = secciones.map((s) => {
    const l = [...s.lineas]
    while (l.length && l[0]!.trim() === '') l.shift()
    while (l.length && l[l.length - 1]!.trim() === '') l.pop()
    return { nombre: s.nombre, lineas: l }
  }).filter((s) => s.nombre !== '' || s.lineas.length > 0)
  return { titulo, campos, secciones: limpias }
}

export function armarDoc(d: Doc, orden: [string, string][]): string {
  const cab = [`# ${d.titulo}`]
  for (const [k, etiqueta] of orden) { const v = d.campos[k]; if (v !== undefined && v !== '') cab.push(`${etiqueta}: ${v}`) }
  const partes = [cab.join('\n')]
  for (const s of d.secciones) {
    if (s.nombre === '') { if (s.lineas.length) partes.push(s.lineas.join('\n')); continue }
    partes.push(`## ${s.nombre}${s.lineas.length ? '\n' + s.lineas.join('\n') : ''}`)
  }
  return partes.join('\n\n') + '\n'
}

export function seccion(d: Doc, nombre: string, crear = false): Seccion | undefined {
  let s = d.secciones.find((x) => clave(x.nombre) === clave(nombre))
  if (!s && crear) { s = { nombre, lineas: [] }; d.secciones.push(s) }
  return s
}

/** Una línea de historial, de ficha o de diario: `- <fecha u hora> · [origen] texto`. Lo que la persona escriba a mano en
 *  otro formato se conserva tal cual (`crudo`). */
export type Entrada = { cuando: string; origen: string; texto: string; crudo?: string }
const reEntrada = /^- (\d{4}-\d{2}-\d{2}|\d{2}:\d{2}) · (?:\[([^\]\n]*)\] )?(.*)$/
export function entradasDe(s: Seccion | undefined): Entrada[] {
  const out: Entrada[] = []
  for (const l of s?.lineas ?? []) {
    if (l.trim() === '') continue
    const m = reEntrada.exec(l)
    out.push(m ? { cuando: m[1]!, origen: m[2] ?? '', texto: m[3]!.trim() } : { cuando: '', origen: '', texto: l.replace(/^-\s*/, '').trim(), crudo: l })
  }
  return out
}
export const lineaEntrada = (e: Entrada) => e.crudo ?? `- ${e.cuando} · ${e.origen ? `[${e.origen}] ` : ''}${e.texto}`

// MARK: - modelos

const clavesTema = ['estado', 'fecha', 'proximo', 'personas', 'actualizado']
const ordenTema: [string, string][] = [['estado', 'Estado'], ['fecha', 'Fecha'], ['proximo', 'Próximo'], ['personas', 'Personas'], ['actualizado', 'Actualizado']]
const clavesFicha = ['tipo', 'actualizado']
const ordenFicha: [string, string][] = [['tipo', 'Tipo'], ['actualizado', 'Actualizado']]

export type Tema = { titulo: string; estado: Estado; fecha: string; proximo: string; personas: string[]; actualizado: string; historial: Entrada[]; doc: Doc; estadoValido: boolean }
export type Ficha = { titulo: string; tipo: TipoFicha; actualizado: string; datos: Entrada[]; doc: Doc; tipoValido: boolean }

export const estadoDe = (v: string | undefined): Estado | undefined => estados.find((e) => e === clave(v ?? ''))

export function parsearTema(texto: string, respaldoTitulo = '', mtimeMs = Date.now()): Tema {
  const doc = parsearDoc(texto, clavesTema)
  const historial = entradasDe(seccion(doc, 'Historial'))
  let ultimo = doc.campos.actualizado && reDia.test(doc.campos.actualizado) ? doc.campos.actualizado : ''
  for (const e of historial) if (reDia.test(e.cuando) && e.cuando > ultimo) ultimo = e.cuando
  const estado = estadoDe(doc.campos.estado)
  return {
    titulo: doc.titulo || respaldoTitulo,
    estado: estado ?? 'abierto',
    estadoValido: doc.campos.estado === undefined || estado !== undefined,
    fecha: doc.campos.fecha ?? '',
    proximo: doc.campos.proximo ?? '',
    personas: (doc.campos.personas ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    actualizado: ultimo || diaLocal(new Date(mtimeMs)),
    historial, doc,
  }
}

export function armarTema(t: Tema): string {
  const d = t.doc
  d.titulo = t.titulo
  d.campos.estado = t.estado
  d.campos.fecha = t.fecha
  d.campos.proximo = t.proximo
  d.campos.personas = t.personas.join(', ')
  d.campos.actualizado = t.actualizado
  seccion(d, 'Historial', true)!.lineas = t.historial.map(lineaEntrada)
  return armarDoc(d, ordenTema)
}

export function parsearFicha(texto: string, respaldoTitulo = '', mtimeMs = Date.now()): Ficha {
  const doc = parsearDoc(texto, clavesFicha)
  const datos = entradasDe(seccion(doc, 'Datos'))
  let ultimo = doc.campos.actualizado && reDia.test(doc.campos.actualizado) ? doc.campos.actualizado : ''
  for (const e of datos) if (reDia.test(e.cuando) && e.cuando > ultimo) ultimo = e.cuando
  const tipo = tiposFicha.find((x) => x === clave(doc.campos.tipo ?? ''))
  return { titulo: doc.titulo || respaldoTitulo, tipo: tipo ?? 'persona', tipoValido: doc.campos.tipo === undefined || tipo !== undefined, actualizado: ultimo || diaLocal(new Date(mtimeMs)), datos, doc }
}

export function armarFicha(f: Ficha): string {
  const d = f.doc
  d.titulo = f.titulo
  d.campos.tipo = f.tipo
  d.campos.actualizado = f.actualizado
  seccion(d, 'Datos', true)!.lineas = f.datos.map(lineaEntrada)
  return armarDoc(d, ordenFicha)
}

// MARK: - crear y actualizar (validan y devuelven el documento nuevo; quien llama escribe)

/** Topes de lo que se escribe en un tema o una ficha. */
export type TopesFormato = { maxTitulo: number; maxHecho: number; maxProximo: number; maxPersona: number; maxPersonas: number; maxOrigen: number; maxHistorial: number; maxDatosFicha: number }
/** Arma el error con mensaje para quien escribió (cada memoria usa su clase). */
export type Falla = (mensaje: string) => Error

export const temaVacio = (titulo: string, hoy: string): Tema => ({ titulo, estado: 'abierto', estadoValido: true, fecha: '', proximo: '', personas: [], actualizado: hoy, historial: [], doc: { titulo, campos: {}, secciones: [] } })
export const fichaVacia = (titulo: string, tipo: TipoFicha, hoy: string): Ficha => ({ titulo, tipo, tipoValido: true, actualizado: hoy, datos: [], doc: { titulo, campos: {}, secciones: [] } })

export function tituloValido(v: unknown, campo: string, T: TopesFormato, falla: Falla): string {
  const t = unaLinea(typeof v === 'string' ? v : '').replace(/^#+\s*/, '')
  if (t === '') throw falla(`Falta «${campo}».`)
  if (largo(t) > T.maxTitulo) throw falla(`«${campo}» es demasiado largo (hasta ${T.maxTitulo} caracteres): usá pocas palabras.`)
  return t
}
export function hechoValido(v: unknown, campo: string, T: TopesFormato, falla: Falla): string {
  const t = unaLinea(typeof v === 'string' ? v : '')
  if (t === '') throw falla(`Falta «${campo}».`)
  if (largo(t) > T.maxHecho) throw falla(`«${campo}» es demasiado largo (hasta ${T.maxHecho} caracteres): resumilo en una o dos oraciones.`)
  return t
}
export function origenValido(v: unknown, T: TopesFormato): string {
  return prefijo(unaLinea(typeof v === 'string' ? v : '').replace(/[[\]]/g, ''), T.maxOrigen)
}
export function personasValidas(v: unknown, T: TopesFormato): string[] {
  const lista = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  const out: string[] = []
  for (const x of lista) {
    const t = unaLinea(typeof x === 'string' ? x : '').replace(/,/g, ' ')
    if (t !== '' && !out.includes(t)) out.push(prefijo(t, T.maxPersona))
  }
  return out
}

export type CambioTema = { estado?: string; fecha?: string; proximo?: string; nota?: string; personas?: string[]; origen?: string }

/** Aplica un cambio a un tema (`nuevo`: recién creado). La nota va al historial con fecha y origen; un cambio de estado
 *  sin nota deja su rastro. Falla si no hay nada para actualizar. */
export function actualizarTema(t: Tema, nuevo: boolean, p: CambioTema, hoy: string, T: TopesFormato, falla: Falla): Tema {
  let cambio = nuevo
  const estadoAntes = t.estado
  if (p.estado !== undefined) {
    const e = estadoDe(p.estado)
    if (!e) throw falla(`El estado es uno de: ${estados.join(', ')}.`)
    if (e !== t.estado) { t.estado = e; cambio = true }
  }
  if (p.fecha !== undefined) {
    const f = unaLinea(p.fecha)
    if (f !== '' && !fechaValida(f)) throw falla('La fecha va como AAAA-MM-DD o AAAA-MM-DD HH:MM (vacía para sacarla).')
    if (f !== t.fecha) { t.fecha = f; cambio = true }
  }
  let proximoEntero = ''
  if (p.proximo !== undefined) {
    let x = unaLinea(p.proximo)
    // Un próximo paso largo no tira el cambio entero: se recorta (en un espacio, con «…») y, si no vino nota, el texto
    // completo queda en el historial para no perder nada.
    if (largo(x) > T.maxProximo) {
      proximoEntero = x
      const corte = prefijo(x, T.maxProximo - 1)
      const esp = corte.lastIndexOf(' ')
      x = (esp > T.maxProximo / 2 ? corte.slice(0, esp) : corte).trimEnd() + '…'
    }
    if (x !== t.proximo) { t.proximo = x; cambio = true }
  }
  if (proximoEntero !== '' && (p.nota === undefined || unaLinea(p.nota) === '')) {
    p = { ...p, nota: prefijo(`Próximo paso: ${proximoEntero}`, T.maxHecho) }
  }
  if (p.personas !== undefined) {
    const lista = personasValidas(p.personas, T)
    const nuevas = lista.filter((x) => !t.personas.some((y) => plegar(y) === plegar(x)))
    if (nuevas.length) {
      if (t.personas.length + nuevas.length > T.maxPersonas) throw falla(`Un tema puede tener hasta ${T.maxPersonas} personas.`)
      t.personas.push(...nuevas); cambio = true
    }
  }
  const nota = p.nota === undefined ? '' : hechoValido(p.nota, 'nota', T, falla)
  if (nota !== '' || (t.estado !== estadoAntes && !nuevo)) {
    const cierre = t.estado !== estadoAntes && !nuevo && nota !== '' ? ` (pasó a «${t.estado}»)` : ''
    t.historial.push({ cuando: hoy, origen: origenValido(p.origen, T), texto: nota !== '' ? nota + cierre : `Pasó a «${t.estado}».` })
    if (t.historial.length > T.maxHistorial) t.historial.splice(0, t.historial.length - T.maxHistorial)
    cambio = true
  }
  if (!cambio) throw falla('No hay nada para actualizar en ese tema: mandá un estado, una fecha, un próximo paso, personas o una nota.')
  t.actualizado = hoy
  return t
}

/** Agrega un dato a una ficha, o reemplaza el dato viejo que contiene `reemplaza`. Un dato repetido no se duplica.
 *  `leer`: la herramienta para mirar la ficha (va en el mensaje de error). */
export function actualizarFicha(f: Ficha, p: { hecho: string; origen?: string; reemplaza?: string }, hoy: string, T: TopesFormato, falla: Falla, leer: string): Ficha {
  const origen = origenValido(p.origen, T)
  if (p.reemplaza !== undefined && unaLinea(p.reemplaza) !== '') {
    const q = plegar(unaLinea(p.reemplaza))
    const i = f.datos.findIndex((d) => plegar(d.texto).includes(q))
    if (i < 0) throw falla(`No encontré ese dato en la ficha para reemplazarlo: mirá la ficha con ${leer}.`)
    f.datos[i] = { cuando: hoy, origen, texto: p.hecho }
  } else if (!f.datos.some((d) => plegar(d.texto) === plegar(p.hecho))) {
    if (f.datos.length >= T.maxDatosFicha) throw falla(`La ficha ya tiene ${T.maxDatosFicha} datos: reemplazá uno (con «reemplaza») o juntá varios en uno.`)
    f.datos.push({ cuando: hoy, origen, texto: p.hecho })
  }
  f.actualizado = hoy
  return f
}
