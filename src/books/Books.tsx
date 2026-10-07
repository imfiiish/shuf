import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import { cachedBooks, fetchBooks, saveCustom } from '../api/books'
import { LANGS, type Book, type LangId } from './data'
import { getActiveBook, setActiveBook } from './active'
import { useSettings } from '../settings/context'
import { LANG_COLOR } from './langColor'
import './books.css'

const fmt = (n: number) => n.toLocaleString('en-US')
const pctOf = (b: Book) => Math.round((b.learned / b.total) * 100)

function Check() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function Sliders() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="8" r="2.4" />
      <circle cx="15" cy="16" r="2.4" />
    </svg>
  )
}

/** The Wordbooks page. The left panel is the picked list — total / learned /
 *  exposed, a study action and a customize dialog; the right rail is the
 *  index of every list. Appearance + local state only. */
export default function Books({ rail = false }: { rail?: boolean }) {
  const { lang, t } = useI18n()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { settings, update } = useSettings()
  const [books, setBooks] = useState<Book[]>(() => cachedBooks() ?? [])
  const [tab, setTab] = useState<LangId>('en')
  const [pickedId, setPickedId] = useState(getActiveBook)
  const [cut, setCut] = useState<string[]>([])
  const [added, setAdded] = useState<string[]>([])
  const [dialog, setDialog] = useState(false)
  const [closingDialog, setClosingDialog] = useState(false)

  const closeDialog = () => {
    setClosingDialog(true)
    window.setTimeout(() => {
      setDialog(false)
      setClosingDialog(false)
    }, 260)
  }

  useEffect(() => {
    let alive = true
    fetchBooks().then(
      (list) => alive && setBooks(list),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [])

  const list = books.filter((b) => b.lang === tab)
  const picked = books.find((b) => b.id === pickedId) ?? list[0]

  const nameOf = (b: Book) => b.name[lang]
  const nameById = (id: string) => {
    const b = books.find((x) => x.id === id)
    return b ? nameOf(b) : id
  }
  const langLabel = (id: LangId) => LANGS.find((l) => l.id === id)?.label ?? id

  const pickLang = (id: LangId) => {
    setTab(id)
    setCut([])
    setAdded([])
    const first = books.find((b) => b.lang === id)
    if (first) setPickedId(first.id)
  }

  const pickBook = (b: Book) => {
    setPickedId(b.id)
    setCut([])
    setAdded([])
  }

  if (!picked) return null

  const active = settings.activeBook ?? getActiveBook()
  const learning = active === picked.id
  const excludes = picked.excludes ?? []
  const addons = picked.addons ?? []
  const baseTotal = picked.baseTotal ?? picked.total
  const delta = picked.total - baseTotal
  const accent = LANG_COLOR[picked.lang]
  const learnedPct =
    picked.total > 0 ? Math.min(100, (picked.learned / picked.total) * 100) : 0
  const exposedPct =
    picked.total > 0 ? Math.min(100, (picked.exposed / picked.total) * 100) : 0

  // Persist a customization and refresh the totals/progress.
  const persist = (exclude: string[], addon: string[]) => {
    void saveCustom(picked.id, { exclude, addon }).then(
      () =>
        fetchBooks().then(
          (list) => setBooks(list),
          () => {},
        ),
      () => {},
    )
  }
  const toggleCut = (id: string) => {
    const next = cut.includes(id) ? cut.filter((x) => x !== id) : [...cut, id]
    setCut(next)
    persist(next, added)
  }
  const toggleAdded = (id: string) => {
    const next = added.includes(id)
      ? added.filter((x) => x !== id)
      : [...added, id]
    setAdded(next)
    persist(cut, next)
  }
  const openDialog = () => {
    // Customization is saved to the account, so a guest must sign in first.
    if (!user || user.isGuest) {
      navigate('/login', { state: { from: '/books' } })
      return
    }
    setCut(picked.custom?.exclude ?? [])
    setAdded(picked.custom?.addon ?? [])
    setDialog(true)
  }

  const startBook = () => {
    // Clicking the book that is already being studied goes back Home.
    if (learning) {
      navigate('/')
      return
    }
    setActiveBook(picked.id)
    void update({ activeBook: picked.id })
  }

  return (
    <div className={`bi-page${rail ? ' bi-page--rail' : ''}`}>
      <header className="bi-head">
        <div className="bi-head-copy">
          <h1 className="bi-title">{t('books.title')}</h1>
          <p className="bi-desc">{t('books.desc')}</p>
        </div>
        <div className="bi-langs" role="tablist" aria-label={t('books.title')}>
          {LANGS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={tab === l.id}
              className={`bi-lang${tab === l.id ? ' on' : ''}`}
              onClick={() => pickLang(l.id)}
            >
              {l.label}
              <em>{books.filter((b) => b.lang === l.id).length}</em>
            </button>
          ))}
        </div>
      </header>

      <div className="bi-body">
        {/* the picked list */}
        <main className="bi-sheet">
          <header className="bi-sheet-head">
            <span
              className="bi-chip"
              style={{ background: accent }}
              aria-hidden="true"
            />
            <div className="bi-sheet-id">
              <span className="bi-kicker">{t('books.current')}</span>
              <h2 className="bi-name">{nameOf(picked)}</h2>
              <span className="bi-sub">
                {langLabel(picked.lang)} · {fmt(picked.total)}{' '}
                {t('books.words')}
              </span>
            </div>
            <span className="bi-pct">{pctOf(picked)}%</span>
          </header>

          <div className="bi-stats">
            <div className="bi-stat">
              <span>{t('books.total')}</span>
              <b>
                {fmt(baseTotal)}
                {delta > 0 && <em className="bi-delta up"> +{fmt(delta)}</em>}
                {delta < 0 && <em className="bi-delta down"> −{fmt(-delta)}</em>}
              </b>
            </div>
            <div className="bi-stat">
              <span>{t('books.learned')}</span>
              <b>{fmt(picked.learned)}</b>
            </div>
            <div className="bi-stat">
              <span>{t('books.exposed')}</span>
              <b>{fmt(picked.exposed)}</b>
            </div>
          </div>

          <div className="bi-meter">
            <span className="bi-meter-track" aria-hidden="true">
              <span
                className="bi-meter-exp"
                style={{ width: `${exposedPct}%` }}
              />
              <span
                className="bi-meter-learn"
                style={{ width: `${learnedPct}%` }}
              />
            </span>
            <span className="bi-meter-meta">
              {fmt(picked.learned)} / {fmt(picked.total)} {t('books.words')}
            </span>
          </div>

          <div className="bi-actions">
            <button
              type="button"
              className={`bi-start${learning ? ' on' : ''}`}
              aria-pressed={learning}
              onClick={startBook}
            >
              <span className="bi-start-ico" aria-hidden="true">
                {learning ? <Check /> : null}
              </span>
              {learning ? t('books.studying') : t('books.start')}
            </button>
            <button
              type="button"
              className="bi-custom"
              onClick={openDialog}
              disabled={!learning}
              title={learning ? undefined : t('books.customizeLocked')}
            >
              <Sliders />
              {t('books.customize')}
            </button>
          </div>
        </main>

        {/* the index rail */}
        <aside className="bi-rail">
          <div className="bi-rail-head">
            <span>{t('books.index.lists')}</span>
            <em>{list.length}</em>
          </div>

          <div className="bi-grid">
            {list.map((b) => {
              const on = b.id === pickedId
              const isLearning = b.id === active
              const soon = !!b.disabled
              const color = LANG_COLOR[b.lang]
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`bi-card${on ? ' on' : ''}${
                    soon ? ' bi-card--soon' : ''
                  }`}
                  aria-pressed={on}
                  disabled={soon}
                  style={{ '--accent-lang': color } as CSSProperties}
                  onClick={() => pickBook(b)}
                >
                  <span className="bi-card-top">
                    <span className="bi-card-bar" aria-hidden="true">
                      <span style={{ width: `${pctOf(b)}%` }} />
                    </span>
                    {soon ? (
                      <span className="bi-card-tag bi-card-tag--soon">
                        {t('books.developing')}
                      </span>
                    ) : (
                      isLearning && (
                        <span className="bi-card-tag">
                          {t('books.studying')}
                        </span>
                      )
                    )}
                  </span>
                  <span className="bi-card-name">{nameOf(b)}</span>
                  <span className="bi-card-foot">
                    <span className="bi-card-count">{fmt(b.total)}</span>
                    <span className="bi-card-pct">
                      {soon ? '—' : `${pctOf(b)}%`}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </aside>
      </div>

      {dialog && (
        <Modal
          onClose={closeDialog}
          ariaLabel={t('books.customize')}
          className="bi-dialog"
          closing={closingDialog}
        >
          <div className="bi-groups">
            <section className="bi-group">
              <header className="bi-group-head">
                <h3>{t('books.exclude')}</h3>
                <span className="bi-group-hint">{t('books.excludeHint')}</span>
              </header>
              {excludes.length > 0 ? (
                <ul className="bi-cands">
                  {excludes.map((c) => {
                    const on = cut.includes(c.id)
                    const b = books.find((x) => x.id === c.id)
                    const soon = !!b?.disabled
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          className={`bi-cand${on ? ' on' : ''}${
                            soon ? ' bi-cand--soon' : ''
                          }`}
                          aria-pressed={on}
                          disabled={soon}
                          style={
                            {
                              '--accent-lang': b
                                ? LANG_COLOR[b.lang]
                                : accent,
                            } as CSSProperties
                          }
                          onClick={() => toggleCut(c.id)}
                        >
                          <span className="bi-cand-top">
                            <span className="bi-cand-bar" aria-hidden="true">
                              <span
                                style={{ width: `${b ? pctOf(b) : 0}%` }}
                              />
                            </span>
                            {on && (
                              <span className="bi-cand-mark" aria-hidden="true">
                                <Check />
                              </span>
                            )}
                          </span>
                          <span className="bi-cand-name">
                            {nameById(c.id)}
                          </span>
                          <span className="bi-cand-foot">
                            <span>{b ? fmt(b.total) : ''}</span>
                            <span className="bi-cand-effect">
                              −{fmt(c.covers)}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="bi-group-empty">{t('books.noTrim')}</p>
              )}
            </section>

            <section className="bi-group">
              <header className="bi-group-head">
                <h3>{t('books.add')}</h3>
                <span className="bi-group-hint">{t('books.addHint')}</span>
              </header>
              {addons.length > 0 ? (
                <ul className="bi-cands">
                  {addons.map((c) => {
                    const on = added.includes(c.id)
                    const b = books.find((x) => x.id === c.id)
                    const soon = !!b?.disabled
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          className={`bi-cand bi-cand-add${on ? ' on' : ''}${
                            soon ? ' bi-cand--soon' : ''
                          }`}
                          aria-pressed={on}
                          disabled={soon}
                          style={
                            {
                              '--accent-lang': b
                                ? LANG_COLOR[b.lang]
                                : accent,
                            } as CSSProperties
                          }
                          onClick={() => toggleAdded(c.id)}
                        >
                          <span className="bi-cand-top">
                            <span className="bi-cand-bar" aria-hidden="true">
                              <span
                                style={{ width: `${b ? pctOf(b) : 0}%` }}
                              />
                            </span>
                            {on && (
                              <span className="bi-cand-mark" aria-hidden="true">
                                <Check />
                              </span>
                            )}
                          </span>
                          <span className="bi-cand-name">
                            {nameById(c.id)}
                          </span>
                          <span className="bi-cand-foot">
                            <span>{b ? fmt(b.total) : ''}</span>
                            <span className="bi-cand-effect">
                              +{fmt(c.covers)}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="bi-group-empty">{t('books.noAdd')}</p>
              )}
            </section>
          </div>
        </Modal>
      )}
    </div>
  )
}
