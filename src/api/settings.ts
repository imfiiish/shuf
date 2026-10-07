import type { Mix } from './study'

// Per-user study settings, persisted server-side.

export type Settings = {
  dailyGoal: number
  mix: Mix
  roundSize: number
  activeBook: string | null
}

export async function fetchSettings(): Promise<Settings> {
  const res = await fetch('/api/settings', { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { settings: Settings }
  return data.settings
}

/** Partial update: only the keys present are changed. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { settings: Settings }
  return data.settings
}
