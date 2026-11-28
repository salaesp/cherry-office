# Oficina para Android

La app de Android es **la oficina web del celular** (la PWA de `oficina/`, en modo celular) abierta en Chrome como
**Trusted Web Activity**: pantalla completa, sin barra de direcciones, con todo lo que tiene la web (Bandeja, charlas
con sus tarjetas, revisar entregas, audio, adjuntar). Lo nativo es solo lo que la web no puede:

- **Widget 2×2 de la secretaría** («sale del marco», opción D de `bocetos/widget-android/tarjeta.html`): la tarjeta
  toma el color de la ropa de la secretaría, su busto pixel se asoma por arriba y va su nombre. **Escribir** abre una
  charla nueva con ella con el cursor en el campo (`#/secretaria/escribir`); **Hablar** abre una charla nueva y empieza
  a grabar (`#/secretaria/hablar`; si Chrome pide un toque antes de usar el micrófono, el botón queda resaltado).
- **Avisos como avisos de la app:** son los Web Push de siempre (`backend/src/push.ts`, `oficina/sw.js`); el
  `DelegationService` de android-browser-helper hace que Android los muestre como de «Oficina» y no de Chrome. Se
  prenden igual que en la PWA (Bandeja › Hoy o «Más › Avisos en este teléfono»).
- **Vincular con el QR** de Ajustes › Celular (o escribiendo la dirección). Los atajos del ícono: «Dejarle un audio»,
  «Escribirle a la secretaría» y «Cambiar de oficina».

## Cómo se conecta
Por Tailscale, como la PWA (docs/plan-celular.md): Tailscale prendido en la compu y en el celular, con la misma cuenta,
y Oficina abierta en la compu. Hace falta Chrome en el celular.

Para que Chrome confíe en la app (sin barra de direcciones y con los avisos delegados), el servidor de la oficina sirve
`/.well-known/assetlinks.json` (`backend/src/app-android.ts`) con el paquete `app.oficina.android` y la huella de la
clave con la que se firma el APK (`app/debug.keystore`). Si Chrome no logra verificarlo, la app funciona igual pero con
una barrita arriba que muestra la dirección. Si algún día cambia la clave, hay que cambiar la huella ahí también.

## El busto del widget
Se dibuja con el mismo código que la oficina pixel: el build copia `oficina/ui/pixel/personajes.js` y `avatar.js` a los
assets (tarea `copiarPixel`) y `Retrato.kt` los corre en un WebView que no se muestra. Cada vez que se abre la app se
pide a la oficina quién atiende la secretaría y su apariencia (`Secretaria.kt`); si cambió, se vuelve a dibujar.
Queda guardado para que el widget se dibuje sin red.

## Armar e instalar
Cada release lleva `Oficina-android-<versión>.apk` (workflow «Release»), y cada push que toca `android/` lo arma en el
workflow «Android» (artefacto `Oficina-android`). A mano:
```bash
cd android && ./gradlew assembleDebug    # necesita el SDK de Android (ANDROID_HOME o local.properties)
```
En el celular hay que permitir «instalar apps desconocidas». Va firmado con una clave de depuración fija
(`app/debug.keystore`, la contraseña de siempre de Android): cada APK nuevo se instala encima del anterior. La versión
es la de `desktop/package.json`.

## Archivos
| Archivo | Qué hace |
|---|---|
| `MainActivity.kt` | Abre la oficina en Chrome (TWA) en la ruta que toca; sin oficina vinculada, la pantalla de vincular |
| `Vincular.kt` | Vincular con el QR o la dirección; desvincular |
| `WidgetSecretaria.kt`, `res/layout/widget_secretaria.xml` | El widget (solo vistas que acepta RemoteViews: lo revisa `WidgetLayoutTest`) |
| `Secretaria.kt`, `Api.kt`, `Prefs.kt` | Quién atiende la secretaría y su apariencia, para el widget |
| `Retrato.kt`, `assets/retrato.html` | El busto pixel con el código de la oficina |
