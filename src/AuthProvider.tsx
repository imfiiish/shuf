import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import * as api from './api/auth'
import { clearBooksCache } from './api/books'
import { clearRoundCache } from './api/study'
import { clearProgressCache } from './progress/useProgress'
import { AuthContext, type AuthCtx, type AuthUser } from './auth'

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  // Resume an existing session on load.
  useEffect(() => {
    let alive = true
    api.fetchMe().then((u) => {
      if (!alive) return
      setUser(u)
      setReady(true)
    })
    return () => {
      alive = false
    }
  }, [])

  const login = useCallback(async (username: string, pin: string) => {
    const u = await api.login(username, pin)
    clearBooksCache()
    clearProgressCache()
    clearRoundCache()
    setUser(u)
    return u
  }, [])

  const register = useCallback(async (username: string, pin: string) => {
    const u = await api.register(username, pin)
    clearProgressCache()
    clearRoundCache()
    setUser(u)
    return u
  }, [])

  const enterAsGuest = useCallback(async () => {
    const u = await api.enterAsGuest()
    setUser(u)
    return u
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    clearBooksCache()
    clearProgressCache()
    clearRoundCache()
    setUser(null)
  }, [])

  const value = useMemo<AuthCtx>(
    () => ({ user, ready, login, register, enterAsGuest, logout }),
    [user, ready, login, register, enterAsGuest, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
