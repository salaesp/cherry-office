// Verifica que el spike (Baileys incluido) se empaqueta con esbuild en un solo archivo, como lo haría desktop/.
// Las dependencias opcionales de imágenes, audio y vistas previas quedan afuera: el spike no las usa.
import { build } from 'esbuild'
const r = await build({
  entryPoints: ['spike.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/spike.mjs',
  external: ['sharp', 'jimp', 'link-preview-js', 'audio-decode'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  metafile: true,
  logLevel: 'warning',
})
const kb = Object.values(r.metafile.outputs).reduce((a, o) => a + o.bytes, 0) / 1024
console.log(`dist/spike.mjs: ${kb.toFixed(0)} KB`)
