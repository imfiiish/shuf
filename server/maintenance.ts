import { pool } from './db.ts'
import { logicalDay } from './day.ts'

// Daily housekeeping, keyed by the 04:00 logical day. It runs once per day
// (guarded so a restart or a second server instance cannot double-run) and
// every step is idempotent.
//
//   * rolls finished days from user_word_daily into user_day_stats, then drops
//     the per-word rows (the detail is only needed for the current day)
//   * drops per-round working sets / round aggregates from past days
//   * deletes expired sessions and old login attempts
//   * deletes guests idle for a month (cascades to all of their data)

/** Advisory-lock key so only one server instance runs a pass at a time. */
const LOCK_KEY = 'shuf-flip-maintenance'
/** Days kept as per-word detail; older ones are folded into the rollup. */
const DETAIL_DAYS = 2
/** Idle guests / old login attempts are dropped after this many days. */
const RETENTION_DAYS = 30

/** Run the daily pass if the logical day has turned over (or `force`). */
export async function runMaintenance(force = false): Promise<boolean> {
  const today = logicalDay()

  const before = await pool.query<{ last_day: string | null }>(
    `SELECT last_day::text AS last_day FROM app.maintenance WHERE id`,
  )
  if (!force && before.rows[0]?.last_day === today) return false

  const client = await pool.connect()
  let locked = false
  try {
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
      [LOCK_KEY],
    )
    locked = lock.rows[0]?.locked ?? false
    if (!locked) return false

    // Re-check under the lock: another instance may have finished meanwhile.
    const after = await client.query<{ last_day: string | null }>(
      `SELECT last_day::text AS last_day FROM app.maintenance WHERE id`,
    )
    if (!force && after.rows[0]?.last_day === today) return false

    await client.query('BEGIN')

    // Fold finished days into the rollup, then drop the per-word rows. new /
    // review come from user_word_stats.met_at, so pruning cannot change them.
    await client.query(
      `INSERT INTO app.user_day_stats
         (user_id, lang, day, learned, exposed, reveals, new_words, review_words)
       SELECT d.user_id, d.lang, d.day,
              (count(*) FILTER (WHERE d.met > 0))::int,
              (count(*) FILTER (WHERE d.exposed > 0))::int,
              COALESCE(sum(d.met), 0)::int,
              (count(*) FILTER (WHERE d.met > 0 AND s.met_at::date = d.day))::int,
              (count(*) FILTER (WHERE d.met > 0 AND s.met_at::date < d.day))::int
         FROM app.user_word_daily d
         JOIN app.user_word_stats s
           ON s.user_id = d.user_id AND s.lang = d.lang AND s.word = d.word
        WHERE d.day < CURRENT_DATE - ($1::int - 1)
        GROUP BY d.user_id, d.lang, d.day
       ON CONFLICT (user_id, lang, day) DO UPDATE SET
         learned = excluded.learned,
         exposed = excluded.exposed,
         reveals = excluded.reveals,
         new_words = excluded.new_words,
         review_words = excluded.review_words`,
      [DETAIL_DAYS],
    )
    await client.query(
      `DELETE FROM app.user_word_daily WHERE day < CURRENT_DATE - ($1::int - 1)`,
      [DETAIL_DAYS],
    )

    // Per-round working sets / aggregates only matter while the round is live.
    await client.query(
      `DELETE FROM app.user_round_words WHERE created_at < now() - interval '7 days'`,
    )
    await client.query(
      `DELETE FROM app.user_rounds WHERE day < CURRENT_DATE - ($1::int - 1)`,
      [DETAIL_DAYS],
    )

    // Expiry / retention.
    await client.query(`DELETE FROM app.sessions WHERE expires_at < now()`)
    await client.query(
      `DELETE FROM app.login_attempts
        WHERE attempted_at < now() - ($1::int * interval '1 day')`,
      [RETENTION_DAYS],
    )
    await client.query(
      `DELETE FROM app.users
        WHERE is_guest AND last_seen_at < now() - ($1::int * interval '1 day')`,
      [RETENTION_DAYS],
    )

    await client.query(
      `UPDATE app.maintenance SET last_day = $1::date, ran_at = now() WHERE id`,
      [today],
    )

    await client.query('COMMIT')
    return true
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    if (locked) {
      await client
        .query(`SELECT pg_advisory_unlock(hashtext($1))`, [LOCK_KEY])
        .catch(() => {})
    }
    client.release()
  }
}

const CHECK_INTERVAL_MS = 5 * 60 * 1000

/** Run once on boot, then poll every few minutes for a logical-day rollover. */
export function startMaintenance(): void {
  const run = () => {
    runMaintenance().catch((e) => console.error('[maintenance]', e))
  }
  run()
  setInterval(run, CHECK_INTERVAL_MS).unref()
}
