import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { logicalDay } from '../utils'
import {
  fetchDaily,
  fetchProgress,
  type DayActivity,
  type Progress,
} from '../api/progress'

/** The full progress read model for the last `days` logical days. */
export function useProgress(days = 30): {
  data: Progress | null
  ready: boolean
} {
  const { user, ready: authReady } = useAuth()
  const [data, setData] = useState<Progress | null>(null)

  useEffect(() => {
    if (!authReady) return
    let alive = true
    fetchProgress(logicalDay(), days).then(
      (p) => {
        if (alive) setData(p)
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [authReady, user, days])

  return { data, ready: data !== null }
}

// The Progress page and its calendar module mount together and ask for the
// same month, so share the in-flight request instead of hitting
// /api/progress/days twice. Only *concurrent* identical requests are merged
// (the entry is dropped once it settles), so a later mount still gets fresh
// data. The user id is part of the key so an account switch cannot reuse it.
const dailyInflight = new Map<string, Promise<DayActivity[]>>()

function loadDaily(
  userId: number | null,
  from: string,
  to: string,
): Promise<DayActivity[]> {
  const key = `${userId ?? 0}|${from}|${to}`
  const existing = dailyInflight.get(key)
  if (existing) return existing
  const p = fetchDaily(from, to).finally(() => dailyInflight.delete(key))
  dailyInflight.set(key, p)
  return p
}

/** Per-day activity for a date range, keyed by logical day (calendar). */
export function useDaily(from: string, to: string): Map<string, DayActivity> {
  const { user, ready: authReady } = useAuth()
  const [days, setDays] = useState<DayActivity[]>([])

  useEffect(() => {
    if (!authReady) return
    let alive = true
    loadDaily(user?.id ?? null, from, to).then(
      (d) => {
        if (alive) setDays(d)
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [authReady, user, from, to])

  return useMemo(() => new Map(days.map((d) => [d.day, d])), [days])
}
