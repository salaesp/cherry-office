// Ícono de la app en pixel art: el edificio de la oficina (el mismo de App.logo() en oficina/ui/base.js, con más
// detalle). Un solo dibujo en una grilla de 32×32 celdas; de acá salen todos los tamaños, escalados sin suavizado.
// Uso: node scripts/make-icon.mjs   (escribe build/icon.png, build/icono.svg, build/bandeja*.png y ../oficina/iconos/*.png)
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const N = 32 // celdas por lado
const T0 = 3, T1 = 28 // la baldosa ocupa las celdas 3..28 (≈ el margen de 100/1024 de los íconos de macOS)

const C = {
  K: '#2a1f2e', // contorno
  cielo1: '#9fd3ee', cielo2: '#b9e0f3', cielo3: '#d3ecf7',
  nube: '#ffffff', nubeS: '#e4f2fa',
  amb: '#e8a33d', ambL: '#f5c86a', ambS: '#c4822a',
  azul: '#5d7da6', azulL: '#8eaed2', azulS: '#45628a',
  luz: '#fff3c4', luzS: '#f2d67e', apagada: '#4a4060',
  puerta: '#7e4f2f', toldo: '#e2574c', toldoB: '#f7f5f0',
  hoja: '#46a457', hojaL: '#7fd06e', hojaS: '#2f7d45', tronco: '#7e4f2f',
  vereda: '#e7e2d8', veredaS: '#cfc9bf', antena: '#e2574c',
}

/** Dibuja la escena en una grilla N×N. `lleno`: sin baldosa, el cielo y la vereda llegan a los bordes. */
function escena(lleno) {
  const g = Array.from({ length: N }, () => Array(N).fill(null))
  let dx = 0 // corrimiento horizontal de los dibujos (el fondo va fijo)
  const r = (x, y, w, h, c) => { x += dx; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && j >= 0 && i < N && j < N) g[j][i] = c }
  const caja = (x, y, w, h, c) => { r(x, y, w, h, C.K); r(x + 1, y + 1, w - 2, h - 2, c) }

  // fondo: cielo en franjas y vereda
  const a = lleno ? 0 : T0, b = lleno ? N - 1 : T1
  r(a, a, b - a + 1, 25 - a, C.cielo1)
  r(a, 10, b - a + 1, 6, C.cielo2)
  r(a, 16, b - a + 1, 9, C.cielo3)
  r(a, 25, b - a + 1, b - 24, C.vereda)
  r(a, 25, b - a + 1, 1, C.K)
  for (let i = a + 1; i <= b; i += 4) r(i, 27, 2, 1, C.veredaS)

  dx = 1 // la escena centrada en la baldosa
  // nubes
  r(6, 7, 4, 1, C.nube); r(5, 8, 6, 1, C.nube); r(5, 9, 6, 1, C.nubeS)
  r(21, 5, 3, 1, C.nube); r(20, 6, 5, 1, C.nube); r(20, 7, 5, 1, C.nubeS)

  // anexo azul (detrás, a la derecha)
  caja(18, 13, 8, 13, C.azul)
  r(19, 14, 6, 1, C.azulL); r(24, 14, 1, 11, C.azulS)
  for (const y of [16, 19, 22]) { r(20, y, 3, 1, C.luz); r(23, y, 1, 1, C.luzS) }

  // torre ámbar
  caja(8, 8, 12, 18, C.amb)
  r(9, 9, 10, 1, C.ambL); r(18, 9, 1, 16, C.ambS)
  r(7, 8, 14, 1, C.K) // cornisa
  // antena
  r(13, 4, 1, 4, C.K); r(13, 3, 1, 1, C.antena); r(12, 7, 3, 1, C.K)
  // ventanas 2×2: encendidas y alguna apagada
  const prendida = [[1, 1, 0], [1, 0, 1], [0, 1, 1]]
  ;[10, 14, 18].forEach((y, fila) => [10, 13, 16].forEach((x, col) => {
    if (prendida[fila][col]) { r(x, y, 2, 2, C.luz); r(x + 1, y + 1, 1, 1, C.luzS) } else r(x, y, 2, 2, C.apagada)
  }))
  // puerta con toldo
  r(12, 21, 4, 1, C.toldo); r(13, 21, 1, 1, C.toldoB); r(15, 21, 1, 1, C.toldoB)
  r(12, 22, 4, 1, C.K)
  r(13, 23, 2, 2, C.puerta)

  // arbolito
  r(5, 20, 3, 1, C.K); r(4, 21, 5, 1, C.K); r(3, 22, 1, 2, C.K); r(9, 22, 1, 2, C.K) // contorno de la copa
  r(5, 21, 3, 1, C.hojaL); r(4, 22, 5, 2, C.hoja); r(5, 22, 2, 1, C.hojaL); r(7, 23, 2, 1, C.hojaS)
  r(4, 24, 5, 1, C.K); r(6, 24, 1, 1, C.tronco)

  if (!lleno) recortar(g)
  return g
}

/** Esquinas escalonadas de la baldosa (radio ≈ 4 celdas) y nada fuera de ella. */
function recortar(g) {
  const R = 4.2
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (x < T0 || x > T1 || y < T0 || y > T1) { g[y][x] = null; continue }
    const cx = Math.min(Math.max(x + 0.5, T0 + R), T1 + 1 - R), cy = Math.min(Math.max(y + 0.5, T0 + R), T1 + 1 - R)
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > R) g[y][x] = null
  }
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

/** PNG RGBA de `lado` px; `recorte` saca píxeles de cada borde después de escalar (para tamaños que no son múltiplo de 32). */
function png(g, lado, recorte = 0) {
  const cel = (lado + 2 * recorte) / g.length
  const filas = []
  for (let y = 0; y < lado; y++) {
    const f = Buffer.alloc(1 + lado * 4)
    for (let x = 0; x < lado; x++) {
      const c = g[Math.floor((y + recorte) / cel)][Math.floor((x + recorte) / cel)]
      if (c) { const [R, G, B] = hex(c); f.set([R, G, B, 255], 1 + x * 4) }
    }
    filas.push(f)
  }
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
  const trozo = (tipo, datos) => {
    const t = Buffer.concat([Buffer.from(tipo), datos]), out = Buffer.alloc(t.length + 8)
    out.writeUInt32BE(datos.length, 0); t.copy(out, 4); out.writeUInt32BE(crc(t), t.length + 4); return out
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(lado, 0); ihdr.writeUInt32BE(lado, 4); ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(Buffer.concat(filas), { level: 9 })), trozo('IEND', Buffer.alloc(0))])
}

/** SVG con un rect por tramo horizontal del mismo color. */
function svg(g) {
  let v = ''
  for (let y = 0; y < N; y++) for (let x = 0; x < N;) {
    const c = g[y][x]; let w = 1
    while (c && x + w < N && g[y][x + w] === c) w++
    if (c) v += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${c}"/>`
    x += w
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Ícono de la app (pixel art). Generado por scripts/make-icon.mjs: no editar a mano. -->\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="1024" height="1024" shape-rendering="crispEdges">${v}</svg>\n`
}

/** Versión chica para la bandeja / barra de menú: el logo de 16×16 de App.logo() (oficina/ui/base.js), celda por celda,
    con `margen` celdas transparentes alrededor (en Mac la barra pide 18 pt). */
function bandeja(margen) {
  const L = 16 + 2 * margen, g = Array.from({ length: L }, () => Array(L).fill(null))
  const r = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) g[j + margen][i + margen] = c }
  r(2, 2, 9, 13, C.K); r(3, 3, 7, 12, C.amb); r(3, 3, 7, 1, C.ambL); r(9, 3, 1, 12, C.ambS)
  r(10, 6, 4, 9, C.K); r(11, 7, 2, 8, C.azul); r(11, 7, 2, 1, C.azulL)
  for (const [x, y] of [[4, 5], [7, 5], [4, 8], [7, 8], [4, 11]]) r(x, y, 2, 2, C.luz)
  r(7, 12, 2, 3, C.K); r(11, 9, 2, 1, C.luz); r(11, 12, 2, 1, C.luz); r(1, 15, 14, 1, C.K)
  return g
}

const baldosa = escena(false), lleno = escena(true)
const sal = (p, d) => { writeFileSync(resolve(aqui, p), d); console.log('escribí', p) }
sal('../build/icon.png', png(baldosa, 1024))
sal('../build/icono.svg', svg(baldosa))
// Electron toma solo el @2x al cargar bandeja.png en pantallas retina
sal('../build/bandeja.png', png(bandeja(0), 16))
sal('../build/bandeja@2x.png', png(bandeja(0), 32))
sal('../build/bandeja-mac.png', png(bandeja(1), 18))
sal('../build/bandeja-mac@2x.png', png(bandeja(1), 36))
sal('../../oficina/iconos/icono-512.png', png(baldosa, 512))
sal('../../oficina/iconos/icono-192.png', png(baldosa, 192))
sal('../../oficina/iconos/icono-maskable-512.png', png(lleno, 512)) // a sangre: Android le pone su propia máscara
sal('../../oficina/iconos/apple-touch-icon.png', png(lleno, 180, 6)) // iOS redondea solo; 192 recortado a 180
