# oficina/ (el front)

La interfaz de Oficina: la oficina en pixel art y todas las pantallas. La app de escritorio
(`desktop/`, Mac y Windows) la sirve tal cual.

- `index.html`: punto de entrada.
- `ui/`: un módulo por pantalla (`app.js` arma la base; `nav.js` el riel de secciones —Bandeja, Oficina, Equipo (personas y
  reuniones), Archivos y Trabajo—, la columna de lista y las rutas con `#` (`#/equipo/<agente>/<sesión>`, `#/archivos/biblioteca`…;
  `#/charlas/…` redirige a Equipo): los módulos siguen pintando en el panel `App.dom.derecho`, que sobre la oficina flota y en
  las secciones va pegado a la lista, con la oficina viva a la derecha (en el celular ocupa todo); `pixel/` la oficina (`oficina-pixel.js`, con muebles, personajes y
  el editor de apariencia en `avatar.js`); `contratar.js` el editor de agentes; `flujos.js`, `reunion.js`, `biblioteca.js`, `parte.js`, `entregables.js`, `creador.js`…) y los
  estilos (`estilo.css` y uno por módulo grande).
- `vendor/`: la fuente Poppins, offline (con su licencia).
- `personajes/`, `Agentes imagenes/`: retratos de los agentes de Próspera.

Para probarla en el navegador: `npm run dev --prefix backend` y abrir http://localhost:8765 (ver el README de la raíz).
