# Plan: del chat a las tareas

> Estado: C0, C1 y C2 hechos. «Sacar tareas» es una sugerencia (chip) debajo de la última respuesta, con 3 idas y vueltas
> o más; backend en `backend/src/chat-tareas.ts`, hoja en `oficina/ui/chat-tareas.js`.
> Antes era un botón fijo en la cabecera del chat. Dejó de serlo cuando todos los agentes pasaron a proponer tareas en la
> charla (`proponer_tarea`, `delegar` con «cuando»): el botón queda para el repaso del final, lo que los agentes no hacen
> (leer toda la charla de una vez, separar lo que le toca a la persona y revisar todo junto en la hoja).

## Contexto
Una charla con un agente suele terminar en «entonces hay que hacer X, Y y Z». Hoy eso queda en el historial y la persona
tiene que armar cada tarea a mano. Las reuniones ya resuelven lo mismo: la síntesis saca pendientes con responsable y
dependencias, y cada uno se encarga o se convierte en tarea ([reunion.js](../oficina/ui/reunion.js), «Convertir en tarea»).

Objetivo: **chat → propuesta de tareas → la persona revisa → tareas creadas**, para el mismo agente o para otros.

## Decisiones
- **Extracción aparte**, como la síntesis: `runner.correrSinAgente` con la transcripción. No usa ni ensucia la sesión del
  agente, y sirve igual para chats largos.
- **Consigna autocontenida.** Cada tarea arranca en una sesión nueva (como todas las tareas), así que la consigna lleva el
  contexto que necesita. Se guarda de qué chat salió (`origen`) para volver a él.
- **Nada se crea sin revisar.** La extracción devuelve una propuesta efímera (no se guarda); recién al confirmar se crean
  las tareas.
- **Primera versión (MVP):** «Hacelo ahora» y «Una sola vez». Se reutiliza `POST /api/tareas` (`tipo: "unica"`, con
  `ahora: true` o `fecha` + `hora`): no hace falta un tipo de encargo nuevo.
- **Fuera del MVP:** dependencias reales (esperas), tareas repetidas, pendientes de la persona, guardar la propuesta.

## Fase C0: extracción (backend)
**Archivo nuevo `backend/src/chat-tareas.ts`**
- `promptTareasChat({ oficina, agente, mensajes })`: «Sos quien ordena el trabajo de la oficina…». Pide SOLO JSON:
  `{"pendientes": [{"quien", "nombre", "consigna", "necesita_usuario", "depende_de": []}]}`.
  - `quien`: nombre exacto de un agente de la oficina (se listan con su rol) o el de la persona. Por defecto, el agente
    del chat.
  - `nombre`: título corto (≤ 80, `ValidarTareas.maxNombre`).
  - `consigna`: autocontenida («quien la lea no vio el chat»), ≤ 4000 (`ValidarTareas.maxConsigna`).
  - Reutilizar `PendientesReunion.consignaSecretario(duenio)` para lo que los agentes no pueden hacer solos.
  - Solo lo que quedó como trabajo por hacer: no inventar.
- Transcripción: mensajes de la sesión (`Store`, tabla `mensajes`), recortada desde el final con el mismo tope que
  las actas (`maxTranscripcionActa`). Exportar ese tope o moverlo a un lugar común.
- `parsearTareasChat(texto)`: sacar de `parsearSintesis` la parte de pendientes (índices, `depende_de` 1-based, descarte
  de ciclos y auto-dependencias) a una función compartida `parsearPendientes`, y usarla en los dos lados. Truncar
  `nombre` y `consigna` a sus topes; si falta `nombre`, derivarlo de la consigna.
- Resolver `quien` → agente con `PendientesReunion.agente(quien, oficina)`. Sin agente o con `necesita_usuario` = de la
  persona.

**Ruta en `rutas-chat.ts`**
- `POST /api/chat/tareas` `{agent, session}` → `{pendientes: [{quien, agente: id|null, nombre, consigna, usuario, dependeDe: [n]}]}`.
  - 404 si la sesión no existe o no es de ese agente en la oficina activa.
  - Chat sin mensajes o sin nada que hacer → `{pendientes: []}` (no es error).
  - Respuesta ilegible → 502 «No pude leer la propuesta» (igual que una síntesis fallida).
  - Timeout `HQ_CHAT_TAREAS_TIMEOUT` (180 s por defecto, como `HQ_REUNION_SINTESIS_TIMEOUT`).
  - Costo registrado con origen `chat-tareas` y `ref` = sesión.
  - Un solo pedido en curso por sesión (409 si se repite mientras corre).

## Fase C1: origen de la tarea (backend)
- `tareas.ts`: `OrigenTarea = { reunion, pendiente } | { chat: string }`. Actualizar `decodificarTarea`, `tareaJSON` y la
  validación de `POST /api/tareas` (que la sesión exista en la oficina activa; si no, 400).
- Hecho: la vista de la tarea suma `charla: {agente, nombre}`; la entrega muestra «Salió de un chat con <agente>» (abre
  esa charla) y el aviso de una corrida que falla lo dice entre paréntesis.
- **Tope:** 50 tareas por hacer por oficina; las de una sola vez ya hechas no cuentan (500 guardadas en total). La hoja
  avisa antes de crear el lote si no entran.

## Fase C2: interfaz
- **Sugerencia «¿Sacamos tareas de esta charla?»** debajo de la última respuesta (`oficina/ui/agente.js`), con 3 idas y
  vueltas o más y sin respuesta en curso ni mensajes en cola. (Al principio era un botón en la cabecera del chat.)
  Mientras corre, `App.cargando` («Leyendo la charla…»).
- **Hoja «Tareas de esta charla»**, armada con las piezas de presentación (`elegir`, `filaDecision`, `seccion`, menú con
  filtro). Una fila por pendiente:
  - casilla (todas marcadas, menos las de la persona);
  - agente: menú con filtro, precargado con el resuelto;
  - nombre y consigna editables;
  - cuándo: «Ahora» o «Una sola vez» (fecha + hora). Por defecto «Ahora», salvo si depende de otra: entonces «Una sola
    vez» y una nota «Va después de: <nombre>» (el MVP no encadena solo);
  - las de la persona, aparte en «Para vos», con botón copiar; no se crean.
- **«Crear N tareas»**: un `POST /api/tareas` por fila, en orden, con `origen: {chat: session}`. Al final, aviso con
  cuántas se crearon y un enlace al panel Tareas. Si alguna falla, se queda en la hoja con su error y las demás no se
  repiten.
- Lista vacía: «No encontré trabajo pendiente en esta charla».
- Hecho: en la ficha de la tarea, si `origen.chat`: «Salió de una charla con <agente>» y «Ver la charla».

## Fase C3: después del MVP
- **Dependencias reales:** crear un grupo de encargos encadenados con las esperas de `dependencias.ts` (ref
  `chat:<sesión>:<n>`, como `encargo:<reunión>:<n>`), con su «encargar todos».
- **Repetidas** en la hoja (días + hora).
- **Pendientes de la persona:** anotarlos o dejarlos como aviso «te necesita».
- **Guardar la propuesta** para reabrirla sin volver a gastar.
- Pedirlo desde el propio chat («pasalo a tareas») con una herramienta MCP del agente que abre la misma hoja.

## Tests
- `backend/test/unit/chat-tareas.test.ts`: prompt (lista agentes, pide consigna autocontenida), `parsearPendientes`
  compartido (los casos actuales de síntesis siguen pasando), topes, `quien` → agente, persona.
- `backend/test/api/chat-tareas.test.ts` con el `claude` falso: propuesta ok, chat vacío, JSON roto → 502, sesión ajena →
  404, 409 en paralelo, costo registrado.
- `backend/test/api/tareas.test.ts`: `origen: {chat}` válido, sesión inexistente → 400, `tareaJSON` lo devuelve.
- `npm test --prefix backend`; prueba a mano en el navegador (`npm run dev --prefix backend`).

## Documentación
- `backend/API.md`: la ruta nueva y `origen.chat` en tareas.
- README, «Qué se puede hacer»: una línea en «Chat y reuniones».
