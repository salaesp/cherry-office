// Lo que no toca la red: clasificar la respuesta de Instagram y pasarla a un formato chico y estable. Lo usan spike.mjs,
// resumen.mjs y las pruebas.

/** Nombre de cuenta limpio: sin @, sin URL, en minúsculas. undefined si no parece un usuario de Instagram. */
export function limpiarCuenta(texto) {
  let s = String(texto ?? '').trim()
  const url = s.match(/instagram\.com\/([^/?#]+)/i)
  if (url) s = url[1]
  s = s.replace(/^@/, '').toLowerCase()
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : undefined
}

/**
 * Qué pasó con un pedido, a partir del status, la ubicación de una redirección y el cuerpo (texto).
 * `ok` | `privada` | `no_existe` | `login` (pide iniciar sesión) | `bloqueo` (demasiados pedidos) | `raro` (otra cosa).
 */
export function clasificar({ status, location, cuerpo }) {
  let json
  try { json = JSON.parse(cuerpo) } catch { /* no es JSON */ }
  const msg = String(json?.message ?? '').toLowerCase()
  if (status >= 300 && status < 400) return /login|challenge/.test(location ?? '') ? 'login' : 'raro'
  if (status === 429 || /wait a few minutes|try again later/.test(msg)) return 'bloqueo'
  if (status === 401 || status === 403 || json?.require_login) return 'login'
  if (status === 404) return 'no_existe'
  if (status !== 200 || !json) return 'raro'
  const user = json?.data?.user
  if (user === null) return 'no_existe'
  if (!user) return 'raro'
  return user.is_private ? 'privada' : 'ok'
}

const cuenta = (edge) => (typeof edge?.count === 'number' && edge.count >= 0 ? edge.count : null)
const num = (x) => (typeof x === 'number' && x >= 0 ? x : null)

/** Tipo de una publicación: `reel` | `video` | `carrusel` | `foto`. */
export function tipoDe(n) {
  if (n.product_type === 'clips') return 'reel'
  if (n.__typename === 'GraphSidecar' || n.edge_sidecar_to_children) return 'carrusel'
  if (n.is_video) return 'video'
  return 'foto'
}

/** Una publicación (`node` de `edge_owner_to_timeline_media`) en el formato del spike. */
export function mapearPublicacion(n) {
  const texto = n.edge_media_to_caption?.edges?.[0]?.node?.text ?? ''
  return {
    codigo: n.shortcode,
    url: n.shortcode ? `https://www.instagram.com/p/${n.shortcode}/` : null,
    tipo: tipoDe(n),
    fecha: typeof n.taken_at_timestamp === 'number' ? new Date(n.taken_at_timestamp * 1000).toISOString() : null,
    texto,
    hashtags: [...new Set(texto.match(/#[\p{L}\p{N}_]+/gu) ?? [])],
    menciones: [...new Set(texto.match(/@[a-zA-Z0-9._]+/g) ?? [])],
    likes: cuenta(n.edge_liked_by) ?? cuenta(n.edge_media_preview_like),
    comentarios: cuenta(n.edge_media_to_comment),
    reproducciones: num(n.video_view_count),
    duracion: num(n.video_duration),
    piezas: n.edge_sidecar_to_children?.edges?.length ?? null,
    fijada: Array.isArray(n.pinned_for_users) && n.pinned_for_users.length > 0,
    descripcionAuto: n.accessibility_caption ?? null,
    lugar: n.location?.name ?? null,
    miniatura: n.thumbnail_src ?? n.display_url ?? null,
    video: n.video_url ?? null,
  }
}

/** La respuesta de `web_profile_info` en el formato del spike. */
export function mapearPerfil(json) {
  const u = json?.data?.user
  if (!u) return undefined
  const media = u.edge_owner_to_timeline_media
  return {
    cuenta: u.username,
    nombre: u.full_name ?? '',
    bio: u.biography ?? '',
    enlace: u.external_url ?? null,
    categoria: u.category_name ?? u.business_category_name ?? null,
    verificada: !!u.is_verified,
    profesional: !!(u.is_business_account || u.is_professional_account),
    privada: !!u.is_private,
    seguidores: cuenta(u.edge_followed_by),
    seguidos: cuenta(u.edge_follow),
    publicacionesTotal: cuenta(media),
    publicaciones: (media?.edges ?? []).map((e) => mapearPublicacion(e.node ?? {})),
    hayMas: !!media?.page_info?.has_next_page,
  }
}

// Dos decimales, o dos cifras significativas si es menos de 1 % (en cuentas enormes la interacción es diminuta).
const pct = (x) => (x >= 1 ? +x.toFixed(2) : +x.toPrecision(2))
const promedio = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

/** Lo que le serviría a un agente: promedios por tipo, interacción sobre seguidores y frecuencia. */
export function resumir(perfil) {
  const pubs = perfil.publicaciones
  const porTipo = {}
  for (const p of pubs) (porTipo[p.tipo] ??= []).push(p)
  const tipos = Object.fromEntries(Object.entries(porTipo).map(([t, ps]) => {
    const inter = ps.map((p) => (p.likes ?? 0) + (p.comentarios ?? 0))
    return [t, {
      cantidad: ps.length,
      likes: promedio(ps.map((p) => p.likes).filter((x) => x !== null)),
      comentarios: promedio(ps.map((p) => p.comentarios).filter((x) => x !== null)),
      reproducciones: promedio(ps.map((p) => p.reproducciones).filter((x) => x !== null)),
      interaccionPct: perfil.seguidores ? pct(100 * promedio(inter) / perfil.seguidores) : null,
    }]
  }))
  // Las fijadas pueden ser viejas: no cuentan para la frecuencia.
  const fechas = pubs.filter((p) => !p.fijada).map((p) => p.fecha).filter(Boolean).sort()
  const dias = fechas.length > 1 ? (Date.parse(fechas.at(-1)) - Date.parse(fechas[0])) / 86400000 : null
  const hashtags = {}
  for (const p of pubs) for (const h of p.hashtags) hashtags[h.toLowerCase()] = (hashtags[h.toLowerCase()] ?? 0) + 1
  const mejor = [...pubs].sort((a, b) => ((b.likes ?? 0) + (b.comentarios ?? 0)) - ((a.likes ?? 0) + (a.comentarios ?? 0)))[0]
  return {
    cuenta: perfil.cuenta,
    seguidores: perfil.seguidores,
    leidas: pubs.length,
    porSemana: dias ? +((fechas.length - 1) / dias * 7).toFixed(1) : null,
    tipos,
    hashtags: Object.entries(hashtags).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([h, n]) => ({ h, n })),
    mejor: mejor ? { url: mejor.url, tipo: mejor.tipo, likes: mejor.likes, comentarios: mejor.comentarios } : null,
  }
}

// MARK: - Apify (apify/instagram-scraper)

const sinNegativo = (x) => (typeof x === 'number' && x >= 0 ? x : null)

/** Tipo de una publicación de Apify (`type`: Image | Video | Sidecar; `productType`: feed | clips | igtv). */
export function tipoApify(p) {
  if (p.productType === 'clips') return 'reel'
  if (p.type === 'Sidecar') return 'carrusel'
  if (p.type === 'Video') return 'video'
  return 'foto'
}

/** Una publicación de Apify en el formato del spike. */
export function mapearPublicacionApify(p) {
  const texto = p.caption ?? ''
  const conPrefijo = (xs, c) => [...new Set((xs ?? []).map((x) => (x.startsWith(c) ? x : c + x)))]
  return {
    codigo: p.shortCode ?? null,
    url: p.url ?? (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : null),
    tipo: tipoApify(p),
    fecha: p.timestamp ?? null,
    texto,
    hashtags: conPrefijo(p.hashtags, '#'),
    menciones: conPrefijo(p.mentions, '@'),
    likes: sinNegativo(p.likesCount),
    comentarios: sinNegativo(p.commentsCount),
    reproducciones: sinNegativo(p.videoPlayCount) ?? sinNegativo(p.igPlayCount) ?? sinNegativo(p.videoViewCount),
    duracion: sinNegativo(p.videoDuration),
    piezas: Array.isArray(p.childPosts) && p.childPosts.length ? p.childPosts.length : null,
    fijada: !!p.isPinned,
    descripcionAuto: p.alt ?? null,
    lugar: p.locationName ?? null,
    miniatura: p.displayUrl ?? null,
    video: p.videoUrl ?? null,
    // Lo que solo trae Apify.
    musica: p.musicInfo ? [p.musicInfo.song_name, p.musicInfo.artist_name].filter(Boolean).join(' — ') || null : null,
    colaboracionPaga: !!p.paidPartnership,
    ultimosComentarios: (p.latestComments ?? []).slice(0, 5).map((c) => ({ de: c.ownerUsername ?? null, texto: c.text ?? '' })),
  }
}

/** Como en el perfil: primero las fijadas y después de la más nueva a la más vieja (Apify las devuelve mezcladas). */
export const ordenar = (pubs) => [...pubs].sort((a, b) => (b.fijada - a.fijada) || String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')))

/** Los datos de perfil de Apify (`resultsType: "details"`) en el formato del spike. Si vienen `posts` (de otra corrida
 *  con `resultsType: "posts"`), reemplazan a las `latestPosts` del perfil. */
export function mapearPerfilApify(d, posts) {
  if (!d || d.error) return undefined
  const lista = posts?.length ? posts.filter((p) => !p.error) : d.latestPosts ?? []
  return {
    cuenta: d.username,
    nombre: d.fullName ?? '',
    bio: d.biography ?? '',
    enlace: d.externalUrl ?? null,
    categoria: d.businessCategoryName ?? null,
    verificada: !!d.verified,
    profesional: !!d.isBusinessAccount,
    privada: !!d.private,
    seguidores: sinNegativo(d.followersCount),
    seguidos: sinNegativo(d.followsCount),
    publicacionesTotal: sinNegativo(d.postsCount),
    publicaciones: ordenar(lista.map(mapearPublicacionApify)),
    hayMas: (sinNegativo(d.postsCount) ?? 0) > lista.length,
  }
}
