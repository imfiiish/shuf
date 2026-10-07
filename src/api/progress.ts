// Progress read model. Days are logical (04:00 cutoff) and come from the client.

export type DayTotals = {
  learned: number
  exposed: number
  reveals: number
  newWords: number
  reviewWords: number
  exposedOnly: number
}

export type ProgressDay = {
  day: string
  learned: number
  exposed: number
  reveals: number
}

/** Per-round totals for the day view. */
export type RoundStat = {
  book: string
  roundSeq: number
  exposed: number
  reveals: number
}

export type Progress = {
  day: string
  today: DayTotals
  daily: ProgressDay[]
  rounds: RoundStat[]
  languages: LangBurst[]
}

/** Sunburst input: per language, status breakdown of touched words. */
export type LangBurst = {
  lang: string
  exposed: number
  before: number
  today: number
}

export async function fetchProgress(
  day: string,
  days = 30,
): Promise<Progress> {
  const params = new URLSearchParams({ day, days: String(days) })
  const res = await fetch(`/api/progress?${params}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as Progress
}

/** Per-day activity for a date range (calendar). */
export type DayActivity = {
  day: string
  learned: number
  exposed: number
  reveals: number
  new: number
  review: number
}

export async function fetchDaily(
  from: string,
  to: string,
): Promise<DayActivity[]> {
  const params = new URLSearchParams({ from, to })
  const res = await fetch(`/api/progress/days?${params}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { days: DayActivity[] }
  return data.days
}

/** Words revealed on a given day. */
export type DayWord = {
  word: string
  lang: string
  reveals: number
  kind: 'new' | 'review'
}

export async function fetchDayWords(day: string): Promise<DayWord[]> {
  const params = new URLSearchParams({ day })
  const res = await fetch(`/api/progress/words?${params}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { words: DayWord[] }
  return data.words
}
