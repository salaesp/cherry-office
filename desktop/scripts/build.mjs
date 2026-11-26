// Compila la carcasa: main (con el backend TS adentro) y preload a CommonJS, con esbuild.
// `--recursos` además arma build/recursos/oficina (el front filtrado, con vendor/: three.js y Poppins), que
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

if (process.argv.includes('--recursos')) {
  const dest = path.join(raiz, 'build/recursos/oficina')
  fs.rmSync(dest, { recursive: true, force: true })
  // fuera: lo que es solo del modo desarrollo, datos locales y laboratorio
  const fuera = (rel) => {
    const base = path.basename(rel)
    if (['server.py', 'lanzar.py', '.datos', '.sesiones.json', 'Agentes imagenes', '__pycache__', '.DS_Store', 'README.md',
      'lego_man.json', 'personajes', '_labvendor', '_ldraw'].includes(base)) return true
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
  const deben = ['index.html', 'ui/base.js', 'ui/app.js', 'ldraw/catalogo.json', 'ldraw/minifigs.mpd', 'ldraw/LICENSE-LDraw.txt',
    'vendor/three.min.js', 'vendor/LDrawLoader.js', 'vendor/LICENSE-three.txt', 'vendor/LICENSE-Poppins-OFL.txt']
  for (const f of deben) if (!fs.existsSync(path.join(dest, f))) throw new Error(`Falta en los recursos: oficina/${f}`)
  console.log(`recursos: ${dest}`)
}
