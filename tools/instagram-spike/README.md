# Spike de Instagram: leer una cuenta pública

Prueba suelta, fuera de la app. Lee el perfil público de una o más cuentas de Instagram **sin iniciar sesión y sin
registrar una app en Meta**, con el mismo pedido que hace la web de Instagram al abrir un perfil
(`i.instagram.com/api/v1/users/web_profile_info/`). Sirve para ver qué datos trae hoy y cuánto aguanta antes de que
Instagram lo frene, y decidir con eso si vale la pena una herramienta `instagram_perfil` para los agentes.

- **Solo lee y nunca manda cookies ni credenciales.** No hace falta, ni conviene, tener Instagram abierto: no usa tu sesión.
- No baja fotos ni videos: guarda solo sus URLs.
- No es una API oficial. Los términos de Meta no permiten la recolección automatizada, e Instagram puede cambiar o
  cortar este pedido sin aviso. Usalo poco, con cuentas públicas y para uso propio. Lo peor esperable es un bloqueo
  temporal de tu IP (te pide iniciar sesión por un rato).

## Correrlo
Hace falta Node 22 o más nuevo. No tiene dependencias, así que no hay `npm ci`. Correlo **en tu compu**: desde
servidores en la nube Instagram suele frenarlo enseguida, así que esa prueba no sirve.

```bash
cd tools/instagram-spike
```

Una lectura (la cuenta va como `nombre`, `@nombre` o la URL del perfil; podés poner varias):

```bash
npm start -- natgeo
```

En la terminal aparece el perfil y sus últimas publicaciones (fecha, tipo, likes, comentarios, reproducciones si es
video, el principio del texto) y un resumen por tipo con la interacción sobre los seguidores.

Para ver cuánto aguanta, dejalo leyendo cada 30 minutos (o `-- --cada 60` para otro intervalo). Si Instagram lo frena,
corta esa ronda y lo vuelve a intentar en la siguiente:

```bash
npm run aguante -- natgeo otra.cuenta
```

Al terminar, el resumen de todo lo que juntó (también queda en `informe-resumen.json`):

```bash
npm run resumen
```

Para borrar lo descargado:

```bash
npm run borrar
```

## Si da `bloqueo` o `login` desde el primer pedido: diagnóstico
Un 429 instantáneo en el primer pedido no es por cantidad: Instagram rechaza la *forma* del pedido (headers, o que no
se conecta como un navegador). El diagnóstico prueba cuatro formas de pedir lo mismo, una vez cada una con 6 s de pausa:

| Variante | Qué hace |
|---|---|
| `pagina` | Pide el HTML del perfil como si lo abrieras en el navegador; saca la descripción (seguidores, seguidos, publicaciones) y cuenta las publicaciones que vengan embebidas |
| `api-i` | Lo mismo que `npm start` |
| `api-www` | La API desde `www.instagram.com` con todos los headers que manda la web |
| `api-www-cookies` | Abre la portada para recibir las cookies **anónimas** que Instagram le da a cualquiera (`csrftoken`, `mid`, `ig_did`) y pide como la web. Nunca usa las de una sesión iniciada |

Con Node:

```bash
npm run diagnostico -- natgeo
```

Con Electron, que manda los pedidos por la red de Chromium y se conecta como Chrome (es lo que usaría la app). Usa el
Electron de `desktop/`, así que la primera vez hay que instalarlo:

```bash
npm ci --prefix ../../desktop
```

```bash
npm run diagnostico:electron -- natgeo
```

Se puede correr una sola variante nombrándola: `npm run diagnostico -- natgeo pagina`. Lo que devolvió cada una queda en
`datos/diagnostico/` y un renglón por variante en `datos/diagnostico.jsonl`. Si recién te bloquearon, esperá una hora
antes de diagnosticar: si no, todo va a dar 429 por el bloqueo anterior.

## Qué deja en `datos/`
| Archivo | Qué tiene |
|---|---|
| `pedidos.jsonl` | Un renglón por pedido: hora, cuenta, `resultado`, status HTTP, demora y tamaño |
| `<cuenta>/ultimo.json` | La última lectura, en el formato del spike (ver abajo) |
| `<cuenta>/<hora>.json` | Cada lectura, en el formato del spike |
| `<cuenta>/<hora>.crudo.json` | La respuesta tal cual vino de Instagram: para ver si hay algo útil que el formato no toma |
| `<cuenta>/<hora>.<resultado>.txt` | Cuando no vino un perfil: status y el principio de lo que devolvió |

`resultado` es `ok`, `privada`, `no_existe`, `login` (pide iniciar sesión), `bloqueo` (demasiados pedidos), `red` (no
se pudo conectar) o `raro` (otra cosa: mirá el `.txt`).

### Formato del spike
```jsonc
{
  "cuenta": "…", "nombre": "…", "bio": "…", "enlace": "…", "categoria": "…",
  "verificada": false, "profesional": true, "privada": false,
  "seguidores": 10000, "seguidos": 150, "publicacionesTotal": 320, "hayMas": true,
  "publicaciones": [{
    "codigo": "…", "url": "https://www.instagram.com/p/…/", "tipo": "reel | video | carrusel | foto",
    "fecha": "2026-11-24T…Z", "texto": "…", "hashtags": ["#…"], "menciones": ["@…"],
    "likes": 900, "comentarios": 100, "reproducciones": 50000, "duracion": 14.5, "piezas": null,
    "fijada": false, "descripcionAuto": "…", "lugar": null, "miniatura": "https://…", "video": "https://…"
  }]
}
```
`likes` queda en `null` si la cuenta los oculta. `reproducciones` y `duracion` solo vienen en videos y reels.

## Lo que ya se verificó (en un contenedor Linux)
- Las pruebas de `mapeo.mjs` pasan (`npm test`): limpiar el nombre de la cuenta, clasificar cada respuesta (perfil,
  privada, no existe, pedido de login, bloqueo, redirección) y pasar a este formato reels, carruseles, fotos fijadas y
  likes ocultos. La respuesta de prueba (`fixtures/perfil.json`) está armada a mano con la forma conocida de la de
  Instagram: **falta confirmarla contra una respuesta real**.
- No se hizo ningún pedido real a Instagram desde el contenedor, y `diagnostico-electron.mjs` no se llegó a correr
  (no se pudo bajar el binario de Electron ahí).

## Resultados en una compu
- **Linux, Node, primera lectura de `natgeo`:** `bloqueo` (429) en 109 ms. Fue el primer pedido, así que
  Instagram rechazó la forma del pedido, no la cantidad. Siguiente paso: el diagnóstico.

## Qué hay que verificar (y anotar en el informe de abajo)
1. **¿Anda?** `npm start -- <una cuenta pública que conozcas>`: ¿da `ok`? Si da otra cosa, mirá el `.txt`.
2. **¿Qué trae?** ¿Cuántas publicaciones (se esperan 12)? ¿Vienen likes, comentarios y reproducciones de los reels?
   Compará dos o tres contra lo que ves en la app de Instagram. ¿Hay algo útil en el `.crudo.json` que el formato no
   toma?
3. **Reels.** ¿Los reels salen como `reel` y con `reproducciones`? (Instagram a veces los manda como `video`.)
4. **Aguante.** `npm run aguante` con 2 o 3 cuentas durante un día: ¿en algún momento da `login` o `bloqueo`? ¿Cuántos
   `ok` hubo antes y cuánto tardó en volver a andar? Esto decide cada cuánto podría leer la app.
5. **Con la VPN o en otra red** (si usás): ¿cambia algo?

## Informe
Completar después de probarlo.

| Punto | Resultado |
|---|---|
| ¿Anda desde tu compu? | |
| Publicaciones por lectura | |
| Likes, comentarios y reproducciones coinciden con la app | |
| Reels reconocidos como `reel` | |
| Primer freno (`login`/`bloqueo`): después de cuántos pedidos y con qué intervalo | |
| Cuánto tardó en volver a andar | |
| Datos útiles del crudo que faltan en el formato | |
