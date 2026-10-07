import { Hono } from 'hono'
import { currentUserId } from './auth.ts'
import { pool } from './db.ts'
import {
  DEFAULT_MIX,
  DEFAULT_ROUND_SIZE,
  MIXES,
  ROUND_SIZES,
  type Mix,
} from './sampling.ts'

// Per-user study preferences. The study route reads these so the server is the
// source of truth for round size and the new/review mix. `activeBook` (the
// wordbook being studied) is synced here so it follows the account.

export type Settings = {
  dailyGoal: number
  mix: Mix
  roundSize: number
  activeBook: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  dailyGoal: 25,
  mix: DEFAULT_MIX,
  roundSize: DEFAULT_ROUND_SIZE,
  activeBook: null,
}

type SettingsRow = {
  [k: string]: unknown
  daily_goal: number
  mix: string
  round_size: number
  active_book: string | null
}

function clampGoal(n: unknown): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return DEFAULT_SETTINGS.dailyGoal
  return Math.max(1, Math.min(1000, v))
}

function pickMix(v: unknown): Mix {
  return typeof v === 'string' && (MIXES as readonly string[]).includes(v)
    ? (v as Mix)
    : DEFAULT_MIX
}

function pickRoundSize(v: unknown): number {
  const n = Math.round(Number(v))
  return (ROUND_SIZES as readonly number[]).includes(n)
    ? n
    : DEFAULT_ROUND_SIZE
}

function pickBook(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

export async function getSettings(userId: number): Promise<Settings> {
  const { rows } = await pool.query<SettingsRow>(
    `SELECT daily_goal, mix, round_size, active_book
       FROM user_settings WHERE user_id = $1`,
    [userId],
  )
  const row = rows[0]
  if (!row) return { ...DEFAULT_SETTINGS }
  return {
    dailyGoal: clampGoal(row.daily_goal),
    mix: pickMix(row.mix),
    roundSize: pickRoundSize(row.round_size),
    activeBook: pickBook(row.active_book),
  }
}

const settings = new Hono()

settings.get('/', async (c) => {
  const userId = await currentUserId(c)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)
  return c.json({ settings: await getSettings(userId) })
})

/** Partial update: only the keys present in the body are changed. */
settings.put('/', async (c) => {
  const userId = await currentUserId(c)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)

  const body = (await c.req.json().catch(() => null)) as {
    dailyGoal?: unknown
    mix?: unknown
    roundSize?: unknown
    activeBook?: unknown
  } | null
  if (!body) return c.json({ error: 'invalid' }, 400)

  const current = await getSettings(userId)
  const next: Settings = {
    dailyGoal:
      body.dailyGoal === undefined ? current.dailyGoal : clampGoal(body.dailyGoal),
    mix: body.mix === undefined ? current.mix : pickMix(body.mix),
    roundSize:
      body.roundSize === undefined
        ? current.roundSize
        : pickRoundSize(body.roundSize),
    activeBook:
      body.activeBook === undefined
        ? current.activeBook
        : pickBook(body.activeBook),
  }

  await pool.query(
    `INSERT INTO user_settings
       (user_id, daily_goal, mix, round_size, active_book, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET
       daily_goal = excluded.daily_goal,
       mix = excluded.mix,
       round_size = excluded.round_size,
       active_book = excluded.active_book,
       updated_at = now()`,
    [userId, next.dailyGoal, next.mix, next.roundSize, next.activeBook],
  )
  return c.json({ settings: next })
})

export default settings
