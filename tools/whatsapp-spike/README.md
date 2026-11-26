# Spike de WhatsApp (fase S0 de la secretaría)

Prueba suelta, fuera de la app, para la fase S0 de [docs/plan-secretaria.md](../../docs/plan-secretaria.md). Se vincula
a WhatsApp como dispositivo (QR), **solo lee**, guarda los mensajes de los chats elegidos y mide el consumo. No manda
mensajes, no marca leído y no aparece «en línea»: `spike.mjs` no llama a ninguna función de Baileys que haga eso.

> ⚠️ Usá un **número secundario**. Un cliente no oficial va contra los términos de WhatsApp y el riesgo de baneo nunca
> es cero, aunque solo lea.

## Correrlo
Hace falta Node 22.13 o más nuevo. Correlo en tu compu, no en un servidor compartido: la carpeta `datos/auth` es la
sesión de WhatsApp, y con ella se puede leer y mandar como vos.

```bash
cd tools/whatsapp-spike
```

```bash
npm ci
```

```bash
npm start
```

1. Aparece un QR en la terminal (y en `datos/qr.png`). En el teléfono: WhatsApp › Dispositivos vinculados › Vincular un
   dispositivo.
2. Dejalo correr unos minutos: se arma `datos/chats.json` con la lista de chats y grupos (solo nombre, número y último
   mensaje; nunca texto).
3. Cortalo con Ctrl+C y mirá la lista como la mostraría la app (sin repetidos, primero los que tienen actividad, con
   un resumen al final):
   ```bash
   npm run lista
   ```
   Elegí por el número de la lista; a los que no tienen nombre ponéselo con `=`:
   ```bash
   npm run elegir -- 1 4=Mamá
   ```
   También podés editar `datos/config.json` a mano, por ejemplo para agregar a alguien por número:
   ```json
   {
     "chats": [
       { "id": "+54 9 11 5555-1234", "nombre": "Mamá", "nota": "tiene turnos médicos seguido" },
       { "id": "120363000000000000@g.us", "nombre": "Familia" }
     ]
   }
   ```
   `id` es un número con código de país, o el JID de un grupo (sale de `chats.json`).
4. Volvé a correr `npm start`. Ya no pide QR: se reconecta con la sesión guardada. Los mensajes de los elegidos se ven en
   la terminal y quedan en `datos/mensajes.jsonl`.

Para desvincular: WhatsApp › Dispositivos vinculados › tocar el dispositivo › Cerrar sesión. Después borrá `datos/`.

## Qué deja en `datos/`
| Archivo | Qué tiene |
|---|---|
| `mensajes.jsonl` | Los mensajes de los chats elegidos, en el formato del plan (`id, chat, de, propio, ts, tipo, texto, cita…`). `via: "alternativo"` = se reconoció por el `@lid` y no por el número |
| `chats.json` | La lista para elegir: nombre, número o «grupo», participantes, último mensaje. Sin texto |
| `eventos.jsonl` | Conexión, QR, reconexiones, revocación, qué llegó en el historial inicial, alias `@lid` aprendidos |
| `consumo.jsonl` | Cada minuto: RAM (`rssMB`, `heapMB`), CPU (`cpuPct`) y contadores |
| `baileys.log` | El log de Baileys (nivel `warn`; `SPIKE_LOG=debug npm start` para más) |
| `auth/` | La sesión. **Tratala como una contraseña** |

## Qué hay que verificar (y anotar en el informe de abajo)
1. **Lista inicial.** Después de vincular, en `eventos.jsonl` → `historial`: ¿cuántos chats y contactos llegaron, y
   cuántos `contactosConNombre`? ¿`chats.json` muestra tus contactos con el nombre de tu agenda o solo números? Esto
   decide si la lista alcanza o si hace falta agregar por número más seguido.
2. **`@lid`.** Elegí un contacto **por número** y pedile que te escriba. En `eventos.jsonl`: ¿hubo `alias` (por
   `consulta`, `mapeo` o `mensaje`) o `sin_lid`? En `mensajes.jsonl`: ¿se guardó el primer mensaje? Si llegó con
   `via: "alternativo"`, el reconocimiento por `@lid` funciona.
3. **Grupos.** Elegí un grupo: ¿`de` trae el número de cada participante?
4. **Lo propio.** Contestá desde el teléfono: ¿aparece con `propio: true`?
5. **Ediciones y borrados.** Editá y borrá un mensaje: ¿llegan como `editado` y `borrado`?
6. **Notificaciones.** Con el spike corriendo, ¿el teléfono sigue mostrando las notificaciones como siempre? ¿Los
   mensajes quedan sin leer en el teléfono?
7. **Reconexión.** Cerralo unas horas, mandate mensajes mientras tanto y volvé a abrirlo: ¿llegan los atrasados (con
   `upsert: "append"` o `"notify"`)?
8. **Consumo.** Una semana corriendo: RAM y CPU de `consumo.jsonl` (máximo y típico) y cuántas `reconexiones` hubo.
9. **Sesión.** ¿WhatsApp la revocó en algún momento (`revocado`)? ¿Hubo algún aviso en el teléfono?

## Lo que ya se verificó (en un contenedor Linux, sin escanear el QR)
- Las pruebas de `mapeo.mjs` pasan (`npm test`): filtros de estados, canales y difusión; chat elegido reconocido por
  `@lid` vía `remoteJidAlt`; remitente en grupos; citas, efímeros, notas de voz, ediciones y borrados.
- Conecta con los servidores de WhatsApp y genera el QR en menos de un segundo.
- Esperando el QR: unos 100 MB de RAM y alrededor de 1 % de CPU.
- `npm run bundle` lo empaqueta con esbuild en un solo archivo (unos 7,4 MB, con el WebAssembly de Baileys adentro) y
  ese archivo corre **sin `node_modules`** hasta el QR. Las dependencias opcionales de imágenes, audio y vistas previas
  quedan afuera.
- Falta probarlo dentro de Electron (`utilityProcess`), que es lo que va a usar la app.

## Informe
Completar después de la semana de prueba.

| Punto | Resultado |
|---|---|
| Lista inicial (chats, contactos, con nombre) | |
| `@lid` de un contacto agregado por número | |
| Grupos: remitente | |
| Mensajes propios | |
| Ediciones y borrados | |
| Notificaciones del teléfono | |
| Mensajes atrasados al reconectar | |
| RAM y CPU (típico / máximo) | |
| Reconexiones en la semana | |
| Revocaciones o avisos de WhatsApp | |
