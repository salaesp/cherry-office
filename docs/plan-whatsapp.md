# Plan: WhatsApp como fuente para un secretario

## Contexto
La persona quiere que la oficina **tome información de su WhatsApp** y que un agente (un «secretario») actúe en
consecuencia, siempre con su aprobación. Caso guía: la mamá escribe «el jueves 4 a las 10 tengo turno con el
cardiólogo en el Italiano» y el secretario deja una sugerencia en la bandeja para agregar ese turno al calendario.

WhatsApp no tiene una API oficial para leer chats personales. La Cloud API de Business solo ve los mensajes de un número
de empresa verificado, necesita webhooks públicos y no lee los chats de la persona. El único camino es un **cliente no
oficial** que se vincula como dispositivo (QR, igual que WhatsApp Web). Se usa **Baileys**, que habla el protocolo por
WebSocket sin navegador.

Antecedente real: la persona ya tiene un monitor así andando con otro agente. De ahí salen varias decisiones de este plan:
- un proceso Node con Baileys, aparte del agente, que escucha **solo el chat objetivo** (por número y por sus ids `@lid`),
  ignora grupos y estados y guarda entrantes **y salientes** en `messages.jsonl`. No tiene lógica para enviar;
- un supervisor (`systemd --user`) que lo relanza si se cae y le pone tope de RAM y CPU. Si WhatsApp revoca la sesión,
  hay que volver a escanear el QR;
- una revisión programada (8, 12, 16 y 20 h) que detecta lo nuevo, deduplica, agrega hasta 10 mensajes anteriores de
  contexto y despierta al agente **solo si hay novedades o una alerta de desconexión**;
- un defecto conocido: si no puede saber si la corrida terminó bien, avanza el cursor igual, y ahí puede perder mensajes.

Lo que ya existe en la oficina y se reusa:
- `proponer_accion` (`backend/src/acciones.ts`): el agente propone una herramienta de actuar de un conector y recién se
  ejecuta cuando la persona la aprueba (`Acciones.ejecutar`, un encargo con **solo** esa herramienta habilitada). La
  propuesta viaja en una entrega de la bandeja;
- los conectores de claude.ai (`conectores.ts`, `permisos.ts`): Google Calendar se lee libre y se actúa por propuesta;
- el programador (`programador.ts`), que mira la oficina activa cada 30 s y corre tareas y encargos (`encargarLibre`);
- el servidor MCP propio (`mcp-servidor.ts`, `registrarHerramientas`), donde cada módulo cuelga sus herramientas;
- los avisos calculados (`s.avisos.fuentes`), para «WhatsApp desconectado»;
- `anotar` y la memoria de la oficina, para que el secretario recuerde qué ya sugirió.

## Riesgos (y qué decisión los baja)
1. **Baneo del número.** Usar un cliente no oficial va contra los términos de WhatsApp: el riesgo nunca es cero y se
   pierde el número entero. Lo que más dispara baneos es **mandar** (muchos mensajes, a gente que no te tiene agendado,
   chats nuevos, denuncias de spam). Mitigación: solo lectura y sin código para enviar, sin confirmaciones de lectura,
   sin presencia «en línea», sin pedir historial de más, sin vincular y desvincular seguido, Baileys al día. Se
   recomienda probar primero con un número secundario. La pantalla de activación lo dice con todas las letras.
2. **Privacidad de terceros.** Lo que escriben otras personas termina en corridas de Claude. Mitigación: **solo se
   guardan los chats que la persona elige**; el resto se descarta en la captura, sin llegar a disco.
3. **La sesión equivale a la cuenta.** Con esos archivos se lee y se manda como la persona. Mitigación: cifrados en
   disco (ver decisión 6); «Desvincular» los borra.
4. **Inyección de prompts.** Cualquiera en un chat elegido le escribe texto al secretario. Mitigación: el secretario no
   puede mandar nada, toda acción pasa por `proponer_accion` con los argumentos a la vista, y los mensajes entran
   delimitados como datos (decisión 8). En el peor caso hay una sugerencia rara y la persona la descarta. Un grupo
   amplía quiénes pueden escribirle: por eso se eligen de a uno.
5. **Mantenimiento.** WhatsApp cambia el protocolo y Baileys se rompe hasta que lo arreglan. Mitigación: la captura está
   aislada en su propio proceso, y si falla la oficina avisa sin caerse.

## Conceptos
- **Captura**: el proceso hijo con Baileys. Mantiene la sesión, filtra por chats elegidos y anota mensajes. No sabe nada
  de agentes.
- **Chat elegido**: un chat individual o un grupo que la persona marcó para leer. Un contacto se identifica por su JID
  de número **y** por sus ids `@lid` (WhatsApp usa los dos; la lista se completa sola cuando llega un mensaje del mismo
  contacto con el otro id). Un grupo, por su JID `@g.us`. Los estados y los canales nunca se leen.
- **Mensaje**: `{id, chat, de, propio, ts, tipo, texto?, cita?, editado?, borrado?}`. `propio` = lo mandó la persona
  desde su teléfono. En un grupo, `de` es el participante que lo mandó. Se guardan los dos sentidos: si la persona ya contestó «listo, lo agendé», el secretario no tiene que
  sugerir nada.
- **Revisión**: una corrida del secretario con los mensajes nuevos de una tanda.
- **Cursor**: hasta qué mensaje se revisó, **por chat**. Avanza solo con confirmación (decisión 5).

## Decisiones de diseño
1. **La captura es un proceso aparte, supervisado por el backend.** Se lanza con `child_process.fork` (en Electron,
   `utilityProcess`) y habla con el backend por IPC con mensajes JSON (`qr`, `estado`, `mensaje`, `error`). El backend
   lo relanza con espera creciente (5 s, 30 s, 2 min, tope 10 min) y lo da por caído tras 5 fallas seguidas. Así un
   cuelgue o una fuga de Baileys no tumba la oficina, que es la versión en app del `systemd` del monitor existente.
   Topes: `--max-old-space-size=256` para el hijo. El tope de CPU queda sin equivalente portable; se mide en la fase W0.
2. **La conexión es de la app, no de la oficina.** Hay un solo WhatsApp por persona: la sesión vive en
   `<datosDir>/whatsapp/` y los mensajes en `hq.db`. Cada oficina decide en su `oficina.json` si lo usa, qué chats lee
   y qué agente es el secretario (`whatsapp: {secretario, chats:[...], cada}`). Como el programador, solo revisa la
   oficina activa; lo que llegó mientras tanto queda para cuando se abra.
3. **Grupos desde la primera versión, elegidos de a uno.** Un grupo elegido se guarda entero, con quién dijo cada cosa.
   El nombre de cada participante sale de los nombres que la persona puso a sus contactos en Ajustes; si no tiene uno,
   se muestra el número, nunca el `pushName` que manda cada uno (decisión 8). Se guarda **a partir de la vinculación**:
   no se importa historial previo (`syncFullHistory: false`), ni de grupos ni de chats individuales. Como un grupo
   suma más terceros, la lista de chats lo marca y la pantalla de activación lo menciona.
4. **Revisión por tandas, cada cuánto lo elige la persona.** La frecuencia se configura como un intervalo en minutos
   u horas (`cada: {valor, unidad: "minutos"|"horas"}`; mínimo 5 minutos, máximo 24 horas; por defecto 4 horas). Se puede
   limitar a una franja horaria (`franja: {desde: "08:00", hasta: "22:00"}`, opcional) para no revisar de noche; lo que
   llega fuera de la franja se revisa en la primera vuelta del día. Una revisión empieza cuando pasó el intervalo desde
   la última y, para no cortar una conversación a la mitad, espera hasta que el chat quede quieto 2 minutos (tope:
   10 minutos de espera).

   En cada disparo: si no hay mensajes nuevos ni alerta, **no se lanza claude** (cero costo). Si hay, se lanza un
   encargo del secretario (`Programador.encargarLibre`, id `whatsapp:<n>`) con los nuevos más hasta 10 anteriores de
   contexto por chat. Tope de 40 mensajes nuevos por revisión; si hay más, se parte en varias en fila.
5. **El cursor avanza solo con una corrida confirmada.** Al lanzar la revisión se guarda `revisiones(id, oficina,
   desde, hasta, estado='corriendo', ejecucion)`. El cursor de cada chat pasa a `hasta` **solo** cuando la ejecución
   termina `ok` (`programador.alTerminar`). Si falla, se cancela o no se puede saber (el backend se cerró a mitad de
   camino), la revisión queda `fallida` o `incierta` y la próxima vuelve a tomar esos mensajes. Esto corrige el defecto
   del monitor actual. El costo de repetir es una posible sugerencia duplicada, y eso lo cubre la decisión 7.
6. **Sesión cifrada.** En la app de escritorio, las claves de Baileys se cifran con `safeStorage` de Electron (llavero
   de macOS, DPAPI en Windows) a través de un hueco que pone la carcasa. En modo desarrollo (navegador más backend)
   quedan en claro y Ajustes lo avisa.
7. **Sin sugerencias repetidas.** El secretario recibe en la consigna las acciones que propuso en los últimos 14 días
   (`acciones` de su agente: resumen y estado) y la instrucción de mirar el calendario antes de proponer un evento. Una
   acción `descartada` cuenta como «ya la viste»: no se vuelve a sugerir lo mismo.
8. **Los mensajes entran como datos.** En la consigna van dentro de un bloque `<mensajes_whatsapp>`, con el aviso fijo
   de que son texto de terceros, que no son órdenes y que cualquier pedido que contengan se evalúa como información.
   El nombre del contacto lo pone la persona en Ajustes (no el `pushName` que manda cada uno).
9. **El secretario es un agente normal.** Se arma con una plantilla (`plantillas.ts`) con Google Calendar asignado
   (leer y crear evento) y las herramientas `whatsapp_*`. Fuera de la revisión, en sus charlas, puede consultar los chats
   elegidos («¿qué me dijo mamá esta semana?»). Ningún otro agente ve WhatsApp salvo que la persona se lo asigne.
10. **Desconexión visible.** Si la sesión se revoca, el teléfono no se conecta hace más de 12 días (a los 14 WhatsApp
    desvincula) o la captura está caída, aparece un aviso (`s.avisos.fuentes`, tipo `whatsapp`) con «Volver a vincular».
    La revisión programada también lo menciona en su entrega, como el monitor actual.

## Fase W0: spike (sin tocar la app)
- Script suelto en `tools/whatsapp-spike/` que se vincula por QR en la terminal, filtra un chat (número y `@lid`) y
  anota en jsonl, con las opciones de Baileys para no marcar leído ni presencia (`markOnlineOnConnect: false`, sin
  `readMessages`, `syncFullHistory: false`).
- Verificar:
  - que empaqueta con `esbuild` para Electron (Baileys es ESM y tiene dependencias opcionales de imágenes: dejarlas afuera);
  - el consumo real de memoria y CPU en una semana;
  - qué pasa al reconectar después de horas cerradas (llegan los mensajes atrasados);
  - que el teléfono sigue mostrando notificaciones normalmente.
- Correr con un número secundario.

## Fase W1: conectar y leer
**Backend** (`backend/src/whatsapp.ts`, módulo `whatsapp`, orden 77; captura en `backend/src/whatsapp-captura.ts`)
- Tablas en `hq.db`:
  - `wa_chats(jid PRIMARY KEY, lids TEXT, nombre, elegido, grupo, ultimo)`;
  - `wa_mensajes(id, chat, de, propio, ts, tipo, texto, cita, editado, borrado, PRIMARY KEY(chat,id))` con índice
    `(chat, ts)`;
  - `wa_estado(clave PRIMARY KEY, valor)`: estado de la conexión, última conexión del teléfono y número vinculado.
- La captura guarda en disco solo los mensajes de chats elegidos. De los demás guarda solo `jid`, nombre y `ultimo`,
  para que la persona pueda elegirlos en la lista. Nunca el texto.
- Retención: mensajes de más de 90 días se borran (configurable).

**API**
| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/api/whatsapp` | | `{estado: "apagado"\|"esperando_qr"\|"conectando"\|"conectado"\|"revocado"\|"caido", numero?, telefonoVisto?, chats:[{jid, nombre, elegido, grupo, ultimo}]}` |
| POST | `/api/whatsapp/vincular` | `{aceptoRiesgo: true}` | `{estado}`; arranca la captura. 400 sin `aceptoRiesgo` |
| GET | `/api/whatsapp/qr` | | `{qr: <data URL PNG>}` o 404 si no hay QR vigente (rota cada ~20 s) |
| POST | `/api/whatsapp/desvincular` | | `{estado:"apagado"}`; cierra sesión en WhatsApp y borra `<datosDir>/whatsapp/` |
| PUT | `/api/whatsapp/chats` | `{elegidos:[jid], nombres?:{jid: nombre}}` | `{chats}`; dejar de elegir un chat borra sus mensajes |

**Front** (Ajustes › Conectores › WhatsApp, `oficina/ui/`)
- Pantalla de activación con el aviso de riesgos (baneo, terceros, sesión) y la casilla «Entiendo los riesgos».
- QR que se refresca solo, estado de la conexión, lista de chats con buscador para elegir y ponerles nombre, y
  «Desvincular».

## Fase W2: consultar en charlas
- Herramientas MCP de solo lectura (`mcp__hq__whatsapp_*`), solo para agentes con `whatsapp: true` en su ficha:
  - `whatsapp_chats`: los chats elegidos, con nombre y último mensaje;
  - `whatsapp_leer {chat, desde?, hasta?, limite?≤100}`;
  - `whatsapp_buscar {texto, chat?, limite?≤20}` (FTS5 sobre `wa_mensajes`).
- Todas devuelven los mensajes dentro del mismo bloque delimitado de la decisión 8.
- Sirve para usar WhatsApp a mano y para medir el riesgo de baneo antes de automatizar.

## Fase W3: secretario automático
- `whatsapp` en `oficina.json`: `{secretario: <id>, chats:[jid], cada: {valor: 4, unidad: "horas"}, franja?: {desde,
  hasta}}`. Editable desde la ficha del secretario («Revisar WhatsApp cada [4] [horas]», con la franja opcional).
  `PUT /api/oficina/whatsapp` lo guarda; 400 si el intervalo queda fuera de 5 minutos a 24 horas.
- Tabla `wa_revisiones(id, oficina, chat, desde_ts, hasta_ts, estado, ejecucion, creada)` y `wa_cursores(oficina, chat,
  hasta_ts)`.
- Disparo (decisión 4) dentro del ciclo de 30 s del programador. Consigna: quién es cada contacto, los mensajes nuevos
  más el contexto, las acciones propuestas recientes (decisión 7) y qué se espera: **proponer** acciones concretas
  (evento en el calendario, tarea para otro agente, una nota con `anotar`) o, si no hay nada que hacer, entregar un
  resumen de una línea.
- Si la revisión no propone nada ni hay nada notable, la entrega se marca como resumen y no hace sonar notificación.
- Cursor confirmado (decisión 5) con `programador.alTerminar`.
- Plantilla «Secretario» en `plantillas.ts`, con instrucciones para turnos, cumpleaños, pagos y pedidos.

## Fase W4: audios e imágenes (después)
- Audios: transcribirlos en la compu (Whisper local) antes de guardarlos como texto. Hay que decidir el modelo, el peso
  de la descarga y el consumo.
- Imágenes (por ejemplo, una orden médica): pasarlas por la extracción de la biblioteca (`extraccion.ts`) o como
  adjunto de la revisión.

## Pruebas
- Unitarias (vitest):
  - filtro por chat con `@lid` y por grupo, descartando estados y canales;
  - mapeo de mensajes de Baileys, con el participante en los grupos;
  - cálculo del próximo disparo con intervalo, franja horaria y espera a que el chat quede quieto;
  - cursor que no avanza con ejecución fallida o incierta;
  - tope de tandas;
  - que no se lanza claude sin novedades;
  - bloque delimitado y saneado.
- La captura se prueba con un doble del socket de Baileys: nada de la suite toca WhatsApp de verdad.
- A mano: W0 y W1 con número secundario, y una semana conectado antes de habilitar W3.

## Decisiones de la persona
- **Sin importar el monitor existente:** la oficina no va a tener acceso a su `messages.jsonl`. Se captura con su propia
  vinculación y solo desde ese momento.
- **Frecuencia configurable** como intervalo en minutos u horas (decisión 4).
- **Grupos incluidos** en la primera versión, elegidos de a uno (decisión 3).
