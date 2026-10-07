import type { Book } from '../books/data'

export type BookCustom = { exclude: string[]; addon: string[] }

// Last fetched list, so a page can render immediately when it remounts on
// navigation (avoids a blank flash while the request is in flight). Persisted
// to localStorage so a full reload renders the wordbooks at once too; the
// fresh copy replaces it in the background.
const CACHE_KEY = 'shuf-flip-books'
let booksCache: Book[] | null = null

export function cachedBooks(): Book[] | null {
  if (booksCache) return booksCache
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) booksCache = JSON.parse(raw) as Book[]
  } catch {
    // corrupt or unavailable storage: just load from the network
  }
  return booksCache
}

/** Drop the cached list so another account's learned/exposed never flashes. */
export function clearBooksCache(): void {
  booksCache = null
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // unavailable storage: nothing to clear
  }
}

/** Every wordbook with live totals, progress and the user's customization. */
export async function fetchBooks(): Promise<Book[]> {
  const res = await fetch('/api/books', {
    credentials: 'include',
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { items: Book[] }
  booksCache = data.items
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data.items))
  } catch {
    // quota / private mode: the in-memory copy is enough
  }
  return data.items
}

/** The saved customization for one book. */
export async function fetchCustom(book: string): Promise<BookCustom> {
  const params = new URLSearchParams({ book })
  const res = await fetch(`/api/books/custom?${params}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { custom: BookCustom }
  return data.custom
}

export async function saveCustom(
  book: string,
  custom: BookCustom,
): Promise<BookCustom> {
  const res = await fetch('/api/books/custom', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ book, ...custom }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { custom: BookCustom }
  return data.custom
}
