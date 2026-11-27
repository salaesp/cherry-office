// Prueba suelta: lee perfiles públicos de Instagram SIN iniciar sesión y sin registrar una app, con el mismo pedido que
// hace la web de Instagram al abrir un perfil. No es parte de la app.
//
// Nunca manda cookies ni credenciales: si Instagram pide iniciar sesión, se anota y se sigue. No baja fotos ni videos
// (solo guarda sus URLs).
//
// Uso:
//   node spike.mjs <cuenta> [<cuenta>...]           una lectura de cada una
//   node spike.mjs <cuenta>... --cada 30             repite cada 30 minutos (para ver cuánto aguanta sin bloqueo)
//   node spike.mjs <cuenta>... --datos ./otra        otra carpeta de datos (por defecto ./datos)
// Las cuentas pueden ir como `nombre`, `@nombre` o `https://www.instagram.com/nombre/`.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { clasificar, limpiarCuenta, mapearPerfil, resumir } from './mapeo.mjs'

// El id que manda la web de Instagram en `x-ig-app-id`. No es una app nuestra ni hace falta registrarlo.
const APP_ID_WEB = '936619743392459'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
// Entre cuenta y cuenta, para no parecer una ráfaga.
const PAUSA_ENTRE_CUENTAS_MS = 4000

const args = process.argv.slice(2)
const opcion = (n) => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v }
const DATOS = path.resolve(opcion('--datos') ?? './datos')
const cada = Number(opcion('--cada') ?? 0)
const cuentas = args.map((a) => {
  const c = limpiarCuenta(a)
  if (!c) { console.error(`«${a}» no parece una cuenta de Instagram`); process.exit(2) }
  return c
})
if (!cuentas.length) {
  console.error('Uso: node spike.mjs <cuenta> [<cuenta>...] [--cada <minutos>]')
  process.exit(2)
}
if (cada && cada < 5) { console.error('--cada tiene que ser de 5 minutos o más'); process.exit(2) }

fs.mkdirSync(DATOS, { recursive: true })
const anexar = (o) => fs.appendFileSync(path.join(DATOS, 'pedidos.jsonl'), JSON.stringify(o) + '\n')
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function leer(cuenta) {
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(cuenta)}`
  const t0 = Date.now()
  let status = 0, location, cuerpo = '', error
  try {
    const r = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
        'x-ig-app-id': APP_ID_WEB,
        'Referer': `https://www.instagram.com/${cuenta}/`,
        'Origin': 'https://www.instagram.com',
      },
    })
    status = r.status
    location = r.headers.get('location') ?? undefined
    cuerpo = await r.text()
  } catch (e) {
    error = e?.cause?.code ?? e?.name ?? String(e)
  }
  const ms = Date.now() - t0
  const resultado = error ? 'red' : clasificar({ status, location, cuerpo })
  const registro = { t: new Date().toISOString(), cuenta, resultado, status, ms, bytes: cuerpo.length, ...(error ? { error } : {}), ...(location ? { location } : {}) }

  const carpeta = path.join(DATOS, cuenta)
  fs.mkdirSync(carpeta, { recursive: true })
  const sello = registro.t.replace(/[:.]/g, '-')
  if (resultado === 'ok' || resultado === 'privada') {
    const crudo = JSON.parse(cuerpo)
    const perfil = mapearPerfil(crudo)
    fs.writeFileSync(path.join(carpeta, `${sello}.crudo.json`), JSON.stringify(crudo, null, 2))
    fs.writeFileSync(path.join(carpeta, `${sello}.json`), JSON.stringify(perfil, null, 2))
    fs.writeFileSync(path.join(carpeta, 'ultimo.json'), JSON.stringify(perfil, null, 2))
    registro.publicaciones = perfil.publicaciones.length
    mostrar(perfil)
  } else {
    // Para ver qué devolvió cuando no fue un perfil (página de login, aviso de espera, etc.).
    fs.writeFileSync(path.join(carpeta, `${sello}.${resultado}.txt`), `status ${status}${location ? `\nlocation ${location}` : ''}\n\n${cuerpo.slice(0, 4000)}`)
    console.log(`@${cuenta}: ${resultado} (status ${status}${error ? `, ${error}` : ''}, ${ms} ms)`)
  }
  anexar(registro)
  return resultado
}

function mostrar(perfil) {
  console.log(`\n@${perfil.cuenta} · ${perfil.nombre} · ${perfil.seguidores ?? '?'} seguidores · ${perfil.publicacionesTotal ?? '?'} publicaciones${perfil.privada ? ' · PRIVADA' : ''}`)
  if (perfil.privada) return
  for (const p of perfil.publicaciones) {
    const fecha = p.fecha?.slice(0, 10) ?? '?'
    const vistas = p.reproducciones !== null ? ` · ${p.reproducciones} repr.` : ''
    const texto = p.texto.replace(/\s+/g, ' ').slice(0, 70)
    console.log(`  ${fecha} ${p.tipo.padEnd(8)} ${String(p.likes ?? '–').padStart(7)} ♥ ${String(p.comentarios ?? '–').padStart(5)} 💬${vistas}${p.fijada ? ' 📌' : ''}  ${texto}`)
  }
  const r = resumir(perfil)
  console.log(`  ${r.leidas} leídas · ${r.porSemana ?? '?'} por semana · ${Object.entries(r.tipos).map(([t, x]) => `${t}: ${x.cantidad} (${x.interaccionPct ?? '?'} % interacción)`).join(' · ')}`)
}

async function ronda() {
  const vistos = {}
  for (const [i, c] of cuentas.entries()) {
    if (i) await esperar(PAUSA_ENTRE_CUENTAS_MS)
    const r = await leer(c)
    vistos[r] = (vistos[r] ?? 0) + 1
    // Si nos frenaron, seguir pidiendo solo empeora el bloqueo.
    if (r === 'bloqueo' || r === 'login') { console.log('Instagram frenó los pedidos: se corta esta ronda.'); break }
  }
  return vistos
}

console.log(`Datos en ${DATOS}`)
let n = 0
do {
  n++
  const vistos = await ronda()
  if (cada) {
    console.log(`\nRonda ${n}: ${JSON.stringify(vistos)}. Próxima en ${cada} min (Ctrl+C para cortar).`)
    await esperar(cada * 60000)
  }
} while (cada)
