import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchSettings, saveSettings, type Settings } from '../api/settings'
import { setActiveBook, storedActiveBook } from '../books/active'
import { useAuth } from '../auth'
import { DEFAULT_SETTINGS, SettingsContext, type SettingsCtx } from './context'

type Loaded = { userId: number; settings: Settings }

export default function SettingsProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady } = useAuth()
  // Server settings, tagged with the account they belong to (so a stale copy
  // from a previous account is never shown while the new one loads).
  const [remote, setRemote] = useState<Loaded | null>(null)
  // Used when there is no account yet (settings are local until signed in).
  const [guest, setGuest] = useState<Settings>(DEFAULT_SETTINGS)

  useEffect(() => {
    if (!authReady || !user) return
    let alive = true
    ;(async () => {
      let s: Settings
      try {
        s = await fetchSettings()
      } catch {
        if (alive) setRemote({ userId: user.id, settings: DEFAULT_SETTINGS })
        return
      }

      if (!s.activeBook) {
        // First login on a fresh account: adopt the wordbook this browser had
        // (e.g. one picked while a guest), so it syncs to the account.
        const local = storedActiveBook()
        if (local) {
          try {
            s = await saveSettings({ activeBook: local })
          } catch {
            s = { ...s, activeBook: local }
          }
        }
      } else {
        // Keep the localStorage fallback consistent with the account.
        setActiveBook(s.activeBook)
      }

      if (alive) setRemote({ userId: user.id, settings: s })
    })()
    return () => {
      alive = false
    }
  }, [authReady, user])

  const settings = user
    ? remote?.userId === user.id
      ? remote.settings
      : DEFAULT_SETTINGS
    : guest
  const ready = !authReady ? false : user ? remote?.userId === user.id : true

  const update = useCallback(
    async (patch: Partial<Settings>) => {
      if (!user) {
        setGuest((s) => ({ ...s, ...patch }))
        return
      }
      // Optimistic; the server reply is the truth.
      setRemote((r) => ({
        userId: user.id,
        settings: {
          ...(r?.userId === user.id ? r.settings : DEFAULT_SETTINGS),
          ...patch,
        },
      }))
      try {
        const saved = await saveSettings(patch)
        setRemote({ userId: user.id, settings: saved })
      } catch {
        // keep the optimistic value; the next load will correct it
      }
    },
    [user],
  )

  const value = useMemo<SettingsCtx>(
    () => ({ settings, ready, update }),
    [settings, ready, update],
  )

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}
