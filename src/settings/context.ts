import { createContext, useContext } from 'react'
import type { Settings } from '../api/settings'

// Settings context + hook (no components) so the provider can stay
// component-only, mirroring the i18n / auth split.

export const DEFAULT_SETTINGS: Settings = {
  dailyGoal: 25,
  mix: 'default',
  roundSize: 16,
  activeBook: null,
}

export type SettingsCtx = {
  settings: Settings
  /** False until the first load has settled. */
  ready: boolean
  update: (patch: Partial<Settings>) => Promise<void>
}

export const SettingsContext = createContext<SettingsCtx | null>(null)

export function useSettings(): SettingsCtx {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
