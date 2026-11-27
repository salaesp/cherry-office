# Plan: Recados a la secretaría (hablarle y que delegue)

## Contexto
Hoy la secretaría **mira lo que te llega** (WhatsApp, Gmail, Calendario), anota en su memoria y te avisa con reportes y
propuestas. Lo que falta es el sentido contrario: que **vos le hables a ella** —desde el celular, por texto o audio— y
que entienda qué hacer con eso: contestarte, anotarlo, hacerlo ella (con una acción que aprobás) o **pasárselo a otro
agente de la oficina** y avisarte cuando esté.

Caso guía: caminando por la calle grabás «decile a Marce que arme el presupuesto para lo de Prospera con los números del
mail de ayer, y recordame el viernes llamar al contador». La secretaría transcribe, le encarga a Marce el presupuesto con
una consigna que se entiende sola, te propone un evento el viernes para llamar al contador, y te contesta en dos líneas
qué hizo. Cuando Marce termina, te avisa por el mismo lado por donde le hablaste.

Este plan arma **la base** (el recado, cómo se entiende, cómo se delega y cómo se cierra el circuito) con la app como
primer canal. Telegram y WhatsApp quedan planteados pero no se hacen ahora.

### Lo que ya existe y se reusa
- **Quien atiende la secretaría** (`secretaria.ts`): agente con despacho propio, memoria privada (`memoria_*`), herramientas
  de WhatsApp, Gmail y Calendario, y una consigna que ya dice que en la charla contesta «¿qué tengo mañana?».
- **`encargar`** del coordinador (`coordinador.ts` → `Programador.encargarLibre`): le pasa trabajo a otro agente, corre
  enseguida y deja una entrega. Tope de 3 por corrida, no a sí mismo.
- **Lectura del estado de la oficina** (`estado_oficina`, `entregas`, `corridas`, `bloqueos`): para contestar «¿cómo va lo
  de Marce?».
- **`proponer_accion`** (`acciones.ts`): todo lo que sale para afuera (mandar un mail, crear un evento) pasa por tu
  aprobación.
- **Tareas programadas** (`tareas.ts`, con `origen`): para «que Marce lo haga mañana a las 9».
- **Transcriptor local** (`whatsapp-transcriptor.ts`, Whisper con Transformers.js): ya transcribe notas de voz en la compu,
  sin mandar el audio a nadie. Hoy solo decodifica OGG/Opus.
- **Charla con un agente** (`rutas-chat.ts`, `store.ts`): sesiones, mensajes, streaming, adjuntos.
- **`programador.alTerminar`**: el gancho para enterarse de que un encargo terminó, falló o quedó esperando.

## Conceptos
- **Recado**: algo que le dejás a la secretaría. Texto o audio (más adjuntos opcionales), con su **canal** de entrada
  (`app`, `movil`, `telegram`, `whatsapp`) y un **estado**. Es tuyo: viene de un canal autenticado, así que es una orden
  tuya, no un dato de terceros (a diferencia de lo que entra por las fuentes).
- **Hilo de recados**: una charla especial de la secretaría donde caen todos los recados, de cualquier canal, en orden.
  Se ve en la app como una charla más (con «Recados» en vez de un título), y es lo mismo que vas a ver en el celular. Así
  ella tiene el contexto de lo anterior («y también decile que…») y vos tenés un solo lugar donde mirar.
- **Resultado** de un recado: uno o más de estos, porque un mismo audio puede traer varias cosas:
  | Tipo | Ejemplo | Qué hace |
  |---|---|---|
  | **contestar** | «¿qué tengo mañana?», «¿qué dijo mamá?» | Lee sus fuentes y memoria, contesta. |
  | **anotar** | «el seguro del auto vence el 10» | Lo guarda en su memoria; si tiene fecha, propone evento. |
  | **hacer ella** | «mandale a Juan el mail de confirmación» | `proponer_accion` (lo aprobás). |
  | **delegar** | «que Marce arme el presupuesto» | Encargo a otro agente (ahora o programado). |
  | **preguntar** | «pasale eso a alguien» (¿a quién? ¿qué es «eso»?) | Te repregunta y el recado queda esperando. |
- **Delegación**: un encargo que nace de un recado. Lleva `origen: {recado}` para poder seguirlo y avisarte al terminar.

## El flujo

```
 Canal (app · celular · Telegram · WhatsApp)
        │  texto / audio / adjuntos
        ▼
 1. Recibir ──► recado guardado (estado: recibido)  ──► acuse inmediato: «Recibido»
        │
        ▼  si es audio
 2. Transcribir (Whisper local) ──► estado: transcribiendo ──► el texto se ve en el hilo
        │
        ▼
 3. Entender: corrida de la secretaría en su hilo de recados
        │   con: su memoria, sus fuentes, el equipo (quién hace qué), lo que está en curso
        │   herramientas: delegar · proponer_accion · memoria_* · leer fuentes · estado de la oficina
        ▼
 4. Actuar (puede ser varias cosas a la vez)
        ├─ contestar ............................► respuesta en el hilo        → estado: respondido
        ├─ anotar ...............................► memoria (+ propuesta evento) → estado: respondido
        ├─ hacer ella ...........................► proponer_accion             → estado: esperando tu ok
        ├─ delegar ..............................► encargo / tarea programada  → estado: delegado
        └─ preguntar ............................► repregunta                  → estado: esperando tu respuesta
        │
        ▼
 5. Responder por el mismo canal: qué entendió y qué hizo, corto («Le pasé a Marce el presupuesto. Te agendé el viernes 10 h
    llamar al contador: confirmalo acá»), con botones para aprobar lo que necesita tu ok.
        │
        ▼
 6. Seguimiento: cuando la delegación termina, falla o necesita algo (alTerminar)
        └─► mensaje en el hilo + aviso por el canal: «Marce terminó el presupuesto → ver»  → estado: hecho
```

Cada recado se procesa **de a uno** (cola por oficina), así no hay dos corridas de la secretaría pisándose y el segundo
recado ve lo que hizo el primero.

## Decisiones de diseño
1. **El recado es asincrónico, no una charla en vivo.** La charla de hoy necesita la pantalla abierta mirando el stream. El
   recado se encola, se procesa aunque nadie mire y la respuesta queda en el hilo (y sale por el canal). La app, si está
   abierta, lo muestra en vivo igual que una charla.
2. **Un solo hilo de recados por oficina, guardado como charla de la secretaría** (sesión marcada `recados`). Reusa el
   almacenamiento, el streaming y la pantalla de charla. La sesión de claude se renueva cuando crece demasiado (como las
   charlas largas), con un resumen de lo pendiente para no perder contexto.
3. **Herramienta nueva `delegar`, solo para la secretaría y solo en el hilo de recados.** Parecida a `encargar`, pero:
   - `{agente, nombre, consigna, cuando?}`: `cuando` vacío corre ya (`encargarLibre`); con fecha, crea una tarea de una vez
     (`tareas.ts`) con `origen: {recado}`;
   - la consigna tiene que entenderse sola (el otro agente no escuchó el audio): la herramienta lo exige en su descripción y
     rechaza consignas muy cortas;
   - tope de 3 por recado, no a sí misma, solo agentes de la oficina;
   - adjuntos del recado viajan con la delegación (las rutas en `archivos/adjuntos/recados/…`).
   No se le da `encargar` completo de coordinador: no hace falta que vea ni reparta todo, solo lo que le pedís.
4. **Cuándo delega directo y cuándo pregunta** (decisión abierta, ver abajo). Propuesta:
   - **Pedido explícito** («que Marce haga X») → delega directo y te avisa, con «Cancelar» mientras no empezó.
   - **Inferido** («habría que ver lo del presupuesto») → lo propone y espera tu ok.
   - **Para afuera** (mail, WhatsApp, evento) → siempre `proponer_accion`, como hoy. Nunca sale nada sin tu ok.
5. **Si no está claro, pregunta en vez de adivinar.** Ambigüedad en quién, qué o cuándo → repregunta corta y el recado queda
   `esperando`. Tu próximo recado se lee como respuesta a esa pregunta.
6. **El texto del recado es tuyo; lo que trae adentro, no.** Si reenviás un mail o pegás un mensaje de otro, ese contenido va
   como dato (igual que el material de las fuentes): lo que pida se evalúa, no se obedece.
7. **Audio transcripto en la compu.** El transcriptor de WhatsApp pasa a ser genérico (`transcriptor.ts`, mismo proceso hijo,
   misma elección de modelo e idioma en Ajustes). Para no depender del formato de cada navegador (Chrome graba WebM, Safari
   MP4, Telegram manda OGG), la interfaz decodifica el audio con Web Audio y manda **PCM 16 kHz mono** (WAV); OGG/Opus
   (Telegram, WhatsApp) sigue entrando por el decodificador que ya hay. Tope de 5 minutos por audio. El audio se guarda
   cifrado como los de WhatsApp y se borra a los 30 días (queda la transcripción).
8. **La respuesta es corta y dice lo que hizo**, no lo que pensó: una línea por resultado, con enlaces a la entrega, tarea o
   propuesta. En el celular no se lee un informe.
9. **Se cierra el circuito.** `alTerminar` de una ejecución con `origen.recado` deja un mensaje en el hilo y avisa por el
   canal del recado. Si la delegación falla o el agente queda esperando algo tuyo, también. Esto convive con la bandeja:
   la entrega sigue llegando ahí; el aviso del hilo es el enlace rápido.
10. **«¿Cómo va…?»** La secretaría tiene, en el hilo, lectura de lo que está en curso (las herramientas de lectura del
    coordinador, acotadas a lo que nació de recados más el parte del día) para contestar sin que vos abras la app.
11. **Memoria.** Lo que le contás («mi contador es Rubén») va a su memoria como hoy, con origen `[Recado]`. Cada delegación
    abierta es un tema en seguimiento que se cierra solo cuando termina.
12. **Oficina destino.** El recado va a la secretaría de la **oficina activa**. Si no hay ninguna abierta o no tiene
    secretaría, el canal contesta eso y no lo pierde: queda en una cola de la app y entra al abrir la oficina. (La app
    tiene que estar corriendo en la compu: los agentes corren ahí.)
13. **Un canal = una interfaz**, como las fuentes:
    ```ts
    type Canal = {
      id: 'app' | 'movil' | 'telegram' | 'whatsapp'
      /** Mandarte texto (respuesta, aviso), con botones opcionales (aprobar / descartar / ver). */
      responder(recado: RecadoId | undefined, texto: string, botones?: Boton[]): Promise<void>
      estado(): { aviso: string } | undefined
    }
    ```
    Lo que entra desde cualquier canal termina en `Recados.recibir({canal, texto?, audio?, adjuntos?})`. Sumar Telegram es
    escribir un canal, sin tocar el resto.

## Recados y flujos
Un flujo es un proceso que vos ya definiste (pasos, quién hace cada uno, dónde aprobás). Si lo que pedís encaja con uno,
la secretaría tiene que **arrancar ese flujo** en vez de inventar una delegación suelta. Y como los flujos se frenan
esperándote, el hilo de recados es el lugar natural para destrabarlos desde el celular. Hoy un flujo solo se arranca desde
la pantalla (`MotorFlujos.iniciar(flujo, nombre, contexto, adjuntos)`) y ningún agente tiene una herramienta para eso.

1. **Arrancar un flujo desde un recado.** Herramienta nueva `arrancar_flujo({flujo, nombre, contexto})`, solo en el hilo de
   recados. La secretaría ve la lista de flujos de la oficina (nombre, descripción, primer paso) y elige el que encaja. El
   `contexto` es lo que dijiste, escrito para que lo entienda el primer paso; los adjuntos del recado viajan como adjuntos
   de la corrida. Misma regla que `delegar`: si se lo pedís por nombre («arrancá el alta de cliente para Prospera») va
   directo; si lo dedujo, te lo propone. Ante la duda entre un flujo y una delegación suelta, gana el flujo. Si no tiene
   los datos que el primer paso necesita, te los pregunta antes de arrancar.
2. **Te avisa cuando un flujo te necesita.** Cuando una corrida que nació de un recado (o, si lo prendés, cualquier corrida)
   llega a un paso con aprobación o a un paso tuyo (`quien: "persona"`), sale un mensaje al hilo y por el canal:
   - **aprobación**: «El presupuesto de Marce está listo para aprobar → ver», con botones **Aprobar** y **Pedir cambios**.
     Pedir cambios abre la respuesta: lo que digas (texto o audio) es la nota que recibe el paso (`volver` con nota);
   - **paso tuyo**: «Te toca: firmar el contrato». Contestás «hecho» con una nota y, si hace falta, una foto o un archivo,
     que llegan como entrega del paso (`hecho` con nota y archivos). Desde Telegram es mandar la foto del papel firmado.
3. **Aprobar por botón o por voz.** Los botones llevan el id de la corrida y el paso: no hay nada que interpretar. Si en
   cambio lo decís con palabras («aprobale el presupuesto a Marce»), la secretaría usa `aprobar_paso` / `pedir_cambios`
   solo si hay **una sola** corrida que encaja; si hay más, pregunta cuál. Estas herramientas solo existen en el hilo de
   recados (donde quien habla sos vos), nunca en revisiones de fuentes: un mensaje de WhatsApp de otro no puede aprobar nada.
4. **Seguimiento.** «¿Cómo va el alta de Prospera?» se contesta con el estado de la corrida (en qué paso está, quién lo
   tiene, desde cuándo). Al terminar, o si queda trabada (lo que ya detecta `MotorFlujos.barrer`), te avisa.
5. **Programado.** «Arrancá el cierre de mes el lunes» necesita que una tarea programada pueda arrancar un flujo; hoy las
   tareas solo corren un agente. Se suma `flujo` a la tarea de una vez (`tareas.ts`) en vez de hacer otro programador.
6. **De delegación repetida a flujo** (después). Si le pedís varias veces la misma cadena («que Marce arme el presupuesto y
   después Betty lo revise»), te sugiere guardarla como flujo, con un borrador armado como el de las esperas
   (`/api/esperas/flujo`).

## Cómo decide, y la vista de recados
Ejemplos navegables en [bocetos/secretaria/recados.html](../bocetos/secretaria/recados.html): arranca un flujo, duda entre
flujo o no, busca en WhatsApp, pasa datos de WhatsApp a un flujo, aprobás un paso, varias cosas en un audio.

**Cómo se da cuenta de que es un flujo.** No queda librado al modelo:
1. **Catálogo en la consigna.** Cada flujo suma dos campos opcionales a `FlujoDef`: `disparadores` (frases que lo nombran:
   «presupuesto», «cotización») y `datos` (lo que necesita para arrancar, con obligatorios: `cliente*`, `pedido*`, `plazo`).
   El editor de flujos los pide; el Creador los propone al armar la oficina.
2. **`arrancar_flujo({flujo, modo, por_que, datos, citas?})`.** `modo: "directo"` solo lo acepta el backend si el texto del
   recado nombra el flujo o usa uno de sus disparadores; si no, la tarjeta sale como propuesta. Si falta un dato
   obligatorio, no arranca y le devuelve el error para que te lo pregunte.
3. **Ventana para deshacer.** Lo directo (flujo o delegación) espera 45 s antes de empezar; la tarjeta muestra la cuenta y
   «Deshacer».
4. **`preguntar({texto, opciones})`.** Cada opción lleva la acción que haría (arrancar tal flujo, delegar a tal agente,
   anotar). Tocar una la ejecuta tal cual; contestar con palabras se lee como respuesta.

**Datos de WhatsApp y de su memoria.**
- **Citas verificables:** en sus respuestas escribe referencias (`[wa:8812]`) y el backend las cambia por la cita con el
  mensaje guardado. Lo citado es el mensaje real, no su versión.
- **Compartir lo mínimo:** los demás agentes no leen WhatsApp ni su memoria. `delegar` y `arrancar_flujo` reciben
  `citas` aparte; en la consigna o el contexto va copiado solo ese fragmento, y la tarjeta muestra con un candado
  exactamente qué se compartió.

**La vista propia.** Los recados no se ven como una charla común sino como un hilo de **tarjetas**: tu recado (con la
transcripción), una línea «Entendí: …» y una tarjeta por resultado: flujo (pasos, datos con su origen, por qué ese flujo),
consulta (respuesta con citas), delegación (a quién, consigna, estado, qué se compartió), propuesta (evento o mail,
como en la bandeja), pregunta (opciones) y aviso de un flujo (aprobar, pedir cambios, hecho). Arriba, filtros **Todo · Te
esperan · En curso · Hechos**; «Te esperan» junta preguntas, propuestas y pasos para aprobar de todos los recados. Es la
misma vista en la app (Equipo › la secretaría › Recados), en la página del celular y, resumida, en Telegram. Para eso cada
resultado se guarda estructurado (`sec_recado_resultados(recado, tipo, datos, estado)`), no solo como texto de la charla.

## Acceso desde el celular
El backend hoy solo escucha dentro de la app (protocolo `hq://`) o en `127.0.0.1` en modo desarrollo: el celular no llega.
Tres caminos, de menos a más trabajo y riesgo:

| Camino | Cómo | A favor | En contra |
|---|---|---|---|
| **Telegram** (bot propio) | La app consulta al bot por *long polling* (sale ella, no entra nadie). | No abre ningún puerto. Funciona fuera de casa. Notificaciones, audio y botones gratis. API oficial que permite mandar. | Los recados pasan por Telegram. Hay que crear un bot con @BotFather. |
| **Página móvil en la red de casa / Tailscale** | Un servidor opcional que escucha en la IP de la red local o de Tailscale, con emparejamiento por QR y token largo. | Todo queda entre tus equipos. Se ve el hilo completo, los audios, las entregas. | Fuera de casa necesita Tailscale (o similar) en compu y celular. Más superficie de ataque. |
| **WhatsApp** | Leer tu chat «Mensajes a mí mismo» con la captura que ya hay. | Es la app que ya usás. | La captura **no tiene código para mandar** a propósito (riesgo de baneo): la secretaría no podría contestarte por ahí; las respuestas irían por otro canal. La alternativa (WhatsApp Business Cloud API) pide otro número y un webhook público. |

Recomendación: la base va en la app (R0–R1); después **Telegram** como primer canal del celular, porque resuelve llegar desde
afuera sin exponer nada; la página móvil queda para cuando quieras ver todo desde el teléfono, y WhatsApp como entrada de
solo lectura si lo pedís, sabiendo que la respuesta sale por otro lado.

Para la página móvil, si se hace: un **API acotado** solo para recados (`/movil/api/*`: mandar recado, leer el hilo,
aprobar o descartar propuestas, ver una entrega), no todo `/api`. Emparejamiento con QR desde Ajustes (token de 32 bytes,
revocable, uno por dispositivo), `Host` y `Origin` controlados como en `servidor-dev.ts`, apagado por defecto.

## Cambio de rumbo: los recados pasan a la charla (decidido el 2026-11-27)
Después de R0, la persona vio que la sección Recados era casi una segunda charla con la secretaría (el hilo ya se guardaba
como una charla suya). Se decide unirlo con la charla y abrirlo a todos los agentes. Bocetos:
[bandeja-y-microfono.html](../bocetos/secretaria/bandeja-y-microfono.html) (lo que te espera en la Bandeja y el micrófono
de la secretaría) y [recados.html](../bocetos/secretaria/recados.html) (las tarjetas y cómo decide).

**Decisiones de la persona**
1. **Se le habla a cualquier agente desde su charla** (Equipo), con texto o audio. La sección Recados se saca cuando
   esté lo nuevo.
2. **Tarjetas dentro de la charla:** debajo de la respuesta, lo que hizo: delegación (con los 45 segundos para deshacer),
   pregunta con opciones, propuesta de acción.
3. **Lo que te espera va a la Bandeja,** como siempre: en Bandeja › Hoy, una sección «Te esperan» arriba de «Para
   revisar» junta las preguntas abiertas, las delegaciones propuestas, las propuestas de acción y los permisos, de todas
   las charlas. Se contesta ahí o en la charla y queda resuelto en los dos lados. La insignia de la Bandeja las cuenta.
4. **Del backend de recados se reusa** el procesamiento en segundo plano, la transcripción, los resultados con su estado
   y la ventana para deshacer.
5. **`delegar` y `preguntar` para todos los agentes,** solo cuando el mensaje lo escribió la persona en una charla.
   Corriendo solos (encargos, tareas, pasos de flujo) no los tienen, salvo el coordinador en sus tareas programadas
   («cada mañana repartí el trabajo»). Son distintas de lo que ya existe entre agentes: `consultar` (preguntarle algo a
   un colega) y `pedir` / `quedo_esperando` (necesitar algo de un colega para el trabajo propio y esperarlo) siguen igual.
   `delegar` es pasarle a un colega un pedido de la persona, cuyo resultado le llega a ella; `preguntar` es preguntarle a
   la persona, con opciones.
6. **`delegar` reemplaza a `encargar`** del coordinador: una sola forma de pasar trabajo. El coordinador conserva ver el
   estado de la oficina (`estado_oficina`, `entregas`, `corridas`, `bloqueos`).
7. **Las instrucciones van como mensaje de sistema** (`--append-system-prompt`) para todos, como ya quedó en R0.
8. **Micrófono en el campo de escribir de cada charla:** grabás y se manda a ese agente. Se transcribe en la compu.
9. **Micrófono flotante de la secretaría:** abajo a la derecha (en el celular, arriba de la barra), con su cara y «Hablale
   a <nombre> · Secretaría». Siempre le habla a la secretaría, aunque haya otra charla abierta, y mientras graba dice para
   quién es. Sin secretaría, ofrece contratarla.
10. **Cada audio del micrófono flotante abre una charla nueva** con la secretaría. Cuando ella lo entiende (termina de
    procesarlo), la app abre esa charla para seguir desde ahí.
11. **La próxima versión sale cuando esté todo esto.**

**Hecho (U1–U5).** Como se describe en «Pasar trabajo, preguntar y hablar por audio en la charla» de
[backend/API.md](../backend/API.md). Lo que hay que saber:
- `recados.ts` y la sección Recados se fueron; sus tablas (`sec_recados*`) quedan sin uso en las bases viejas y los hilos
  de recados siguen legibles como charlas de la secretaría. Lo de delegar y preguntar vive en `delegar.ts` (tarjetas por
  charla, `charla_res`) y la transcripción suelta en `audio.ts` (`POST /api/audio/transcribir`).
- En R0, `delegar` y `preguntar` no estaban en `--allowedTools`: con el claude de verdad habrían pedido permiso. Ahora van
  permitidas para todos los agentes (el servidor solo las ofrece cuando corresponde).
- El coordinador delega (sin preguntar) en todas sus corridas sin la persona, como hacía con `encargar`, no solo en sus
  tareas programadas: el servidor MCP no distingue una tarea de un encargo o un paso de flujo.
- Elegir una opción (en la charla o en la Bandeja) manda «Elijo: …» en esa charla; desde la Bandeja, la abre.
- El micrófono flotante no aparece si el navegador no deja grabar; en el celular se esconde con un panel abierto y sube
  cuando hay un aviso abajo. El atajo de teclado para grabar (tipo walkie-talkie) quedó afuera.
- **Sin probar todavía:** con el claude de verdad (si separa bien qué delegar, cuándo pregunta y si respeta `explicito`) y
  la grabación dentro de la app de escritorio empaquetada (macOS pide el permiso del micrófono la primera vez).

**Orden**
- **U1.** Micrófono en el campo de escribir de todas las charlas (transcripción con el mismo transcriptor; el texto
  transcripto se ve en el mensaje).
- **U2.** `delegar` y `preguntar` en la charla para todos, con tarjetas en la charla; `encargar` sale y el coordinador
  delega con las mismas reglas (también en sus tareas programadas).
- **U3.** «Te esperan» en Bandeja › Hoy, con respuesta desde ahí.
- **U4.** Micrófono flotante de la secretaría: charla nueva por audio y se abre al entenderlo.
- **U5.** Sacar la sección Recados (ruta, riel, `recados.js`); los recados guardados quedan legibles como charlas de la
  secretaría. Pasar las rutas de `/api/recados` a la charla o retirarlas, con la API y el README al día.

## Fases
### R0: recados en la app (la base) (hecho)
Implementado como se describe en «Recados a la secretaría» de [backend/API.md](../backend/API.md). Cambios respecto de lo
planeado:
- **Sección propia en el riel** («Recados», `#/recados`), no dentro de Equipo: es lo primero que se busca en el celular y
  tiene su insignia con lo que te espera. Los filtros van en la lista de la sección (y arriba del hilo en el celular).
- **La grabación** usa Web Audio (`ScriptProcessor`) y manda WAV 16 kHz mono; probado de punta a punta con el Whisper real
  (micrófono simulado de Chromium). En la app de Mac hace falta `NSMicrophoneUsageDescription` (agregado).
- **Las propuestas** del recado se ven como tarjeta con «Revisar y aprobar», que abre la entrega en la bandeja: se aprueba
  donde siempre.
- **Elegir una opción** de una pregunta manda un recado nuevo «Elijo: …» (así ella lo lee con todo el contexto).
- **Sin avisos al terminar todavía** (R1): el estado de lo delegado se actualiza y la entrega llega a la bandeja; el
  próximo recado le cuenta a la secretaría lo que terminó.
- **Sin probar todavía:** con el claude de verdad (qué tan bien separa los pedidos, cuándo pregunta y si respeta
  `explicito`) y la grabación dentro de la app de escritorio empaquetada.

Lo planeado:
- `recados.ts`: tabla `sec_recados(id, oficina, canal, texto, audio?, transcripcion?, estado, sesion, ejecucion, creado,
  actualizado)`, cola de a uno, `Recados.recibir`.
- Hilo de recados como charla marcada de la secretaría; consigna del hilo (qué es un recado, los cinco resultados, cuándo
  preguntar, respuesta corta).
- Herramienta `delegar` (ahora o programado) con `origen: {recado}`.
- Transcriptor genérico + grabación en la interfaz (botón de micrófono en el hilo, Web Audio → WAV 16 kHz).
- Pantalla: el hilo en Equipo (fijo arriba en la charla de la secretaría) con el estado de cada recado y sus resultados
  (delegado a X, esperando tu ok, esperando respuesta).
- Botón «Dejar un recado» en el ícono de la bandeja del sistema (abre el hilo con el micrófono listo).

### R1: cerrar el circuito (hecho, sobre la charla)
- `alTerminar` con `origen.recado`: mensaje en el hilo + notificación; recado `hecho` cuando terminan todas sus delegaciones.
- «Cancelar» una delegación que no empezó.
- Lectura de lo que está en curso para «¿cómo va…?».
- Tema de memoria por delegación abierta.

Como quedó (detalle en «Pasar trabajo, preguntar y hablar por audio en la charla» de [backend/API.md](../backend/API.md)):
- Ya no hay hilo de recados: al terminar una delegación la tarjeta cambia, sale un aviso que abre esa charla (con
  notificación) y queda una **novedad** que el agente recibe en su próximo mensaje ahí («Novedades desde tu último mensaje»),
  una sola vez. No se escribe un mensaje falso en la charla: la sesión de claude no lo vería.
- «Cancelar» ya estaba (U2).
- `en_curso` en la charla, para todos: delegaciones abiertas, flujos por arrancar y corridas abiertas.
- El tema de memoria por delegación abierta no se hizo: las novedades y `en_curso` cubren el «¿cómo va?» sin escribir en la
  memoria de la secretaría.

### R1b: flujos (hecho, sobre la charla)
- `arrancar_flujo` (ahora), con `origen: {recado}` en la corrida.
- Aviso de paso con aprobación o paso tuyo, con botones; `aprobar_paso`, `pedir_cambios` y `paso_hecho` en el hilo.
- Estado de corridas para «¿cómo va…?» y aviso al terminar o al trabarse.
- Ajuste: avisar por recados solo de las corridas que nacieron de un recado (por defecto) o de todas.
- Después: tarea programada que arranca un flujo; sugerencia de guardar una cadena repetida como flujo.

Como quedó (detalle en «Flujos desde la charla» de [backend/API.md](../backend/API.md); código en `charla-flujos.ts`):
- `arrancar_flujo` para cualquier agente en la charla con la persona, con `disparadores` y `datos` en `FlujoDef` (el editor
  de flujos los pide). Directo solo si el mensaje nombra el flujo; si no, propuesta. 45 s para deshacer.
- La corrida no guarda `origen`: la tarjeta guarda la corrida (`datos.corrida`) y `MotorFlujos.alCambiar` la actualiza.
- La tarjeta del flujo muestra los pasos con el actual marcado y, cuando te espera, **Aprobar**, **Pedir cambios** (con
  nota) o **Hecho** (con nota opcional; sin archivos: para adjuntar, desde la corrida en Flujos).
- Se avisa solo de las corridas que nacieron en una charla (la propuesta por defecto de la decisión 4). El ajuste para
  avisar de todas no se hizo.
- **Programado:** `arrancar_flujo` con `cuando` deja la tarjeta programada (una vez). Una tarea programada *repetida* que
  arranque un flujo sigue pendiente.
- Sugerir guardar una cadena repetida como flujo: pendiente (era «después»).

### Citas de WhatsApp (hecho)
Lo de «Datos de WhatsApp y de su memoria»: `[wa:N]` en lo que se lee, cambiado por el mensaje real en la respuesta, y
`citas` en `delegar` y `arrancar_flujo` con el candado en la tarjeta (`citas-whatsapp.ts`). Las citas de la memoria de la
secretaría no se hicieron.

### R2: Telegram
- Ajustes › Toda la app › Telegram: pegar el token del bot (guardado con `safeStorage`), emparejar con un código de 6
  dígitos que le mandás al bot. Solo ese `chat_id` es escuchado; lo demás se ignora sin contestar.
- Texto y notas de voz (OGG, al transcriptor), fotos y documentos como adjuntos.
- Respuestas con botones (aprobar / descartar una propuesta, cancelar una delegación) y enlaces a la entrega como resumen.
- Avisos del seguimiento (R1) por Telegram.

### R3: página móvil (opcional)
- Servidor opcional con el API acotado, emparejamiento por QR, guía para Tailscale.
- La página: el hilo, micrófono, aprobar propuestas, ver entregas. Instalable como acceso directo (PWA mínima, sin offline).

### R4: WhatsApp (opcional, a decidir)
- Entrada por el chat «Mensajes a mí mismo» (lectura, como el resto de la captura); respuesta por Telegram, la página o la
  app. O evaluar Business Cloud API con número aparte.

## API (R0–R1)
| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/api/recados` | `{texto?, audio?: {wav_base64}, archivos?}` | `{recado}`. 400 sin texto ni audio; 409 sin secretaría |
| GET | `/api/recados` | | `{sesion, recados: [Recado] (últimos 50), corriendo}` |
| GET | `/api/recados/<id>` | | `{recado, delegaciones: [{agente, nombre, ejecucion?, tarea?, estado}], acciones: [Accion]}` |
| POST | `/api/recados/<id>/cancelar` | `{delegacion}` | `{recado}`; 409 si ya empezó |

`Recado`: `{id, canal, texto, transcripcion?, estado: "recibido"|"transcribiendo"|"entendiendo"|"respondido"|"delegado"|
"esperando_ok"|"esperando_respuesta"|"hecho"|"fallido", respuesta?, creado, actualizado}`.

## Pruebas
- Unitarias: cola de a uno; estados del recado; `delegar` (tope, no a sí misma, agente inexistente, consigna corta,
  programado crea tarea con origen); que el contenido reenviado va delimitado como dato; WAV 16 kHz al transcriptor.
- API con el claude falso: recado de texto que delega → encargo creado con `origen.recado` → al terminar, mensaje en el
  hilo y recado `hecho`; recado ambiguo → `esperando_respuesta` y el siguiente lo responde; sin secretaría → 409.
- A mano: grabar un audio en la app y en el navegador del celular (Chrome Android, Safari iOS) para confirmar la
  decodificación con Web Audio.

## Decisiones abiertas (para la persona)
1. **¿Delega directo cuando se lo pedís claro, o siempre te pide ok?** Propuesta: directo si es explícito y para adentro
   de la oficina; con ok si lo infirió; siempre con ok lo que sale para afuera.
2. **¿Un hilo de recados aparte, o que los recados caigan en la charla normal con la secretaría?** Propuesta: aparte, para que
   en el celular veas solo lo que le mandaste y lo que te contestó.
3. **¿Primer canal del celular: Telegram o la página móvil?** Propuesta: Telegram.
4. **¿Avisos de flujos por recados de todas las corridas o solo de las que arrancaste desde un recado?** Propuesta: solo
   esas por defecto, con un ajuste para todas (así el celular te sirve para aprobar cualquier flujo).
5. **¿Respuesta en audio?** (la secretaría te contesta con voz). Propuesta: no por ahora; texto corto.
