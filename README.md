# Oficina

Una oficina en pixel art isométrico donde trabajan tus agentes de Claude Code. Cada personaje es un agente real
(`.claude/agents/<id>.md`): le hablás, lo llamás a reuniones, le das tareas y te deja lo que termina en tu bandeja.
Hay app para **Mac** y para **Windows**.

## Instalar
Bajá el instalador de la última release en GitHub:
- **Mac** (Apple Silicon, macOS 13+): `Oficina-<versión>-arm64.dmg`. Arrastrá Oficina a Aplicaciones. Como no está
  firmada con Developer ID, la primera vez macOS la bloquea: corré
  `xattr -dr com.apple.quarantine "/Applications/Oficina.app"` o andá a Ajustes del Sistema → Privacidad y
  seguridad → **Abrir igualmente**.
- **Windows** (x64): `Oficina-Setup-<versión>.exe`. No está firmado, así que SmartScreen avisa la primera vez:
  «Más información» → «Ejecutar de todas formas».

En los dos casos hace falta **Claude Code** instalado y con la sesión iniciada. Si falta, la app te avisa al abrir.

## Qué se puede hacer
- **Oficinas:** cada oficina es una carpeta (por defecto `~/Oficinas/<Nombre>/`) con su `oficina.json`, sus agentes,
  su conocimiento, sus reuniones y sus archivos. Podés crear una a mano, **armarla charlando con tu secretaría** (le contás
  cómo trabajás y te propone departamentos, agentes y flujos), abrir una existente o importar un `.zip` exportado. Toda
  oficina nueva viene con secretaría: es a quien le pedís crear cosas (contratar, armar flujos, programar tareas); lo
  propone y vos lo aprobás (`docs/plan-secretaria-creadora.md`).
- **Quién dirige:** tu nombre y tu apariencia, guardados en cada oficina. Tenés tu despacho en la oficina y una bandeja
  en el escritorio donde los agentes apilan lo que te entregan.
- **Agentes y departamentos:** cada departamento es una sala del edificio. A los agentes los vestís con el editor de
  apariencia (piel, peinado, ropa, colores y accesorios) y les ajustás modelo, permisos y conectores. Los agentes sin
  trabajo caminan a la sala de juegos y café, y la luz de la oficina sigue la hora del día.
- **Equipo, chat y reuniones:** Equipo funciona como un chat: cada agente es un contacto y tocarlo (en la lista o en la oficina)
  abre su charla pegada a la lista, con la oficina a la vista y la persona centrada. Al costado van sus charlas, tareas,
  archivos y notas (el lápiz abre su perfil y permisos; el pin muestra dónde está). Las reuniones tienen su pestaña en Equipo,
  desde donde se llama a una nueva. Al final de una charla larga aparece la sugerencia «¿Sacamos tareas de esta charla?»:
  propone el trabajo que quedó pendiente (para ese agente o para otros) y, después de revisarlo, lo crea como tareas.
- **Hablarles y que se pasen trabajo:** en cualquier charla podés escribir o grabar un audio (se transcribe en tu compu).
  Si lo que pedís es para otro, el agente se lo pasa a ese colega: lo que pediste explícito arranca a los 45 segundos (se
  puede deshacer) y lo que dedujo queda como propuesta; si algo no está claro, te pregunta con opciones. Cada cosa queda
  como una tarjeta en la charla, y lo que te espera (preguntas, propuestas) aparece en Bandeja › Hoy. Cuando lo que pasó
  termina, te avisa y el agente se entera en tu próximo mensaje. Si lo que pedís encaja con un flujo, lo arranca (directo
  si lo nombraste) y la tarjeta lo sigue: aprobás o pedís cambios ahí mismo, o se lo decís («aprobale el boceto»). Lo que
  cita de WhatsApp se ve tal cual es, y si se lo pasa a otro, la tarjeta muestra exactamente qué compartió. El micrófono
  flotante, con la cara de la secretaría, le habla siempre a ella: también anda en el celular.
- **Flujos:** procesos de varios pasos que pasan de agente en agente, con aprobaciones tuyas donde haga falta. Ves
  cada corrida en vivo y una pieza viaja por la maqueta. Un flujo puede **seguir con otro** al terminar («Al terminar,
  seguir con…»): arranca solo una corrida del segundo con lo último que se entregó, y los cambios del segundo valen
  también cuando se corre solo.
- **Tareas programadas, Parte del día y Biblioteca:** tareas repetidas o de una sola vez, un resumen de lo que pasó y
  qué está trabado, y una biblioteca de documentos con fichas que los agentes pueden consultar.
  La memoria de la oficina se guarda por tema y por fecha: los agentes leen al empezar solo lo corto (`oficina.md`, un índice
  de temas, las decisiones vigentes y sus notas) y el resto, el histórico incluido, se busca. Los agentes dejan lo que
  aprenden con `anotar` y un bibliotecario interno lo ordena por tema (la primera vez, con una propuesta que revisás vos).
- **Tiempo libre:** cuando no tienen trabajo, los agentes van a la sala de juegos y café.

## Estructura del repo
| Carpeta | Qué hay |
|---|---|
| `oficina/` | El front (HTML y JS, con `vendor/` offline): la oficina pixel (`ui/pixel/`) y todas las pantallas. |
| `backend/` | El backend en TypeScript (Node): oficinas, agentes, chat, flujos, tareas, biblioteca. La API está en [backend/API.md](backend/API.md). |
| `desktop/` | La app de escritorio: carcasa Electron alrededor de `backend/` y `oficina/`. De acá salen el `.dmg` y el `.exe` de las releases. Ver [desktop/README.md](desktop/README.md). |
| `docs/` | Planes de diseño, `aprendizajes.md` (cómo se comporta el `claude` real) y `caso-prospera/` (el texto con el que se prueba armar una oficina con el Creador). |
| `tools/` | Utilidades sueltas (pruebas de concepto, como `whatsapp-spike/` e `instagram-spike/`). |
| `bocetos/` | Pruebas de diseño que no forman parte de la app. `bocetos/pixel/` es el boceto del que salió la oficina pixel, con su renderizador de sprites a PNG. Ver [bocetos/pixel/README.md](bocetos/pixel/README.md). |

## Dónde está qué
| Quiero tocar… | Archivos |
|---|---|
| Departamentos | UI: `oficina/ui/departamentos.js` · rutas: `backend/src/rutas-departamentos.ts` · reglas: `backend/src/departamentos.ts` · API: [backend/API.md#departamentos](backend/API.md#departamentos) |
| Oficinas (abrir, crear, perfil) | `backend/src/oficinas.ts`, `backend/src/rutas-oficinas.ts` |
| Agentes (contratar, editar, despedir) | `backend/src/agentes.ts`, UI en `oficina/ui/contratar.js` y `oficina/ui/agente.js` |
| Skills propias de cada agente (ficha, «Convertir en skill», `proponer_skill`) | `backend/src/skills-propias.ts`, `backend/src/rutas-skills.ts`, UI en `oficina/ui/skills-propias.js` · API: [backend/API.md#skills-propias](backend/API.md#skills-propias) |
| Armar la oficina con tarjetas (la secretaría en la charla; el Creador en las oficinas sin secretaría) | `backend/src/secretaria-creadora.ts`, `backend/src/creador.ts`, `backend/src/rutas-creador.ts`, `oficina/ui/creador.js` |
| Flujos | `backend/src/flujos.ts`, `backend/src/motor-flujos.ts`, `oficina/ui/flujos.js` |
| Biblioteca | `backend/src/biblioteca.ts`, `oficina/ui/biblioteca.js` |
| Reuniones | `backend/src/reuniones.ts`, `oficina/ui/reunion.js` |
| Tareas programadas | `backend/src/programador.ts`, `backend/src/tareas.ts`, `oficina/ui/tareas.js` |
| Pasar trabajo, preguntar y audio en la charla (`delegar`, `preguntar`, micrófonos); flujos desde la charla y citas de WhatsApp | `backend/src/delegar.ts`, `backend/src/charla-flujos.ts`, `backend/src/citas-whatsapp.ts`, `backend/src/audio.ts`, `oficina/ui/tarjetas.js`, `oficina/ui/grabadora.js`, `oficina/ui/microfono.js` · API: [backend/API.md#pasar-trabajo-preguntar-y-hablar-por-audio-en-la-charla](backend/API.md#pasar-trabajo-preguntar-y-hablar-por-audio-en-la-charla) · plan: [docs/plan-recados.md](docs/plan-recados.md) |
| Navegación y rutas `#/…` de la UI | `oficina/ui/nav.js` |

Hasta la 0.7 la app de Mac era nativa en Swift, con su propio backend; se retiró al pasar las dos plataformas a
Electron (queda en el historial de git, antes de borrar `app/`).

## Desarrollo
La interfaz se prueba en el navegador con el backend, sin armar la app:
```bash
npm ci --prefix backend
npm run dev --prefix backend        # http://localhost:8765
```
Variables útiles: `PORT`, `HQ_DATA_DIR`, `HQ_OFICINAS_DIR`, `CLAUDE_BIN`, `HQ_UI_DIR` (ver `backend/src/dev.ts`).

**Desde otra compu o el celular, con Tailscale:** el navegador solo deja usar el micrófono en `https://` o `localhost`, así que
para hablarles a los agentes desde afuera conviene `tailscale serve`, que le da a la máquina una dirección `https://` con
certificado válido (en la consola de Tailscale, DNS › MagicDNS y HTTPS Certificates prendidos):
```bash
tailscale serve --bg 8765
HQ_HOSTS=alfred.tu-red.ts.net npm run dev --prefix backend   # el nombre que muestra `tailscale serve status`
```
y se entra por `https://alfred.tu-red.ts.net`. `HQ_HOSTS` (nombres separados por comas) le dice al servidor qué nombres
aceptar además de localhost; sin eso rechaza los pedidos que llegan por otro nombre.

**Desde el celular con la app de escritorio:** Ajustes › **Celular** hace lo mismo sin terminal. Con Tailscale instalado en
la compu y en el celular (misma cuenta), la app levanta el servidor local, lo publica con `tailscale serve` y muestra un QR.
Desde el navegador del celular se instala como app (manifest y service worker en `oficina/`): en el celular
queda una versión reducida (Bandeja, Charlas, Trabajo), con avisos push y, en Android, «Compartir › Oficina» desde otras apps. La compu tiene que estar
prendida y con Oficina abierta; mientras el acceso está prendido, no se suspende. Plan completo: [docs/plan-celular.md](docs/plan-celular.md).

**Actualizar la versión web:** `bash actualizar.sh` en la máquina trae lo último de la rama del clon (normalmente `main`),
recompila y reinicia el servidor (con systemd o sin él). Lo mismo se puede hacer desde el navegador, en Ajustes › Actualizar:
muestra los commits nuevos y, con «Actualizar ahora», corre `actualizar.sh` y recarga la página cuando el servidor vuelve
(`backend/src/actualizar-web.ts`). Solo aparece en la versión web; la app de escritorio se actualiza desde las releases.
`HQ_SIN_ACTUALIZACIONES=1` también lo apaga.

Tests (con un `claude` falso, sin tocar tus datos ni tu cuenta):
```bash
npm test --prefix backend
```

App de escritorio (Mac o Windows):
```bash
npm ci --prefix backend && npm ci --prefix desktop
npm start --prefix desktop
```

### Releases
La versión sale de `desktop/package.json` (subirla también en `desktop/package-lock.json`, por ejemplo con
`npm version X.Y.Z --no-git-tag-version --prefix desktop`). Al subir una etiqueta `vX.Y.Z`, el workflow
`.github/workflows/release.yml` corre los tests, arma el `.dmg` y el `.exe` y los adjunta a la release de esa etiqueta.
Si la release no existe, la crea como borrador con las notas de `docs/releases/vX.Y.Z.md` (si no existe ese archivo, con un
texto para completar a mano).

### Actualizaciones automáticas
Las apps instaladas se actualizan solas desde las releases **publicadas** (los borradores no cuentan): publicar la
release es lo que la manda a todos. Las dos buscan al abrir y cada 6 horas, y tienen «Buscar actualizaciones…» en el
menú (Mac: menú Oficina; Windows: Ayuda). `HQ_SIN_ACTUALIZACIONES=1` las apaga.
- **Mac (actualizador propio, `desktop/src/actualizaciones-mac.ts`):** lee `appcast.xml` de la última release, baja
  `Oficina-<versión>-arm64.zip`, verifica la firma EdDSA contra la clave pública del proyecto (esa firma reemplaza al
  Developer ID que la app no tiene), cambia la .app al salir y, con «Reiniciar ahora», la vuelve a abrir. Como la baja
  la propia app y no el navegador, macOS no vuelve a pedir «Abrir igualmente». No puede instalarse sola si la app corre
  desde el `.dmg` o sin permiso de escritura en su carpeta: en ese caso avisa y ofrece bajarla a mano.
- **Puente desde la 1.0 Swift:** la 1.0.0 de Mac era la app Swift con Sparkle 2, que lee el mismo `appcast.xml` y
  pasa sola a la app Electron. Para eso la app Electron lleva la misma `SUPublicEDKey` en su `Info.plist`
  (`build.mac.extendInfo` en `desktop/package.json`) y el workflow le pone un `CFBundleVersion` entero que crece con la
  versión (1.2.3 → 10203), mayor que el build 10 de la 1.0.
- **Windows (electron-updater):** lee `latest.yml` de la última release, baja el `.exe` en segundo plano (solo lo que
  cambió, con el `.blockmap`) y lo instala al salir o con «Reiniciar ahora».
- El workflow necesita el secret **`SPARKLE_PRIVATE_KEY`** (la clave privada EdDSA). Sin él, una etiqueta falla en vez
  de sacar una release que las Mac no pueden recibir. Si se pierde la clave, las Mac instaladas no aceptan más
  actualizaciones y hay que reinstalar a mano: guardala también en un gestor de contraseñas.
- La primera versión con actualizador hay que instalarla a mano una vez; de ahí en adelante, ya no. En Windows, la
  1.0.0 se cae al abrir (el import de `electron-updater` quedaba `undefined` con esbuild), así que quien la tenga
  tiene que instalar a mano la versión siguiente.
