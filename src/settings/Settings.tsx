import { useNavigate } from 'react-router-dom'
import { useI18n, type Lang } from '../i18n'
import type { Mix } from '../api/study'
import type { Settings } from '../api/settings'
import { useAuth } from '../auth'
import { useSettings } from './context'
import './settings.css'

/** Words / day presets. */
const GOALS = [15, 25, 50]

/** Custom goal bounds. */
const MIN_GOAL = 5
const MAX_GOAL = 200

const clampGoal = (n: number) =>
  Math.max(MIN_GOAL, Math.min(MAX_GOAL, Math.round(n)))

/** Preview of today's progress toward the goal (appearance only). */
const TODAY = 12

/** Review / new balance presets. Values match the server's `mix`. */
const MIX: {
  value: Mix
  labelKey: string
  new: number
  review: number
  note: string
}[] = [
  {
    value: 'moreReview',
    labelKey: 'settings.mix.moreReview',
    new: 35,
    review: 65,
    note: '注释1',
  },
  {
    value: 'default',
    labelKey: 'settings.mix.default',
    new: 50,
    review: 50,
    note: '注释2',
  },
  {
    value: 'faster',
    labelKey: 'settings.mix.faster',
    new: 65,
    review: 35,
    note: '注释3',
  },
]

const ROUNDS = ['8', '16']

type Option = { value: string; label: string; disabled?: boolean }

/** A pill segmented control. */
function Seg({
  value,
  options,
  onChange,
}: {
  value: string
  options: Option[]
  onChange: (v: string) => void
}) {
  return (
    <div className="set-seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? 'on' : ''}
          aria-pressed={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Creative: study preferences — appearance only, held in local state. */
export default function Settings({ rail = false }: { rail?: boolean }) {
  const { t, lang, setLang } = useI18n()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { settings, update } = useSettings()
  const goal = settings.dailyGoal
  const round = String(settings.roundSize)

  // only English / Chinese are ready — Japanese is still in development
  const LANGS: Option[] = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文' },
    { value: 'ja', label: t('settings.lang.developing'), disabled: true },
  ]

  // Settings are saved to the account — a guest must sign in first.
  const changeSetting = (patch: Partial<Settings>) => {
    if (!user) {
      navigate('/login', { state: { from: '/settings' } })
      return
    }
    void update(patch)
  }

  const applyGoal = (n: number) => changeSetting({ dailyGoal: clampGoal(n) })
  const bumpGoal = (d: number) => changeSetting({ dailyGoal: clampGoal(goal + d) })

  const goalPct = Math.min(100, (TODAY / Math.max(1, goal)) * 100)

  return (
    <div className={`set-page${rail ? ' set-page--rail' : ''}`}>
      <header className="set-head">
        <h1 className="set-title">{t('settings.title')}</h1>
        <p className="set-desc">{t('settings.desc')}</p>
      </header>

      <div className="set-body">
        {/* daily goal */}
        <section className="set-card set-card-split">
          <div className="set-card-head">
            <div>
              <h2 className="set-card-title">{t('settings.goal.title')}</h2>
              <p className="set-card-desc">{t('settings.goal.desc')}</p>
            </div>
          </div>

          <div className="set-goal-body">
            <div className="set-goal-top">
              <div className="set-goal-value">
                <b className="set-goal-num">{goal}</b>
                <span className="set-goal-unit">
                  {t('settings.goal.unit')}
                </span>
              </div>
              <div className="set-stepgroup" role="group">
                <button
                  type="button"
                  className="set-stepgroup-btn"
                  aria-label={t('settings.goal.less')}
                  onClick={() => bumpGoal(-5)}
                >
                  {'\u2212'}
                </button>
                <span className="set-stepgroup-sep" aria-hidden="true" />
                <button
                  type="button"
                  className="set-stepgroup-btn"
                  aria-label={t('settings.goal.more')}
                  onClick={() => bumpGoal(5)}
                >
                  +
                </button>
              </div>
            </div>

            <div className="set-meter">
              <span
                className="set-meter-fill"
                style={{ width: `${goalPct}%` }}
              />
            </div>
            <div className="set-goal-foot">
              <span>
                {t('settings.goal.today')} · <b>{TODAY}</b> / {goal}
              </span>
              <span className="set-goal-pct">{Math.round(goalPct)}%</span>
            </div>

            <div className="set-seg">
              {GOALS.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={g === goal ? 'on' : ''}
                  aria-pressed={g === goal}
                  onClick={() => applyGoal(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* new vs review */}
        <section className="set-card">
          <div className="set-card-head">
            <div>
              <h2 className="set-card-title">{t('settings.mix.title')}</h2>
              <p className="set-card-desc">{t('settings.mix.desc')}</p>
            </div>
          </div>

          <div
            className="set-choices"
            role="radiogroup"
            aria-label={t('settings.mix.title')}
          >
            {MIX.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={settings.mix === o.value}
                className={`set-choice${settings.mix === o.value ? ' on' : ''}`}
                onClick={() => changeSetting({ mix: o.value })}
              >
                <span className="set-choice-head">
                  <span className="set-choice-radio" aria-hidden="true" />
                  <span className="set-choice-label">{t(o.labelKey)}</span>
                </span>
                <span className="set-choice-bar" aria-hidden="true">
                  <span className="review" style={{ flexGrow: o.review }} />
                  <span className="new" style={{ flexGrow: o.new }} />
                </span>
                <span className="set-choice-note">{o.note}</span>
              </button>
            ))}
          </div>
        </section>

        {/* round size + language */}
        <div className="set-grid">
          <section className="set-card">
            <div className="set-card-head">
              <div>
                <h2 className="set-card-title">{t('settings.round.title')}</h2>
                <p className="set-card-desc">{t('settings.round.desc')}</p>
              </div>
            </div>
            <Seg
              value={round}
              onChange={(v) => changeSetting({ roundSize: Number(v) })}
              options={ROUNDS.map((r) => ({
                value: r,
                label: `${r} ${t('settings.round.unit')}`,
              }))}
            />
          </section>

          <section className="set-card">
            <div className="set-card-head">
              <div>
                <h2 className="set-card-title">{t('settings.lang.title')}</h2>
                <p className="set-card-desc">{t('settings.lang.desc')}</p>
              </div>
            </div>
            <Seg
              value={lang}
              onChange={(v) => setLang(v as Lang)}
              options={LANGS}
            />
          </section>
        </div>
      </div>

      <p className="set-note">{t('settings.note')}</p>
    </div>
  )
}
