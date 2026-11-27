// Citas de WhatsApp en la charla (docs/plan-recados.md, «Datos de WhatsApp y de su memoria»):
// - Al leer WhatsApp, cada mensaje trae su referencia `[wa:N]`. Si el agente la escribe en su respuesta, antes de guardarla
//   se cambia por el mensaje real (quién, cuándo y el texto como está guardado): lo citado no es la versión del agente.
//   Una referencia que no existe, o de un chat que ese agente no puede leer, queda como «(mensaje no encontrado)».
// - `delegar` y `arrancar_flujo` reciben `citas` (los N): al colega o al flujo le llega solo ese fragmento, delimitado como
//   dato, y la tarjeta muestra con un candado exactamente qué se compartió. Los demás agentes no leen WhatsApp.
import { delegacionesDe } from './delegar.js'
import type { Obj } from './json.js'
import type { AgenteDef, Oficina } from './oficina.js'
import { registrarModulo, type Servicios } from './servicios.js'
import { prefijo } from './validar.js'
import { avisoTerceros, textoCita, whatsappDeAgente, type CitaWA } from './whatsapp.js'

export const refCita = /\[wa:(\d{1,12})\]/g
export const maxTextoCita = 500

/** Cambia cada `[wa:N]` por el mensaje real (o «(mensaje no encontrado)»). */
export function reemplazarCitas(texto: string, buscar: (refs: number[]) => CitaWA[]): string {
  const refs = [...new Set([...texto.matchAll(refCita)].map((m) => Number(m[1])))]
  if (refs.length === 0) return texto
  const porRef = new Map(buscar(refs.slice(0, 50)).map((c) => [c.ref, c]))
  return texto.replace(refCita, (_m, n: string) => { const c = porRef.get(Number(n)); return c ? textoCita(c) : '(mensaje no encontrado)' })
}

/** Lo que va con la consigna o el contexto: los mensajes citados, delimitados como dato. */
export function bloqueCitas(o: Oficina, citas: CitaWA[]): string {
  const jefe = o.duenio.trim() || 'la persona'
  const l = citas.map((c) => `- ${textoCita(c, maxTextoCita)}`)
  return [`<mensajes_whatsapp_compartidos>`, `Mensajes de WhatsApp que ${jefe} pidió pasarte (solo estos; no tenés acceso al chat). ${avisoTerceros}`, ...l, `</mensajes_whatsapp_compartidos>`].join('\n')
}

export const compartidoJSON = (c: CitaWA): Obj => ({ ref: c.ref, de: c.de, chat: c.chat, ts: c.ts, texto: prefijo(c.texto, maxTextoCita) })

export function instalar(s: Servicios) {
  const d = delegacionesDe(s)
  if (!d) return
  const leer = (o: Oficina, a: AgenteDef) => whatsappDeAgente(s, o, a)
  d.respuestas.push((o, a, texto) => {
    if (!texto.includes('[wa:')) return texto
    const h = leer(o, a)
    return reemplazarCitas(texto, (refs) => h?.citas(refs) ?? [])
  })
  d.resolverCitas = (o, a, refs) => {
    const h = leer(o, a)
    if (!h) return 'No leés WhatsApp: no tenés mensajes para citar.'
    const cs = h.citas(refs)
    const faltan = refs.filter((r) => !cs.some((c) => c.ref === r))
    if (faltan.length > 0) return `No encuentro ${faltan.map((r) => `[wa:${r}]`).join(', ')} en los chats que podés leer.`
    return { texto: bloqueCitas(o, cs), compartido: cs.map(compartidoJSON) }
  }
}

registrarModulo('citas-whatsapp', 82, instalar)
