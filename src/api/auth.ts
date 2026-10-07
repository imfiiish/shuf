// Auth client. Talks to the Hono server through the Vite `/api` proxy; the
// session is an httpOnly cookie, so callers never see the token.

export type AuthUser = {
  id: number
  isGuest: boolean
  username: string | null
  displayName: string
}

export type AuthErrorCode =
  | 'invalid_username'
  | 'invalid_pin'
  | 'invalid_credentials'
  | 'username_taken'
  | 'too_many_attempts'
  | 'network'
  | 'unknown'

export class AuthError extends Error {
  code: AuthErrorCode

  constructor(code: AuthErrorCode) {
    super(code)
    this.name = 'AuthError'
    this.code = code
  }
}

async function post(path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new AuthError('network')
  }
}

async function toUser(res: Response): Promise<AuthUser> {
  if (res.ok) {
    const data = (await res.json()) as { user: AuthUser }
    return data.user
  }
  let code: AuthErrorCode = 'unknown'
  try {
    const data = (await res.json()) as { error?: string }
    if (data.error) code = data.error as AuthErrorCode
  } catch {
    // non-JSON error body
  }
  throw new AuthError(code)
}

/** Current user, or null when the visitor has no valid session. */
export async function fetchMe(): Promise<AuthUser | null> {
  let res: Response
  try {
    res = await fetch('/api/auth/me', { credentials: 'include' })
  } catch {
    return null
  }
  if (!res.ok) return null
  const data = (await res.json()) as { user: AuthUser }
  return data.user
}

export async function login(username: string, pin: string): Promise<AuthUser> {
  return toUser(await post('/api/auth/login', { username, pin }))
}

export async function register(username: string, pin: string): Promise<AuthUser> {
  return toUser(await post('/api/auth/register', { username, pin }))
}

export async function enterAsGuest(): Promise<AuthUser> {
  return toUser(await post('/api/auth/guest'))
}

export async function logout(): Promise<void> {
  await post('/api/auth/logout')
}
