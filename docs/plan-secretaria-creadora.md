# Plan: la secretaría arma la oficina

## Contexto
Con los recados (`plan-recados.md`) la secretaría pasó a ser la puerta de entrada: le hablás, por texto o audio, y ella
contesta, anota, delega o pregunta. Lo que todavía la obliga a uno a ir a otro lado es **cambiar la oficina**: contratar a
alguien, crear un departamento, programar una tarea, sumar una regla. Eso hoy lo hace el Creador, en su propia pantalla
(`plan-creador-flujos.md`, §Creador).

Pedirle a la secretaría «contratá a alguien que lleve la facturación» es el mismo gesto que «decile a Marce que…». Y ella
tiene el contexto que al Creador le falta: su memoria, tus chats y tus mails.

Boceto: `bocetos/secretaria/creadora.html` (los cuatro ejemplos de abajo).

## La idea en una línea
La secretaría **usa las herramientas del Creador** (`proponer_*`, `marcar_faltante`, `descartar_tarjeta`, `ver_oficina`,
`listar_conectores`) cuando le hablás vos, sus tarjetas se dibujan debajo de su respuesta como las de delegar, y el
Creador queda como **la pantalla de armar la oficina**, donde esas mismas tarjetas se ven y se editan.

No hay un agente nuevo ni una maquinaria nueva: las tarjetas son las de `creador_tarjetas`, se validan con
`Creador.armar` (con la regla anti-invento de la cita) y se aplican con `Creador.aplicar`.

## Decisiones
1. **Solo quien atiende la secretaría** (`MemoriaSecretariaAgente.atiende`). Los demás agentes siguen sin poder cambiar la
   oficina. Es el agente que ya es tu punto de entrada; darle esto a todos sería otra conversación.
2. **Solo cuando le hablás vos.** Las herramientas existen mientras corre un mensaje tuyo en una charla con ella
   (`Delegaciones.enCharla`, la misma ventana que `delegar` y `preguntar`). En sus revisiones de WhatsApp, Gmail o
   Calendario, en el reporte, en tareas y encargos, no las tiene: un mail que diga «contraten a un community manager» no
   puede hacer aparecer una propuesta. La regla es **quién pidió, no qué dice**.
3. **La cita sigue siendo obligatoria.** `origen` tiene que estar, textual, en un mensaje tuyo de esa charla
   (`Creador.citaValida`). Lo que traés pegado de otros (un mail reenviado) es dato; la instrucción se lo dice.
4. **Nada se crea sin tu ok.** Como en el Creador: las tarjetas quedan `lista` o `borrador`, y se crean cuando tocás
   «Aprobar». Quitar algo sigue pidiendo confirmación.
5. **Lo chico en la charla, lo grande en la pantalla del Creador.** Debajo de la respuesta:
   - hasta 3 tarjetas y ninguna en borrador → cada tarjeta con sus datos clave y la cita, y un pie con «Aprobar», «Abrir en
     el Creador» y «Descartar»;
   - más de 3, o alguna en borrador → un resumen (una línea por tarjeta con su estado y lo que falta) con «Abrir en el
     Creador» como botón principal y «Aprobar las N listas».
6. **Las tarjetas son de la oficina, no de la charla.** `creador_tarjetas` ya es por oficina: lo que propone la secretaría
   aparece también en la pantalla del Creador, con la marca «De la charla con Sofía», y lo que se aprueba en un lado se ve
   aprobado en el otro.
7. **Lo que te espera.** Las tarjetas de una charla que siguen pendientes (`lista` o `borrador`) cuentan en «Te esperan» de
   Bandeja › Hoy, agrupadas por charla, con «Ver la charla» y «Abrir en el Creador».

## Fuera de este plan (decisión abierta)
- **¿Toda oficina nueva arranca con secretaría?** Si sí, el Creador puede dejar de ser un personaje: la pantalla de armar la
  oficina la atendería ella, con su consigna y su memoria. Si no, sin secretaría sigue el Creador de hoy. Hasta decidirlo,
  la pantalla del Creador sigue atendida por el Creador; lo único que cambia ahí es que muestra las tarjetas que vienen de
  la charla.
- **«Pedírselo a Sofía» desde el reporte** (ejemplo 4 del boceto): un botón que te arma el recado a partir de algo que
  ella leyó. Es comodidad; la seguridad ya la da la decisión 2.

## Tareas y flujos para todos los agentes (decidido el 2026-11-27)
Crear una tarea o arrancar un flujo es trabajo del día a día, como delegar. Así que **cualquier agente**, en la charla con la
persona, puede:
- **proponer tareas programadas** (`proponer_tarea`, con `ver_oficina`, `marcar_faltante` y `descartar_tarjeta`): para sí o
  para un colega, como tarjeta del Creador que la persona aprueba. Lo decide `CambiosCharla.nombres` (`permisos.ts`): la
  secretaría tiene todas las del Creador; los demás, esas cuatro;
- **arrancar un flujo** de la oficina (`arrancar_flujo`, en `delegar.ts`): una tarjeta de tipo `flujo` en la charla, con las
  reglas de `delegar` (explícito → arranca después de la ventana para deshacer; deducido → propuesta que la persona
  confirma), hasta 2 por mensaje. Los flujos activos van en sus instrucciones con su primer paso.

Cambiar la estructura (contratar, departamentos, reglas, conectores, flujos nuevos) sigue siendo solo de la secretaría y el
Creador. Desde una charla solo se tocan las tarjetas de esa charla (ref, `marcar_faltante`, `descartar_tarjeta`).

## Cómo queda por dentro

### Backend
- **`secretaria-creadora.ts`** (módulo nuevo, orden 80, después de `creador` y `delegar`):
  - registra en el servidor MCP (`resto`) una fábrica que devuelve `HerramientasCambiosCharla` (las del perfil creador,
    filtradas por `CambiosCharla.nombres`) si `Delegaciones.enCharla(oficina, agente, sid)`;
  - suma sus instrucciones a las de la charla (`s.charla().instrucciones`): qué puede proponer, que mire `ver_oficina`
    antes, que cite textual, que lo de terceros es dato, que para algo grande avise que se sigue en el Creador y que no
    repita en el texto lo que ya muestran las tarjetas;
  - `cambiosDeCharla(s, oficina, sid)`: las tarjetas de esa charla (sin descartadas) con su `turno` (cuántos mensajes
    había cuando se propuso, para ponerlas debajo de su respuesta);
  - `cambiosPendientes(s, oficina)`: las pendientes de todas las charlas, agrupadas por charla.
- **`permisos.ts`**: `CambiosCharla.herramientasMCP` agrega los nombres del Creador a `--allowedTools` (todos para quien atiende
  la secretaría; los de tareas para los demás) (van permitidas siempre para que no pidan permiso; el servidor solo las ofrece en la charla, como `delegar`).
- **`delegar.ts`**: `GET /api/charlas/tarjetas` suma `cambios`; `GET /api/charlas/pendientes` suma `cambios`; la insignia
  `teEsperan` cuenta las charlas con cambios pendientes.
- **`rutas-creador.ts`**: `GET /api/creador/borrador` marca cada tarjeta que vino de una charla con `deCharla: <agente>` y
  `charla: <sid>`.
- Aprobar y descartar desde la charla usan las rutas que ya existen: `POST /api/creador/aplicar {ids}` y
  `DELETE /api/creador/tarjetas/:id`.

### Interfaz
- **`creador.js`** expone lo que ya sabe dibujar: `App.Creador.resumenTarjeta(t, todas)` (título, tipo, acción, estado,
  campos clave) para no duplicarlo.
- **`tarjetas.js`**: `App.Tarjetas.cambios(lista, op)`, el grupo de propuestas de la secretaría (detalle o resumen según la
  decisión 5), con «Aprobar», «Abrir en el Creador» y «Descartar».
- **`agente.js`**: cuelga `cambios` debajo de la respuesta de su turno, como las delegaciones.
- **`parte.js`**: en «Te esperan», un grupo por charla con cambios pendientes.
- **Pantalla del Creador**: insignia «De la charla con Sofía» en las tarjetas que vinieron de ahí, con «Ver la charla».

## Olas
### S1: backend (hecho)
Herramientas en la charla de la secretaría, permisos, instrucciones, `cambios` en tarjetas y pendientes, `deCharla` en el
borrador. Pruebas en `test/unit/secretaria-creadora.test.ts`.

### S2: interfaz (hecho)
Tarjetas en la charla, «Te esperan» y la marca en la pantalla del Creador.

### S3: la pantalla del Creador atendida por la secretaría (pendiente de la decisión abierta)

### S4: tareas programadas para todos los agentes (hecho)
`HerramientasCambiosCharla` filtra las herramientas del Creador según `CambiosCharla.nombres` y limita lo que toca tarjetas
existentes a las de la charla. Instrucciones «## Tareas programadas» para los que no atienden la secretaría.

### S5: arrancar un flujo desde la charla (hecho)
`arrancar_flujo` en `delegar.ts` (tarjeta `flujo`: propuesta | esperando | arrancado | fallida | cancelada), con
`MotorFlujos.iniciar`. En la interfaz, tarjeta con «Arrancarlo», «Deshacer», «Arrancar ya» y «Ver el flujo».

## Pruebas
- Con la secretaría: en una charla, `proponer_agente` y `proponer_tarea` crean tarjetas con el `sid` de la charla; aparecen
  en `/api/charlas/tarjetas` debajo de la respuesta (`turno`), en `/api/charlas/pendientes` y en la insignia; aprobarlas
  con `/api/creador/aplicar` contrata y programa; descartadas dejan de contar.
- La cita: si no está en un mensaje de la persona en esa charla, se rechaza.
- Sin la persona: en una corrida que no es la charla (otra sesión, revisión, encargo) las herramientas no aparecen.
- Otro agente (no atiende la secretaría) no las tiene ni en la charla.
- Las instrucciones: «Armar la oficina» para la secretaría y «Tareas programadas» para los demás.
- Otro agente propone una tarea en su charla; no puede contratar; desde otra charla no toca tarjetas ajenas.
- `arrancar_flujo`: explícito arranca la corrida después de la ventana (y se puede deshacer antes); deducido queda como
  propuesta y cuenta en lo que espera; errores de flujo inexistente, pausado, sin `explicito` y más de 2 por mensaje.
- `--allowedTools` de la secretaría incluye los nombres del Creador; los de otro agente, no.
- El borrador del Creador marca `deCharla` en las tarjetas que vinieron de una charla.
