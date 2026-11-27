# Oficina de escritorio (Electron)

La app de Oficina en Mac y Windows: una carcasa Electron alrededor del backend TypeScript (`../backend`) y del front
(`../oficina`). De acá salen el `.dmg` y el `.exe` de las releases.

- `src/main.ts`: ventana, esquema `hq://app/` (estáticos + `/api/*` al router, en proceso), mensajes del front
  (`abrir`, `revelar`, `elegirCarpeta`, `elegirArchivo`, `login`…), notificaciones, insignia, bandeja y menú.
- `src/preload.ts`: expone `window.webkit.messageHandlers.hq.postMessage` (lo que espera el front) y la plataforma.
- `src/actualizaciones.ts`, `src/actualizaciones-mac.ts`: actualizaciones automáticas (ver el README de la raíz).
- `src/abrir.ts`, `src/estaticos.ts`: qué se puede abrir y qué se sirve (listas blancas).
- `src/onboarding.html`: la pantalla de «Falta Claude Code» / «Iniciá sesión».
- `scripts/build.mjs`: esbuild a `dist/` (el backend va adentro); con `--recursos` arma `build/recursos/oficina`.

```bash
npm ci --prefix ../backend && npm ci
npm start            # compila y abre la app (datos reales: usá HQ_DATA_DIR / HQ_OFICINAS_DIR para probar aparte)
npm run dist:mac     # release/Oficina-<versión>-arm64.dmg (firma ad-hoc)
npm run dist:win     # release/Oficina-Setup-<versión>.exe (también se puede armar desde una Mac)
```

La versión de las releases sale de `package.json` (`version`).
`build/icon.png`, `build/icono.svg` y los íconos del celular (`../oficina/iconos/`) salen de `node scripts/make-icon.mjs`
(el edificio pixel, dibujado celda por celda en el script).

## Datos
Los mismos que usaba la app Swift de Mac hasta la 0.7, así que actualizar no pierde nada: en Mac,
`~/Library/Application Support/Próspera HQ/` (`config.json`, `hq.db`) y las oficinas en `~/Oficinas/`. El bundle id
también es el mismo (`com.oficina.app`). Lo propio de Electron (tamaño de la ventana, `localStorage` del front) va en
`~/Library/Application Support/Oficina/`.

## Sin firma
Ni el `.dmg` ni el `.exe` están firmados con un certificado.

- **Mac:** firma ad-hoc (`mac.identity: "-"`, sin hardened runtime). macOS bloquea la primera apertura. Se puede ir a
  Ajustes del Sistema → Privacidad y seguridad → **Abrir igualmente**, o quitar la cuarentena:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/Oficina.app"
  ```
- **Windows:** SmartScreen avisa la primera vez («Más información» → «Ejecutar de todas formas»).

Para probar el actualizador de Mac con un appcast y una clave propios: `HQ_ACTUALIZACIONES_FEED=<url del appcast>` y
`HQ_ACTUALIZACIONES_CLAVE=<clave pública EdDSA en base64>`.

Para firmar y notarizar en Mac más adelante, con un certificado Developer ID: sacar `identity` y poner
`hardenedRuntime: true` en `build.mac` (con un `.plist` de entitlements que permita JIT a Electron), y darle a
electron-builder `CSC_LINK` / `CSC_KEY_PASSWORD` y `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` como
secrets del workflow de release.
