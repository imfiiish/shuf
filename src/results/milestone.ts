// Results appears when the day's distinct revealed words reach a milestone:
// 5, 20, 50, 200 (new or review, deduped). The day resets at the 04:00 logical
// boundary, so the highest milestone already celebrated is stored with its day.

export const MILESTONES = [5, 20, 50, 200]

const KEY = 'results-milestone'

type State = { day: string; shown: number }

/** Per-account key: switching account (or dropping to a fresh guest) must not
 *  inherit the previous account's celebrated milestone, or the next Results
 *  would be suppressed. */
function keyFor(userId: number | null): string {
  return `${KEY}:${userId ?? 'anon'}`
}

/** Highest milestone already celebrated for `day` (0 if none). */
export function shownMilestone(day: string, userId: number | null): number {
  try {
    const raw = localStorage.getItem(keyFor(userId))
    if (!raw) return 0
    const s = JSON.parse(raw) as State
    return s.day === day ? s.shown : 0
  } catch {
    return 0
  }
}

export function setShownMilestone(
  day: string,
  shown: number,
  userId: number | null,
): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify({ day, shown }))
  } catch {
    // ignore
  }
}

/** Highest milestone `total` has reached (0 if below the first). */
export function reachedMilestone(total: number): number {
  let m = 0
  for (const t of MILESTONES) if (t <= total) m = t
  return m
}
