// Diagnóstico: prueba varias formas de pedir el mismo perfil, una vez cada una y con pausas, para ver cuál deja pasar
// Instagram. No depende de cómo se hace el pedido: `pedir(url, headers)` lo pone quien lo corre (Node o Electron, que usa
// la red de Chromium y se conecta como Chrome).
//
// `pedir` devuelve `{status, location?, cuerpo, cookies: {nombre: valor}}`, sin seguir redirecciones.
//
// Las cookies que se usan acá son las ANÓNIMAS que Instagram le da a cualquiera que abre la página (csrftoken, mid,
// ig_did): nunca las de una sesión iniciada.
import fs from 'node:fs'
import path from 'node:path'
import { clasificar, mapearPerfil } from './mapeo.mjs'

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
export const APP_ID_WEB = '936619743392459'
const PAUSA_MS = 6000

const navegacion = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
}

const xhr = (cuenta) => ({
  'User-Agent': UA,
  'Accept': '*/*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Referer': `https://www.instagram.com/${cuenta}/`,
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'X-Requested-With': 'XMLHttpRequest',
  'X-IG-App-ID': APP_ID_WEB,
  'X-ASBD-ID': '129477',
  'X-IG-WWW-Claim': '0',
})

const api = (host, cuenta) => `https://${host}/api/v1/users/web_profile_info/?username=${encodeURIComponent(cuenta)}`
const cookieHeader = (c) => Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ')

/** Lo que se puede sacar del HTML de un perfil sin iniciar sesión. */
export function leerPagina(html) {
  const meta = html.match(/<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]*)"/i)?.[1]
  const decodificar = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  const codigos = new Set([...html.matchAll(/"(?:shortcode|code)":"([A-Za-z0-9_-]{9,14})"/g)].map((m) => m[1]))
  return {
    descripcion: meta ? decodificar(meta) : null,
    publicacionesEnLaPagina: codigos.size,
    pideLogin: /\/accounts\/login/.test(html) && !meta,
  }
}

/** Las variantes, de la menos a la más insistente. Cada una devuelve lo que pasó. */
export const variantes = [
  {
    nombre: 'pagina',
    explica: 'El HTML del perfil, como si lo abrieras en el navegador',
    async correr(pedir, cuenta) {
      const r = await pedir(`https://www.instagram.com/${cuenta}/`, navegacion)
      const ok = r.status === 200
      return { ...r, resultado: ok ? 'ok' : clasificar(r), ...(ok ? { pagina: leerPagina(r.cuerpo) } : {}) }
    },
  },
  {
    nombre: 'api-i',
    explica: 'Lo que hace npm start (i.instagram.com, pocos headers)',
    async correr(pedir, cuenta) {
      const r = await pedir(api('i.instagram.com', cuenta), { 'User-Agent': UA, 'Accept': '*/*', 'x-ig-app-id': APP_ID_WEB, 'Referer': `https://www.instagram.com/${cuenta}/` })
      return { ...r, resultado: clasificar(r) }
    },
  },
  {
    nombre: 'api-www',
    explica: 'www.instagram.com con todos los headers que manda la web',
    async correr(pedir, cuenta) {
      const r = await pedir(api('www.instagram.com', cuenta), xhr(cuenta))
      return { ...r, resultado: clasificar(r) }
    },
  },
  {
    nombre: 'api-www-cookies',
    explica: 'Abre la portada para recibir las cookies anónimas y después pide como la web',
    async correr(pedir, cuenta) {
      const portada = await pedir('https://www.instagram.com/', navegacion)
      const c = portada.cookies
      if (!c.csrftoken) return { ...portada, resultado: 'raro', nota: `la portada dio status ${portada.status} sin csrftoken (cookies: ${Object.keys(c).join(', ') || 'ninguna'})` }
      const r = await pedir(api('www.instagram.com', cuenta), { ...xhr(cuenta), 'X-CSRFToken': c.csrftoken, 'Cookie': cookieHeader(c) })
      return { ...r, resultado: clasificar(r), nota: `cookies anónimas: ${Object.keys(c).join(', ')}` }
    },
  },
]

/** Corre todas las variantes (o las nombradas) y llama a `informar` con cada resultado. */
export async function diagnosticar(cuenta, pedir, informar, soloEstas) {
  const lista = soloEstas?.length ? variantes.filter((v) => soloEstas.includes(v.nombre)) : variantes
  const resultados = []
  for (const [i, v] of lista.entries()) {
    if (i) await new Promise((r) => setTimeout(r, PAUSA_MS))
    const t0 = Date.now()
    let r
    try { r = await v.correr(pedir, cuenta) } catch (e) { r = { status: 0, cuerpo: '', resultado: 'red', error: e?.cause?.code ?? e?.message ?? String(e) } }
    const fila = { variante: v.nombre, explica: v.explica, resultado: r.resultado, status: r.status, ms: Date.now() - t0, bytes: r.cuerpo?.length ?? 0,
      ...(r.location ? { location: r.location } : {}), ...(r.error ? { error: r.error } : {}), ...(r.nota ? { nota: r.nota } : {}), ...(r.pagina ? { pagina: r.pagina } : {}) }
    if (r.resultado === 'ok' && v.nombre.startsWith('api')) {
      try { fila.publicaciones = mapearPerfil(JSON.parse(r.cuerpo))?.publicaciones.length ?? 0 } catch { fila.resultado = 'raro' }
    }
    resultados.push(fila)
    informar(fila, r.cuerpo ?? '')
  }
  return resultados
}

/** Corre el diagnóstico de punta a punta: muestra cada variante, guarda lo devuelto en `<datos>/diagnostico/` y deja
 *  un renglón por variante en `diagnostico.jsonl`. `motor` es `node` o `electron`. */
export async function correrDiagnostico({ cuenta, pedir, motor, datos, soloEstas }) {
  const dir = path.join(datos, 'diagnostico')
  fs.mkdirSync(dir, { recursive: true })
  const sello = new Date().toISOString().replace(/[:.]/g, '-')
  console.log(`Diagnóstico de @${cuenta} con ${motor} (una vez cada variante, con pausas de ${PAUSA_MS / 1000} s)\n`)
  const resultados = await diagnosticar(cuenta, pedir, (fila, cuerpo) => {
    const extra = fila.pagina ? ` · ${fila.pagina.descripcion ?? 'sin descripción'} · ${fila.pagina.publicacionesEnLaPagina} publicaciones en el HTML${fila.pagina.pideLogin ? ' · pide login' : ''}`
      : fila.publicaciones !== undefined ? ` · ${fila.publicaciones} publicaciones` : ''
    console.log(`${fila.variante.padEnd(16)} ${fila.resultado.padEnd(9)} status ${fila.status} · ${fila.ms} ms${extra}${fila.nota ? ` · ${fila.nota}` : ''}${fila.error ? ` · ${fila.error}` : ''}`)
    console.log(`${''.padEnd(16)} ${fila.explica}`)
    fs.writeFileSync(path.join(dir, `${sello}-${motor}-${fila.variante}.txt`), `status ${fila.status}${fila.location ? `\nlocation ${fila.location}` : ''}\n\n${cuerpo.slice(0, 200000)}`)
    fs.appendFileSync(path.join(datos, 'diagnostico.jsonl'), JSON.stringify({ t: new Date().toISOString(), motor, cuenta, ...fila }) + '\n')
  }, soloEstas)
  const anduvo = resultados.filter((r) => r.resultado === 'ok').map((r) => r.variante)
  console.log(`\n${anduvo.length ? `Anduvieron: ${anduvo.join(', ')}` : 'No anduvo ninguna.'} Lo devuelto quedó en ${dir}`)
  return resultados
}
