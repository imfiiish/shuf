import type { CardData } from '../flip/FlipCard'

// Study dealing. The server owns the cascading-window sampling; the client
// just asks for a round and renders it.

export type RawCard = {
  word: string
  phonetic: string | null
  senses: unknown
  tags: string[]
  sound: string | null
}

export type Mix = 'default' | 'faster' | 'moreReview'

export type StudyRound = {
  book: string
  lang: string
  name: { en: string; zh: string }
  roundSeq: number
  roundSize: number
  mix: Mix
  total: number
  words: string[]
  lastWord: string | null
  items: RawCard[]
}

export type RoundOptions = {
  roundSize?: number
  mix?: Mix
}

async function deal(
  book: string,
  advance: boolean,
  opts?: RoundOptions,
): Promise<Response> {
  return fetch('/api/study/round', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ book, advance, ...opts }),
  })
}

// The current round per book, plus the in-flight deal, so Home can warm it and
// the study page paints without waiting (a double mount shares one request).
const roundCache = new Map<string, StudyRound>()
const roundInflight = new Map<string, Promise<StudyRound>>()

/** The last dealt (current) round for a book, if any. */
export function cachedRound(book: string): StudyRound | null {
  return roundCache.get(book) ?? null
}

/** Forget every cached round (logout / account switch). */
export function clearRoundCache(): void {
  roundCache.clear()
  roundInflight.clear()
}

/** Deal the current round, sharing an in-flight request and caching it. */
export function ensureRound(book: string): Promise<StudyRound> {
  const cached = roundCache.get(book)
  if (cached) return Promise.resolve(cached)
  const inflight = roundInflight.get(book)
  if (inflight) return inflight
  const p = fetchRound(book).finally(() => roundInflight.delete(book))
  roundInflight.set(book, p)
  return p
}

/** Warm the current round in the background so entering study does not wait. */
export function prefetchRound(book: string): void {
  if (roundCache.has(book) || roundInflight.has(book)) return
  void ensureRound(book).catch(() => {})
}

/** Deal the current round; `advance` moves on to the next one. */
export async function fetchRound(
  book: string,
  advance = false,
  opts?: RoundOptions,
): Promise<StudyRound> {
  const res = await deal(book, advance, opts)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const round = (await res.json()) as StudyRound
  roundCache.set(book, round)
  return round
}

function toDefs(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    const list = v.filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    )
    return list.length ? list.slice(0, 5) : undefined
  }
  if (typeof v === 'string' && v.length > 0) return [v]
  return undefined
}

/**
 * Server senses are per-language JSON (zh/en strings or arrays, plus Korean
 * objects); fold them into the card's { pos?, defs } shape.
 */
function normalizeSenses(raw: unknown): { pos?: string; defs: string[] }[] {
  if (!Array.isArray(raw)) return []
  const out: { pos?: string; defs: string[] }[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    const defs = toDefs(s.zh) ?? toDefs(s.en) ?? toDefs(s.defs)
    if (!defs) continue
    const pos = typeof s.pos === 'string' ? s.pos : undefined
    out.push(pos ? { pos, defs } : { defs })
    if (out.length >= 4) break
  }
  return out
}

export function toCards(items: RawCard[]): CardData[] {
  return items.map((it) => ({
    word: it.word,
    phonetic: it.phonetic ?? '',
    senses: normalizeSenses(it.senses),
    tags: it.tags ?? [],
    sound: it.sound ?? null,
  }))
}

/**
 * Record what was seen (exposed) / learned (met). Idempotent-ish: counters
 * add. Returns today's distinct revealed total, so the caller can check a
 * milestone without a follow-up /api/progress request.
 */
export async function saveProgress(
  book: string,
  roundSeq: number,
  day: string,
  exposed: string[],
  met: Record<string, number>,
  lastWord: string | null,
): Promise<number> {
  const res = await fetch('/api/study/progress', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ book, roundSeq, day, exposed, met, lastWord }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { learned?: number }
  return data.learned ?? 0
}

/** Best-effort send on page hide, which survives the unload. */
export function saveProgressBeacon(
  book: string,
  roundSeq: number,
  day: string,
  exposed: string[],
  met: Record<string, number>,
  lastWord: string | null,
): void {
  if (exposed.length === 0 && Object.keys(met).length === 0 && !lastWord) return
  try {
    void fetch('/api/study/progress', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ book, roundSeq, day, exposed, met, lastWord }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // ignore
  }
}
