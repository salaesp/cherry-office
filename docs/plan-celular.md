# Plan: la Oficina en el celular (instalable y reducida)

Hoy la app ya se abre desde el celular por `tailscale serve` (https, con `HQ_HOSTS`), y la interfaz ya tiene un modo
angosto (≤ 720 px): barra abajo con Bandeja, Equipo y Archivos, el resto en «Más», paneles que ocupan la pantalla y el
micrófono de la secretaría achicado. Lo que falta es que **se instale como app** y que **muestre solo lo que tiene
sentido en el teléfono**: enterarte, contestar, aprobar y hablarle a alguien. Armar y configurar la oficina queda en la
compu.

## 1. Qué conviene tener en el celular

Criterio: cosas cortas, que destraban trabajo de los agentes o que se hacen mejor hablando.

| Prioridad | Qué | Por qué en el celular | Qué hay hoy |
|---|---|---|---|
| **Imprescindible** | **Bandeja › Hoy**: preguntas con opciones, propuestas, permisos pendientes, «te toca en un flujo» | Los agentes quedan trabados esperándote; contestar es un toque | `parte.js`, `permisos.js`, `tarjetas.js`, `propuestas.js` |
| **Imprescindible** | **Micrófono de la secretaría** (recado por audio) | Es la forma natural de pedir algo caminando | `microfono.js`, `grabadora.js` (manda WAV PCM, anda en iPhone y Android) |
| **Imprescindible** | **Charlas con los agentes**: lista de contactos, escribir o grabar, ver tarjetas de delegar/preguntar | Seguir una conversación que empezaste en la compu | `agente.js`, `chat-rico.js` |
| Alta | **Revisar entregas**: vista previa, aprobar o pedir retoque con una nota | Destraba flujos; leer un documento en el teléfono está bien | `entregables.js`, `revisar.js` |
| Alta | **Notificaciones** (permiso, pregunta, te toca en un flujo, entrega lista) | Sin esto hay que acordarse de abrir la app | No existe: hoy es sondeo de `/api/actividad` |
| Media | **Parte del día** (leer) | Resumen para el viaje | `parte.js` |
| Media | **Compartir hacia la Oficina** (una foto, un PDF, un link, un texto desde cualquier app) | Mandar material a la biblioteca o como recado a la secretaría | No existe |
| Media | **Tareas y flujos, solo operar**: ver qué corre, correr ahora, pausar, arrancar un flujo con su entrada | Arrancar algo sin ir a la compu | `tareas.js`, `flujos.js` (sin el editor) |
| Baja | **Archivos en modo lectura**: abrir un documento de la carpeta o la biblioteca | Consulta puntual | `carpetas.js`, `biblioteca.js` |

**Queda fuera del celular** (se oculta, no se borra): la oficina pixel, contratar y editar agentes (ficha, apariencia,
permisos, conectores, skills), departamentos, el Creador, el editor de flujos, reuniones nuevas (se pueden *leer*),
memoria y conocimiento (edición), WhatsApp, Ajustes, importar/exportar y cambiar de oficina (salvo un selector simple si
tenés varias).

## 2. Cómo hacerlo

### Fase 1 — Instalable (PWA)
Chico y sin riesgo; con esto ya aparece «Instalar app» / «Agregar a inicio».

1. **`oficina/manifest.webmanifest`**: `name` «Oficina», `short_name`, `start_url: "/?movil=1#/bandeja"`, `scope: "/"`,
   `display: "standalone"`, `theme_color` y `background_color` del tema, íconos 192 y 512 (más uno `maskable`) y
   `shortcuts`: «Hablarle a la secretaría» (`/?movil=1#/bandeja?mic=1`) y «Bandeja».
2. **Íconos** en `oficina/iconos/` (PNG 192, 512, maskable 512 y `apple-touch-icon` 180). Se pueden sacar del logo o de
   un sprite del pixel con el renderizador de `bocetos/pixel/`.
3. **`oficina/sw.js`** (service worker mínimo, servido desde la raíz para que su alcance sea `/`):
   - nunca toca `/api/*` (todo va a la red, siempre);
   - para la interfaz (`index.html`, `ui/*`, `vendor/*`, íconos): *network-first* con copia en caché solo como respaldo,
     para que `actualizar.sh` + recargar siga trayendo lo nuevo sin quedar pegado a JS viejo;
   - sin red: una pantalla «Sin conexión con la Oficina (¿está prendido Tailscale?)» en vez del error del navegador.
4. **`index.html`**: `<link rel="manifest">`, `theme-color`, `apple-touch-icon`, `apple-mobile-web-app-capable`,
   `viewport-fit=cover`, y el registro del service worker.
5. **Servidor** (`backend/src/servidor-dev.ts`): sumar a la lista blanca `manifest.webmanifest`, `sw.js` e `iconos/*`,
   con sus `Content-Type` (`application/manifest+json`, `text/javascript`, `image/png`). El resto de las defensas
   (Host, Origin, contención por realpath) no cambia. La app de escritorio no se entera: Electron ignora todo esto.
6. **Pruebas**: un test del servidor que pida los tres estáticos con su tipo, y un chequeo con Playwright emulando un
   teléfono (que el manifest cargue y el service worker se registre).

### Fase 2 — Modo reducido
La idea es **la misma app con una bandera**, no una app aparte: así se reusa todo (charlas, tarjetas, revisar, permisos)
y no hay dos versiones que mantener. Si después pesa demasiado, se puede separar un `movil.html` que cargue menos
scripts (ver «Alternativa» abajo).

1. **La bandera**: `App.movil = ?movil=1` (lo pone el `start_url`), o la app abierta como instalada
   (`display-mode: standalone`), o pantalla angosta. Se guarda en `sessionStorage` para que sobreviva a la navegación.
   Pone `body.modo-movil`.
2. **Navegación** (`nav.js`): en modo móvil la barra queda **Bandeja · Charlas · Trabajo · Más**; «Más» solo lleva a
   Parte del día, Archivos (lectura) y, si hay varias, cambiar de oficina. El botón «Nuevo…» se reduce a «Recado a la
   secretaría» y «Escribirle a…». La ruta inicial es `#/bandeja/hoy`, no la oficina.
3. **Sin oficina pixel**: no montar `App.Oficina` en modo móvil (hoy solo se pausa). Ahorra CPU y batería; los llamados
   ya están protegidos con `App.Oficina && …`. Los retratos de las listas siguen saliendo de `avatar.js`.
4. **Esconder lo de la compu**: el lápiz de la ficha del agente, contratar, departamentos, editor de flujos, Creador,
   Ajustes y WhatsApp. Un selector CSS `body.modo-movil .solo-compu { display: none }` y marcar esos botones con
   `.solo-compu`; las rutas a esas pantallas redirigen a la Bandeja.
5. **Bandeja primero**: que Hoy muestre arriba lo accionable (preguntas, permisos, aprobaciones de flujo) con botones
   grandes, y abajo lo informativo.
6. **Pulido de teléfono**: `env(safe-area-inset-*)` en la barra de abajo y el micrófono, `100dvh`, campos de texto con
   letra ≥ 16 px (si no, iPhone hace zoom), y que el teclado no tape el campo de escribir de la charla.
7. **Batería**: el sondeo de `/api/actividad` (1 s si alguien trabaja, 4 s si no) se **frena con la app en segundo
   plano** (`visibilitychange`) y al volver pide una vez enseguida. Sirve también en la compu.

### Fase 3 — Notificaciones push
Es lo que más cambia el uso del celular. En Android anda en Chrome; en iPhone, desde iOS 16.4 y **solo con la app
instalada** en la pantalla de inicio.

1. **Claves VAPID** generadas una vez y guardadas en `HQ_DATA_DIR` (con la librería `web-push` o firmando el JWT a mano
   con `node:crypto`, para no sumar dependencias).
2. **API**: `GET /api/push/clave` (la pública), `POST /api/push/suscribir` y `POST /api/push/desuscribir`; las
   suscripciones se guardan en el store por dispositivo, con un nombre («Celular») y qué tipos de aviso quiere.
3. **Disparo**: en el mismo lugar donde se calculan los avisos de `/api/actividad` (`avisos.ts`), cuando aparece uno
   nuevo de tipo permiso, pregunta, flujo o entrega, se manda un push con título corto y la ruta a abrir. Se deduplica
   por id de aviso y se respeta un «no molestar» (horario) en la suscripción.
4. **Service worker**: `push` muestra la notificación; `notificationclick` abre o enfoca la app en la ruta del aviso.
5. **UI**: en la Bandeja del celular, un botón «Avisarme en este teléfono» (el permiso del navegador hay que pedirlo
   desde un toque del usuario).
6. El servidor necesita salida a internet hacia el servicio de push (FCM / Apple); con Tailscale no hay que abrir nada
   de entrada.

### Fase 4 — Compartir hacia la Oficina
1. En el manifest, `share_target` con `POST` y `multipart/form-data` (archivos, título, texto, link).
2. El **service worker** intercepta ese POST, lee el `FormData`, guarda los archivos en IndexedDB y abre
   `#/compartir`. Así el servidor no necesita aceptar multipart y sigue con sus escrituras en JSON.
3. `#/compartir` pregunta el destino: **a la biblioteca** (sube en base64 al endpoint que ya existe) o **recado a la
   secretaría / a un agente** (mensaje con el adjunto, usando `adjuntos.ts`).
4. Solo Android (iOS no soporta `share_target`); en iPhone queda el adjuntar desde la charla.

### Fase 5 (opcional) — Leer sin señal
Guardar en IndexedDB el último Parte del día y las últimas charlas abiertas para leerlas sin conexión, con un aviso de
«visto a las 14:32». Solo si se nota la falta.

## 3. Cosas a tener en cuenta
- **Seguridad**: hoy la puerta es Tailscale (el servidor escucha en 127.0.0.1 y acepta solo los nombres de
  `HQ_HOSTS`). Mientras sea así no hace falta login. Si algún día se expone con `tailscale funnel` o fuera del tailnet,
  antes hay que agregar una autenticación (al menos un token por dispositivo).
- **Audio en iPhone**: la grabadora arma WAV PCM con `AudioContext`, así que no depende del formato del navegador; hay
  que probar igual que el permiso del micrófono se recuerde en la app instalada.
- **Actualizaciones**: con el service worker *network-first* y `Cache-Control: no-store` del servidor, `actualizar.sh`
  sigue funcionando igual. Si algún día se pasa a *cache-first*, versionar la caché con el commit de `dist/.commit`.
- **Escritorio intacto**: todo vive detrás de `modo-movil` y de archivos que Electron no carga; la compu no cambia.

**Alternativa a la bandera** (si la Fase 2 queda pesada): un `oficina/movil.html` propio que cargue solo `base.js`,
`avatar.js`, `chat-rico.js`, `tarjetas.js`, `grabadora.js`, `microfono.js`, `permisos.js`, `parte.js`, `revisar.js`,
`entregables.js`, `agente.js` y una `nav-movil.js` más simple. Carga más rápido, pero hay que desacoplar los módulos de
`App.dom.derecho`/`App.dom.ventana` y mantener dos navegaciones. Por eso conviene empezar con la bandera y medir.

## 4. Orden sugerido
1. Fase 1 (instalable) — un PR chico.
2. Fase 2 (modo reducido) — el grueso del trabajo visible.
3. Fase 3 (push) — el que más valor agrega después de la 2.
4. Fase 4 (compartir) y 5 (sin señal) — según cómo se use.
