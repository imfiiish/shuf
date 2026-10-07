import {
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useI18n } from '../i18n'
import { logicalDay } from '../utils'
import { useDaily } from './useProgress'
import './progressModules.css'

/* ------------------------------------------------------------------ *
 * Progress page module: a month calendar of study activity, sized to
 * live in a right-hand rail.
 * ------------------------------------------------------------------ */

/** Activity level 0–4 from how many words were learned that day. */
function levelOfCount(n: number): number {
  if (n <= 0) return 0
  if (n < 5) return 1
  if (n < 10) return 2
  if (n < 20) return 3
  return 4
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export function CalendarModule() {
  const { lang } = useI18n()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
  const todayKey = logicalDay()

  const [view, setView] = useState(() => {
    const n = new Date()
    return { y: n.getFullYear(), m: n.getMonth() }
  })
  const shift = (delta: number) =>
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })

  const { y, m } = view
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  // Monday-first column for the 1st of the month
  const firstCol = (new Date(y, m, 1).getDay() + 6) % 7
  const activity = useDaily(
    `${y}-${pad2(m + 1)}-01`,
    `${y}-${pad2(m + 1)}-${pad2(daysInMonth)}`,
  )

  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(y, m, 1))

  const wdFmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
  // 2024-01-01 is a Monday
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    wdFmt.format(new Date(2024, 0, 1 + i)),
  )

  const cells: (number | null)[] = [
    ...Array.from({ length: firstCol }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="pm-cal">
      <div className="pm-cal-head">
        <button
          type="button"
          className="pm-nav"
          aria-label="previous"
          onClick={() => shift(-1)}
        >
          ‹
        </button>
        <span className="pm-month">{monthLabel}</span>
        <button
          type="button"
          className="pm-nav"
          aria-label="next"
          onClick={() => shift(1)}
        >
          ›
        </button>
      </div>

      <div className="pm-week" aria-hidden="true">
        {weekdays.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>

      <div className="pm-grid">
        {cells.map((d, i) => {
          if (d === null) return <span key={i} className="pm-blank" />
          const key = `${y}-${pad2(m + 1)}-${pad2(d)}`
          const isToday = key === todayKey
          const future = key > todayKey
          const level = future
            ? 0
            : levelOfCount(activity.get(key)?.learned ?? 0)
          return (
            <span
              key={i}
              className={`pm-day l${level}${isToday ? ' today' : ''}${
                future ? ' future' : ''
              }`}
            >
              {d}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Card-scale takes on today's numbers — sized for the Progress page's
 * wide card beside the pie, not the narrow rail.
 * ------------------------------------------------------------------ */

type Slice = 'new' | 'review'

const DAY = { new: 180, review: 120 } as const
const DAY_TOTAL = DAY.new + DAY.review
const NEW_PCT = (DAY.new / DAY_TOTAL) * 100

/** Count from 0 to `target`, restarting whenever `run` changes. Used by the
 *  live ring so its centre number rises along with the draw-in. */
function useCountUp(target: number, run: number, duration = 950): number {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, run, duration])
  return value
}

/** The counts column on the right of every ring take. `enter` staggers the
 *  two counts in from the right when the card first mounts (and on replay). */
function CountsSide({
  active,
  onHover,
  onPick,
  enter,
  counts = DAY,
}: {
  active: Slice | null
  onHover?: (k: Slice) => void
  onPick?: (k: Slice) => void
  enter?: boolean
  counts?: { new: number; review: number }
}) {
  const { t } = useI18n()
  return (
    <span
      className={`pm-hw-side${active ? ' has-on' : ''}${enter ? ' enter' : ''}`}
    >
      {(['new', 'review'] as const).map((k) => (
        <span
          key={k}
          className={`${k}${active === k ? ' on' : ''}`}
          onMouseEnter={onHover ? () => onHover(k) : undefined}
          onClick={onPick ? () => onPick(k) : undefined}
        >
          <b>{counts[k]}</b>
          <small>{t(k === 'new' ? 'results.new' : 'results.review')}</small>
        </span>
      ))}
    </span>
  )
}

/** The live dial: thicker arcs with round caps, a light that sweeps the
 *  track as they draw in, and slices that grow / recede on hover. It
 *  remounts whenever `run` changes so the whole entrance replays. */
function RingDialLive({
  run,
  active,
  onHover,
  children,
  newPct = NEW_PCT,
}: {
  run: number
  active: Slice | null
  onHover?: (k: Slice) => void
  children: ReactNode
  newPct?: number
}) {
  const reviewPct = 100 - newPct
  const reviewTurn = -90 + newPct * 3.6
  const turn = (k: Slice) =>
    k === 'new' ? 'rotate(-90 60 60)' : `rotate(${reviewTurn} 60 60)`
  const offset = (k: Slice) => (k === 'new' ? 100 - newPct : 100 - reviewPct)
  return (
    <div className="pm-live-dial" key={run}>
      <span className="pm-live-sheen" aria-hidden="true" />
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="pm-live-track" cx="60" cy="60" r="50" />
        {(['new', 'review'] as const).map((k) => (
          <circle
            key={k}
            className={`pm-live-arc ${k} draw${
              active === k ? ' on' : active ? ' dim' : ''
            }`}
            cx="60"
            cy="60"
            r="50"
            pathLength={100}
            strokeDasharray="100 100"
            strokeDashoffset={offset(k)}
            transform={turn(k)}
          />
        ))}
        {onHover &&
          (['new', 'review'] as const).map((k) => (
            <circle
              key={k}
              className="pm-ring-hit"
              cx="60"
              cy="60"
              r="50"
              pathLength={100}
              strokeDasharray="100 100"
              strokeDashoffset={offset(k)}
              transform={turn(k)}
              onMouseEnter={() => onHover(k)}
            />
          ))}
      </svg>
      <span className="pm-ring-center">{children}</span>
    </div>
  )
}

/** 03 / 04 · live ring — the reworked dial: it springs in, the arcs sweep
 *  behind a travelling light, hovering a slice fattens it while the other
 *  recedes, and a replay button reruns the entrance. */
export function TodayRingLiveModule({
  dividers = true,
  run = 0,
  enterCounts = false,
  newCount = DAY.new,
  reviewCount = DAY.review,
}: {
  dividers?: boolean
  run?: number
  enterCounts?: boolean
  newCount?: number
  reviewCount?: number
} = {}) {
  const { t } = useI18n()
  const [active, setActive] = useState<Slice | null>(null)
  const counts = { new: newCount, review: reviewCount }
  const dayTotal = counts.new + counts.review
  const newPct = dayTotal > 0 ? (counts.new / dayTotal) * 100 : 0
  const total = useCountUp(dayTotal, run)
  const num = active ? counts[active] : total
  const cap = active
    ? t(active === 'new' ? 'results.new' : 'results.review')
    : t('progress.mod.todayWords')
  return (
    <div
      className={`pm-today-card pm-ring-card pm-live-card${
        dividers ? '' : ' no-dividers'
      }`}
      onMouseLeave={() => setActive(null)}
    >
      <div className="pm-ring-left">
        <RingDialLive
          run={run}
          active={active}
          onHover={setActive}
          newPct={newPct}
        >
          <b
            key={active ?? 'all'}
            className={`pm-ring-num pm-live-num${active ? ` ${active}` : ''}`}
          >
            {num}
          </b>
          <small key={cap}>{cap}</small>
        </RingDialLive>
      </div>
      <CountsSide
        active={active}
        onHover={setActive}
        enter={enterCounts}
        counts={counts}
      />
    </div>
  )
}

