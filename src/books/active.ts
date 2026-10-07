// Which wordbook the user is currently studying. Kept in localStorage so Home
// knows it; the study route carries the id in the URL too.

const KEY = 'active-book'

export const DEFAULT_BOOK = 'en-cet4'

export function getActiveBook(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_BOOK
  } catch {
    return DEFAULT_BOOK
  }
}

/** The stored value, or null if this browser never set one. */
export function storedActiveBook(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setActiveBook(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // ignore
  }
}
