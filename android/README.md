# Oficina para Android

App nativa (Kotlin + Jetpack Compose) para hablarle a la secretaría desde el celular, con un **widget** en la pantalla
de inicio. El resto de la oficina sigue en la versión web para celular (la PWA de `oficina/`): la app la abre desde
«Abrir la oficina completa».

## Qué hace
- **Widget 2×2** («sale del marco», opción D de `bocetos/widget-android/tarjeta.html`): la tarjeta toma el color de la
  ropa de la secretaría, su busto pixel se asoma por arriba y va su nombre. **Escribir** abre una charla nueva con el
  teclado listo; **Hablar** abre una charla nueva y empieza a grabar. Tocar el busto abre la última charla.
- **Chat con la secretaría**: la última charla al abrir, charla nueva (+), charlas anteriores, lo que va haciendo
  mientras responde (`/api/chat/vivo`) y «Detener».
- **Audio**: graba WAV de 16 kHz y lo transcribe la compu (`POST /api/audio/transcribir`), igual que el micrófono de
  la web; el mensaje lleva la misma marca «(nota de voz)», así que en la compu se ve como audio.
- **Atajos** del ícono (mantener apretado): «Dejarle un audio» y «Escribirle a la secretaría».

## Cómo se conecta
Igual que la PWA: por Tailscale (docs/plan-celular.md). En la compu, Ajustes › **Celular** muestra un QR; la app lo
escanea (o se escribe la dirección `compu.tu-red.ts.net`) y queda vinculada. Hace falta Tailscale prendido en la compu y
en el celular, con la misma cuenta, y Oficina abierta en la compu. No hay cambios en el backend: la app usa la API de
siempre y manda el `Origin` de la oficina en las escrituras, que es lo que pide `servidor-dev.ts`.

## El busto del widget
Se dibuja con el mismo código que la oficina pixel: el build copia `oficina/ui/pixel/personajes.js` y `avatar.js` a los
assets (tarea `copiarPixel`) y `Retrato.kt` los corre en un WebView que no se muestra. Se vuelve a dibujar solo cuando
cambia la apariencia de la secretaría o quién la atiende; queda guardado para que el widget se dibuje sin red.

## Armar e instalar
Cada push que toca `android/` arma el APK en GitHub Actions (workflow «Android», artefacto `Oficina-android`). A mano:
```bash
cd android && ./gradlew assembleDebug    # necesita el SDK de Android (ANDROID_HOME o local.properties)
```
y se instala `app/build/outputs/apk/debug/app-debug.apk` (en el celular, permitir «instalar apps desconocidas»). Va
firmado con una clave de depuración fija (`app/debug.keystore`, la contraseña de siempre de Android), así cada APK
nuevo se instala encima del anterior.

## Archivos
| Archivo | Qué hace |
|---|---|
| `WidgetSecretaria.kt`, `res/layout/widget_secretaria.xml` | El widget |
| `MainActivity.kt` | Recibe los botones del widget y los atajos; permiso del micrófono |
| `Charla.kt` | Estado: oficina vinculada, secretaría, charla abierta, mandar, audio |
| `Pantallas.kt`, `Tema.kt` | Vincular y chat (Compose), con los colores de `oficina/ui/estilo.css` |
| `Api.kt` | Cliente de la API (backend/API.md) |
| `Grabadora.kt` | Graba PCM 16 kHz y arma el WAV |
| `Retrato.kt`, `assets/retrato.html` | El busto pixel con el código de la oficina |
