// Compila la carcasa: main (con el backend TS adentro) y preload a CommonJS, con esbuild.
// `--recursos` además arma build/recursos/oficina (el front filtrado, con vendor/: Poppins), que
// electron-builder copia como recurso de la app.
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const raiz = path.resolve(aqui, '..')
const repo = path.resolve(raiz, '..')

const comun = {
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: 'linked', logLevel: 'warning',
  external: ['electron'],
  // el backend es ESM con top-level imports de node:*; en CJS `import.meta.url` no existe (solo lo usa dev.ts)
  define: { 'import.meta.url': 'undefined' },
}
await build({ ...comun, entryPoints: [path.join(raiz, 'src/main.ts')], outfile: path.join(raiz, 'dist/main.cjs'), loader: { '.html': 'text' } })
await build({ ...comun, entryPoints: [path.join(raiz, 'src/preload.ts')], outfile: path.join(raiz, 'dist/preload.cjs') })
// La captura de WhatsApp corre en su propio proceso (backend/src/whatsapp.ts la lanza). Baileys es ESM: va aparte, como
// módulo ES, con su WebAssembly adentro. Las dependencias opcionales de imágenes, audio y vistas previas quedan afuera.
await build({
  ...comun, format: 'esm', define: {}, entryPoints: [path.join(repo, 'backend/src/whatsapp-captura.ts')],
  outfile: path.join(raiz, 'dist/whatsapp-captura.mjs'), external: ['sharp', 'jimp', 'link-preview-js', 'audio-decode'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
})

// El transcriptor de notas de voz (S4) también corre aparte. Transformers.js va adentro; el motor nativo
// (onnxruntime-node) queda afuera y se copia recortado a esta plataforma junto a la versión empaquetada (--recursos).
const opcionesTranscriptor = {
  ...comun, format: 'esm', define: {}, entryPoints: [path.join(repo, 'backend/src/whatsapp-transcriptor.ts')],
  external: ['onnxruntime-node', 'onnxruntime-common'], alias: { sharp: path.join(aqui, 'sharp-vacio.mjs') },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
}
// para la app sin empaquetar (npm start): dentro de backend/dist, así encuentra el motor en backend/node_modules
await build({ ...opcionesTranscriptor, outfile: path.join(repo, 'backend/dist/transcriptor-desktop.mjs') })

/** build/recursos/transcriptor: el transcriptor y el motor nativo de esta plataforma (sin las demás ni CUDA). */
function recursosTranscriptor() {
  const dest = path.join(raiz, 'build/recursos/transcriptor')
  fs.rmSync(dest, { recursive: true, force: true })
  const ort = path.join(repo, 'backend/node_modules/onnxruntime-node')
  const comunOrt = path.join(repo, 'backend/node_modules/onnxruntime-common')
  const bin = path.join(ort, 'bin/napi-v6', process.platform, process.arch)
  if (!fs.existsSync(bin) || !fs.existsSync(comunOrt)) {
    console.warn(`transcriptor: falta onnxruntime-node para ${process.platform}-${process.arch}; la app sale sin transcripción`)
    return Promise.resolve()
  }
  const destOrt = path.join(dest, 'node_modules/onnxruntime-node')
  fs.mkdirSync(path.join(destOrt, 'bin/napi-v6', process.platform, process.arch), { recursive: true })
  fs.cpSync(path.join(ort, 'dist'), path.join(destOrt, 'dist'), { recursive: true })
  fs.copyFileSync(path.join(ort, 'package.json'), path.join(destOrt, 'package.json'))
  // Mac: el binding pide @rpath/libonnxruntime.1.dylib (la copia con versión completa es igual); Windows: todo (DirectML);
  // Linux: sin los proveedores de CUDA ni TensorRT
  const sobra = (n) => n === 'libonnxruntime.1.30.0.dylib' || /providers_(cuda|tensorrt)/.test(n)
  for (const n of fs.readdirSync(bin)) if (!sobra(n)) fs.copyFileSync(path.join(bin, n), path.join(destOrt, 'bin/napi-v6', process.platform, process.arch, n))
  fs.cpSync(comunOrt, path.join(dest, 'node_modules/onnxruntime-common'), { recursive: true })
  console.log(`recursos: ${dest}`)
  return build({ ...opcionesTranscriptor, sourcemap: false, outfile: path.join(dest, 'whatsapp-transcriptor.mjs') })
}

if (process.argv.includes('--recursos')) {
  await recursosTranscriptor()
  const dest = path.join(raiz, 'build/recursos/oficina')
  fs.rmSync(dest, { recursive: true, force: true })
  // fuera: lo que es solo del modo desarrollo, datos locales y laboratorio
  const fuera = (rel) => {
    const base = path.basename(rel)
    if (['server.py', 'lanzar.py', '.datos', '.sesiones.json', 'Agentes imagenes', '__pycache__', '.DS_Store', 'README.md',
      'personajes', '_labvendor'].includes(base)) return true
    if (base.endsWith('.command') || base.startsWith('config') || base.startsWith('_lab') || base.startsWith('_cara')) return true
    if (['_fig.html', '_figuras_demo.html'].includes(base)) return true
    if (rel === 'js' || (rel.startsWith('ui/') && base.startsWith('_'))) return true
    return false
  }
  const copiar = (rel) => {
    const o = path.join(repo, 'oficina', rel)
    if (rel && fuera(rel.split(path.sep).join('/'))) return
    const st = fs.statSync(o)
    if (st.isDirectory()) {
      fs.mkdirSync(path.join(dest, rel), { recursive: true })
      for (const n of fs.readdirSync(o)) copiar(path.join(rel, n))
    } else fs.copyFileSync(o, path.join(dest, rel))
  }
  copiar('')
  const deben = ['index.html', 'ui/base.js', 'ui/app.js', 'ui/pixel/oficina-pixel.js', 'vendor/poppins.css', 'vendor/LICENSE-Poppins-OFL.txt']
  for (const f of deben) if (!fs.existsSync(path.join(dest, f))) throw new Error(`Falta en los recursos: oficina/${f}`)
  console.log(`recursos: ${dest}`)
}
