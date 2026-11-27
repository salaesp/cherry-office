// Todo lo que comparten los módulos del backend (ServiciosHQ de Swift), más los puntos donde cada módulo se enchufa.
//
// Cada módulo (consultas, agentes, tareas, reuniones, biblioteca, flujos, …) vive en su archivo y se registra con
// `registrarModulo(nombre, orden, instalar)`. `createBackend` arma los servicios del núcleo y llama a los `instalar` en
// orden: ahí cada módulo crea sus tablas, registra sus rutas y llena los huecos que otros usan (programador, mcp, …).
import type { EventEmitter } from 'node:events'
import type { Avisos } from './avisos.js'
import type { ClaudeRunner } from './claude-runner.js'
import type { Config } from './config.js'
import type { GanchosCharla } from './delegar.js'
import type { Entregas } from './entregas.js'
import type { Obj } from './json.js'
import type { HQLog } from './log.js'
import type { Oficina } from './oficina.js'
import type { OficinaActiva, Oficinas } from './oficinas.js'
import type { ServidorConector } from './permisos.js'
import type { Router } from './router.js'
import type { MCPChat, PermisosTareasChat } from './rutas-chat.js'
import type { Store } from './store.js'

export interface Servicios {
  readonly config: Config
  readonly store: Store
  readonly runner: ClaudeRunner
  readonly oficinas: Oficinas
  readonly avisos: Avisos
  readonly entregas: Entregas
  readonly log: HQLog
  readonly router: Router
  readonly env: NodeJS.ProcessEnv
  /** Canal de avisos para la app nativa (`'aviso'`, {aviso, nombre}). */
  readonly canal: EventEmitter

  // Huecos que llenan los módulos (undefined hasta que su módulo se instala). Se tipan como `unknown` acá y cada
  // módulo exporta un accesor tipado (p. ej. `programadorDe(s)`), así este archivo no depende de ninguno.
  readonly huecos: Record<string, unknown>

  // Ganchos del núcleo
  /** Al abrir una oficina (después de activarla). */
  readonly alAbrir: ((a: OficinaActiva) => Promise<void>)[]
  /** Al crear una oficina, con el pedido de `POST /api/oficinas` (la secretaría se contrata acá). Devuelve la oficina como
   *  quedó si la cambió. */
  readonly alCrear: ((a: OficinaActiva, pedido: Obj) => OficinaActiva | undefined)[]
  /** Validaciones extra de oficina.json (tareas, flujos, reglas). Lanzan ErrorAPI. */
  readonly validaciones: ((o: Oficina) => void)[]
  /** Servidor MCP para el chat (lo pone el módulo de consultas). */
  mcp?: () => MCPChat | undefined
  /** Pedidos de permiso de las tareas que esperan (lo pone el módulo de tareas). */
  permisosTareas?: () => PermisosTareasChat | undefined
  /** Ganchos de la charla con la persona: delegar y preguntar (lo pone el módulo delegar). */
  charla?: () => GanchosCharla | undefined
  /** Catálogo de conectores de la cuenta (lo pone el módulo de gobierno). */
  catalogo?: () => ServidorConector[] | undefined
  /** Resumen de corridas de flujos para /api/actividad. */
  corridas?: (oficina: string) => Obj[]
  /** Versión del Creador para /api/actividad. */
  creadorVersion?: (oficina: string) => number
  /** Espera antes de atender cada pedido (la migración inicial). */
  listo?: () => Promise<void>
  /** Al cerrar, ANTES de matar los claude (detener el programador, cerrar el servidor MCP). */
  readonly alCerrar: (() => Promise<void> | void)[]
  /** Al cerrar, DESPUÉS de matar los claude y antes de cerrar la base (esperar que las corridas guarden su estado). */
  readonly despuesDeProcesos: (() => Promise<void> | void)[]
  /** Después de armar todo (arrancar el programador, preparar el motor…). */
  readonly alArrancar: (() => Promise<void> | void)[]
}

export type Instalador = (s: Servicios) => void

const registro: { nombre: string; orden: number; instalar: Instalador }[] = []

/** Registra un módulo. `orden` define el orden de instalación (y por lo tanto el de sus rutas «extra»):
 *  10 consultas/MCP · 20 agentes · 30 entregas · 40 tareas/programador · 50 reuniones · 60 biblioteca · 65 conocimiento · 70 flujos ·
 *  71 creador · 72 gobierno · 73 parte · 74 uso-claude · 77 whatsapp · 78 secretaria · 79 audio, delegar · 80 paquete · 90 importar/migración. */
export function registrarModulo(nombre: string, orden: number, instalar: Instalador) {
  if (registro.some((m) => m.nombre === nombre)) return
  registro.push({ nombre, orden, instalar })
}

export function modulosRegistrados() {
  return [...registro].sort((a, b) => a.orden - b.orden)
}
