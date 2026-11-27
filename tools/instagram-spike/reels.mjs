// Desarma los reels de la última lectura de una cuenta para poder analizarlos: baja cada video, saca imágenes del
// arranque (el gancho) y de todo el reel con ffmpeg, transcribe lo que se dice con Whisper en esta compu y arma una
// ficha por reel con todo junto y sus métricas. No gasta crédito de Apify: usa los links que vinieron en la lectura.
//
// Uso:
//   node reels.mjs <cuenta>                     todos los reels de datos/<cuenta>/ultimo.json
//   node reels.mjs <cuenta> --max 1             solo el de más reproducciones (o los N primeros)
//   node reels.mjs <cuenta> --codigo DAbc123    solo ese reel
//   node reels.mjs <cuenta> --sin-audio         sin transcribir (más rápido)
//   node reels.mjs <cuenta> --zona America/Argentina/Buenos_Aires   zona para el día y la hora de publicación
//
// Hace falta ffmpeg. Para transcribir, @huggingface/transformers (se instala con npm ci); el modelo de Whisper se baja la
// primera vez (unos 80 MB) a datos/modelos.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { limpiarCuenta, metricasReel } from './mapeo.mjs'

const args = process.argv.slice(2)
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined }
const bandera = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true }
const DATOS = path.resolve(opcion('--datos') ?? './datos')
const max = Number(opcion('--max') ?? 0)
const soloCodigo = opcion('--codigo')
const zona = opcion('--zona') ?? 'America/Argentina/Buenos_Aires'
const sinAudio = bandera('--sin-audio')
const modelo = opcion('--modelo') ?? 'onnx-community/whisper-base'
const cuenta = limpiarCuenta(args[0])
if (!cuenta) { console.error('Uso: node reels.mjs <cuenta> [--max 1] [--codigo X] [--sin-audio]'); process.exit(2) }

try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch {
  console.error('Falta ffmpeg. En Raspberry Pi OS o Debian:\n\n  sudo apt install -y ffmpeg\n')
  process.exit(1)
}

const ultimo = path.join(DATOS, cuenta, 'ultimo.json')
if (!fs.existsSync(ultimo)) { console.error(`No hay ${ultimo}: corré primero npm run apify -- ${cuenta} --publicaciones 12`); process.exit(1) }
const perfil = JSON.parse(fs.readFileSync(ultimo, 'utf8'))
const todos = perfil.publicaciones.filter((p) => (p.tipo === 'reel' || p.tipo === 'video') && p.video)
if (!todos.length) {
  console.error('La última lectura no trae links de video. Leé con publicaciones (las de los datos del perfil no los traen):\n')
  console.error(`  npm run apify -- ${cuenta} --publicaciones 12\n`)
  process.exit(1)
}
// Puesto de cada reel por reproducciones, entre los de la lectura.
const ranking = [...todos].sort((a, b) => (b.reproducciones ?? 0) - (a.reproducciones ?? 0))
let elegidos = soloCodigo ? todos.filter((p) => p.codigo === soloCodigo) : ranking
if (soloCodigo && !elegidos.length) { console.error(`No hay un reel ${soloCodigo} en la última lectura`); process.exit(1) }
if (max > 0) elegidos = elegidos.slice(0, max)

// MARK: - video

async function bajar(url, destino) {
  if (fs.existsSync(destino) && fs.statSync(destino).size > 0) return 'ya estaba'
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (r.status === 403 || r.status === 410) throw new Error('el link del video venció: volvé a leer la cuenta con npm run apify (los links duran horas o pocos días)')
  if (!r.ok) throw new Error(`no se pudo bajar el video (status ${r.status})`)
  fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()))
  return `${(fs.statSync(destino).size / 1e6).toFixed(1)} MB`
}

const duracionDe = (video) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }).trim())

const ffmpeg = (a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: ['ignore', 'ignore', 'pipe'] })

/** Imágenes: los segundos 0 a 3 sueltos (para leer bien el texto del gancho), una hoja con el gancho y otra con 12
 *  cuadros repartidos en todo el reel. */
function imagenes(video, dir, dur) {
  const sueltos = []
  for (const t of [0, 1, 2, 3].filter((t) => t < dur)) {
    const f = path.join(dir, `seg-${t}.jpg`)
    ffmpeg(['-ss', String(t + 0.05), '-i', video, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '3', f])
    sueltos.push(path.basename(f))
  }
  ffmpeg(['-t', '4', '-i', video, '-vf', 'fps=1,scale=300:-2,tile=4x1:padding=4', '-frames:v', '1', '-q:v', '3', path.join(dir, 'gancho.jpg')])
  const fps = Math.max(12 / Math.max(dur, 1), 0.05)
  ffmpeg(['-i', video, '-vf', `fps=${fps.toFixed(4)},scale=240:-2,tile=4x3:padding=4`, '-frames:v', '1', '-q:v', '3', path.join(dir, 'reel.jpg')])
  return sueltos
}

// MARK: - audio

/** El audio del video a 16 kHz mono, como Whisper lo espera. */
function audioDe(video) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'])
    const partes = []
    p.stdout.on('data', (d) => partes.push(d))
    p.on('error', reject)
    p.on('close', (c) => {
      const b = Buffer.concat(partes)
      if (c !== 0 && !b.length) return reject(new Error('el video no tiene audio'))
      resolve(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)))
    })
  })
}

let asr
async function transcribir(audio) {
  if (!asr) {
    let t
    try { t = await import('@huggingface/transformers') } catch {
      throw new Error('falta @huggingface/transformers: corré npm ci (o usá --sin-audio)')
    }
    t.env.cacheDir = path.join(DATOS, 'modelos')
    console.log(`  cargando Whisper (${modelo}; la primera vez se baja, unos 80 MB)…`)
    asr = await t.pipeline('automatic-speech-recognition', modelo, { dtype: 'q8' })
  }
  const r = await asr(audio, { language: 'spanish', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: true })
  const trozos = (r.chunks ?? []).map((c) => ({ desde: c.timestamp?.[0] ?? null, hasta: c.timestamp?.[1] ?? null, texto: c.text.trim() })).filter((c) => c.texto)
  return { texto: (r.text ?? '').trim(), trozos }
}

// MARK: - ficha

const seg = (x) => (x === null || x === undefined ? '?' : `${x.toFixed(1)} s`)
function cuando(fecha) {
  if (!fecha) return '?'
  const d = new Date(fecha)
  const f = new Intl.DateTimeFormat('es-AR', { timeZone: zona, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return f.format(d)
}

function ficha(p, m, dur, sueltos, trans) {
  const puesto = ranking.indexOf(p) + 1
  const l = []
  l.push(`# Reel ${p.codigo} de @${cuenta}`, '', `${p.url}`, '')
  l.push('## Métricas', '')
  l.push(`| | |`, `|---|---|`)
  l.push(`| Puesto por reproducciones | ${puesto} de ${ranking.length} reels de la lectura |`)
  l.push(`| Reproducciones | ${m.reproducciones ?? '?'} |`)
  l.push(`| Alcance aproximado (reproducciones ÷ ${perfil.seguidores} seguidores) | ${m.alcanceAproxPct ?? '?'} % |`)
  l.push(`| Likes · comentarios | ${p.likes ?? 'ocultos'} · ${p.comentarios ?? '?'} |`)
  l.push(`| Interacción sobre vistas ((likes + comentarios) ÷ reproducciones) | ${m.interaccionVistasPct ?? '?'} % |`)
  l.push(`| Duración | ${seg(dur)} |`)
  l.push(`| Publicado | ${cuando(p.fecha)} (${zona}) |`)
  l.push(`| Audio | ${p.musica ?? 'sin dato (suele ser audio original)'} |`)
  l.push(`| Fijado | ${p.fijada ? 'sí' : 'no'} |`)
  if (p.colaboracionPaga) l.push('| Colaboración paga | sí |')
  l.push('', '## Texto de la publicación', '', p.texto ? p.texto.split('\n').map((x) => `> ${x}`).join('\n') : '_(sin texto)_', '')
  l.push('## Imágenes', '')
  l.push(`- \`gancho.jpg\`: segundos 0, 1, 2 y 3 en una tira.`)
  l.push(`- ${sueltos.map((s) => `\`${s}\``).join(', ')}: esos mismos segundos, más grandes (para leer el texto en pantalla).`)
  l.push(`- \`reel.jpg\`: 12 cuadros repartidos en todo el reel (de izquierda a derecha y de arriba abajo).`, '')
  l.push('## Lo que se dice', '')
  if (!trans) l.push('_(sin transcribir)_')
  else if (trans.error) l.push(`_(no se pudo transcribir: ${trans.error})_`)
  else if (!trans.texto) l.push('_(no se entiende voz: puede ser solo música)_')
  else if (trans.trozos.length) for (const c of trans.trozos) l.push(`- **${seg(c.desde)}–${seg(c.hasta)}** ${c.texto}`)
  else l.push(trans.texto)
  if (p.ultimosComentarios?.length) {
    l.push('', '## Últimos comentarios', '')
    for (const c of p.ultimosComentarios) l.push(`- ${c.texto.replace(/\s+/g, ' ')}`)
  }
  l.push('', '_Datos de afuera de la cuenta: no incluyen alcance real, guardados ni compartidos. La transcripción es automática (Whisper) y puede tener errores._', '')
  return l.join('\n')
}

// MARK: - correr

const base = path.join(DATOS, cuenta, 'reels')
fs.mkdirSync(base, { recursive: true })
console.log(`@${cuenta}: ${elegidos.length} de ${todos.length} reels de la lectura${perfil.publicaciones[0]?.fecha ? '' : ''} → ${base}`)
const filas = []
for (const p of elegidos) {
  const dir = path.join(base, p.codigo)
  fs.mkdirSync(dir, { recursive: true })
  const video = path.join(dir, 'video.mp4')
  const m = metricasReel(p, perfil.seguidores)
  console.log(`\n${p.codigo} · ${m.reproducciones ?? '?'} repr. · ${p.texto.replace(/\s+/g, ' ').slice(0, 60)}`)
  try {
    console.log(`  video: ${await bajar(p.video, video)}`)
    const dur = duracionDe(video)
    const sueltos = imagenes(video, dir, dur)
    console.log(`  imágenes: gancho.jpg, reel.jpg y ${sueltos.length} sueltas (${seg(dur)})`)
    let trans
    if (!sinAudio) {
      try {
        const t0 = Date.now()
        trans = await transcribir(await audioDe(video))
        console.log(`  transcripción: ${trans.texto ? `${trans.texto.split(/\s+/).length} palabras` : 'sin voz'} en ${Math.round((Date.now() - t0) / 1000)} s`)
      } catch (e) {
        trans = { error: e.message }
        console.log(`  transcripción: ${e.message}`)
      }
    }
    fs.writeFileSync(path.join(dir, 'ficha.md'), ficha(p, m, dur, sueltos, trans))
    fs.writeFileSync(path.join(dir, 'datos.json'), JSON.stringify({ ...p, metricas: m, duracionVideo: dur, transcripcion: trans ?? null }, null, 2))
    filas.push({ p, m, dur })
    console.log(`  ficha: ${path.relative(process.cwd(), path.join(dir, 'ficha.md'))}`)
  } catch (e) {
    console.log(`  ${e.message}`)
  }
}

// Índice con todos los reels desarmados hasta ahora de esta cuenta, de más a menos reproducciones.
const hechos = fs.readdirSync(base).filter((d) => fs.existsSync(path.join(base, d, 'datos.json')))
  .map((d) => JSON.parse(fs.readFileSync(path.join(base, d, 'datos.json'), 'utf8')))
  .sort((a, b) => (b.metricas.reproducciones ?? 0) - (a.metricas.reproducciones ?? 0))
const idx = [`# Reels desarmados de @${cuenta}`, '', `${perfil.seguidores} seguidores. Cada carpeta tiene \`ficha.md\`, \`gancho.jpg\`, \`reel.jpg\` y las imágenes sueltas.`, '',
  '| Reel | Reprod. | Alcance aprox. | Interacción s/ vistas | Duración | Arranca diciendo |', '|---|---|---|---|---|---|',
  ...hechos.map((h) => `| [${h.codigo}](${h.codigo}/ficha.md) | ${h.metricas.reproducciones ?? '?'} | ${h.metricas.alcanceAproxPct ?? '?'} % | ${h.metricas.interaccionVistasPct ?? '?'} % | ${seg(h.duracionVideo)} | ${(h.transcripcion?.trozos?.[0]?.texto ?? h.texto.split('\n')[0]).replace(/\|/g, '/').slice(0, 70)} |`), '']
fs.writeFileSync(path.join(base, 'indice.md'), idx.join('\n'))
console.log(`\n${filas.length} reels desarmados · índice en ${path.relative(process.cwd(), path.join(base, 'indice.md'))}`)
