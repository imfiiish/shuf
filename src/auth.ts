import { createContext, useContext } from 'react'
import type { AuthUser } from './api/auth'

// Auth context + hook live here (no components) so the provider file can stay
// component-only, mirroring the i18n split.

export type { AuthUser } from './api/auth'

export type AuthCtx = {
  user: AuthUser | null
  /** False until the initial /me probe has settled. */
  ready: boolean
  login: (username: string, pin: string) => Promise<AuthUser>
  register: (username: string, pin: string) => Promise<AuthUser>
  enterAsGuest: () => Promise<AuthUser>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthCtx | null>(null)

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
