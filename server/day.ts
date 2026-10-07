/** Logical day (YYYY-MM-DD): the day rolls over at 04:00 local time. */
export function logicalDay(now: number = Date.now()): string {
  const d = new Date(now - 4 * 60 * 60 * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Validate a client-supplied logical day. */
export function pickDay(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}
