/** Logical day (YYYY-MM-DD) in local time; the day rolls over at 04:00. */
export function logicalDay(ms: number = Date.now()): string {
  const d = new Date(ms - 4 * 60 * 60 * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
