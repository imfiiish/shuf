// Wordbook types + the language tab list. The books themselves now come from
// the server (`GET /api/books`).

export type LangId = 'en' | 'zh' | 'ja' | 'ko'
export type Locale = 'en' | 'zh'

export type BookName = { en: string; zh: string }

/** A related list: words it covers, so it can be excluded or added. */
export type Candidate = { id: string; covers: number }

export type Book = {
  id: string
  lang: LangId
  name: BookName
  /** Effective total (after customization). */
  total: number
  /** The book's own total, before customization. */
  baseTotal?: number
  /** Words already learned (part of the total). */
  learned: number
  /** Words seen at least once — always at least `learned` (learned ⊆ exposed). */
  exposed: number
  /** Lists folded into the book by default; drop one to exclude its words. */
  excludes?: Candidate[]
  /** Extra lists that can be folded into this book on demand. */
  addons?: Candidate[]
  /** Not ready yet — shown greyed out and cannot be picked. */
  disabled?: boolean
  /** The user's saved customization. */
  custom?: { exclude: string[]; addon: string[] }
}

export const LANGS: { id: LangId; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
]
