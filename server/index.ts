import './env.ts'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
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

app.get('/api/health', (c) => c.json({ ok: true }))

app.route('/api/auth', auth)
app.route('/api/study', study)
app.route('/api/settings', settings)
app.route('/api/progress', progress)

/** Languages that actually have words in the dictionary. */
app.get('/api/languages', async (c) => {
  const { rows } = await pool.query<{ code: string; count: string }>(
    `SELECT l.code, count(w.*)::text AS count
       FROM languages l
       LEFT JOIN words w ON w.lang = l.code
      GROUP BY l.code
      ORDER BY l.code`,
  )
  return c.json(rows.map((r) => ({ code: r.code, count: Number(r.count) })))
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

const port = Number(process.env.PORT ?? 8787)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`shuf-flip API listening on http://localhost:${info.port}`)
})
