import { useState } from 'react'
import { useI18n } from '../i18n'
import { Dual, GoalGauge, PieExplode } from './ResultCharts'
import { Sunburst } from './ProgressCharts'
import { burstFrom } from './progressBurstData'
import { CalendarModule, TodayRingLiveModule } from './ProgressModules'
import { useProgress, useDaily } from './useProgress'
import { useSettings } from '../settings/context'
import type { DayActivity } from '../api/progress'
import { DIMS, type DimKey } from './data'
import './progress.css'

const ORDER: DimKey[] = ['day', 'month']

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Current calendar month as [from, to] logical days. */
function currentMonthRange(): [string, string] {
  const d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth()
  const last = new Date(y, m + 1, 0).getDate()
  return [`${y}-${pad2(m + 1)}-01`, `${y}-${pad2(m + 1)}-${pad2(last)}`]
}

/** One {e: review, r: new} per day of the current month, zero-filled. */
function monthRounds(
  activity: Map<string, DayActivity>,
): { e: number; r: number }[] {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const last = new Date(y, m + 1, 0).getDate()
  return Array.from({ length: last }, (_, i) => {
    const a = activity.get(`${y}-${pad2(m + 1)}-${pad2(i + 1)}`)
    return { e: a?.review ?? 0, r: a?.new ?? 0 }
  })
}

/** Progress page — the charts, read at day / week / month / total zoom. */
export default function Progress({ rail = false }: { rail?: boolean }) {
  const { t } = useI18n()
  const { settings } = useSettings()
  const { data } = useProgress(30)
  const [dim, setDim] = useState<DimKey>('day')
  // Day view = one bar per dealt round (exposed / reveals).
  const dayRounds = (data?.rounds ?? []).map((r) => ({
    e: r.exposed,
    r: r.reveals,
  }))
  const burst = burstFrom(data?.languages ?? [])
  // Month view = one bar per day (review / new) for the current month.
  const [monthFrom, monthTo] = currentMonthRange()
  const month = monthRounds(useDaily(monthFrom, monthTo))
  const activeRounds = dim === 'day' ? dayRounds : month
  const deck = Math.max(1, ...activeRounds.map((r) => r.e))

  return (
    <div className={`progress-page${rail ? ' progress-page--rail' : ''}`}>
      <header className="progress-head">
        <div>
          <h1 className="progress-title">{t('progress.title')}</h1>
          <p className="progress-desc">{t('progress.desc')}</p>
        </div>
        <div className="progress-tabs" role="tablist">
          {ORDER.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={dim === k}
              className={`progress-tab${dim === k ? ' on' : ''}`}
              onClick={() => setDim(k)}
            >
              {t(DIMS[k].label)}
            </button>
          ))}
        </div>
      </header>

      <div className="progress-body">
        <main className="progress-main">
          <div className="progress-grid">
            {/* the pie only reads at the day zoom; today's numbers ride
                along on the same row */}
            {dim === 'day' && (
              <section className="progress-card">
                <PieExplode
                  newWords={data?.today.newWords ?? 0}
                  reviewWords={data?.today.reviewWords ?? 0}
                  exposed={data?.today.exposedOnly ?? 0}
                  legend={false}
                />
              </section>
            )}

            {dim === 'day' && (
              <section className="progress-card">
                <TodayRingLiveModule
                  dividers={false}
                  enterCounts
                  newCount={data?.today.newWords ?? 0}
                  reviewCount={data?.today.reviewWords ?? 0}
                />
              </section>
            )}

            <section className="progress-card progress-card-wide">
              {dim === 'day' ? (
                <Dual rounds={dayRounds} deck={deck} />
              ) : (
                <Dual
                  rounds={month}
                  deck={deck}
                  tone="study"
                  scale="shared"
                  headlineLabel="progress.totalWords"
                  headlineValue="sum"
                  labels={{
                    e: t('results.review'),
                    r: t('results.new'),
                    cumE: t('progress.cumReview'),
                    cumR: t('progress.cumNew'),
                  }}
                />
              )}
            </section>
          </div>
        </main>

        <aside className="progress-rail">
          <CalendarModule />
          {dim !== 'day' && (
            <section className="progress-card">
              <Sunburst burst={burst} legend={false} />
            </section>
          )}
          {dim === 'day' && (
            <section className="progress-card">
              <GoalGauge value={data?.today.learned ?? 0} goal={settings.dailyGoal} />
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
