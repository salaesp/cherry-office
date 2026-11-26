# Plan: Secretaría (fuentes que se revisan y avisan)

## Contexto
La persona quiere un **secretario o secretaria** en la oficina: alguien que mire lo que le llega por distintos medios
(WhatsApp, mails, eventos del calendario y, más adelante, otros), le avise con un **reporte** cada cierto tiempo o
cuando lo pide, y le **sugiera acciones** que ella aprueba. Se arranca con WhatsApp; las otras fuentes vienen después,
sobre la misma estructura.

Caso guía: la mamá escribe «el jueves 4 a las 10 tengo turno con el cardiólogo en el Italiano» y en el reporte siguiente
aparece una sugerencia para agregar ese turno al calendario.

Lo que ya existe y se reusa:
- `proponer_accion` (`backend/src/acciones.ts`): el agente propone una herramienta de actuar de un conector y recién se
  ejecuta cuando la persona la aprueba (`Acciones.ejecutar`, un encargo con **solo** esa herramienta habilitada). La
  propuesta viaja en una entrega de la bandeja;
- los conectores de claude.ai (`conectores.ts`, `permisos.ts`): Gmail y Google Calendar se leen libres y se actúa por
  propuesta;
- el programador (`programador.ts`), que mira la oficina activa cada 30 s y corre tareas y encargos (`encargarLibre`,
  `alTerminar`);
- el servidor MCP propio (`mcp-servidor.ts`, `registrarHerramientas`), donde cada módulo cuelga sus herramientas;
- los avisos calculados (`s.avisos.fuentes`);
- `anotar` y la memoria de la oficina.

Las tareas programadas repetidas (`tareas.ts`) ya permiten «revisá mis mails todos los días a las 9», pero les falta lo
que hace a una secretaría: saber **desde cuándo** revisar, no lanzar claude si no hay nada nuevo, juntar varias fuentes
en un solo reporte y un intervalo en minutos u horas en vez de días y hora fija.

## Conceptos
- **Secretaría**: la función, configurada por oficina en `oficina.json` (`secretaria`). La cumple **un agente** de la
  oficina (el secretario o la secretaria), que es un agente normal: tiene apariencia, charla, permisos y conectores.
  Hay como mucho una secretaría por oficina.
- **Fuente**: algo que la secretaría revisa. Dos clases:
  - **local**: la oficina captura y guarda los datos ella misma, así que sabe sin gastar nada si hay novedades.
    WhatsApp es la primera (y por ahora la única).
  - **de conector**: la lee el agente durante la revisión con las herramientas de un conector de claude.ai (Gmail,
    Calendar…). La oficina no guarda esos datos ni puede saber si hay novedades sin correr claude.
- **Revisión**: una corrida del agente que mira **todas las fuentes con novedades juntas** y produce un reporte.
  - **periódica**: cada cierto intervalo (decisión 4);
  - **bajo demanda**: «Revisar ahora», o pidiéndoselo en la charla (decisión 5).
- **Reporte**: la entrega que deja la revisión en la bandeja. Tiene una sección por fuente con lo relevante y, aparte,
  las **sugerencias**: cada una es un `proponer_accion` que la persona aprueba, edita o descarta.
- **Cursor**: hasta dónde se revisó, **por fuente** (y por chat en WhatsApp). Avanza solo con una revisión confirmada
  (decisión 6).

## Decisiones de diseño (generales)
1. **Una interfaz para todas las fuentes.** Cada fuente es un módulo que implementa:
   ```ts
   type Fuente = {
     tipo: string                         // 'whatsapp', 'conector'
     id: string                           // 'whatsapp', 'conector:gmail'
     nombre: string                       // lo que ve la persona
     /** true/false si se puede saber sin claude; undefined si no (fuentes de conector). */
     novedades(oficina: string, desde: Cursor): boolean | undefined
     /** Lo que va en la consigna para esta fuente, y hasta dónde llega. */
     material(oficina: string, desde: Cursor): { texto: string; hasta: Cursor }
     /** Herramientas que el agente necesita en la revisión (MCP propias o de conector). */
     herramientas(oficina: string): string[]
     /** Problema visible (desconectada, sesión vencida…), o undefined. */
     estado(): { aviso: string } | undefined
   }
   ```
   Las fuentes se registran en `s.huecos.fuentesSecretaria`. Agregar Gmail más adelante es escribir una fuente, sin
   tocar la secretaría.
2. **Fuentes de conector por instrucción, sin copiar datos.** Una fuente de conector no guarda mails ni eventos: su
   `material` es una instrucción («buscá con `<herramienta>` los mails recibidos desde `<fecha del cursor>`; ignorá
   promociones y newsletters») y su cursor es la fecha de la última revisión confirmada. La persona puede sumar a cada
   fuente su propia indicación («solo mails de mi jefe y del banco»). Calendar es distinto: no mira lo nuevo sino **lo
   que viene** (los eventos de las próximas 24 o 48 h), y entra en el reporte como agenda.
3. **No gastar si no hay nada.** Si todas las fuentes de la revisión periódica son locales y ninguna tiene novedades,
   no se lanza claude. Con fuentes de conector no se puede saber antes, así que cada una tiene **su propio intervalo**
   (por ejemplo WhatsApp cada 1 hora y Gmail cada 4 horas): en una vuelta entran solo las fuentes a las que les tocaba.
   Una vuelta donde solo tocaba revisar fuentes locales sin novedades no cuesta nada.
4. **Frecuencia configurable.** Cada fuente tiene `cada: {valor, unidad: "minutos"|"horas"}` (mínimo 5 minutos, máximo
   24 horas). La secretaría tiene una franja horaria opcional (`franja: {desde: "08:00", hasta: "22:00"}`) para no
   revisar de noche; lo que llega fuera de la franja entra en la primera vuelta del día. Las fuentes a las que les toca
   en la misma vuelta del programador (30 s) van en una sola revisión y un solo reporte.
5. **Bajo demanda.** Tres formas:
   - botón «Revisar ahora» en la ficha de la secretaría (todas las fuentes, o una sola);
   - en la charla con el secretario: «¿qué hay de nuevo?» o «¿qué me dijo mamá hoy?». En la charla tiene las mismas
     herramientas de lectura de sus fuentes;
   - desde el ícono de la bandeja del sistema: «Revisar ahora».

   La revisión bajo demanda avanza el cursor igual que una periódica, así la siguiente periódica no repite.
6. **El cursor avanza solo con una revisión confirmada.** Al lanzar se guarda `sec_revisiones(id, oficina, fuentes,
   desde, hasta, estado='corriendo', ejecucion)`. Los cursores de esas fuentes pasan a `hasta` **solo** cuando la
   ejecución termina `ok` (`programador.alTerminar`). Si falla, se cancela o no se puede saber (el backend se cerró a
   mitad de camino), la revisión queda `fallida` o `incierta` y la próxima vuelve a tomar ese tramo. El costo de
   repetir es una posible sugerencia duplicada, y eso lo cubre la decisión 7.
7. **Sin sugerencias repetidas.** La consigna incluye las acciones que propuso el secretario en los últimos 14 días
   (`acciones` de su agente: resumen y estado) y la instrucción de mirar el calendario antes de proponer un evento.
   Una acción `descartada` cuenta como «ya la viste»: no se vuelve a sugerir lo mismo.
8. **Lo que entra de afuera es dato, no orden.** El material de cada fuente va en un bloque delimitado
   (`<fuente id="whatsapp">…</fuente>`), con el aviso fijo de que es texto de terceros: lo que pida se evalúa como
   información. El secretario nunca manda nada por su cuenta: todo lo que sale pasa por `proponer_accion`.
9. **Reporte con poco ruido.** Si la revisión no encuentra nada relevante, no deja entrega (periódica) o contesta «nada
   nuevo» (bajo demanda). Solo hace sonar notificación si trae sugerencias o algo marcado como urgente (el agente lo
   dice en el reporte: `urgente: true`). Opción «Dejar reporte aunque no haya nada» apagada por defecto.
10. **Solo en la oficina activa**, como el programador. Lo que llegó mientras tanto entra en la primera revisión al
    abrirla.

## Fuente WhatsApp

### Antecedente
La persona ya tiene un monitor así andando con otro agente, y de ahí salen varias decisiones:
- un proceso Node con Baileys, aparte del agente, que escucha **solo el chat objetivo** (por número y por sus ids
  `@lid`), ignora grupos y estados y guarda entrantes **y salientes**. No tiene lógica para enviar;
- un supervisor que lo relanza si se cae y le pone tope de RAM y CPU. Si WhatsApp revoca la sesión, hay que volver a
  escanear el QR;
- una revisión programada que deduplica, agrega hasta 10 mensajes anteriores de contexto y despierta al agente **solo si
  hay novedades o una alerta de desconexión**;
- un defecto conocido: si no puede saber si la corrida terminó bien, avanza el cursor igual (corregido en la decisión 6).

La oficina **no** reusa ese monitor ni sus archivos: tiene su propia vinculación y guarda desde ese momento.

WhatsApp no tiene API oficial para leer chats personales (la Cloud API de Business solo ve un número de empresa
verificado y necesita webhooks públicos). El camino es un **cliente no oficial** vinculado como dispositivo por QR:
**Baileys**, que habla el protocolo por WebSocket sin navegador.

### Riesgos
1. **Baneo del número.** Va contra los términos de WhatsApp: el riesgo nunca es cero y se pierde el número entero. Lo
   que más dispara baneos es **mandar**. Mitigación: solo lectura y sin código para enviar, sin confirmaciones de
   lectura, sin presencia «en línea», sin pedir historial, sin vincular y desvincular seguido, Baileys al día. Probar
   primero con un número secundario. La pantalla de activación lo dice con todas las letras.
2. **Privacidad de terceros.** Lo que escriben otras personas termina en corridas de Claude. Mitigación: **solo se
   guardan los chats que la persona elige**; el resto se descarta en la captura, sin llegar a disco.
3. **La sesión equivale a la cuenta.** Con esos archivos se lee y se manda como la persona. Mitigación: cifrados en
   disco; «Desvincular» los borra.
4. **Inyección de prompts.** Cualquiera en un chat elegido le escribe texto al secretario. Mitigación: decisión 8. Un
   grupo amplía quiénes pueden escribirle: por eso se eligen de a uno.
5. **Mantenimiento.** WhatsApp cambia el protocolo y Baileys se rompe hasta que lo arreglan. Mitigación: la captura está
   aislada en su propio proceso, y si falla la oficina avisa sin caerse.

### Conceptos
- **Captura**: el proceso hijo con Baileys. Mantiene la sesión, filtra por chats elegidos y anota mensajes. No sabe
  nada de agentes.
- **Chat elegido**: un chat individual o un grupo que la persona marcó para leer. Un contacto se identifica por su JID
  de número **y** por sus ids `@lid` (WhatsApp usa los dos; la lista se completa sola cuando llega un mensaje del mismo
  contacto con el otro id). Un grupo, por su JID `@g.us`. Los estados y los canales nunca se leen.
- **Mensaje**: `{id, chat, de, propio, ts, tipo, texto?, cita?, editado?, borrado?}`. `propio` = lo mandó la persona
  desde su teléfono. En un grupo, `de` es el participante. Se guardan los dos sentidos: si la persona ya contestó
  «listo, lo agendé», no hay nada que sugerir.

### Decisiones
1. **La captura es un proceso aparte, supervisado por el backend.** Se lanza con `child_process.fork` (en Electron,
   `utilityProcess`) y habla por IPC con mensajes JSON (`qr`, `estado`, `mensaje`, `error`). El backend lo relanza con
   espera creciente (5 s, 30 s, 2 min, tope 10 min) y lo da por caído tras 5 fallas seguidas. Tope de memoria con
   `--max-old-space-size=256`; el de CPU no tiene equivalente portable y se mide en el spike.
2. **La conexión es de la app, no de la oficina.** Hay un solo WhatsApp por persona: la sesión vive en
   `<datosDir>/whatsapp/` y los mensajes en `hq.db`. Cada oficina elige en su secretaría qué chats lee.
3. **Grupos desde la primera versión, elegidos de a uno.** Un grupo elegido se guarda entero, con quién dijo cada cosa.
   El nombre de cada participante (y de cada contacto) es el que la persona le puso en Ajustes; si no tiene uno, se
   muestra el número, nunca el `pushName` que manda cada uno. Se guarda **a partir de la vinculación**
   (`syncFullHistory: false`).
4. **Material para la revisión:** los mensajes nuevos de cada chat elegido más hasta 10 anteriores de contexto. Tope de
   40 mensajes nuevos por revisión; si hay más, se parte en varias en fila. Para no cortar una conversación a la mitad,
   una revisión periódica espera a que los chats con novedades queden quietos 2 minutos (tope: 10 minutos).
5. **Sesión cifrada.** En la app de escritorio, las claves de Baileys se cifran con `safeStorage` de Electron (llavero
   de macOS, DPAPI en Windows) a través de un hueco que pone la carcasa. En modo desarrollo quedan en claro y Ajustes
   lo avisa.
6. **Desconexión visible.** Si la sesión se revoca, el teléfono no se conecta hace más de 12 días (a los 14 WhatsApp
   desvincula) o la captura está caída, la fuente lo informa en `estado()`: aparece un aviso (`s.avisos.fuentes`, tipo
   `secretaria`) con «Volver a vincular» y el próximo reporte lo menciona.
7. **Cómo se eligen los chats.** En Ajustes › Conectores › WhatsApp, después del QR, de dos formas:
   - **de una lista** con buscador (por nombre o número): la arman los chats recientes y los grupos que WhatsApp manda
     al vincular (`messaging-history.set` sin historial, `groupFetchAllParticipating`) más los chats que van escribiendo
     después. Muestra nombre, número (o «grupo · N participantes») y cuándo fue el último mensaje. De un chat no
     elegido se guarda solo eso, **nunca el texto**;
   - **por número**: se escribe el número con código de país y queda elegido aunque nadie haya escrito todavía desde
     ahí. Es lo más directo para un contacto conocido.

   Al elegir un chat se le pone un **nombre** («Mamá»; es el que ve el secretario) y una **nota** opcional para el
   secretario («es mi mamá, tiene turnos médicos seguido y me avisa por acá»), que va en el material de la revisión
   como contexto. Se lee **desde que se elige**: lo anterior no se recupera. Dejar de elegirlo borra sus mensajes. En
   un grupo elegido se leen todos los participantes (filtrar por participante queda para después). Estados y canales
   no aparecen.

   La lista es de la app (hay un solo WhatsApp); cada oficina marca, entre los chats elegidos, cuáles revisa su
   secretaría (`fuentes[].chats`). Un chat agregado por número tiene que reconocer el primer mensaje que llegue con su
   id `@lid`: la captura usa el mapeo número↔`@lid` de Baileys y, si lo encuentra, suma el `@lid` a `wa_chats.lids`.

## Configuración
`secretaria` en `oficina.json`:
```json
{
  "agente": "sofia",
  "franja": { "desde": "08:00", "hasta": "22:00" },
  "reporteVacio": false,
  "fuentes": [
    { "id": "whatsapp", "cada": { "valor": 1, "unidad": "horas" }, "chats": ["54911...@s.whatsapp.net", "1203...@g.us"] },
    { "id": "conector:gmail", "cada": { "valor": 4, "unidad": "horas" }, "indicacion": "solo mails del banco y del colegio" }
  ]
}
```
Se edita desde la ficha del secretario («Secretaría»): qué fuentes, cada cuánto, la franja y «Revisar ahora». El agente
recibe solo las herramientas de las fuentes que tiene; ningún otro agente ve WhatsApp salvo que la persona se lo
asigne.

## API
| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/api/secretaria` | | `{config, fuentes:[{id, nombre, tipo, estado?, ultimaRevision?, proxima?}], revisiones:[últimas 20]}` |
| PUT | `/api/secretaria` | `{agente?, franja?, reporteVacio?, fuentes?}` | `{config}`; 400 si un intervalo queda fuera de 5 minutos a 24 horas o la fuente no existe |
| POST | `/api/secretaria/revisar` | `{fuentes?: [id]}` | `{revision}`; bajo demanda. 409 si ya hay una corriendo |
Las rutas de WhatsApp (`/api/whatsapp*`) ya están implementadas: ver la sección «WhatsApp» de [backend/API.md](../backend/API.md).

## Fases
### S0: spike de WhatsApp (hecho)
`tools/whatsapp-spike/`, probado con un WhatsApp real durante poco tiempo (no la semana prevista). Lo que se aprendió:
- **Al vincular llega mucho historial** aunque `syncFullHistory` sea false: unos 25.000 mensajes recientes en tandas
  (`syncType` 3, del 20 % al 100 %). Se aceptan, como hace WhatsApp Web, y se descartan sin guardar. La pantalla muestra
  «Trayendo la lista de chats (N %)» mientras dura.
- **Los nombres de la agenda llegan después**, por otra vía (unos 200 de 670 entradas, todos los grupos con nombre). El
  resto se muestra con el nombre que cada uno eligió para sí, como pista («~Juli»), o con el número. Los agentes nunca
  ven esa pista: ven el nombre que la persona puso al elegir el chat.
- **Una persona puede aparecer con su número y con su `@lid`**: la lista las junta (`wa_lids`).
- **`@lid` de un elegido por número:** se averigua al conectar (`getLIDForPN`); en grupos, el remitente llega con su
  número (`participantAlt`).
- Consumo esperando el QR o conectado sin actividad: unos 100 a 115 MB de RAM y cerca de 1 % de CPU.
- Empaqueta con esbuild en un solo archivo ESM con el WebAssembly adentro.
- Quedaron sin medir: una semana corriendo, reconexión tras horas cerrada, notificaciones del teléfono y si un mensaje
  nuevo de un elegido por número llega con `via: "alternativo"`.

### S1: WhatsApp conectado y legible (hecho)
Implementado como se describe en la sección «WhatsApp» de [backend/API.md](../backend/API.md). Cambios respecto de lo
planeado:
- **Qué agente lee:** mientras no exista la secretaría (S2), lo decide un permiso del agente (`"whatsapp"`, el
  interruptor «Puede leer WhatsApp» en su ficha), y lee todos los chats elegidos. En S2 la secretaría lo reemplaza o lo
  acota por oficina.
- **Búsqueda** con `LIKE` sobre el texto sin acentos (`norm`), no FTS5: son pocos mensajes (solo chats elegidos, 90 días).
- **Ajustes › WhatsApp** es una sección propia de «Toda la app», no parte de Conectores (que es de cada oficina).
- **Desvincular** borra todo: sesión, lista de chats, relaciones número↔`@lid` y mensajes.
- **Sesión cifrada** con una clave aleatoria guardada con `safeStorage` (`desktop/src/whatsapp.ts`); la captura cifra
  cada archivo con AES-256-GCM.
- **Pendiente:** el aviso de «el teléfono no se conecta hace más de 12 días» (decisión 6 de WhatsApp) no está: Baileys
  no da esa fecha de forma directa. Quedan los avisos de sesión revocada y de captura caída.
- **Sin probar todavía:** la app de escritorio empaquetada (la captura lanzada con `fork` desde Electron y fuera
  del asar) y una vinculación real desde la app. En modo desarrollo, la captura real llega hasta el QR.

### S2: la secretaría, con WhatsApp como primera fuente (hecho)
Implementada como se describe en la sección «Secretaría» de [backend/API.md](../backend/API.md). Cambios respecto de lo
planeado:
- **Cursor de WhatsApp por orden de llegada** (rowid), no por hora: con la hora en segundos se perdían mensajes del
  mismo segundo, y así también entran los atrasados que llegan al reconectar.
- **Sin plantilla «Secretaría»:** `plantillas.ts` arma carpetas y archivos de una oficina, no es un catálogo de agentes.
  La secretaría se activa en la ficha de cualquier agente («Que atienda la secretaría») y las instrucciones van en la
  consigna de cada revisión.
- **Quién lee WhatsApp:** quien atiende la secretaría recibe las herramientas de WhatsApp acotadas a los chats de su
  fuente, sin necesitar el permiso general de S1.
- **Sin validación en `oficina.json`:** una secretaría que quedó inválida (por ejemplo, despidieron a quien la atendía) no
  traba la oficina; no corre hasta que se arregla en la ficha. El `PUT` sí valida.
- **Al exportar** la oficina, la secretaría viaja sin los chats (números de teléfono).
- **Sin novedades:** la entrega queda silenciosa y ya revisada (no se descarta: sirve de registro).

### S3: fuentes de conector (hecho)
Gmail y Calendario, como se describe en la sección «Secretaría» de [backend/API.md](../backend/API.md). Cambios respecto
de lo planeado:
- Dos fuentes con id fijo (`gmail`, `calendario`) sobre una `fuenteConector` genérica que reconoce el servidor del
  catálogo por el nombre (`/gmail/i`, `/calendar|calendario/i`).
- **El agente tiene que tener el conector asignado para leer** (o el modo «todos»): la revisión corre con sus permisos
  normales. Si no, la fuente muestra el problema y no se revisa (no se gasta en una revisión que no puede leer).
- Se configuran en la misma sección de la ficha (prender, cada cuánto, indicación).

### S4: audios e imágenes de WhatsApp (hecho)
Como se describe en la sección «WhatsApp» de [backend/API.md](../backend/API.md). Lo que se decidió y probó:
- **Whisper local con Transformers.js y onnxruntime-node** (modelo base, q8, ~80 MB). Probado con una nota de voz real en
  OGG/Opus: unos 2 segundos para 11 segundos de audio con el modelo ya bajado, ~700 MB de memoria mientras trabaja. El
  transcriptor es un proceso aparte que se apaga solo.
- **Se descartó WebAssembly:** Transformers.js en Node fuerza el motor nativo, y whisper.cpp en WebAssembly es solo para
  navegador. A cambio, el motor nativo se copia recortado a cada plataforma: ~45 MB en Mac (solo
  `libonnxruntime.1.dylib`, que es lo que pide el binding) y ~66 MB en Windows (con DirectML, que onnxruntime.dll nombra y
  no se pudo confirmar desde Linux que sea opcional). `sharp` (imágenes) se reemplaza por un módulo vacío.
- **Imágenes:** no se procesan; el agente las mira con `whatsapp_imagen`, que devuelve contenido `image` de MCP (el
  servidor MCP propio ahora puede devolver imágenes).
- **Medios cifrados** con la misma clave de la sesión.
- **Sin probar todavía:** el transcriptor dentro de la app de Mac y Windows empaquetada (el armado de recursos se probó en
  Linux), y la calidad en español con notas de voz reales.

## Pruebas
- Unitarias (vitest):
  - WhatsApp: filtro por chat con `@lid` y por grupo, descartando estados y canales; mapeo de mensajes de Baileys con
    el participante en los grupos;
  - próxima revisión por fuente con intervalo, franja horaria y espera a que el chat quede quieto;
  - que fuentes que coinciden en la misma vuelta salen en una sola revisión;
  - cursor que no avanza con ejecución fallida o incierta, y que avanza con una revisión bajo demanda;
  - que no se lanza claude si solo tocaban fuentes locales sin novedades;
  - bloque delimitado y saneado.
- La captura se prueba con un doble del socket de Baileys: nada de la suite toca WhatsApp de verdad.
- A mano: S0 y S1 con número secundario, y una semana conectado antes de habilitar S2.

## Decisiones de la persona
- **Una secretaría general, no solo WhatsApp:** fuentes que se revisan cada cierto tiempo o bajo demanda y dejan un
  reporte. Se empieza por WhatsApp; mails, eventos y otras fuentes vienen después.
- **Sin importar el monitor existente:** la oficina no va a tener acceso a sus archivos. Captura con su propia
  vinculación y desde ese momento.
- **Frecuencia configurable** como intervalo en minutos u horas.
- **Grupos de WhatsApp incluidos** en la primera versión, elegidos de a uno.
- **Chats elegidos de una lista o por número**, con nombre y nota para el secretario (decisión 7 de WhatsApp).
