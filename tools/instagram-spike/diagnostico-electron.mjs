// Diagnóstico con Electron: los pedidos salen por la red de Chromium (net.request), que se conecta como Chrome. Es lo
// que usaría la app de escritorio. Usa el Electron de desktop/ (hace falta `npm ci --prefix desktop` una vez).
//
// Uso: node ../../desktop/node_modules/electron/cli.js diagnostico-electron.mjs <cuenta> [variante...]
// (o `npm run diagnostico:electron -- <cuenta>`). Sin ventanas: corre y se cierra.
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { app, net, session } from 'electron'
import { limpiarCuenta } from './mapeo.mjs'
import { correrDiagnostico } from './variantes.mjs'

const aqui = path.dirname(fileURLToPath(import.meta.url))
// Lo que viene después de este archivo en la línea de comandos.
const desde = process.argv.findIndex((a) => a.endsWith('diagnostico-electron.mjs'))
const args = process.argv.slice(desde + 1).filter((a) => !a.startsWith('--'))
const cuenta = limpiarCuenta(args.shift())

app.dock?.hide()

function pedir(ses, url, headers) {
  return new Promise((resolve, reject) => {
    // Sin las cookies de la sesión de Electron: cada pedido manda solo lo que dicen sus headers.
    const req = net.request({ url, session: ses, redirect: 'manual', useSessionCookies: false })
    for (const [k, v] of Object.entries(headers)) {
      try { req.setHeader(k, v) } catch (e) { console.log(`  (Electron no deja poner el header ${k}: ${e.message})`) }
    }
    let location
    req.on('redirect', (status, _metodo, url) => {
      location = url
      resolve({ status, location, cuerpo: '', cookies: {} })
      req.abort()
    })
    req.on('response', (res) => {
      const partes = []
      res.on('data', (d) => partes.push(d))
      res.on('end', () => {
        const cookies = {}
        const sc = res.headers['set-cookie']
        for (const c of Array.isArray(sc) ? sc : sc ? [sc] : []) {
          const [par] = c.split(';')
          const k = par.indexOf('=')
          if (k > 0) cookies[par.slice(0, k).trim()] = par.slice(k + 1).trim()
        }
        resolve({ status: res.statusCode, location, cuerpo: Buffer.concat(partes).toString('utf8'), cookies })
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    setTimeout(() => { req.abort(); reject(new Error('timeout')) }, 20000)
    req.end()
  })
}

app.whenReady().then(async () => {
  if (!cuenta) { console.error('Uso: npm run diagnostico:electron -- <cuenta> [variante...]'); app.exit(2); return }
  // Una sesión aparte y en memoria: no toca nada de la app ni del navegador.
  const ses = session.fromPartition('instagram-diagnostico')
  try {
    await correrDiagnostico({ cuenta, pedir: (u, h) => pedir(ses, u, h), motor: 'electron', datos: path.join(aqui, 'datos'), soloEstas: args })
  } catch (e) {
    console.error(e)
  }
  app.exit(0)
})
