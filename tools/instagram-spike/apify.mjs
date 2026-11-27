// Lectura por Apify (apify/instagram-scraper): Apify lee Instagram desde sus servidores y nosotros solo le pedimos el
// resultado a su API. No hace falta navegador ni registrar nada en Meta: solo la clave de tu cuenta de Apify.
//
// Uso:
//   node apify.mjs <cuenta> [<cuenta>...]                datos del perfil con sus últimas publicaciones (1 resultado por cuenta)
//   node apify.mjs <cuenta> --publicaciones 30           además, las últimas 30 publicaciones (30 resultados más por cuenta)
//   node apify.mjs <cuenta> --tope 0.20                  tope de gasto por corrida en dólares (por defecto 0.10)
//
// Cada corrida se lanza y se consulta cada minuto hasta que termina (máximo 20 minutos), mostrando cómo va.
//
// La clave va en la variable APIFY_TOKEN o en el archivo datos/.apify-token. Nunca se muestra ni se guarda en otro lado.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { limpiarCuenta, mapearPerfilApify } from './mapeo.mjs'
import { mostrar } from './mostrar.mjs'

const ACTOR = 'apify~instagram-scraper'
// Precio por resultado del plan gratuito (pricingInfos del actor, 2026-11). Solo para mostrar una estimación.
const USD_POR_RESULTADO = 0.0027

const args = process.argv.slice(2)
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined }
const DATOS = path.resolve(opcion('--datos') ?? './datos')
const nPublicaciones = Number(opcion('--publicaciones') ?? 0)
const tope = Number(opcion('--tope') ?? 0.10)
const cuentas = args.map((a) => {
  const c = limpiarCuenta(a)
  if (!c) { console.error(`«${a}» no parece una cuenta de Instagram`); process.exit(2) }
  return c
})
if (!cuentas.length) { console.error('Uso: node apify.mjs <cuenta> [<cuenta>...] [--publicaciones 30] [--tope 0.10]'); process.exit(2) }
if (!(nPublicaciones >= 0 && nPublicaciones <= 200)) { console.error('--publicaciones va de 0 a 200'); process.exit(2) }
if (!(tope > 0 && tope <= 5)) { console.error('--tope va de más de 0 a 5 dólares'); process.exit(2) }

fs.mkdirSync(DATOS, { recursive: true })
const archivoToken = path.join(DATOS, '.apify-token')
const token = (process.env.APIFY_TOKEN ?? (fs.existsSync(archivoToken) ? fs.readFileSync(archivoToken, 'utf8') : '')).trim()
if (!token) {
  console.error('Falta la clave de Apify. Copiala de console.apify.com › Settings › API & Integrations y guardala así:\n')
  console.error('  read -rs APIFY_TOKEN && printf %s "$APIFY_TOKEN" > datos/.apify-token && chmod 600 datos/.apify-token\n')
  console.error('(pegala y Enter; no se ve en pantalla) o exportá APIFY_TOKEN antes de correr.')
  process.exit(2)
}

const API = 'https://api.apify.com/v2'
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { 'Authorization': `Bearer ${token}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    signal: AbortSignal.timeout(120000),
  })
  const texto = await r.text()
  let json
  try { json = JSON.parse(texto) } catch { /* no es JSON */ }
  if (!r.ok) {
    const motivo = json?.error?.message ?? texto.slice(0, 300)
    const pista = r.status === 401 ? ' (¿la clave está bien copiada?)'
      : r.status === 402 || r.status === 403 ? ' (¿te quedaste sin crédito en Apify?)' : ''
    throw new Error(`Apify respondió ${r.status}: ${motivo}${pista}`)
  }
  return json
}

const TERMINADA = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']
const MAX_MIN = 20

/** Lanza el actor, muestra cómo va cada minuto hasta que termina (máximo 20 minutos) y trae sus resultados. */
async function correr(entrada, que) {
  const t0 = Date.now()
  let run = (await api('POST', `/acts/${ACTOR}/runs?maxTotalChargeUsd=${tope}&waitForFinish=30`, entrada)).data
  console.log(`${que}: corrida ${run.id} lanzada (se ve en console.apify.com › Runs)`)
  while (!TERMINADA.includes(run.status)) {
    const min = (Date.now() - t0) / 60000
    if (min > MAX_MIN) throw new Error(`La corrida ${run.id} lleva más de ${MAX_MIN} minutos; mirala en console.apify.com › Runs`)
    console.log(`  … ${run.status.toLowerCase()} · ${Math.round(min * 60)} s${run.stats?.resultCount ? ` · ${run.stats.resultCount} resultados` : ''}`)
    run = (await api('GET', `/actor-runs/${run.id}?waitForFinish=60`)).data
  }
  if (run.status !== 'SUCCEEDED') console.log(`  la corrida terminó en ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ''}; se usa lo que alcanzó a juntar`)
  const items = await api('GET', `/datasets/${run.defaultDatasetId}/items?clean=true`)
  const ms = Date.now() - t0
  console.log(`${que}: ${items.length} resultados en ${Math.round(ms / 1000)} s`)
  return { items: Array.isArray(items) ? items : [], ms }
}

const anexar = (o) => fs.appendFileSync(path.join(DATOS, 'pedidos.jsonl'), JSON.stringify(o) + '\n')

console.log(`Datos en ${DATOS}`)
const urls = cuentas.map((c) => `https://www.instagram.com/${c}/`)
let resultados = 0
try {
  // Una corrida para todos los perfiles juntos.
  const det = await correr({ directUrls: urls, resultsType: 'details' }, 'Perfiles')
  resultados += det.items.length

  let posts = { items: [], ms: 0 }
  if (nPublicaciones) {
    posts = await correr({ directUrls: urls, resultsType: 'posts', resultsLimit: nPublicaciones }, `Publicaciones (${nPublicaciones} por cuenta)`)
    resultados += posts.items.length
  }

  for (const cuenta of cuentas) {
    const t = new Date().toISOString()
    const d = det.items.find((x) => x.username?.toLowerCase() === cuenta || x.inputUrl?.toLowerCase().includes(`/${cuenta}/`))
    const suyos = posts.items.filter((p) => p.ownerUsername?.toLowerCase() === cuenta || p.inputUrl?.toLowerCase().includes(`/${cuenta}/`))
    const carpeta = path.join(DATOS, cuenta)
    fs.mkdirSync(carpeta, { recursive: true })
    const sello = t.replace(/[:.]/g, '-')
    fs.writeFileSync(path.join(carpeta, `${sello}.apify.crudo.json`), JSON.stringify({ detalles: d ?? null, publicaciones: suyos }, null, 2))
    const perfil = mapearPerfilApify(d, suyos)
    if (!perfil) {
      const motivo = d?.errorDescription ?? d?.error ?? 'Apify no devolvió el perfil'
      console.log(`\n@${cuenta}: ${motivo}`)
      anexar({ t, motor: 'apify', cuenta, resultado: d?.error === 'not_found' ? 'no_existe' : 'raro', detalle: motivo })
      continue
    }
    fs.writeFileSync(path.join(carpeta, `${sello}.json`), JSON.stringify(perfil, null, 2))
    fs.writeFileSync(path.join(carpeta, 'ultimo.json'), JSON.stringify(perfil, null, 2))
    anexar({ t, motor: 'apify', cuenta, resultado: perfil.privada ? 'privada' : 'ok', publicaciones: perfil.publicaciones.length })
    mostrar(perfil)
  }
} catch (e) {
  console.error(`\n${e.message}`)
  anexar({ t: new Date().toISOString(), motor: 'apify', cuentas, resultado: 'error', detalle: e.message })
  process.exitCode = 1
}
console.log(`\n${resultados} resultados · costo estimado USD ${(resultados * USD_POR_RESULTADO).toFixed(4)} (el real está en console.apify.com › Billing)`)
