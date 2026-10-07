import './env.ts'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { etag } from 'hono/etag'
import { resolve } from 'node:path'
import auth, { currentUserId } from './auth.ts'
import {
  BOOK_BY_ID,
  bookTotal,
  deckFor,
  EMPTY_CUSTOM,
  getCustom,
  listBooks,
  loadCustoms,
  saveCustom,
  type Custom,
} from './books.ts'
import { pool } from './db.ts'
import { startMaintenance } from './maintenance.ts'
import { migrateWithRetry } from './migrate.ts'
import progress from './progress.ts'
import settings from './settings.ts'
import study from './study.ts'

const app = new Hono()

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'internal_error' }, 500)
})

// Basic hardening headers for every response. HSTS is left to the TLS
// terminator (reverse proxy), which is the only place that knows the scheme.
app.use('*', async (c, next) => {
  await next()
  const h = c.res.headers
  h.set('x-content-type-options', 'nosniff')
  h.set('x-frame-options', 'DENY')
  h.set('referrer-policy', 'same-origin')
})

// Pronunciation audio. $AUDIO_DIR holds <lang>/<voice>/<file>; a relative path
// resolves against the repo root. Never hard-code a machine path here — set
// AUDIO_DIR in the gitignored .env instead.
const AUDIO_DIR = resolve(
  import.meta.dirname,
  '..',
  process.env.AUDIO_DIR ?? 'audio',
)
/** Vite build output, served by this same process in production. */
const DIST_DIR = resolve(import.meta.dirname, '..', 'dist')
const AUDIO_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
}
// hono/utils/mime has no .wav/.ogg entry, so serveStatic falls back to
// application/octet-stream (which makes browsers download). Fix it up.
app.use('/audio/*', async (c, next) => {
  await next()
  // Recordings never change, so let the browser keep them across sessions
  // instead of falling back to heuristic caching.
  if (c.res.status === 200) {
    c.res.headers.set('cache-control', 'public, max-age=31536000, immutable')
  }
  if (c.res.headers.get('content-type') === 'application/octet-stream') {
    const ext = c.req.path.split('.').pop()?.toLowerCase() ?? ''
    if (AUDIO_TYPES[ext]) c.res.headers.set('content-type', AUDIO_TYPES[ext])
  }
})
app.use(
  '/audio/*',
  serveStatic({
    root: AUDIO_DIR,
    rewriteRequestPath: (path) => path.replace(/^\/audio/, ''),
  }),
)

// gzip/deflate the JSON API. Audio is already compressed and served from
// /audio, so it is deliberately left alone.
app.use('/api/*', compress())

// Revalidate cheaply: ETag on the JSON, and a cache policy that keeps
// per-account reads out of shared caches while letting the public language
// list sit in the browser. Registered after compress() so the tag hashes the
// uncompressed body; compress() preserves the header on the way out.
app.use('/api/*', etag())
app.use('/api/*', async (c, next) => {
  await next()
  if (c.res.status !== 200 || c.res.headers.has('cache-control')) return
  const path = c.req.path
  if (path === '/api/languages') {
    c.res.headers.set(
      'cache-control',
      'public, max-age=3600, stale-while-revalidate=86400',
    )
  } else if (path.startsWith('/api/auth')) {
    c.res.headers.set('cache-control', 'no-store')
  } else {
    c.res.headers.set('cache-control', 'private, no-cache')
  }
})

app.get('/api/health', async (c) => {
  try {
    await pool.query('SELECT 1')
    return c.json({ ok: true })
  } catch (err) {
    console.error('[health]', err)
    return c.json({ ok: false }, 503)
  }
})

app.route('/api/auth', auth)
app.route('/api/study', study)
app.route('/api/settings', settings)
app.route('/api/progress', progress)

/** Languages that actually have words in the dictionary. */
let languagesCache: { code: string; count: number }[] | null = null
app.get('/api/languages', async (c) => {
  // The dictionary is static, so the aggregate is computed once per process.
  if (!languagesCache) {
    const { rows } = await pool.query<{ code: string; count: string }>(
      `SELECT l.code, count(w.*)::text AS count
         FROM languages l
         LEFT JOIN words w ON w.lang = l.code
        GROUP BY l.code
        ORDER BY l.code`,
    )
    languagesCache = rows.map((r) => ({ code: r.code, count: Number(r.count) }))
  }
  return c.json(languagesCache)
})

function toIdList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return [
    ...new Set(
      v.filter((x): x is string => typeof x === 'string' && BOOK_BY_ID.has(x)),
    ),
  ]
}

app.get('/api/books', async (c) => {
  const userId = await currentUserId(c)
  const customs = userId ? await loadCustoms(userId) : new Map()
  return c.json({ items: await listBooks(userId, customs) })
})

/** The user's saved customization for one book. */
app.get('/api/books/custom', async (c) => {
  const userId = await currentUserId(c)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)
  const book = c.req.query('book')?.trim() ?? ''
  return c.json({ custom: await getCustom(userId, book) })
})

app.put('/api/books/custom', async (c) => {
  const userId = await currentUserId(c)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)
  const body = (await c.req.json().catch(() => null)) as {
    book?: unknown
    exclude?: unknown
    addon?: unknown
  } | null
  const book = typeof body?.book === 'string' ? body.book : null
  if (!book || !BOOK_BY_ID.has(book)) {
    return c.json({ error: 'unknown_book' }, 404)
  }
  const custom: Custom = {
    exclude: toIdList(body?.exclude),
    addon: toIdList(body?.addon),
  }
  await saveCustom(userId, book, custom)
  return c.json({ custom })
})

app.get('/api/deck', async (c) => {
  const userId = await currentUserId(c)
  const bookId = c.req.query('book')?.trim() ?? ''
  const def = BOOK_BY_ID.get(bookId)
  if (!def) {
    return c.json({ error: 'unknown_book', book: bookId }, 404)
  }
  const custom = userId ? await getCustom(userId, bookId) : EMPTY_CUSTOM

  const parsedLimit = Number.parseInt(c.req.query('limit') ?? '', 10)
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT
  const parsedOffset = Number.parseInt(c.req.query('offset') ?? '', 10)
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0
  const shuffle = c.req.query('shuffle') === '1'

  const [items, total] = await Promise.all([
    deckFor(def, custom, limit, offset, shuffle),
    bookTotal(def, custom),
  ])

  return c.json({
    book: def.id,
    lang: def.lang,
    name: def.name,
    total,
    limit,
    offset,
    items,
  })
})

// ---- Built SPA (production) -----------------------------------------------
// Vite writes content-hashed names into dist/assets ("index-DHA6PBVa.js"), so
// those files can be cached forever. The HTML shell must revalidate so a
// deploy's new hashes are picked up. Without this the CDN has to invent a TTL
// (Cloudflare's default is only 4 hours).
const HASHED =
  /[.-][0-9a-zA-Z_-]{8,}\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico)$/

// Everything Vite emits under /assets carries a content hash in its name, so
// it can be cached forever; root files (favicon, manifest, robots) and the
// HTML shell revalidate instead.
const isHashedAsset = (path: string): boolean =>
  path.startsWith('/assets/') && HASHED.test(path)

// Must run before the static handler: the Node adapter finalises the response
// inside serveStatic, so a cache header set in its onFound hook is dropped.
app.use('*', async (c, next) => {
  const path = c.req.path
  if (path.startsWith('/api') || path.startsWith('/audio')) return next()
  c.header(
    'cache-control',
    isHashedAsset(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
  )
  return next()
})

// Registered last so /api and /audio win; unknown paths there still 404
// instead of falling through to index.html.
app.use('*', async (c, next) => {
  const path = c.req.path
  if (path.startsWith('/api') || path.startsWith('/audio')) return next()
  return serveStatic({ root: DIST_DIR })(c, next)
})
app.get('*', async (c, next) => {
  const path = c.req.path
  if (path.startsWith('/api') || path.startsWith('/audio')) return next()
  // A path that names a file (or lives under /assets) is a real miss: 404 it
  // instead of handing it the SPA shell, otherwise the CDN caches an HTML
  // body under a script/style/robots URL.
  if (path.startsWith('/assets') || /\.[a-z0-9]+$/i.test(path)) {
    return c.notFound()
  }
  return serveStatic({ path: resolve(DIST_DIR, 'index.html') })(c, next)
})

// Bring the app schema up to date before accepting traffic.
await migrateWithRetry()

const port = Number(process.env.PORT ?? 8787)
const hostname = process.env.HOST ?? '0.0.0.0'

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`shuf-flip listening on http://${hostname}:${info.port}`)
})

// Daily housekeeping at the logical-day rollover (see maintenance.ts).
startMaintenance()

// Close the server and the pool on SIGTERM/SIGINT so a container stop or a
// deploy is not a hard kill; force-exit if connections refuse to drain.
let closing = false
function shutdown(signal: string): void {
  if (closing) return
  closing = true
  console.log(`[server] ${signal}: shutting down`)
  server.close(() => {
    void pool.end().finally(() => process.exit(0))
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
