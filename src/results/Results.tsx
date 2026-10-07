import { useEffect, useState } from 'react'
import FlipResults, { type ResultsStats } from './FlipResults'
import { fetchDayWords, fetchProgress } from '../api/progress'
import { useSettings } from '../settings/context'
import { logicalDay } from '../utils'
import './results.css'

/** Result page: today's summary (the milestone that just landed). */
export default function Results({
  onContinue,
  onStop,
}: {
  onContinue?: () => void
  onStop?: () => void
}) {
  const { settings } = useSettings()
  const [stats, setStats] = useState<ResultsStats | null>(null)

  useEffect(() => {
    let alive = true
    const day = logicalDay()
    Promise.all([fetchProgress(day, 1), fetchDayWords(day)]).then(
      ([p, words]) => {
        if (!alive) return
        const rounds = p.rounds.map((r) => ({ e: r.exposed, r: r.reveals }))
        setStats({
          studied: p.today.learned,
          newWords: p.today.newWords,
          reviewWords: p.today.reviewWords,
          exposed: p.today.exposed,
          reveals: p.today.reveals,
          goal: settings.dailyGoal,
          words: words.map((w) => ({
            word: w.word,
            count: w.reveals,
            kind: w.kind,
          })),
          rounds,
          deck: Math.max(1, ...rounds.map((r) => r.e)),
        })
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [settings.dailyGoal])

  return (
    <div className="results-page">
      {stats && (
        <FlipResults
          stats={stats}
          onContinue={onContinue ?? (() => {})}
          onStop={onStop ?? (() => {})}
          contained
        />
      )}
    </div>
  )
}
