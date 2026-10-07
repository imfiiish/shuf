import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { logicalDay } from '../utils'
import {
  fetchDaily,
  fetchProgress,
  type DayActivity,
  type Progress,
} from '../api/progress'

// Home and Progress both read this model on every visit, and their entrance
// animations only look right once the numbers are there. Keep the last payload
// (per account) in memory + sessionStorage, paint it immediately, then
// revalidate in the background (stale-while-revalidate). The tab keeps it
// across a reload; a new session starts clean.
const CACHE_KEY = 'shuf-flip-progress'
type ProgressEntry = { uid: number | null; data: Progress }
let progressCache: ProgressEntry | null = null

function readProgressCache(): ProgressEntry | null {
  if (progressCache) return progressCache
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (raw) progressCache = JSON.parse(raw) as ProgressEntry
  } catch {
    // corrupt or unavailable storage: just load from the network
  }
  return progressCache
}

/** Drop the cached payload so another account's numbers never show. */
export function clearProgressCache(): void {
  progressCache = null
  try {
    sessionStorage.removeItem(CACHE_KEY)
  } catch {
    // unavailable storage: nothing to clear
  }
}

/** The full progress read model. The cached copy (same account) is returned
 *  synchronously so charts animate on real values; a fresh copy follows. */
export function useProgress(): { data: Progress | null; ready: boolean } {
  const { user, ready: authReady } = useAuth()
  const uid = user?.id ?? null
  const [loaded, setLoaded] = useState<ProgressEntry | null>(readProgressCache)

  useEffect(() => {
    if (!authReady) return
    let alive = true
    fetchProgress(logicalDay()).then(
      (p) => {
        const entry: ProgressEntry = { uid, data: p }
        progressCache = entry
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry))
        } catch {
          // quota / private mode: the in-memory copy is enough
        }
        if (alive) setLoaded(entry)
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [authReady, uid])

  // Never show another account's numbers: only the entry tagged with this uid.
  const data = loaded && loaded.uid === uid ? loaded.data : null
  // A visitor with no session has no progress to wait for, so charts can show
  // their empty state at once. Account holders wait for the payload (or the
  // cache) before animating.
  const ready = authReady && (user === null || data !== null)
  return { data, ready }
}

// The Progress page and its calendar module mount together and ask for the
// same month, so share the in-flight request instead of hitting
// /api/progress/days twice, and keep the result so re-entering Progress does
// not refill the grid from scratch. The user id is part of the key so an
// account switch cannot reuse it.
const dailyCache = new Map<string, DayActivity[]>()
const dailyInflight = new Map<string, Promise<DayActivity[]>>()

function loadDaily(
  userId: number | null,
  from: string,
  to: string,
): Promise<DayActivity[]> {
  const key = `${userId ?? 0}|${from}|${to}`
  const existing = dailyInflight.get(key)
  if (existing) return existing
  const p = fetchDaily(from, to)
    .then((d) => {
      dailyCache.set(key, d)
      return d
    })
    .finally(() => dailyInflight.delete(key))
  dailyInflight.set(key, p)
  return p
}

/** Shared empty result so the memo below stays stable while unloaded. */
const EMPTY_DAYS: DayActivity[] = []

/** Per-day activity for a date range, keyed by logical day (calendar). */
export function useDaily(from: string, to: string): Map<string, DayActivity> {
  const { user, ready: authReady } = useAuth()
  const uid = user?.id ?? null
  const key = `${uid ?? 0}|${from}|${to}`
  const [loaded, setLoaded] = useState<{
    key: string
    days: DayActivity[]
  } | null>(() => {
    const days = dailyCache.get(key)
    return days ? { key, days } : null
  })

  useEffect(() => {
    if (!authReady) return
    let alive = true
    loadDaily(uid, from, to).then(
      (d) => {
        if (alive) setLoaded({ key, days: d })
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [authReady, uid, from, to, key])

  // Adopt a cached range immediately when the month changes, then let the
  // effect revalidate it.
  const days =
    loaded?.key === key ? loaded.days : (dailyCache.get(key) ?? EMPTY_DAYS)
  return useMemo(() => new Map(days.map((d) => [d.day, d])), [days])
}
