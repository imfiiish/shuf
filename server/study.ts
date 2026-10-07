import { Hono } from 'hono'
import { currentUserId } from './auth.ts'
import { BOOK_BY_ID, bookPool, cardsForWords, getCustom } from './books.ts'
import { pool } from './db.ts'
import { logicalDay, pickDay } from './day.ts'
import { getSettings } from './settings.ts'
import {
  advance,
  ensureCascade,
  paramsFor,
  DEFAULT_MIX,
  DEFAULT_ROUND_SIZE,
  MIXES,
  ROUND_SIZES,
  type Cascade,
  type Mix,
} from './sampling.ts'

// Dealing for the study flow. Sampling state is the cascading windows
// (server/sampling.ts). Round size and the new/review mix come from settings
// and only change the sampling parameters, not the mechanism.

type CascadeRow = {
  [k: string]: unknown
  round_seq: number
  levels: string[][] | null
  words: string[] | null
}

async function loadCascade(
  userId: number,
  book: string,
): Promise<Cascade | null> {
  const { rows } = await pool.query<CascadeRow>(
    `SELECT round_seq, levels, words
       FROM cascades
      WHERE user_id = $1 AND book = $2`,
    [userId, book],
  )
  const row = rows[0]
  if (!row) return null
  return {
    roundSeq: Number(row.round_seq),
    levels: row.levels ?? [],
    words: row.words ?? [],
  }
}

async function saveCascade(
  userId: number,
  book: string,
  c: Cascade,
): Promise<void> {
  await pool.query(
    `INSERT INTO cascades (user_id, book, round_seq, levels, words, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id, book) DO UPDATE SET
       round_seq = excluded.round_seq,
       levels = excluded.levels,
       words = excluded.words,
       updated_at = now()`,
    [userId, book, c.roundSeq, JSON.stringify(c.levels), JSON.stringify(c.words)],
  )
}

function pickRoundSize(v: unknown): number {
  return typeof v === 'number' &&
    (ROUND_SIZES as readonly number[]).includes(v)
    ? v
    : DEFAULT_ROUND_SIZE
}

function pickMix(v: unknown): Mix {
  return typeof v === 'string' && (MIXES as readonly string[]).includes(v)
    ? (v as Mix)
    : DEFAULT_MIX
}

/**
 * Deal one round from the cascading windows.
 * body: { book, advance?, roundSize?, mix? }. Without `advance` it returns the
 * current round (idempotent, so a reload keeps the same cards); `advance: true`
 * moves on. `roundSize` / `mix` come from settings.
 */
const study = new Hono()

study.post('/round', async (c) => {
  const userId = await currentUserId(c)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)

  const body = (await c.req.json().catch(() => null)) as {
    book?: unknown
    advance?: unknown
    roundSize?: unknown
    mix?: unknown
  } | null
  const book = typeof body?.book === 'string' ? body.book : null
  if (!book) return c.json({ error: 'invalid' }, 400)
  const def = BOOK_BY_ID.get(book)
  if (!def) return c.json({ error: 'unknown_book' }, 404)

  const prefs = await getSettings(userId)
  const roundSize =
    body?.roundSize === undefined
      ? prefs.roundSize
      : pickRoundSize(body.roundSize)
  const mix = body?.mix === undefined ? prefs.mix : pickMix(body.mix)
  const params = paramsFor(roundSize, mix)

  const words = await bookPool(def, await getCustom(userId, book))
  if (words.length === 0) return c.json({ error: 'empty' }, 400)

  const stored = await loadCascade(userId, book)
  let { cascade, generated } = ensureCascade(stored, words, params)
  if (body?.advance === true && !generated) {
    cascade = advance(cascade, words, params)
    generated = true
  }
  // Round size changed in settings → re-deal so the count matches.
  if (cascade.words.length !== params.roundSize) {
    cascade = advance(cascade, words, params)
    generated = true
  }
  await saveCascade(userId, book, cascade)

  const { rows: lastRows } = await pool.query<{ last_word: string | null }>(
    `SELECT last_word FROM cascades WHERE user_id = $1 AND book = $2`,
    [userId, book],
  )

  const items = await cardsForWords(def, cascade.words)
  return c.json({
    book: def.id,
    lang: def.lang,
    name: def.name,
    roundSeq: cascade.roundSeq,
    roundSize: params.roundSize,
    mix,
    total: words.length,
    words: cascade.words,
    lastWord: lastRows[0]?.last_word ?? null,
    items,
  })
})

function toWordList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  for (const x of v) {
    if (typeof x === 'string' && x.length > 0) seen.add(x)
    if (seen.size >= 1000) break
  }
  return [...seen]
}

/** met payload: { word: count } → [{ word, n }] with sane counts. */
function toMet(v: unknown): { word: string; n: number }[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return []
  const out: { word: string; n: number }[] = []
  for (const [word, count] of Object.entries(v as Record<string, unknown>)) {
    const n = Math.round(Number(count))
    if (word.length === 0 || !Number.isFinite(n) || n <= 0) continue
    out.push({ word, n: Math.min(n, 1000) })
    if (out.length >= 1000) break
  }
  return out
}

function pickRoundSeq(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** Fallback round number when the client does not send one. */
async function currentRoundSeq(userId: number, book: string): Promise<number> {
  const { rows } = await pool.query<{ round_seq: number }>(
    `SELECT round_seq FROM cascades WHERE user_id = $1 AND book = $2`,
    [userId, book],
  )
  return Number(rows[0]?.round_seq ?? 0)
}

/**
 * Record what the user saw / learned for the round just played.
 * body: { book, day?, exposed: string[], met: { [word]: count } }
 * `exposed` counts +1 per round the word reached the centre; `met` adds the
 * flip count. Both also go into the per-logical-day bucket.
 */
study.put('/progress', async (c) => {
  const userId = await currentUserId(c)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)

  const body = (await c.req.json().catch(() => null)) as {
    book?: unknown
    day?: unknown
    roundSeq?: unknown
    exposed?: unknown
    met?: unknown
    lastWord?: unknown
  } | null
  const book = typeof body?.book === 'string' ? body.book : null
  const def = book ? BOOK_BY_ID.get(book) : undefined
  if (!book || !def) return c.json({ error: 'unknown_book' }, 404)

  const day = pickDay(body?.day) ?? logicalDay()
  const roundSeq =
    pickRoundSeq(body?.roundSeq) ?? (await currentRoundSeq(userId, book))
  const exposed = toWordList(body?.exposed)
  const met = toMet(body?.met)
  const metSum = met.reduce((sum, m) => sum + m.n, 0)
  const lastWord = typeof body?.lastWord === 'string' ? body.lastWord : null
  if (exposed.length === 0 && met.length === 0 && !lastWord) {
    return c.json({ ok: true, day, exposed: 0, met: 0 })
  }

  const client = await pool.connect()
  let exposedCount = 0
  try {
    await client.query('BEGIN')

    if (exposed.length > 0) {
      // Count a word only the first time it is exposed in this round.
      const res = await client.query(
        `WITH new_words AS (
           INSERT INTO user_round_words (user_id, book, round_seq, word)
           SELECT $1, $2, $3, w FROM unnest($4::text[]) AS w
           ON CONFLICT (user_id, book, round_seq, word) DO NOTHING
           RETURNING word
         ),
         bumped AS (
           INSERT INTO user_word_stats (user_id, lang, word, exposed, exposed_at, last_at)
           SELECT $1, $5, word, 1, now(), now() FROM new_words
           ON CONFLICT (user_id, lang, word) DO UPDATE SET
             exposed = user_word_stats.exposed + 1,
             exposed_at = COALESCE(user_word_stats.exposed_at, now()),
             last_at = now()
           RETURNING word
         )
         INSERT INTO user_word_daily (user_id, lang, word, day, exposed)
         SELECT $1, $5, word, $6::date, 1 FROM bumped
         ON CONFLICT (user_id, lang, word, day) DO UPDATE SET
           exposed = user_word_daily.exposed + 1`,
        [userId, book, roundSeq, exposed, def.lang, day],
      )
      exposedCount = res.rowCount ?? 0
    }

    if (met.length > 0) {
      const json = JSON.stringify(met)
      await client.query(
        `INSERT INTO user_word_stats (user_id, lang, word, met, met_at, last_at)
         SELECT $1, $2, m.word, m.n, now(), now()
           FROM jsonb_to_recordset($3::jsonb) AS m(word text, n int)
         ON CONFLICT (user_id, lang, word) DO UPDATE SET
           met = user_word_stats.met + excluded.met,
           met_at = COALESCE(user_word_stats.met_at, now()),
           last_at = now()`,
        [userId, def.lang, json],
      )
      await client.query(
        `INSERT INTO user_word_daily (user_id, lang, word, day, met)
         SELECT $1, $2, m.word, $3::date, m.n
           FROM jsonb_to_recordset($4::jsonb) AS m(word text, n int)
         ON CONFLICT (user_id, lang, word, day) DO UPDATE SET
           met = user_word_daily.met + excluded.met`,
        [userId, def.lang, day, json],
      )
    }

    // Per-round aggregate for the day view.
    if (exposedCount > 0 || metSum > 0) {
      await client.query(
        `INSERT INTO user_rounds (user_id, book, round_seq, day, exposed, reveals)
         VALUES ($1, $2, $3, $4::date, $5, $6)
         ON CONFLICT (user_id, book, round_seq) DO UPDATE SET
           day = excluded.day,
           exposed = user_rounds.exposed + excluded.exposed,
           reveals = user_rounds.reveals + excluded.reveals`,
        [userId, book, roundSeq, day, exposedCount, metSum],
      )
    }

    // Last word brought to the centre (synced across devices).
    if (lastWord) {
      await client.query(
        `UPDATE cascades SET last_word = $3, updated_at = now()
          WHERE user_id = $1 AND book = $2`,
        [userId, book, lastWord],
      )
    }

    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

  return c.json({
    ok: true,
    day,
    roundSeq,
    exposed: exposedCount,
    met: metSum,
  })
})

export default study
