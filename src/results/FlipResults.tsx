import { useMemo, type CSSProperties } from 'react'
import { useStageScale } from '../flip/useStageScale'
import { useI18n } from '../i18n'
import { Dual, GoalGauge } from '../progress/ResultCharts'
import { TodayRingLiveModule } from '../progress/ProgressModules'
import './flipResults.css'

export type ResultsWord = {
  word: string
  count: number
  kind: 'new' | 'review'
}

export type ResultsStats = {
  studied: number
  newWords: number
  reviewWords: number
  exposed: number
  reveals: number
  /** Daily goal the gauge measures against. */
  goal: number
  words: ResultsWord[]
  /** One entry per round: e = cards exposed, r = reveals. */
  rounds: { e: number; r: number }[]
  /** Cards in a round — the exposure ceiling. */
  deck: number
}

type Props = {
  stats: ResultsStats
  onContinue: () => void
  onStop: () => void
  /** Fill the parent instead of overlaying the viewport (standalone page). */
  contained?: boolean
}

/** Fixed design canvas for the summary, scaled as one unit (see useStageScale). */
const STAGE_W = 1440
const STAGE_H = 900

/** Full-screen round summary for the Flip · Results scene. Words encountered
 *  live in a left rail; the summary reads as a small report — a composition
 *  halo, a daily-goal gauge and the round's reveal pace. Free of the app
 *  tokens on purpose — it is meant to feel like a reward screen. */
export default function FlipResults({
  stats,
  onContinue,
  onStop,
  contained = false,
}: Props) {
  const { t } = useI18n()
  const { stageRef, scale } = useStageScale(STAGE_W, STAGE_H)
  const { studied, newWords, reviewWords, goal, words, rounds, deck } = stats

  // split a trailing "!" (or "！") off the title so it can hang on the right
  // without dragging the words off-centre
  const title = t('results.title')
  const bangMatch = title.match(/^(.*?)([!！?？。.]+)$/)
  const titleText = bangMatch ? bangMatch[1] : title
  const titleBang = bangMatch ? bangMatch[2] : ''

  // left rail doubles as a bar chart: sorted, with a proportional fill
  const maxCount = useMemo(
    () => Math.max(1, ...words.map((w) => w.count)),
    [words],
  )
  const rail = useMemo(
    () =>
      [...words].sort(
        (a, b) => b.count - a.count || a.word.localeCompare(b.word),
      ),
    [words],
  )

  return (
    <div
      className={`results${contained ? ' results--contained' : ''}`}
      ref={stageRef}
    >
      <div
        className="results-stage"
        style={{ '--s': scale } as CSSProperties}
      >
        <header className="results-head">
          <h1 className="results-title">
            <span className="results-title-ghost" aria-hidden="true">
              {titleBang}
            </span>
            {titleText}
            <span className="results-title-bang">{titleBang}</span>
          </h1>
        </header>

        <aside className="results-side">
          <h2 className="results-side-title">
            {t('results.encountered')}
            <span className="results-side-count">{studied}</span>
          </h2>
          <ul className="results-wordlist">
            {rail.map((w, i) => (
              <li
                key={w.word}
                className={`rw ${w.kind}`}
                style={
                  {
                    '--w': `${(w.count / maxCount) * 100}%`,
                    '--d': `${Math.min(i, 14) * 26}ms`,
                  } as CSSProperties
                }
              >
                <span className="rw-dot" aria-hidden="true" />
                <span className="rw-word">{w.word}</span>
                <span className="rw-count">×{w.count}</span>
              </li>
            ))}
          </ul>
        </aside>

        <main className="results-main">
          <div className="results-dashboard">
            <section className="results-panel results-panel-halo">
              <TodayRingLiveModule
                dividers={false}
                enterCounts
                newCount={newWords}
                reviewCount={reviewWords}
              />
            </section>
            <section className="results-panel results-panel-gauge">
              <GoalGauge value={studied} goal={goal} />
            </section>
            <section className="results-panel results-panel-dual">
              <Dual rounds={rounds} deck={deck} hover="crosshair" />
            </section>
          </div>
        </main>

        <div className="results-actions">
          <button type="button" className="results-btn ghost" onClick={onStop}>
            {t('results.stop')}
          </button>
          <button
            type="button"
            className="results-btn primary"
            onClick={onContinue}
          >
            {t('results.continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
