// App de escritorio de la Oficina (Mac y Windows): la carcasa Electron alrededor del backend TypeScript.
// Reemplazó a la app Swift de Mac (hasta la 0.7):
// - La página se sirve por el esquema hq://app/ (estáticos en lista blanca y /api/* al router, en proceso: sin puerto).
// - El front habla con la app por `window.webkit.messageHandlers.hq.postMessage` (lo expone el preload).
// - Cerrar la ventana no cierra la app: queda en la bandeja (Windows) o en el Dock y la barra de menú (Mac).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, protocol, shell, Tray,
  type IpcMainInvokeEvent, type MenuItemConstructorOptions,
} from 'electron'
import { createBackend, type Backend } from '../../backend/src/backend.js'
import { Config } from '../../backend/src/config.js'
import { ejecutable, resolver } from './abrir.js'
import * as actualizaciones from './actualizaciones.js'
import { archivo, mime, raices } from './estaticos.js'
import { hostWhatsApp } from './whatsapp.js'
import onboardingHTML from './onboarding.html'

const esMac = process.platform === 'darwin'
const esWindows = process.platform === 'win32'
const ORIGEN = 'hq://app'

protocol.registerSchemesAsPrivileged([
  { scheme: 'hq', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: false } },
])
app.setName('Oficina')
if (esWindows) app.setAppUserModelId('com.oficina.app') // notificaciones con el nombre y el ícono de la app

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => mostrar())
  void app.whenReady().then(arrancar)
}

let backend: Backend
let ventana: BrowserWindow | undefined
let bandeja: Tray | undefined
let saliendo = false
let refrescarBandeja: (() => Promise<void>) | undefined

// MARK: - arranque

async function arrancar() {
  const env = process.env
  const config = Config.load(os.homedir(), env)
  config.version = app.getVersion()
  backend = createBackend({ config, env, whatsapp: hostWhatsApp(config.datosDir, __dirname, app.isPackaged, process.resourcesPath) })
  const r = raices(app.isPackaged, process.resourcesPath, path.resolve(__dirname, '../..'))

  protocol.handle('hq', async (req) => {
    const url = new URL(req.url)
    if (url.host !== 'app') return new Response('', { status: 404 })
    let ruta: string
    try { ruta = decodeURIComponent(url.pathname) } catch { return new Response('', { status: 400 }) }
    if (ruta === '/api' || ruta.startsWith('/api/')) {
      const query: Record<string, string> = {}
      for (const [k, v] of url.searchParams) query[k] = v
      const cuerpo = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.from(await req.arrayBuffer())
      const res = await backend.router.handle(req.method, ruta, query, cuerpo)
      return new Response(new Uint8Array(res.json), {
        status: res.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('', { status: 405 })
    if (ruta === '/__onboarding.html') return new Response(onboardingHTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    const f = archivo(r, ruta)
    if (!f) return new Response('', { status: 404 })
    return new Response(req.method === 'HEAD' ? null : new Uint8Array(fs.readFileSync(f)), {
      headers: { 'Content-Type': mime(f), 'Cache-Control': 'no-cache' },
    })
  })

  ipcMain.handle('hq', mensaje)
  backend.avisos.on('aviso', notificar)
  armarMenu()
  armarBandeja()
  await crearVentana()
  actualizaciones.iniciar({
    ventana: () => ventana,
    alCambiar: () => { armarMenu(); void refrescarBandeja?.() },
    alAvisar: (texto) => ejecutarEnPagina(`window.App && App.aviso && App.aviso(${JSON.stringify(texto)})`),
  })

  app.on('activate', () => mostrar()) // clic en el Dock
  app.on('window-all-closed', () => { /* la app sigue viva en la bandeja / el Dock */ })
  app.on('before-quit', (e) => {
    if (saliendo) return
    e.preventDefault()
    saliendo = true
    void backend.shutdown().finally(() => {
      // con una actualización bajada, electron-updater lanza el instalador y cierra la app; por las dudas, salida forzada
      if (actualizaciones.instalarAlSalir()) setTimeout(() => app.exit(0), 5_000)
      else app.exit(0)
    })
  })
}

async function api(ruta: string): Promise<Record<string, any>> {
  try {
    const r = await backend.router.handle('GET', ruta, {})
    return JSON.parse(r.json.toString('utf8'))
  } catch {
    return {}
  }
}

// MARK: - ventana

const archivoVentana = () => path.join(app.getPath('userData'), 'ventana.json')

function boundsGuardados(): Electron.Rectangle | undefined {
  try {
    const b = JSON.parse(fs.readFileSync(archivoVentana(), 'utf8'))
    if ([b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n))) return b
  } catch {}
  return undefined
}

async function crearVentana() {
  const b = boundsGuardados()
  const w = new BrowserWindow({
    width: b?.width ?? 1280, height: b?.height ?? 820, x: b?.x, y: b?.y,
    minWidth: 900, minHeight: 600, title: 'Oficina', show: false,
    backgroundColor: '#f6f1ea', autoHideMenuBar: esWindows,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false,
      // visor de PDF de Chromium para la vista previa de entregas (revisar.js)
      plugins: true },
  })
  ventana = w
  const guardar = () => { try { if (!w.isMinimized() && !w.isMaximized()) fs.writeFileSync(archivoVentana(), JSON.stringify(w.getBounds())) } catch {} }
  w.on('resize', guardar)
  w.on('move', guardar)
  w.on('close', (e) => {
    if (saliendo) return
    e.preventDefault()
    w.hide()
  })
  w.on('focus', () => { if (esWindows) w.flashFrame(false) })

  // Solo hq:// adentro; http(s) y mailto se abren en el navegador; lo demás no.
  w.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGEN + '/')) return
    e.preventDefault()
    abrirAfuera(url)
  })
  // Los artefactos del chat corren en iframes sandbox (chat-rico.js): ningún iframe puede cargar la app (hq://) adentro.
  w.webContents.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && e.url.startsWith(ORIGEN)) e.preventDefault()
  })
  w.webContents.setWindowOpenHandler(({ url }) => {
    abrirAfuera(url)
    return { action: 'deny' }
  })
  w.once('ready-to-show', () => w.show())

  const e = await api('/api/estado')
  const listo = e.claude === true && e.auth !== false
  await w.loadURL(`${ORIGEN}/${listo ? 'index.html' : '__onboarding.html'}`)
}

function abrirAfuera(url: string) {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
}

function mostrar() {
  if (!ventana) return
  if (ventana.isMinimized()) ventana.restore()
  ventana.show()
  ventana.focus()
}

function ejecutarEnPagina(js: string) {
  void ventana?.webContents.executeJavaScript(js).catch(() => {})
}

// MARK: - mensajes del front

async function mensaje(ev: IpcMainInvokeEvent, m: unknown): Promise<unknown> {
  // solo la página de la oficina (frame principal, origen hq://app)
  if (!ventana || ev.sender !== ventana.webContents || ev.senderFrame !== ventana.webContents.mainFrame) return null
  if (!ev.senderFrame?.url.startsWith(ORIGEN + '/')) return null
  if (!m || typeof m !== 'object') return null
  const o = m as Record<string, unknown>
  const accion = typeof o.accion === 'string' ? o.accion : typeof o.action === 'string' ? o.action : ''
  switch (accion) {
    case 'abrir':
    case 'revelar':
      await abrirRuta(accion, typeof o.ruta === 'string' ? o.ruta : undefined)
      return null
    case 'acerca':
      acercaDe()
      return null
    case 'borrarOficina':
      return borrarOficina(typeof o.carpeta === 'string' ? o.carpeta : undefined)
    case 'copiar':
      if (typeof o.texto !== 'string' || o.texto.length > 20_000_000) return false
      clipboard.writeText(o.texto)
      return true
    case 'insignia':
      insignia(typeof o.n === 'number' ? Math.max(0, Math.floor(o.n)) : 0)
      return null
    case 'open':
      if (typeof o.url === 'string' && /^https:\/\//i.test(o.url)) void shell.openExternal(o.url)
      return null
    case 'login':
      await login()
      return null
    case 'elegirCarpeta': {
      const r = await dialog.showOpenDialog(ventana, {
        title: typeof o.titulo === 'string' ? o.titulo : 'Elegí una carpeta',
        defaultPath: typeof o.inicio === 'string' && path.isAbsolute(o.inicio) ? o.inicio : undefined,
        properties: ['openDirectory', ...(o.crear ? (['createDirectory', 'promptToCreate'] as const) : [])],
        buttonLabel: 'Elegir',
      })
      return r.canceled ? null : r.filePaths[0] ?? null
    }
    case 'elegirArchivo': {
      const r = await dialog.showOpenDialog(ventana, {
        title: typeof o.titulo === 'string' ? o.titulo : 'Elegí un archivo',
        properties: ['openFile'], filters: [{ name: 'Oficina exportada', extensions: ['zip'] }],
      })
      return r.canceled ? null : r.filePaths[0] ?? null
    }
    default:
      return null
  }
}

/** Borra la oficina abierta (solo si es la que pidió el front): el backend la cierra, olvida lo guardado en hq.db y
 *  borra su carpeta del disco (permanente). */
async function borrarOficina(carpeta?: string): Promise<Record<string, unknown>> {
  const estado = await api('/api/estado')
  const activa: string | undefined = estado.oficina?.carpeta
  if (!carpeta || carpeta !== activa) return { error: 'Esa oficina no es la que está abierta.' }
  const r = await backend.router.handle('DELETE', '/api/oficina', {})
  let cuerpo: Record<string, unknown> = {}
  try { cuerpo = JSON.parse(r.json.toString('utf8')) } catch {}
  if (r.status !== 200) return { error: typeof cuerpo.error === 'string' ? cuerpo.error : 'No pude borrar la oficina.' }
  return { ok: true }
}

/** Abrir (con su aplicación) o mostrar en el Finder/Explorador, solo dentro de la oficina, de una carpeta vinculada o de
 *  una carpeta de trabajo (y, para mostrar, la carpeta de la memoria de la secretaría). */
async function abrirRuta(accion: 'abrir' | 'revelar', ruta?: string) {
  const estado = await api('/api/estado')
  const carpeta: string | undefined = estado.oficina?.carpeta
  const vinculos = await api('/api/vinculos')
  const trabajo = await api('/api/carpetas-trabajo')
  // la memoria privada de la secretaría vive fuera de la oficina (datosDir/secretaria/<id>): solo se puede mostrar
  const memoria = accion === 'revelar' && ruta !== undefined ? (await api('/api/secretaria/memoria/carpeta')).ruta : undefined
  const bases = [carpeta, ...((vinculos.vinculos ?? []) as { ruta?: string }[]).map((v) => v.ruta),
    ...((trabajo.carpetas ?? []) as { ruta?: string }[]).map((c) => c.ruta), memoria].filter((x): x is string => typeof x === 'string')
  const pedida = ruta ?? carpeta
  if (!pedida) return shell.beep()
  // un .oficina.zip exportado puede quedar fuera de la oficina (Descargas): se puede mostrar, no abrir
  const esExport = accion === 'revelar' && /\.oficina\.zip$/i.test(pedida) && path.isAbsolute(pedida) && fs.existsSync(pedida)
  const r = esExport ? pedida : resolver(pedida, bases)
  if (!r) return shell.beep()
  let carpetaReal = false
  try { carpetaReal = fs.statSync(r).isDirectory() } catch { return shell.beep() }
  if (accion === 'revelar' && !carpetaReal) return shell.showItemInFolder(r)
  if (ejecutable(r)) return accion === 'revelar' ? shell.showItemInFolder(r) : shell.beep()
  const error = await shell.openPath(r)
  if (error) shell.beep()
}

function acercaDe() {
  const creditos = [
    'Tu oficina de agentes de Claude.',
    '',
    'Poppins: SIL Open Font License 1.1.',
  ].join('\n')
  if (esMac) {
    app.setAboutPanelOptions({ applicationName: 'Oficina', applicationVersion: app.getVersion(), version: '', credits: creditos })
    app.showAboutPanel()
    return
  }
  void dialog.showMessageBox(ventana!, {
    type: 'none', title: 'Acerca de Oficina', message: `Oficina ${app.getVersion()}`, detail: creditos, buttons: ['Aceptar'],
    icon: icono(),
  })
}

function insignia(n: number) {
  if (esMac) app.setBadgeCount(n)
  else if (esWindows && ventana) {
    ventana.setOverlayIcon(n > 0 ? superposicion(n) : null, n > 0 ? `${n} avisos sin leer` : '')
  }
  bandeja?.setToolTip(n > 0 ? `Oficina · ${n} avisos` : 'Oficina')
}

/** Puntito rosa para el ícono de la barra de tareas de Windows (16×16). */
function superposicion(n: number): Electron.NativeImage {
  const txt = n > 9 ? '9+' : String(n)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#ee6da6"/><text x="16" y="22" font-family="Segoe UI,Arial" font-size="${txt.length > 1 ? 15 : 19}" font-weight="700" fill="#fff" text-anchor="middle">${txt}</text></svg>`
  return nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))
}

/** `claude auth login` en una terminal nueva (como el .command de la app Mac). */
async function login() {
  const claude = backend.runner.claudePath ?? 'claude'
  if (esWindows) {
    // cmd /k deja la ventana abierta para ver el resultado; start abre una consola nueva
    const comando = /\.(c|m)?js$/i.test(claude) ? `"${process.execPath}" "${claude}" auth login` : `"${claude}" auth login`
    spawn('cmd.exe', ['/c', 'start', '"Oficina: iniciar sesión en Claude"', 'cmd.exe', '/k', comando], {
      detached: true, stdio: 'ignore', windowsHide: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    }).unref()
  } else if (esMac) {
    const f = path.join(app.getPath('temp'), `oficina-login-${Date.now()}.command`)
    fs.writeFileSync(f, `#!/bin/zsh -l\n${JSON.stringify(claude)} auth login\n`, { mode: 0o700 })
    spawn('open', ['-a', 'Terminal', f], { detached: true, stdio: 'ignore' }).unref()
  } else {
    spawn('x-terminal-emulator', ['-e', claude, 'auth', 'login'], { detached: true, stdio: 'ignore' }).unref()
  }
}

// MARK: - notificaciones

type Aviso = { id: string; tipo: string; agente?: string; texto?: string }

function notificar({ aviso, nombre }: { aviso: Aviso; nombre: string }) {
  if (ventana?.isVisible() && ventana.isFocused()) return
  if (!Notification.isSupported()) return
  const titulo = aviso.tipo === 'respuesta' ? `${nombre} te respondió`
    : aviso.tipo === 'error' ? `${nombre} no pudo responder`
    : aviso.tipo === 'tarea' ? `${nombre} terminó una tarea`
    : aviso.tipo === 'entrega' ? (aviso.agente ? `${nombre} te entregó algo` : 'Nueva entrega para revisar')
    : 'Oficina'
  const n = new Notification({ title: titulo, body: aviso.texto ?? '', icon: esWindows ? icono() : undefined })
  n.on('click', () => {
    mostrar()
    ejecutarEnPagina(`window.App && App.Avisos && App.Avisos.abrir(${JSON.stringify(aviso.id)})`)
  })
  n.show()
  if (esWindows) ventana?.flashFrame(true)
}

// MARK: - menú, bandeja

function icono(tam?: number): Electron.NativeImage {
  const f = app.isPackaged ? path.join(process.resourcesPath, 'icono.png') : path.resolve(__dirname, '../build/icon.png')
  const img = nativeImage.createFromPath(f)
  return tam && !img.isEmpty() ? img.resize({ width: tam, height: tam }) : img
}

/** «Buscar actualizaciones…» o «Reiniciar para actualizar a X» (solo en la app empaquetada). */
function itemActualizacion(): MenuItemConstructorOptions[] {
  if (!actualizaciones.disponible()) return []
  const e = actualizaciones.estadoActual()
  if (e.tipo === 'lista') return [{ label: `Reiniciar para actualizar a ${e.version}`, click: () => actualizaciones.reiniciar() }]
  if (e.tipo === 'bajando') return [{ label: `Bajando la versión ${e.version}… ${e.pct} %`, enabled: false }]
  if (e.tipo === 'buscando') return [{ label: 'Buscando actualizaciones…', enabled: false }]
  if (e.tipo === 'manual') return [{ label: `Bajar la versión ${e.version}…`, click: () => void shell.openExternal(e.url) }]
  return [{ label: 'Buscar actualizaciones…', click: () => void actualizaciones.buscar(true) }]
}

function armarMenu() {
  const revelar: MenuItemConstructorOptions = {
    label: 'Abrir carpeta de la oficina', accelerator: 'CmdOrCtrl+Shift+O',
    click: () => void abrirRuta('revelar'),
  }
  const plantilla: MenuItemConstructorOptions[] = esMac
    ? [
        { label: 'Oficina', submenu: [
          { label: 'Acerca de Oficina', click: acercaDe }, ...itemActualizacion(), { type: 'separator' }, revelar, { type: 'separator' },
          { role: 'hide', label: 'Ocultar Oficina' }, { role: 'hideOthers', label: 'Ocultar otros' }, { role: 'unhide', label: 'Mostrar todo' },
          { type: 'separator' }, { role: 'quit', label: 'Salir de Oficina' },
        ] },
        { label: 'Edición', submenu: [
          { role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' },
          { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' },
        ] },
        { label: 'Visualización', submenu: [{ role: 'togglefullscreen', label: 'Pantalla completa' }, ...devTools()] },
        { label: 'Ventana', submenu: [
          { role: 'minimize', label: 'Minimizar' }, { role: 'zoom', label: 'Zoom' }, { role: 'close', label: 'Cerrar' },
        ] },
      ]
    : [
        { label: 'Archivo', submenu: [revelar, { type: 'separator' }, { label: 'Salir', accelerator: 'Ctrl+Q', click: () => app.quit() }] },
        { label: 'Edición', submenu: [
          { role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' },
          { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' },
        ] },
        { label: 'Ver', submenu: [{ role: 'togglefullscreen', label: 'Pantalla completa' }, ...devTools()] },
        { label: 'Ayuda', submenu: [...itemActualizacion(), { label: 'Acerca de Oficina', click: acercaDe }] },
      ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(plantilla))
}

function devTools(): MenuItemConstructorOptions[] {
  return app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload', label: 'Recargar' }, { role: 'toggleDevTools', label: 'Herramientas de desarrollo' }]
}

function armarBandeja() {
  const img = esMac ? icono(18) : icono(16)
  if (img.isEmpty()) return
  if (esMac) img.setTemplateImage(false)
  bandeja = new Tray(img)
  bandeja.setToolTip('Oficina')
  if (esWindows) bandeja.on('click', () => mostrar())
  // el menú se arma al abrirlo, con las entregas y las próximas tareas al día
  const actualizar = async () => bandeja?.setContextMenu(await menuBandeja())
  refrescarBandeja = actualizar
  void actualizar()
  setInterval(() => void actualizar(), 60_000)
  backend.avisos.on('aviso', () => void actualizar())
}

async function menuBandeja(): Promise<Menu> {
  const actividad = await api('/api/actividad')
  const sinRevisar = Number(actividad.entregasSinRevisar) || 0
  const tareas = ((await api('/api/tareas')).tareas ?? []) as { activa?: boolean; proxima?: string; agente?: string; nombre?: string }[]
  const agentes = ((await api('/api/agentes')).agentes ?? []) as { id?: string; nombre?: string }[]
  const nombre = (id?: string) => agentes.find((a) => a.id === id)?.nombre ?? id ?? ''
  const proximas = tareas
    .filter((t) => t.activa && t.proxima && !Number.isNaN(Date.parse(t.proxima)))
    .sort((a, b) => Date.parse(a.proxima!) - Date.parse(b.proxima!))
    .slice(0, 5)
  const items: MenuItemConstructorOptions[] = [{ label: 'Abrir Oficina', click: () => mostrar() }]
  if (sinRevisar > 0) {
    items.push({ label: `${sinRevisar} ${sinRevisar === 1 ? 'entrega' : 'entregas'} sin revisar`, click: () => {
      mostrar()
      ejecutarEnPagina('window.App && App.Entregables && App.Entregables.abrir()')
    } })
  }
  const sec = await api('/api/secretaria')
  if (sec.config && sec.agente) {
    items.push({ label: sec.corriendo ? `${sec.agente.nombre} está revisando…` : `Revisar ahora (${sec.agente.nombre})`, enabled: !sec.corriendo, click: () => {
      void backend.router.handle('POST', '/api/secretaria/revisar', {}, Buffer.from('{}')).then((r) => {
        let motivo = ''
        try { const o = JSON.parse(r.json.toString('utf8')); motivo = o.motivo ?? o.error ?? '' } catch {}
        if (motivo && Notification.isSupported()) new Notification({ title: 'Secretaría', body: motivo }).show()
        void refrescarBandeja?.()
      })
    } })
  }
  items.push({ type: 'separator' }, {
    label: 'Próximas tareas',
    submenu: proximas.length
      ? proximas.map((t) => ({ label: `${cuando(new Date(t.proxima!))} · ${nombre(t.agente)}: ${t.nombre ?? ''}`, enabled: false }))
      : [{ label: 'Sin tareas programadas', enabled: false }],
  })
  const act = itemActualizacion()
  items.push(
    { type: 'separator' },
    ...(act.length && ['lista', 'manual', 'bajando'].includes(actualizaciones.estadoActual().tipo) ? act : []),
    { label: 'Abrir al iniciar sesión', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (it) => app.setLoginItemSettings({ openAtLogin: it.checked }) },
    { label: 'Salir de Oficina', click: () => app.quit() },
  )
  return Menu.buildFromTemplate(items)
}

function cuando(d: Date): string {
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
  const hoy = new Date()
  const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1)
  const mismoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (mismoDia(d, hoy)) return `hoy ${hora}`
  if (mismoDia(d, manana)) return `mañana ${hora}`
  return `${d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })} ${hora}`
}

