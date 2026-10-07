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

/** Per-day activity for a date range, keyed by logical day (calendar). */
export function useDaily(from: string, to: string): Map<string, DayActivity> {
  const { user, ready: authReady } = useAuth()
  const [days, setDays] = useState<DayActivity[]>([])

  useEffect(() => {
    if (!authReady) return
    let alive = true
    fetchDaily(from, to).then(
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
