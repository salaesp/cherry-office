# Aprendizajes sobre Claude Code

Comportamientos de Claude Code que la app da por sentados. Cada uno lleva su estado:
- **CONFIRMADO**: lo vimos en una corrida real, con la versión indicada.
- **NO VERIFICADO**: es una suposición razonable que todavía no probamos.
- **FALSO**: lo creíamos y resultó no ser así.

Regla: antes de construir sobre un comportamiento de Claude Code, se prueba y se anota acá.

## Salida `stream-json` (spike del 13/11/2026, claude-haiku-5-5)

- **CONFIRMADO.** `claude -p --output-format stream-json --verbose` escribe un objeto JSON por línea. Sin `--verbose`, `-p` no acepta `stream-json`.
- **CONFIRMADO.** El orden observado fue:
  1. `system/hook_started` y `system/hook_response`: los hooks del usuario (`~/.claude/settings.json`) **también corren dentro de los agentes de la oficina**;
  2. `system/init`, con `session_id`, `model`, `tools`, `mcp_servers`, `cwd`;
  3. `system/thinking_tokens`;
  4. un `assistant` por bloque de contenido: `thinking`, `tool_use` o `text`;
  5. `user` con el `tool_result`;
  6. `rate_limit_event`;
  7. al final, `result`.
- **CONFIRMADO.** `tool_use` trae `name` (por ejemplo `Read`) e `input`, que para `Read` es `{file_path}`. Para mostrar actividad alcanza con `name` y el nombre del archivo, sin contenido.
- **CONFIRMADO.** La última línea es `{"type":"result", "subtype":"success", "is_error", "result", "total_cost_usd", "num_turns", "session_id", ...}`. Por eso `parsearJSON`, que toma la última línea JSON si el todo no parsea, sigue funcionando.
- **CONFIRMADO.** Con haiku, una lectura de archivo más una respuesta de una palabra costó `total_cost_usd` ≈ 0,019. Ese número es un estimado de precio de API, no lo que se cobra en un plan Pro/Max: en la UI se muestra como «costo estimado».
- **NO VERIFICADO.** Que con `--output-format json` también venga `total_cost_usd`. Da igual: la app pasa toda a `stream-json`.
- **CONFIRMADO (Fase 4).** Los nombres de las herramientas MCP en `tool_use` son `mcp__<servidor>__<herramienta>` (ver la sección del servidor MCP propio).

## Entorno del proceso hijo

- **CONFIRMADO (en agents-office).** Si `claude` hereda `CLAUDECODE` o `CLAUDE_CODE_*` de una sesión padre, se comporta como sesión anidada y no guarda el transcript. `ClaudeLocator.childEnvironment` y `server.entorno_hijo` las quitan, salvo `CLAUDE_CODE_USE_*`, `CLAUDE_CODE_SKIP_*` y la config del usuario.
- **CONFIRMADO.** Desde una app gráfica, `claude` puede no estar en el PATH: se busca con `$SHELL -ilc` (shell de login interactivo), leyendo la ruta entre marcadores.

## Servidor MCP propio (spike de la Fase 4, 13/11/2026, claude 2.1.323, haiku)

Probado con un servidor HTTP de juguete en `127.0.0.1` y `claude -p --model haiku --output-format stream-json --verbose --mcp-config <json> --tools mcp__hq__colegas --allowedTools mcp__hq__colegas`; después, de punta a punta, con el servidor de verdad (modo dev Python) y dos agentes con modelo haiku (marce le consultó a nico y citó su respuesta).

- **CONFIRMADO.** `--mcp-config` acepta JSON inline: `{"mcpServers":{"hq":{"type":"http","url":"http://127.0.0.1:PUERTO/mcp","headers":{"Authorization":"Bearer TOKEN"}}}}`. El servidor aparece en `system/init` → `mcp_servers` como `{"name":"hq","status":"connected","source":"dynamic"}`. Los servidores MCP del usuario (`~/.claude`) se cargan igual: lo que limita al agente es `--tools`.
- **CONFIRMADO.** El header se expande con variables de entorno: `"Authorization":"Bearer ${HQ_MCP_TOKEN}"` y el token en el entorno del proceso. La app lo usa así para que el token no aparezca en los argumentos (`ps`).
- **CONFIRMADO.** Secuencia de pedidos de claude, todos `POST /mcp` con `Content-Type: application/json` y `Accept: application/json, text/event-stream`:
  1. `server/discover` (id string `server-discover-probe-1`, `Mcp-Protocol-Version: 2026-07-28`): un sondeo previo. Contestarle error `-32601` (método no soportado) o un resultado vacío alcanza; después sigue;
  2. `initialize` con `protocolVersion: "2025-11-25"` (más `capabilities` y `clientInfo` de claude-code);
  3. `notifications/initialized` (sin `id`): se contesta `202` sin cuerpo;
  4. un `GET /mcp` con `Accept: text/event-stream` (canal SSE del servidor al cliente): contestar `405` está bien;
  5. `tools/list` (id 1) y, cuando el modelo la usa, `tools/call` con `params: {name, arguments, _meta}`.
- **CONFIRMADO.** Basta contestar `Content-Type: application/json` simple, sin SSE. La versión que pide claude es `2025-11-25`; el servidor la repite en `initialize` (acepta también `2025-06-18`, `2025-03-26` y `2024-11-05`).
- **CONFIRMADO.** El nombre en el `tool_use` de stream-json es `mcp__<servidor>__<herramienta>`: `mcp__hq__colegas` (y, por lo mismo, `mcp__hq__consultar`; el estado «consultando» y el 3D se apoyan en ese prefijo). Su `input` trae los argumentos tal cual los escribió el modelo, así que `colega` puede venir como id («nico») o como nombre («Nico»).
- **CONFIRMADO.** `--tools mcp__hq__colegas` hace visible la herramienta y `--allowedTools mcp__hq__colegas` la deja correr sin pedir permiso (en `-p` no hay a quién preguntarle).
- **CONFIRMADO.** Una herramienta que devuelve `{"content":[{"type":"text","text":...}],"isError":true}` llega al modelo como error de herramienta y puede seguir.
- **NO VERIFICADO.** Qué hace claude con un `401` en medio de una corrida (token revocado): solo probamos que el servidor lo devuelve; en la app el token se revoca recién cuando termina el chat.
- **NO VERIFICADO.** Que `claude` reuse la conexión (keep-alive): el servidor de la app cierra cada conexión (`Connection: close`) y funciona.

## Conectores de claude.ai (spike del 13/11/2026, claude 2.1.316, haiku)

Probado desde la raíz del repo con el entorno limpio (`env -u CLAUDECODE -u CLAUDE_CODE_* ... claude ...`). Solo se usaron herramientas de lectura (`list_calendars`, `list_events`); nunca una que cree, modifique, borre o mande algo.

- **CONFIRMADO.** `claude mcp list` muestra los conectores de la cuenta como `claude.ai <Nombre>: <url> - ✔ Connected` o `- ! Needs authentication`. Un conector repetido aparece como `claude.ai <Nombre> (2)`.
- **CONFIRMADO.** `claude -p` hereda esos conectores sin `--mcp-config`. En `system/init` → `mcp_servers` vienen como `{"name":"claude.ai Google Calendar","status":"connected","source":"claudeai"}`; los que piden login vienen con `"status":"needs-auth"` (y no aportan herramientas). La lista de la oficina se puede armar de ahí: `source == "claudeai"` y `status == "connected"`.
- **CONFIRMADO.** Formato de las herramientas: `mcp__claude_ai_<Nombre con espacios cambiados por _>__<herramienta>`. Ejemplos: `mcp__claude_ai_Google_Calendar__list_calendars`, `mcp__claude_ai_Google_Calendar__create_event`, `mcp__claude_ai_Gmail__send_message`, `mcp__claude_ai_Google_Drive__read_file_content`. El prefijo `claude.ai ` del servidor pasa a `claude_ai_`. Los nombres de las herramientas no siguen una convención única (`list_events` y `getJiraIssue` conviven), así que leer vs actuar no se puede deducir con seguridad del nombre: hay que clasificarlas a mano (`list_`/`get_`/`search_`/`read_` leen; `create_`/`update_`/`delete_`/`send_`/`trash_`/`share_`/`forward`/`reply` actúan).
- **CONFIRMADO.** **Carrera al arrancar:** los conectores se conectan en segundo plano («claude.ai connectors running fully async (nonblocking)» en `--debug=mcp`). Con `-p` y stdin cerrado (`</dev/null`), `system/init` sale con `mcp_servers: []`, sin herramientas `mcp__claude_ai_*`, y el modelo dice que no tiene la herramienta. Solo andaba «de casualidad» cuando claude esperaba 3 s por stdin. **Solución confirmada:** poner `MCP_CONNECTION_NONBLOCKING=false` en el entorno del hijo; así init trae los 16 servidores y las herramientas siempre. Cuesta alrededor de 1 s más de arranque.
- **FALSO.** Que `--tools` limite las herramientas MCP. `--tools` solo filtra las herramientas propias (Read, Bash...). Con `--tools Read`, `--tools mcp__claude_ai_Google_Calendar__list_calendars` o `--tools 'mcp__claude_ai_Google_Calendar__*'`, init trae igual **todas** las herramientas de **todos** los conectores conectados (163 en esta cuenta, incluidas `create_event`, `send_message`, `trash_file`). Esto corrige lo que se anotó en el spike del servidor MCP propio («lo que limita al agente es `--tools`»): eso vale para las herramientas propias y no para las MCP.
- **CONFIRMADO.** Por lo mismo, el comodín en `--tools` no hace falta ni cambia nada: con nombre exacto o con `mcp__<servidor>__*` el modelo vio y usó `list_calendars` (con `--allowedTools` en el nombre exacto, sin pedir permiso).
- **CONFIRMADO, y es un riesgo.** La app no pasa `--permission-mode`, así que el hijo hereda `defaultMode` de `~/.claude/settings.json` (en esta máquina `auto`; init dice `"permissionMode":"auto"`). En `auto`, una herramienta MCP que **no** está en `--allowedTools` (`list_events`) corrió igual, sin preguntar. Con `--permission-mode default` o `--permission-mode dontAsk`, la misma llamada se rechaza: el `tool_result` vuelve con `is_error: true` y `result.permission_denials` lista `{tool_name, tool_use_id, tool_input}`. El modelo la ve igual y lo intenta. **Para la oficina:** pasar siempre `--permission-mode dontAsk` (o `default`); en `-p` las dos rechazan todo lo que no esté en `--allowedTools`.
- **CONFIRMADO.** `--disallowedTools` sí saca herramientas MCP de la lista que ve el modelo. Acepta el servidor entero (`mcp__claude_ai_Gmail`), un comodín (`mcp__claude_ai_Gmail__*`, `mcp__claude_ai_*` saca todos los conectores) o un nombre exacto (`mcp__claude_ai_Google_Calendar__create_event`).
- **CONFIRMADO.** `--disallowedTools` le gana a `--allowedTools`: `--disallowedTools 'mcp__claude_ai_Google_Calendar__*'` (o `mcp__claude_ai_Google_Calendar`) junto con `--allowedTools mcp__claude_ai_Google_Calendar__list_calendars` deja el Calendar entero afuera, incluida la permitida. Para mostrar solo algunas herramientas de un conector hay que listar con nombre exacto las que se sacan (los nombres salen de init).
- **CONFIRMADO.** `--strict-mcp-config` (sin `--mcp-config` de claude.ai) saca todos los conectores de claude.ai. Para un agente sin conectores sirve, pero también saca los que se pasen fuera de `--mcp-config` (el `hq` va por `--mcp-config`, así que sigue).
- **Receta que se desprende (NO VERIFICADO de punta a punta en la app):** entorno con `MCP_CONNECTION_NONBLOCKING=false` + `--permission-mode dontAsk` + `--allowedTools` con las herramientas asignadas al agente (las de leer; las de actuar solo en la corrida que sale de una entrega aprobada) + `--disallowedTools` con los servidores no asignados (por servidor) y, dentro de los asignados, con el nombre exacto de cada herramienta no asignada.
- **NO VERIFICADO.** Qué pasa si un conector vence o se desautoriza en medio de una corrida, y si el nombre `mcp__claude_ai_<Nombre>` cambia cuando el usuario renombra el conector o hay dos con el mismo nombre (`(2)`).

## Ejecución de agentes de oficina: la receta de `Permisos.argumentos` con el claude real (ola 3, 14/11/2026, claude 2.1.316, haiku)

Probado en una carpeta temporal (un agente `.claude/agents/*.md` con `model: haiku`, una skill y un archivo de texto) con el comando que arma `Permisos.argumentos` (`-p --agent … --output-format stream-json --verbose --tools … --permission-mode dontAsk --allowedTools … --disallowedTools … --append-system-prompt …`), `MCP_CONNECTION_NONBLOCKING=false` y stdin cerrado. Solo herramientas de lectura: nada que cree, mande, modifique o borre algo en la cuenta; de Calendar se llamó únicamente `list_calendars`, y se pidió solo la cantidad de calendarios.

- **CONFIRMADO (a).** `--append-system-prompt` se combina con `--agent` en `-p`. Un agente cuyo prompt dice «terminá siempre con KIWI-1» y un `--append-system-prompt` que dice «además, terminá siempre con PERA-77» respondió terminando con las dos palabras. No hace falta el plan B (anteponer las instrucciones al mensaje).
- **CONFIRMADO (b).** `--permission-mode dontAsk` con `--tools Read,Glob,Grep,Skill` y `--allowedTools Read Glob Grep Skill` deja usar las cuatro: el modelo llamó a `Read`, `Glob`, `Grep` y `Skill` y ninguna volvió con `is_error`. La skill se cargó (el contenido de su `SKILL.md` llegó al modelo). `Permisos` no necesita ajuste.
- **CONFIRMADO (c).** Con `--disallowedTools 'mcp__claude_ai_*'` y `--tools ""`, `system/init` no trae ninguna herramienta `mcp__claude_ai_*` aunque la cuenta tenga 16 conectores (sin la veda, la misma llamada trae 163 herramientas, todas de conectores). Es el caso de un agente sin conectores asignados.
- **CONFIRMADO (d).** Con Calendar asignado para leer, `--allowedTools` con las herramientas de leer de Calendar y `--disallowedTools` con los demás servidores (por prefijo) y el nombre exacto de las de actuar (`create_event`, `update_event`, `delete_event`, `respond_to_event`), `init` trae solo `get_event`, `list_calendars`, `list_events`, `search_events` y `suggest_time` (más Read, Glob y Grep): `create_event` no aparece. `list_calendars` anduvo sin pedir permiso y devolvió la cantidad (10).
- **NO VERIFICADO.** Que una acción aprobada corra con una herramienta real de actuar (por ejemplo `create_event`) y que, sin ser aprobada, el agente no la pueda usar en una corrida normal. Solo se probó con el claude falso (los tests miran los argumentos del comando: `--allowedTools` lleva solo esa herramienta en la corrida `accion:`). Con el claude real no se ejecutó ninguna herramienta que cree, mande, modifique o borre algo: esa prueba la hace la persona a mano, con una cuenta o un evento de prueba.
- **Dato.** `system/init` de `stream-json` no trae el nombre del agente (no hay clave `agent`): para saber que `--agent` se aplicó hay que mirar el comportamiento, no el evento.
- **Dato.** Con `claude -p` sin stdin redirigido, sale un aviso («no stdin data received in 3s») y espera 3 segundos antes de seguir. La app lanza el hijo con stdin cerrado; en pruebas a mano conviene `< /dev/null`.

## Escritura de agentes: carpetas que terminan en punto (15/11/2026, claude 2.1.316, haiku)

Apareció en Linux, con una oficina en `/home/…/Oficinas/Luis Inc./`: un paso de flujo no pudo escribir en
`archivos/entregables/<id>/` ni en `conocimiento/agentes/<id>.md`. Se reprodujo en macOS con el comando de `Permisos.argumentos`.

- **CONFIRMADO.** Si algún componente de la ruta termina en `.` (`Luis Inc.`, `LuisInc.`), `Write` se rechaza en `dontAsk` aunque
  `--allowedTools` tenga la regla exacta. El `tool_result` dice «Permission to use Write has been denied because Claude Code is
  running in don't ask mode». Con `Luis Inc` (sin el punto) y con espacios en el medio (`Mi Ofi`) anda.
- **CONFIRMADO.** No se arregla escribiendo la regla de otra manera: fallan también `Edit(\.)` escapado, el comodín `Luis Inc?`,
  la regla relativa al cwd (`archivos/entregables/<id>/**`) y `./archivos/…`. Con `--permission-mode bypassPermissions` el
  archivo se crea, o sea que el problema es de permisos y no del sistema de archivos. Parece un chequeo de seguridad de Claude
  Code sobre rutas raras (los puntos al final son un truco conocido de Windows) que fuerza a preguntar, y en `-p` no hay a quién.
- **Para la app:** `Oficinas.carpetaLibre` saca los puntos y espacios del final del nombre de la carpeta (el nombre de la oficina
  en `oficina.json` queda igual). Una oficina que ya existe con esa carpeta hay que renombrarla a mano y volver a abrirla.

## Pedir permiso en vivo: `--permission-prompt-tool` (spike del 15/11/2026, claude 2.1.316, haiku)
Idea: que el agente pida lo que no tiene (Bash, Edit fuera de sus notas) y la persona lo apruebe desde la app, como en Claude
Code. Se probó con un servidor MCP stdio mínimo (`pedir_permiso`) que anota cada pedido y responde permitir o rechazar.
Comando: `-p --tools Read,Bash,Edit,Write --permission-mode manual --permission-prompt-tool mcp__hq__pedir_permiso
--allowedTools Read mcp__hq__pedir_permiso` (el flag no aparece en `claude --help`, pero anda).

- **CONFIRMADO.** Lo que no está en `--allowedTools` llama a la herramienta con `{tool_name, input, tool_use_id}`: por ejemplo
  `{"tool_name":"Bash","input":{"command":"touch nuevo.txt","description":"…"}}` o el `Edit` con `file_path`, `old_string` y
  `new_string`. La herramienta responde con un texto JSON: `{"behavior":"allow","updatedInput":<input>}` o
  `{"behavior":"deny","message":"…"}`.
- **CONFIRMADO.** Con `allow`, el comando corre o el archivo se edita. Con `deny`, no pasa nada, el agente recibe el mensaje y
  el pedido aparece en `permission_denials` de la salida JSON.
- **CONFIRMADO.** Lo que ya está en `--allowedTools` no pregunta: con `Edit(//<ruta>/a.txt)` en la lista, el Edit pasó sin llamar
  a la herramienta. O sea que «Siempre» se puede guardar como regla y la próxima vez no pregunta.
- **CONFIRMADO.** Los comandos de solo lectura (`git status --short`) no preguntan: Claude Code ya los deja pasar.
- **CONFIRMADO.** Con `--permission-mode dontAsk` la herramienta **no se llama**: todo lo que no está permitido se rechaza solo.
  Para pedir permiso hay que dejar `dontAsk` y usar `manual` (el modo normal).
- **CONFIRMADO.** Con el servidor por stdio, Claude esperó 150 s sin problema. **Con el servidor por HTTP (el `hq` de la app)
  corta a los 60 s**: la herramienta devuelve «The operation timed out» y el agente sigue sin el permiso. Con
  `MCP_TOOL_TIMEOUT=600000` en el entorno esperó los 90 s de la prueba y el comando corrió. La app pone `MCP_TOOL_TIMEOUT`
  (15 min) en los chats que piden permiso (`Permisos.entorno`). Probado en la app con el claude real: tarjeta, espera de
  más de un minuto, «Siempre», el comando corrió y la segunda vez pasó sin preguntar.
- **NO VERIFICADO.** Que el caso de «carpetas que terminan en punto» (sección anterior), que hoy falla porque Claude Code fuerza a
  preguntar, se resuelva pidiendo permiso con esta herramienta.
- **Para la app:** cambiar `dontAsk` por `default` (el nombre viejo de `manual`, que las versiones nuevas también aceptan)
  + `--permission-prompt-tool mcp__hq__pedir_permiso` en las corridas con persona presente. La herramienta del servidor `hq` muestra la tarjeta (una vez, siempre para este agente, rechazar), no
  cuenta la espera dentro del timeout del turno y, si nadie responde, rechaza. Las corridas sin persona (tareas
  programadas, lectura por rol) pueden seguir en `dontAsk`.

## Modelo y esfuerzo (`--model`, `--effort`)
- **CONFIRMADO** (Claude Code 2.1.326). `--model` pisa el `model:` del frontmatter del agente (`--agent`): `system/init` informa el de `--model`.
- **CONFIRMADO.** `--effort low|medium|high|xhigh|max` existe; un valor inválido solo avisa por stderr y usa el de por defecto. Sin `--effort`, la corrida usa el que la persona tenga en su Claude Code (puede ser alto): por eso la app deja elegirlo por agente y por charla.
- **CONFIRMADO.** Un turno mínimo (`--agent`, `--tools Read,Glob,Grep`) ya carga ~4 mil tokens de prompt de sistema antes del mensaje; se le suman las instrucciones de la oficina, el CLAUDE.md, la memoria y los servidores MCP del `~/.claude` de la persona. En el `result`, `usage` trae `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` y `output_tokens`: el log del chat los anota como `tokens=entrada/cache_leida/cache_escrita/salida`.
- **CONFIRMADO** (Claude Code 2.1.326). El `usage` del `result` suma todas las llamadas del turno: no es el tamaño del contexto. Ese tamaño es el `usage` del último mensaje `assistant` con `parent_tool_use_id: null` (entrada + caché leída + escrita); la ventana viene en `result.modelUsage[modelo].contextWindow`. `claude -p "/context"` es un comando local (costo 0, `local_command: "context"`, ~1 s) que devuelve en `result` un markdown con el total y el uso por categoría. Con `--resume <sid>` le agrega a la sesión el comando y su salida (~3k tokens que el agente carga el próximo turno); con `--no-session-persistence` además no escribe nada.
- **CONFIRMADO.** La herramienta `Skill` le manda al modelo la lista de skills y plugins instalados en cada llamada (con 40 skills: ~7.400 tokens). `--disallowedTools Skill(x)` NO la achica. Sí la achican, por `--settings` en cada corrida: `skillListingMaxDescChars` (150 → ~2.700 de lista) y `skillOverrides` (`{nombre: "off" | "name-only" | "user-invocable-only" | "on"}`). Con la lista recortada a 150 o solo con nombres, el modelo igual eligió `pptx` y `xlsx` cuando se los pidieron. El `system/init` trae `skills: [nombres]`.
- **CONFIRMADO.** `--append-system-prompt` pisa el «Al empezar: leé…» de la plantilla del agente: con el aviso de memoria liviana, una pregunta pasó de 4 viajes (3 Read) a 1.

## Skills propias de cada agente (27/11/2026) — NO VERIFICADO con el claude real

Las skills propias (`backend/src/skills-propias.ts`) se apoyan en tres supuestos que solo se probaron con el claude falso:
- **NO VERIFICADO.** Que Claude Code cargue un `SKILL.md` de proyecto (`.claude/skills/<nombre>/` dentro del cwd de la corrida) con una clave extra en el frontmatter (`metadata:` con `oficina-agente: <id>`) sin quejarse. La sección de la ola 3 de arriba confirma que carga skills de proyecto, pero no con `metadata`.
- **NO VERIFICADO.** Que `skillOverrides: {"<nombre>": "off"}` en `--settings` apague también una skill de proyecto (lo confirmado arriba fue con skills instaladas).
- **NO VERIFICADO.** Qué pasa si una skill de proyecto y una personal (`~/.claude/skills`) tienen el mismo nombre. La app no deja crear una propia con el nombre de una instalada para no depender de eso.
Para probarlo: crear una skill propia desde la ficha, chatear con su agente pidiendo algo que la dispare y mirar en `system/init` que `skills` la traiga; chatear con otro agente y confirmar que no aparece.
