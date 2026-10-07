import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { pool } from './db.ts'
import { hashPin, hashToken, newToken, verifyPin } from './pin.ts'

const COOKIE = 'sf_session'
const SESSION_DAYS = 30
const SESSION_SEC = SESSION_DAYS * 24 * 60 * 60

// A 4-digit PIN has only 10k values, so failures are throttled per username.
const MAX_ATTEMPTS = 5
const ATTEMPT_WINDOW = '15 minutes'

const USERNAME_RE = /^[a-z][a-z0-9]{2,19}$/
const PIN_RE = /^\d{4}$/

export type AuthUser = {
  id: number
  isGuest: boolean
  username: string | null
  displayName: string
}

type UserRow = {
  [column: string]: unknown
  id: number | string
  is_guest: boolean
  username: string | null
  display_name: string
  pin_hash?: string | null
}

function shape(row: UserRow): AuthUser {
  return {
    id: Number(row.id),
    isGuest: row.is_guest,
    username: row.username,
    displayName: row.display_name,
  }
}

function clientIp(c: Context): string | null {
  try {
    return getConnInfo(c).remote.address ?? null
  } catch {
    return null
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === '23505'
  )
}

async function readBody(
  c: Context,
): Promise<{ username?: unknown; pin?: unknown } | null> {
  try {
    return (await c.req.json()) as { username?: unknown; pin?: unknown }
  } catch {
    return null
  }
}

/** Create a session row and hand the raw token to the client as a cookie. */
async function startSession(c: Context, userId: number): Promise<void> {
  const token = newToken()
  const expires = new Date(Date.now() + SESSION_SEC * 1000)
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userId,
      hashToken(token),
      expires,
      c.req.header('user-agent') ?? null,
      clientIp(c),
    ],
  )
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_SEC,
    secure: process.env.NODE_ENV === 'production',
  })
}

/** Resolve the cookie to a user, refreshing the session/seen timestamps. */
export async function currentUser(c: Context): Promise<AuthUser | null> {
  const token = getCookie(c, COOKIE)
  if (!token) return null
  const hash = hashToken(token)
  const { rows } = await pool.query<UserRow>(
    `SELECT u.id, u.is_guest, u.username, u.display_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hash],
  )
  const row = rows[0]
  if (!row) return null
  void pool
    .query(`UPDATE sessions SET last_used_at = now() WHERE token_hash = $1`, [hash])
    .catch(() => {})
  void pool
    .query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [row.id])
    .catch(() => {})
  return shape(row)
}

export async function currentUserId(c: Context): Promise<number | null> {
  const user = await currentUser(c)
  return user?.id ?? null
}

const auth = new Hono()

auth.get('/me', async (c) => {
  const user = await currentUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  return c.json({ user })
})

/** "Just browsing": a throwaway account that can be upgraded to a real one. */
auth.post('/guest', async (c) => {
  const existing = await currentUser(c)
  if (existing) return c.json({ user: existing })

  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (is_guest, display_name)
     VALUES (true, 'Guest')
     RETURNING id, is_guest, username, display_name`,
  )
  const user = shape(rows[0]!)
  await startSession(c, user.id)
  return c.json({ user }, 201)
})

auth.post('/register', async (c) => {
  const body = await readBody(c)
  const username =
    typeof body?.username === 'string' ? body.username.toLowerCase() : ''
  const pin = typeof body?.pin === 'string' ? body.pin : ''
  if (!USERNAME_RE.test(username)) {
    return c.json({ error: 'invalid_username' }, 400)
  }
  if (!PIN_RE.test(pin)) return c.json({ error: 'invalid_pin' }, 400)

  const pinHash = await hashPin(pin)
  const current = await currentUser(c)

  try {
    // A guest upgrading keeps its id, so anything pointing at it survives.
    if (current?.isGuest) {
      const { rows } = await pool.query<UserRow>(
        `UPDATE users
            SET is_guest = false, username = $2, pin_hash = $3, display_name = $2
          WHERE id = $1
          RETURNING id, is_guest, username, display_name`,
        [current.id, username, pinHash],
      )
      return c.json({ user: shape(rows[0]!) })
    }

    const { rows } = await pool.query<UserRow>(
      `INSERT INTO users (is_guest, username, pin_hash, display_name)
       VALUES (false, $1, $2, $1)
       RETURNING id, is_guest, username, display_name`,
      [username, pinHash],
    )
    const user = shape(rows[0]!)
    await startSession(c, user.id)
    return c.json({ user }, 201)
  } catch (e) {
    if (isUniqueViolation(e)) {
      return c.json({ error: 'username_taken' }, 409)
    }
    throw e
  }
})

auth.post('/login', async (c) => {
  const body = await readBody(c)
  const username =
    typeof body?.username === 'string' ? body.username.toLowerCase() : ''
  const pin = typeof body?.pin === 'string' ? body.pin : ''
  if (!username || !PIN_RE.test(pin)) {
    return c.json({ error: 'invalid_credentials' }, 401)
  }

  const ip = clientIp(c)
  const { rows: recent } = await pool.query(
    `SELECT count(*)::int AS n
       FROM login_attempts
      WHERE username = $1 AND NOT ok
        AND attempted_at > now() - interval '${ATTEMPT_WINDOW}'`,
    [username],
  )
  if ((recent[0]?.n ?? 0) >= MAX_ATTEMPTS) {
    return c.json({ error: 'too_many_attempts' }, 429)
  }

  const { rows } = await pool.query<UserRow>(
    `SELECT id, is_guest, username, display_name, pin_hash
       FROM users
      WHERE username = $1 AND NOT is_guest`,
    [username],
  )
  const row = rows[0]
  const ok = row ? await verifyPin(pin, row.pin_hash ?? null) : false

  await pool.query(
    `INSERT INTO login_attempts (username, ip, ok) VALUES ($1, $2, $3)`,
    [username, ip, ok],
  )

  if (!row || !ok) return c.json({ error: 'invalid_credentials' }, 401)

  const user = shape(row)
  await startSession(c, user.id)
  return c.json({ user })
})

auth.post('/logout', async (c) => {
  const token = getCookie(c, COOKIE)
  if (token) {
    await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [
      hashToken(token),
    ])
  }
  deleteCookie(c, COOKIE, { path: '/' })
  return c.json({ ok: true })
})

export default auth
