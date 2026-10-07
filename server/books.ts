import { pool } from './db.ts'

// A "book" is a named slice of the dictionary. Most map onto one or more
// `words.categories` tags; the Oxford lists map onto `oxford.cefr` bands.
// The ids match the front-end wordbook ids so decks can be requested with the
// same identifier the UI already uses.

export type BookName = { en: string; zh: string }
export type BookDef = {
  id: string
  lang: string
  name: BookName
  /** Category tags (any overlap selects the word). */
  categories?: string[]
  /** Oxford CEFR bands. */
  cefr?: string[]
  /** Not ready yet (shown greyed out). */
  disabled?: boolean
}

/** Per-user customization: related lists to drop / fold in. */
export type Custom = { exclude: string[]; addon: string[] }
export const EMPTY_CUSTOM: Custom = { exclude: [], addon: [] }

/** Literal name, identical in both UI languages. */
const only = (name: string): BookName => ({ en: name, zh: name })

export const BOOK_DEFS: BookDef[] = [
  { id: 'en-primary', lang: 'en', name: only('义务教育·小学'), categories: ['小学'] },
  { id: 'en-junior', lang: 'en', name: only('义务教育·初中'), categories: ['初中'] },
  {
    id: 'en-senior',
    lang: 'en',
    name: only('普通高中'),
    categories: ['必修', '选择性必修'],
  },
  { id: 'en-cet4', lang: 'en', name: only('CET4(四级)'), categories: ['CET4'] },
  { id: 'en-cet6', lang: 'en', name: only('CET6(六级)'), categories: ['CET6'] },
  {
    id: 'en-ox3',
    lang: 'en',
    name: { en: 'Oxford 3000', zh: '牛津3000词' },
    cefr: ['A1', 'A2', 'B1', 'B2'],
  },
  {
    id: 'en-ox5',
    lang: 'en',
    name: { en: 'Oxford 5000', zh: '牛津5000词' },
    cefr: ['A1', 'A2', 'B1', 'B2', 'C1'],
  },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({
    id: `hsk-${n}`,
    lang: 'zh',
    name: only(`HSK ${n}`),
    categories: [`HSK${n}`],
  })),
  { id: 'hsk-7', lang: 'zh', name: only('HSK 7-9'), categories: ['HSK7-9'] },
  // Display names follow the modern N scale; the source data has no N3, so
  // JLPT3 is shown as N4.
  { id: 'jlpt-1', lang: 'ja', name: only('JLPT N1'), categories: ['JLPT1'] },
  { id: 'jlpt-2', lang: 'ja', name: only('JLPT N2'), categories: ['JLPT2'] },
  { id: 'jlpt-3', lang: 'ja', name: only('JLPT N4'), categories: ['JLPT3'] },
  { id: 'jlpt-4', lang: 'ja', name: only('JLPT N5'), categories: ['JLPT4'] },
  { id: 'ko-1', lang: 'ko', name: only('韩语常用词·初级'), categories: ['A'] },
  { id: 'ko-2', lang: 'ko', name: only('韩语常用词·中级'), categories: ['B'] },
  { id: 'ko-3', lang: 'ko', name: only('韩语常用词·高级'), categories: ['C'] },
]

export const BOOK_BY_ID = new Map(BOOK_DEFS.map((b) => [b.id, b]))

export type Card = {
  word: string
  phonetic: string | null
  senses: unknown
  tags: string[]
  sound: string | null
}

type RawCard = {
  word: string
  tags: string[]
  phonetic: string | null
  senses: unknown
  sound: string | null
}

/** Word-selector SQL for a book; pushes its params onto `params`. */
function selector(def: BookDef, params: unknown[]): string {
  if (def.cefr) {
    params.push(def.cefr)
    return `SELECT DISTINCT word FROM oxford WHERE cefr = ANY($${params.length}::text[])`
  }
  params.push(def.lang, def.categories ?? [])
  return `SELECT word FROM words
           WHERE lang = $${params.length - 1} AND categories && $${params.length}::text[]`
}

/** Effective word pool: (base ∪ addons) − excludes. Pushes its params. */
function poolSql(def: BookDef, custom: Custom, params: unknown[]): string {
  const includeDefs = [
    def,
    ...custom.addon
      .map((id) => BOOK_BY_ID.get(id))
      .filter((b): b is BookDef => !!b),
  ]
  const inc = includeDefs.map((b) => selector(b, params))
  let sql = inc.length === 1 ? inc[0] : `SELECT word FROM (${inc.join(' UNION ')}) u`

  const excludeDefs = custom.exclude
    .map((id) => BOOK_BY_ID.get(id))
    .filter((b): b is BookDef => !!b)
  if (excludeDefs.length > 0) {
    const ex = excludeDefs.map((b) => selector(b, params))
    sql = `SELECT word FROM (${sql}) t WHERE word NOT IN (${ex.join(' UNION ')})`
  }
  return sql
}

/** Total number of words in a book (after customization). */
export async function bookTotal(
  def: BookDef,
  custom: Custom = EMPTY_CUSTOM,
): Promise<number> {
  const params: unknown[] = []
  const sql = poolSql(def, custom, params)
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM (${sql}) t`,
    params,
  )
  return rows[0]?.n ?? 0
}

/** All words in a book (after customization), stable order — the pool. */
export async function bookPool(
  def: BookDef,
  custom: Custom = EMPTY_CUSTOM,
): Promise<string[]> {
  const params: unknown[] = []
  const sql = poolSql(def, custom, params)
  const { rows } = await pool.query<{ word: string }>(
    `SELECT word FROM (${sql}) t ORDER BY word`,
    params,
  )
  return rows.map((r) => r.word)
}

/** Per-language join to the table that holds phonetic / senses / audio. */
function detailOf(lang: string): { join: string; phonetic: string } {
  switch (lang) {
    case 'en':
      return {
        join: `LEFT JOIN english d ON d.word = w.word`,
        phonetic: `COALESCE(d.ipa->>'us', d.ipa->>'uk')`,
      }
    case 'zh':
      return {
        join: `LEFT JOIN LATERAL (
           SELECT pinyin AS phonetic, senses, sound FROM hsk
            WHERE hsk.word = w.word ORDER BY level LIMIT 1
         ) d ON true`,
        phonetic: `d.phonetic`,
      }
    case 'ja':
      return {
        join: `LEFT JOIN LATERAL (
           SELECT reading AS phonetic, senses, sound FROM jlpt
            WHERE jlpt.word = w.word ORDER BY level LIMIT 1
         ) d ON true`,
        phonetic: `d.phonetic`,
      }
    default:
      return {
        join: `LEFT JOIN LATERAL (
           SELECT romanization AS phonetic, senses, sound FROM korean
            WHERE korean.word = w.word LIMIT 1
         ) d ON true`,
        phonetic: `d.phonetic`,
      }
  }
}

function shuffleRows<T>(rows: T[]): T[] {
  const a = [...rows]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Words for a book, details joined per language, in deck order. */
export async function deckFor(
  def: BookDef,
  custom: Custom,
  limit: number,
  offset: number,
  shuffle: boolean,
): Promise<Card[]> {
  const order = shuffle ? 'random()' : 'w.word'
  const params: unknown[] = []
  const sql = poolSql(def, custom, params)
  const base = params.length
  params.push(def.lang, limit, offset)

  const { join, phonetic } = detailOf(def.lang)
  const { rows } = await pool.query<RawCard>(
    `SELECT w.word,
            w.categories AS tags,
            ${phonetic} AS phonetic,
            d.senses,
            d.sound
       FROM (${sql}) p
       JOIN words w ON w.lang = $${base + 1} AND w.word = p.word
       ${join}
      ORDER BY ${order}
      LIMIT $${base + 2} OFFSET $${base + 3}`,
    params,
  )
  return shuffle ? shuffleRows(rows) : rows
}

/** Details for a specific, ordered list of words (deck order preserved). */
export async function cardsForWords(
  def: BookDef,
  words: string[],
): Promise<Card[]> {
  if (words.length === 0) return []

  if (def.cefr) {
    const { rows } = await pool.query<RawCard>(
      `SELECT o.word,
              COALESCE(w.categories, ARRAY[]::text[]) AS tags,
              COALESCE(e.ipa->>'us', e.ipa->>'uk') AS phonetic,
              e.senses,
              e.sound
         FROM unnest($1::text[]) WITH ORDINALITY AS o(word, ord)
         LEFT JOIN english e ON e.word = o.word
         LEFT JOIN words w ON w.lang = 'en' AND w.word = o.word
        ORDER BY o.ord`,
      [words],
    )
    return rows
  }

  const { join, phonetic } = detailOf(def.lang)
  const { rows } = await pool.query<RawCard>(
    `SELECT w.word,
            w.categories AS tags,
            ${phonetic} AS phonetic,
            d.senses,
            d.sound
       FROM unnest($1::text[]) WITH ORDINALITY AS o(word, ord)
       JOIN words w ON w.lang = $2 AND w.word = o.word
       ${join}
      ORDER BY o.ord`,
    [words, def.lang],
  )
  return rows
}

// ---------------------------------------------------------------------------
// Wordbook listing: totals + the related lists shown in the customize dialog.
//
// `covers` is computed from the real dictionary: excluding a list removes the
// words it shares with the book (A∩B); adding a list brings in the words the
// book does not already have (B\A).
// ---------------------------------------------------------------------------

export type BookSummary = {
  id: string
  lang: string
  name: BookName
  /** Effective total (after the user's customization). */
  total: number
  /** The book's own total, before customization. */
  baseTotal: number
  learned: number
  exposed: number
  disabled: boolean
  excludes: Candidate[]
  addons: Candidate[]
  /** The user's saved customization. */
  custom: Custom
}

export type Candidate = { id: string; covers: number }

const EN_RELATIONS: Record<string, { exclude?: string[]; addon?: string[] }> = {
  'en-junior': { exclude: ['en-primary'], addon: ['en-senior'] },
  'en-senior': { exclude: ['en-primary', 'en-junior'], addon: ['en-ox3'] },
  'en-cet4': {
    exclude: ['en-primary', 'en-junior', 'en-senior'],
    addon: ['en-cet6', 'en-ox3', 'en-ox5'],
  },
  'en-cet6': {
    exclude: ['en-primary', 'en-junior', 'en-senior', 'en-cet4'],
    addon: ['en-ox5'],
  },
  'en-ox3': { exclude: ['en-primary', 'en-junior'], addon: ['en-ox5'] },
  'en-ox5': { exclude: ['en-ox3'] },
}

/** Level chains: a level can fold in the next (harder) level. */
function chainAddons(ids: string[]): Record<string, { addon: string[] }> {
  const out: Record<string, { addon: string[] }> = {}
  ids.forEach((id, i) => {
    out[id] = { addon: i + 1 < ids.length ? [ids[i + 1]] : [] }
  })
  return out
}

const RELATIONS: Record<string, { exclude?: string[]; addon?: string[] }> = {
  ...EN_RELATIONS,
  // zh / ja / ko: the lists are not nested, so there is nothing to exclude —
  // only "add more" (fold in the next level).
  ...chainAddons(['hsk-1', 'hsk-2', 'hsk-3', 'hsk-4', 'hsk-5', 'hsk-6', 'hsk-7']),
  ...chainAddons(['jlpt-1', 'jlpt-2', 'jlpt-3', 'jlpt-4']),
  ...chainAddons(['ko-1', 'ko-2', 'ko-3']),
}

const overlapCache = new Map<string, number>()

// The dictionary is static for the life of the process, so a book's own total
// and the coverage of its related lists can be memoised. Without this,
// /api/books re-counts every book (and every add-on total) on each request —
// dozens of full dictionary scans for data that never changes.
const baseTotalCache = new Map<string, number>()
function baseTotal(def: BookDef): Promise<number> {
  const cached = baseTotalCache.get(def.id)
  if (cached !== undefined) return Promise.resolve(cached)
  return bookTotal(def).then((n) => {
    baseTotalCache.set(def.id, n)
    return n
  })
}

const candidatesCache = new Map<string, Candidate[]>()
/** `candidates()` is a pure function of the static RELATIONS map — memoise it. */
async function relatedCandidates(
  def: BookDef,
  ids: string[],
  kind: 'exclude' | 'addon',
): Promise<Candidate[]> {
  const key = `${def.id}:${kind}`
  const cached = candidatesCache.get(key)
  if (cached) return cached
  const list = await candidates(def, ids, kind)
  candidatesCache.set(key, list)
  return list
}

/** Number of words shared by two books (cached — the dictionary is static). */
async function overlap(a: BookDef, b: BookDef): Promise<number> {
  const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
  const cached = overlapCache.get(key)
  if (cached !== undefined) return cached
  const params: unknown[] = []
  const aSql = selector(a, params)
  const bSql = selector(b, params)
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM (${aSql}) x JOIN (${bSql}) y ON x.word = y.word`,
    params,
  )
  const n = rows[0]?.n ?? 0
  overlapCache.set(key, n)
  return n
}

async function candidates(
  def: BookDef,
  ids: string[],
  kind: 'exclude' | 'addon',
): Promise<Candidate[]> {
  return Promise.all(
    ids.map(async (id) => {
      const other = BOOK_BY_ID.get(id)
      if (!other) return { id, covers: 0 }
      const shared = await overlap(def, other)
      const covers =
        kind === 'exclude'
          ? shared
          : Math.max(0, (await baseTotal(other)) - shared)
      return { id, covers }
    }),
  )
}

/** learned / exposed counts for a book (after customization). */
async function bookStats(
  userId: number,
  def: BookDef,
  custom: Custom,
): Promise<{ learned: number; exposed: number }> {
  const params: unknown[] = [userId, def.lang]
  const sql = poolSql(def, custom, params)
  const { rows } = await pool.query<{ learned: number; exposed: number }>(
    `SELECT (count(*) FILTER (WHERE s.met > 0))::int AS learned,
            (count(*) FILTER (WHERE s.exposed > 0))::int AS exposed
       FROM user_word_stats s
      WHERE s.user_id = $1 AND s.lang = $2 AND s.word IN (${sql})`,
    params,
  )
  return rows[0] ?? { learned: 0, exposed: 0 }
}

/** The user's saved customization for every book. */
export async function loadCustoms(
  userId: number,
): Promise<Map<string, Custom>> {
  const { rows } = await pool.query<{
    book: string
    exclude_ids: string[]
    addon_ids: string[]
  }>(
    `SELECT book, exclude_ids, addon_ids FROM user_book_custom WHERE user_id = $1`,
    [userId],
  )
  return new Map(
    rows.map((r) => [
      r.book,
      { exclude: r.exclude_ids ?? [], addon: r.addon_ids ?? [] },
    ]),
  )
}

export async function getCustom(
  userId: number,
  book: string,
): Promise<Custom> {
  const { rows } = await pool.query<{
    exclude_ids: string[]
    addon_ids: string[]
  }>(
    `SELECT exclude_ids, addon_ids FROM user_book_custom
      WHERE user_id = $1 AND book = $2`,
    [userId, book],
  )
  const r = rows[0]
  return r
    ? { exclude: r.exclude_ids ?? [], addon: r.addon_ids ?? [] }
    : { exclude: [], addon: [] }
}

export async function saveCustom(
  userId: number,
  book: string,
  custom: Custom,
): Promise<void> {
  await pool.query(
    `INSERT INTO user_book_custom (user_id, book, exclude_ids, addon_ids, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, book) DO UPDATE SET
       exclude_ids = excluded.exclude_ids,
       addon_ids = excluded.addon_ids,
       updated_at = now()`,
    [userId, book, custom.exclude, custom.addon],
  )
}

/** Every wordbook with live totals, progress and related lists. */
export async function listBooks(
  userId: number | null,
  customs: Map<string, Custom>,
): Promise<BookSummary[]> {
  return Promise.all(
    BOOK_DEFS.map(async (def) => {
      const rel = RELATIONS[def.id] ?? {}
      const custom = customs.get(def.id) ?? EMPTY_CUSTOM
      const customized = custom.exclude.length > 0 || custom.addon.length > 0
      const [total, base, stats, excludes, addons] = await Promise.all([
        customized ? bookTotal(def, custom) : baseTotal(def),
        baseTotal(def),
        userId
          ? bookStats(userId, def, custom)
          : Promise.resolve({ learned: 0, exposed: 0 }),
        relatedCandidates(def, rel.exclude ?? [], 'exclude'),
        relatedCandidates(def, rel.addon ?? [], 'addon'),
      ])
      return {
        id: def.id,
        lang: def.lang,
        name: def.name,
        total,
        baseTotal: base,
        learned: stats.learned,
        exposed: stats.exposed,
        disabled: !!def.disabled,
        excludes,
        addons,
        custom,
      }
    }),
  )
}
