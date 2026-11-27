// Lectura por Apify (apify/instagram-scraper): Apify lee Instagram desde sus servidores y nosotros solo le pedimos el
// resultado a su API. No hace falta navegador ni registrar nada en Meta: solo la clave de tu cuenta de Apify.
//
// Uso:
//   node apify.mjs <cuenta> [<cuenta>...]                datos del perfil con sus últimas publicaciones (1 resultado por cuenta)
//   node apify.mjs <cuenta> --publicaciones 30           además, las últimas 30 publicaciones (30 resultados más por cuenta)
//   node apify.mjs <cuenta> --tope 0.20                  tope de gasto por corrida en dólares (por defecto 0.10)
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

/** Corre el actor y espera sus resultados (hasta 5 minutos). */
async function correr(entrada) {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?maxTotalChargeUsd=${tope}`
  const t0 = Date.now()
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(entrada),
    signal: AbortSignal.timeout(330000),
  })
  const cuerpo = await r.text()
  let json
  try { json = JSON.parse(cuerpo) } catch { /* no es JSON */ }
  if (!r.ok) {
    const motivo = json?.error?.message ?? cuerpo.slice(0, 300)
    const pista = r.status === 401 ? ' (¿la clave está bien copiada?)'
      : r.status === 402 || r.status === 403 ? ' (¿te quedaste sin crédito en Apify?)'
      : r.status === 408 ? ' (la corrida tardó más de 5 minutos; mirala en console.apify.com › Runs)' : ''
    throw new Error(`Apify respondió ${r.status}: ${motivo}${pista}`)
  }
  return { items: Array.isArray(json) ? json : [], ms: Date.now() - t0 }
}

const anexar = (o) => fs.appendFileSync(path.join(DATOS, 'pedidos.jsonl'), JSON.stringify(o) + '\n')

console.log(`Datos en ${DATOS}`)
const urls = cuentas.map((c) => `https://www.instagram.com/${c}/`)
let resultados = 0
try {
  // Una corrida para todos los perfiles juntos.
  const det = await correr({ directUrls: urls, resultsType: 'details' })
  resultados += det.items.length
  console.log(`Perfiles: ${det.items.length} resultados en ${Math.round(det.ms / 1000)} s`)

  let posts = { items: [], ms: 0 }
  if (nPublicaciones) {
    posts = await correr({ directUrls: urls, resultsType: 'posts', resultsLimit: nPublicaciones })
    resultados += posts.items.length
    console.log(`Publicaciones: ${posts.items.length} resultados en ${Math.round(posts.ms / 1000)} s`)
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
