// Diagnóstico con un navegador de verdad, sin pantalla (Chromium headless con playwright-core). Para máquinas sin
// monitor, como una Raspberry: abre el perfil como lo abrirías vos, deja que la página corra su JavaScript y anota qué
// datos pide y recibe. Después, desde la misma página (con sus cookies anónimas y su forma de conectarse), pide la API.
//
// Nunca inicia sesión. Usa un perfil de navegador nuevo y vacío en cada corrida.
//
// Uso: node diagnostico-navegador.mjs <cuenta> [--chromium /usr/bin/chromium] [--datos ./datos]
// Sin --chromium busca el del sistema (chromium o chromium-browser) y si no, el que instala `npx playwright install chromium`.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright-core'
import { limpiarCuenta, mapearPerfil } from './mapeo.mjs'
import { APP_ID_WEB, leerPagina } from './variantes.mjs'

const args = process.argv.slice(2)
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined }
const datos = path.resolve(opcion('--datos') ?? './datos')
const ejecutable = opcion('--chromium') ?? ['/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p))
const cuenta = limpiarCuenta(args[0])
if (!cuenta) { console.error('Uso: node diagnostico-navegador.mjs <cuenta> [--chromium /ruta/a/chromium]'); process.exit(2) }

const dir = path.join(datos, 'diagnostico')
fs.mkdirSync(dir, { recursive: true })
const sello = new Date().toISOString().replace(/[:.]/g, '-')
const archivo = (n) => path.join(dir, `${sello}-navegador-${n}`)
const anotar = (fila) => fs.appendFileSync(path.join(datos, 'diagnostico.jsonl'), JSON.stringify({ t: new Date().toISOString(), motor: 'navegador', cuenta, ...fila }) + '\n')

console.log(`Diagnóstico de @${cuenta} con Chromium headless (${ejecutable ?? 'el de Playwright'})\n`)
let browser
try {
  browser = await chromium.launch({ headless: true, ...(ejecutable ? { executablePath: ejecutable } : {}) })
} catch (e) {
  console.error(`No se pudo abrir Chromium: ${e.message.split('\n')[0]}\n`)
  console.error('En Raspberry Pi OS o Debian instalá el del sistema:\n\n  sudo apt install -y chromium\n')
  console.error('o el de Playwright (en ARM puede no andar):\n\n  npx playwright install --with-deps chromium\n')
  process.exit(1)
}

// El navegador headless se presenta como «HeadlessChrome»: se cambia por el de un Chrome común de la misma versión.
const version = browser.version()
const userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version.split('.')[0]}.0.0.0 Safari/537.36`
const contexto = await browser.newContext({ userAgent, locale: 'es-AR', viewport: { width: 1280, height: 900 } })
const pagina = await contexto.newPage()

// Lo que la propia página pide y recibe de Instagram con datos del perfil.
const capturas = []
pagina.on('response', async (r) => {
  const url = r.url()
  if (!/web_profile_info|\/graphql\/query|\/api\/v1\/feed\/user\//.test(url)) return
  let cuerpo = ''
  try { cuerpo = await r.text() } catch { /* sin cuerpo (redirección) */ }
  capturas.push({ url: url.slice(0, 120), status: r.status(), bytes: cuerpo.length, cuerpo })
})

const t0 = Date.now()
let estado
try {
  const r = await pagina.goto(`https://www.instagram.com/${cuenta}/`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  estado = r?.status()
  await pagina.waitForTimeout(8000) // que la página termine de pedir sus datos
} catch (e) {
  console.log(`No cargó la página: ${e.message.split('\n')[0]}`)
}
const urlFinal = pagina.url()
const html = await pagina.content().catch(() => '')
const enLaPagina = await pagina.$$eval('a[href*="/p/"], a[href*="/reel/"]', (as) => new Set(as.map((a) => a.getAttribute('href'))).size).catch(() => 0)
const info = leerPagina(html)
const fueAlLogin = /\/accounts\/login|\/challenge/.test(urlFinal)
fs.writeFileSync(archivo('pagina.html'), html)
await pagina.screenshot({ path: archivo('pagina.png') }).catch(() => {})
const filaPagina = {
  variante: 'navegador-pagina', resultado: fueAlLogin ? 'login' : estado === 200 ? 'ok' : 'raro', status: estado ?? 0, ms: Date.now() - t0,
  urlFinal, descripcion: info.descripcion, publicacionesVisibles: enLaPagina,
  capturas: capturas.map(({ url, status, bytes }) => ({ url, status, bytes })),
}
console.log(`navegador-pagina ${filaPagina.resultado.padEnd(9)} status ${filaPagina.status} · ${filaPagina.ms} ms${fueAlLogin ? ` · terminó en ${urlFinal}` : ''}`)
console.log(`                 ${info.descripcion ?? 'sin descripción'} · ${enLaPagina} publicaciones visibles en la página`)
for (const c of capturas) console.log(`                 la página pidió ${c.url} → ${c.status} (${c.bytes} bytes)`)
anotar(filaPagina)
const perfilCapturado = capturas.find((c) => c.url.includes('web_profile_info') && c.status === 200)
if (perfilCapturado) fs.writeFileSync(archivo('capturado.json'), perfilCapturado.cuerpo)

// Desde la página, con sus cookies anónimas: el mismo pedido que hace la web.
await pagina.waitForTimeout(3000)
const t1 = Date.now()
const api = await pagina.evaluate(async ({ cuenta, appId }) => {
  try {
    const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1]
    const r = await fetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(cuenta)}`, {
      headers: { 'X-IG-App-ID': appId, 'X-Requested-With': 'XMLHttpRequest', ...(csrf ? { 'X-CSRFToken': csrf } : {}) },
      credentials: 'include',
    })
    return { status: r.status, cuerpo: await r.text(), cookies: document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean) }
  } catch (e) {
    return { status: 0, cuerpo: '', error: String(e) }
  }
}, { cuenta, appId: APP_ID_WEB }).catch((e) => ({ status: 0, cuerpo: '', error: e.message }))
let publicaciones
try { publicaciones = mapearPerfil(JSON.parse(api.cuerpo))?.publicaciones.length } catch { /* no es un perfil */ }
fs.writeFileSync(archivo('api.txt'), `status ${api.status}\n\n${api.cuerpo.slice(0, 200000)}`)
const filaApi = {
  variante: 'navegador-api', resultado: publicaciones !== undefined ? 'ok' : api.status === 429 ? 'bloqueo' : api.status === 401 ? 'login' : 'raro',
  status: api.status, ms: Date.now() - t1, ...(publicaciones !== undefined ? { publicaciones } : {}), cookies: api.cookies, ...(api.error ? { error: api.error } : {}),
}
console.log(`navegador-api    ${filaApi.resultado.padEnd(9)} status ${filaApi.status} · ${filaApi.ms} ms${publicaciones !== undefined ? ` · ${publicaciones} publicaciones` : ''} · cookies: ${(api.cookies ?? []).join(', ') || 'ninguna'}${api.error ? ` · ${api.error}` : ''}`)
anotar(filaApi)

await browser.close()
console.log(`\nLo devuelto (HTML, captura de pantalla y respuestas) quedó en ${dir}`)
