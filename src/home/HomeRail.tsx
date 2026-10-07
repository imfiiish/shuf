import { useMemo } from 'react'
import type { LangBurst } from '../api/progress'
import { GoalGauge } from '../progress/ResultCharts'
import { Sunburst } from '../progress/ProgressCharts'
import { burstFrom } from '../progress/progressBurstData'

/** Home's right rail: today's goal gauge and the month sunburst, lifted from
 *  the Progress page. Split into its own chunk so the chart code and CSS are
 *  not part of the landing page's initial bundle. */
export default function HomeRail({
  value,
  goal,
  languages,
}: {
  value: number
  goal: number
  languages: LangBurst[]
}) {
  const burst = useMemo(() => burstFrom(languages), [languages])
  return (
    <>
      <section className="home-card">
        <GoalGauge value={value} goal={goal} />
      </section>
      <section className="home-card">
        <Sunburst burst={burst} legend={false} />
      </section>
    </>
  )
}
