// Muestra un perfil (en el formato del spike) en la terminal. Lo usan spike.mjs y apify.mjs.
import { resumir } from './mapeo.mjs'

export function mostrar(perfil) {
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
