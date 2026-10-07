import { lazy, Suspense, useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import { useProgress } from '../progress/useProgress'
import { useSettings } from '../settings/context'
import { getActiveBook } from '../books/active'
import { cachedBooks, fetchBooks } from '../api/books'
import { LANGS, type Book } from '../books/data'
import { LANG_COLOR } from '../books/langColor'
import UserChip from '../UserChip'
import './home.css'

// The rail charts pull in the Progress page's chart code; load them after the
// landing page so they are not on the critical path.
const HomeRail = lazy(() => import('./HomeRail'))

const fmt = (n: number) => n.toLocaleString('en-US')

/** Placeholder for the rail while its chunk and/or progress data loads. */
function RailSkeleton() {
  return (
    <>
      <section className="home-card home-rail-skel" aria-hidden="true" />
      <section className="home-card home-rail-skel" aria-hidden="true" />
    </>
  )
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h13l-3.5-3.5" />
      <path d="M20 16H7l3.5 3.5" />
    </svg>
  )
}

/** Home — left column: the wordbook being studied; right rail: today's goal
 *  gauge and the month sunburst, lifted from the Progress page. */
export default function Home({
  rail = false,
  onStudy,
  onChangeBook,
  onLogin,
}: {
  rail?: boolean
  onStudy?: () => void
  onChangeBook?: () => void
  onLogin?: () => void
}) {
  const { lang, t } = useI18n()
  const { user, logout } = useAuth()
  const { settings } = useSettings()
  const { data, ready } = useProgress()

  const [books, setBooks] = useState<Book[]>(() => cachedBooks() ?? [])
  useEffect(() => {
    let alive = true
    fetchBooks().then(
      (list) => alive && setBooks(list),
      () => {},
    )
    return () => {
      alive = false
    }
    // Refetch when the account changes so learned/exposed are for this user.
  }, [user])

  const book =
    books.find((b) => b.id === (settings.activeBook ?? getActiveBook())) ??
    books[0]
  if (!book) return null

  const name = book.name[lang]
  const langLabel = LANGS.find((l) => l.id === book.lang)?.label ?? book.lang
  const pct = book.total > 0 ? Math.round((book.learned / book.total) * 100) : 0
  const learnedPct =
    book.total > 0 ? Math.min(100, (book.learned / book.total) * 100) : 0
  const exposedPct =
    book.total > 0 ? Math.min(100, (book.exposed / book.total) * 100) : 0
  const accent = LANG_COLOR[book.lang]

  return (
    <div className={`home-page${rail ? ' home-page--rail' : ''}`}>
      <header className="home-head">
        <div className="home-head-copy">
          <h1 className="home-title">{t('nav.home')}</h1>
          <p className="home-desc">{t('scene.nav.homeSub')}</p>
        </div>
        <UserChip
          // A guest owns progress but is not an account: it looks signed out.
          // Clicking opens the login/register overlay, which upgrades the guest
          // in place (same id), so the progress collected so far is kept.
          name={user && !user.isGuest ? user.displayName : t('user.signIn')}
          signedIn={!!user && !user.isGuest}
          logoutLabel={t('user.logout')}
          onClick={onLogin}
          onLogout={() => void logout()}
        />
      </header>

      <div className="home-body">
        <main className="home-main">
          <section className="home-card home-learn">
            <header className="home-learn-head">
              <span
                className="home-learn-chip"
                style={{ background: accent }}
                aria-hidden="true"
              />
              <div className="home-learn-id">
                <span className="home-kicker">{t('books.current')}</span>
                <h2 className="home-learn-name">{name}</h2>
                <span className="home-learn-sub">
                  {langLabel} · {fmt(book.total)} {t('books.words')}
                </span>
              </div>
              <span className="home-learn-pct">{pct}%</span>
            </header>

            <div className="home-stat-row">
              <div className="home-stat">
                <span>{t('books.total')}</span>
                <b>{fmt(book.total)}</b>
              </div>
              <div className="home-stat">
                <span>{t('books.learned')}</span>
                <b>{fmt(book.learned)}</b>
              </div>
              <div className="home-stat">
                <span>{t('books.exposed')}</span>
                <b>{fmt(book.exposed)}</b>
              </div>
            </div>

            <div className="home-meter">
              <span className="home-meter-track" aria-hidden="true">
                <span
                  className="home-meter-exp"
                  style={{ width: `${exposedPct}%` }}
                />
                <span
                  className="home-meter-learn"
                  style={{ width: `${learnedPct}%` }}
                />
              </span>
              <span className="home-meter-meta">
                {fmt(book.learned)} / {fmt(book.total)} {t('books.words')}
              </span>
            </div>

            <div className="home-actions">
              <button type="button" className="home-start" onClick={onStudy}>
                <PlayIcon />
                {t('home.study')}
              </button>
              <button
                type="button"
                className="home-change"
                onClick={onChangeBook}
              >
                <SwapIcon />
                {t('home.changeBook')}
              </button>
            </div>
          </section>
        </main>

        <aside className="home-rail">
          <Suspense fallback={<RailSkeleton />}>
            {ready ? (
              <HomeRail
                value={data?.today.learned ?? 0}
                goal={settings.dailyGoal}
                languages={data?.languages ?? []}
              />
            ) : (
              <RailSkeleton />
            )}
          </Suspense>
        </aside>
      </div>
    </div>
  )
}
