import { Hono } from 'hono'
import { currentUserId } from './auth.ts'
import { logicalDay, pickDay } from './day.ts'
import { pool } from './db.ts'

// Progress read model, built from user_word_daily / user_rounds (per logical
// day).
//
// today:
//   learned   = distinct words revealed today (the daily goal's numerator)
//   exposed   = distinct words brought to the centre today
//   reveals   = total flips today
//   newWords  = revealed today AND first ever revealed today
//   reviewWords = revealed today AND revealed on an earlier day
//   exposedOnly = exposed today but never revealed today
//   (newWords + reviewWords = learned; learned + exposedOnly = exposed)

const emptyTotals = {
  learned: 0,
  exposed: 0,
  reveals: 0,
  newWords: 0,
  reviewWords: 0,
  exposedOnly: 0,
}

const progress = new Hono()

progress.get('/', async (c) => {
  const userId = await currentUserId(c)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)

  const day = pickDay(c.req.query('day')) ?? logicalDay()
  const parsedDays = Number.parseInt(c.req.query('days') ?? '', 10)
  const days = Number.isFinite(parsedDays)
    ? Math.min(Math.max(parsedDays, 1), 365)
    : 30

  const [today, daily, rounds, languages] = await Promise.all([
    pool.query<{
      learned: number
      exposed: number
      reveals: number
      new_words: number
      review_words: number
      exposed_only: number
    }>(
      // new / review use user_word_stats.met_at (first reveal), so pruning
      // user_word_daily never changes the classification.
      `SELECT (count(*) FILTER (WHERE d.met > 0))::int AS learned,
              (count(*) FILTER (WHERE d.exposed > 0))::int AS exposed,
              COALESCE(sum(d.met), 0)::int AS reveals,
              (count(*) FILTER (WHERE d.met > 0 AND s.met_at::date = $2::date))::int AS new_words,
              (count(*) FILTER (WHERE d.met > 0 AND s.met_at::date < $2::date))::int AS review_words,
              (count(*) FILTER (WHERE d.exposed > 0 AND d.met = 0))::int AS exposed_only
         FROM user_word_daily d
         JOIN user_word_stats s
           ON s.user_id = d.user_id AND s.lang = d.lang AND s.word = d.word
        WHERE d.user_id = $1 AND d.day = $2::date`,
      [userId, day],
    ),
    pool.query<{
      day: string
      learned: number
      exposed: number
      reveals: number
    }>(
      `SELECT day::text AS day,
              COALESCE(sum(learned), 0)::int AS learned,
              COALESCE(sum(exposed), 0)::int AS exposed,
              COALESCE(sum(reveals), 0)::int AS reveals
         FROM user_day_stats_all
        WHERE user_id = $1
          AND day BETWEEN $2::date - ($3::int - 1) AND $2::date
        GROUP BY day
        ORDER BY day`,
      [userId, day, days],
    ),
    pool.query<{
      book: string
      round_seq: number
      exposed: number
      reveals: number
    }>(
      `SELECT book, round_seq, exposed, reveals
         FROM user_rounds
        WHERE user_id = $1 AND day = $2::date
        ORDER BY started_at, round_seq`,
      [userId, day],
    ),
    // Sunburst: per language, how the touched words are distributed across
    // exposed-only / revealed-before-today / revealed-today.
    pool.query<{
      lang: string
      exposed: number
      before: number
      today: number
    }>(
      `SELECT s.lang,
              (count(*) FILTER (WHERE s.met > 0 AND s.met_at::date = $2::date))::int AS today,
              (count(*) FILTER (WHERE s.met > 0 AND s.met_at::date < $2::date))::int AS before,
              (count(*) FILTER (WHERE s.met = 0 AND s.exposed > 0))::int AS exposed
         FROM user_word_stats s
        WHERE s.user_id = $1
        GROUP BY s.lang
        ORDER BY s.lang`,
      [userId, day],
    ),
  ])

  const t = today.rows[0]
  return c.json({
    day,
    today: t
      ? {
          learned: t.learned,
          exposed: t.exposed,
          reveals: t.reveals,
          newWords: t.new_words,
          reviewWords: t.review_words,
          exposedOnly: t.exposed_only,
        }
      : { ...emptyTotals },
    daily: daily.rows,
    rounds: rounds.rows.map((r) => ({
      book: r.book,
      roundSeq: Number(r.round_seq),
      exposed: r.exposed,
      reveals: r.reveals,
    })),
    languages: languages.rows,
  })
})

/** Per-day activity for a date range — used by the calendar. */
progress.get('/days', async (c) => {
  const userId = await currentUserId(c)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)

  const from = pickDay(c.req.query('from'))
  const to = pickDay(c.req.query('to'))
  if (!from || !to) return c.json({ error: 'invalid' }, 400)

  const { rows } = await pool.query<{
    day: string
    learned: number
    exposed: number
    reveals: number
    new_words: number
    review_words: number
  }>(
    `SELECT day::text AS day,
            COALESCE(sum(learned), 0)::int AS learned,
            COALESCE(sum(exposed), 0)::int AS exposed,
            COALESCE(sum(reveals), 0)::int AS reveals,
            COALESCE(sum(new_words), 0)::int AS new_words,
            COALESCE(sum(review_words), 0)::int AS review_words
       FROM user_day_stats_all
      WHERE user_id = $1 AND day BETWEEN $2::date AND $3::date
      GROUP BY day
      ORDER BY day`,
    [userId, from, to],
  )
  return c.json({
    days: rows.map((r) => ({
      day: r.day,
      learned: r.learned,
      exposed: r.exposed,
      reveals: r.reveals,
      new: r.new_words,
      review: r.review_words,
    })),
  })
})

/** Words revealed on a given day, with their reveal count and new/review kind. */
progress.get('/words', async (c) => {
  const userId = await currentUserId(c)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)

  const day = pickDay(c.req.query('day')) ?? logicalDay()

  const { rows } = await pool.query<{
    word: string
    lang: string
    reveals: number
    is_new: boolean
  }>(
    `SELECT d.word, d.lang, d.met AS reveals,
            (s.met_at::date = $2::date) AS is_new
       FROM user_word_daily d
       JOIN user_word_stats s
         ON s.user_id = d.user_id AND s.lang = d.lang AND s.word = d.word
      WHERE d.user_id = $1 AND d.day = $2::date AND d.met > 0
      ORDER BY d.met DESC, d.word`,
    [userId, day],
  )

  return c.json({
    day,
    words: rows.map((r) => ({
      word: r.word,
      lang: r.lang,
      reveals: Number(r.reveals),
      kind: r.is_new ? 'new' : 'review',
    })),
  })
})

export default progress
