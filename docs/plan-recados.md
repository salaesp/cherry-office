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

## Fases
### R0: recados en la app (la base)
- `recados.ts`: tabla `sec_recados(id, oficina, canal, texto, audio?, transcripcion?, estado, sesion, ejecucion, creado,
  actualizado)`, cola de a uno, `Recados.recibir`.
- Hilo de recados como charla marcada de la secretaría; consigna del hilo (qué es un recado, los cinco resultados, cuándo
  preguntar, respuesta corta).
- Herramienta `delegar` (ahora o programado) con `origen: {recado}`.
- Transcriptor genérico + grabación en la interfaz (botón de micrófono en el hilo, Web Audio → WAV 16 kHz).
- Pantalla: el hilo en Equipo (fijo arriba en la charla de la secretaría) con el estado de cada recado y sus resultados
  (delegado a X, esperando tu ok, esperando respuesta).
- Botón «Dejar un recado» en el ícono de la bandeja del sistema (abre el hilo con el micrófono listo).

### R1: cerrar el circuito
- `alTerminar` con `origen.recado`: mensaje en el hilo + notificación; recado `hecho` cuando terminan todas sus delegaciones.
- «Cancelar» una delegación que no empezó.
- Lectura de lo que está en curso para «¿cómo va…?».
- Tema de memoria por delegación abierta.

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
4. **¿Respuesta en audio?** (la secretaría te contesta con voz). Propuesta: no por ahora; texto corto.
