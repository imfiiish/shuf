import { useMemo, useState, type CSSProperties } from 'react'
import { useI18n } from '../i18n'
import './resultCharts.css'

/** angle 0 = 12 o'clock, clockwise. */
function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`
}

/** Filled pie wedge from a0 to a1 (degrees, 0 = 12 o'clock). */
function wedgePath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`
}

/** Split new / review / exposure into pie slices (cumulative counts). */
function slicesOf(newWords: number, reviewWords: number, exposed: number) {
  const total = newWords + reviewWords + exposed || 1
  const parts = [
    { key: 'new', n: newWords },
    { key: 'review', n: reviewWords },
    { key: 'exposed', n: exposed },
  ] as const
  let acc = 0
  return parts.map((p) => {
    const frac = p.n / total
    const a0 = acc * 360
    const a1 = (acc + frac) * 360
    acc += frac
    return { ...p, frac, a0, a1, mid: (a0 + a1) / 2 }
  })
}

/* ================================================================== *
 * Reusable chart bodies (no outer chrome — callers supply a panel).
 * ================================================================== */

/** Cumulative reveals across the round. `steps` = reveals per card, in order. */
export function GoalGauge({ value, goal }: { value: number; goal: number }) {
  const { t } = useI18n()
  const pct = goal > 0 ? Math.min(1, value / goal) : 0
  const cx = 130
  const cy = 130
  const r = 100
  const A0 = -90
  const A1 = 90

  return (
    <div className="rc-gauge">
      <svg viewBox="0 0 260 168" aria-hidden="true">
        <path
          className="rc-gauge-track"
          d={arcPath(cx, cy, r, A0, A1)}
          strokeLinecap="round"
        />
        <path
          className="rc-gauge-value"
          d={arcPath(cx, cy, r, A0, A0 + 180 * pct)}
          strokeLinecap="round"
          pathLength={1}
        />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const a = A0 + 180 * f
          const [x1, y1] = polar(cx, cy, r - 13, a)
          const [x2, y2] = polar(cx, cy, r - 4, a)
          return (
            <line
              key={f}
              className="rc-tick"
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
            />
          )
        })}
      </svg>
      <div className="rc-gauge-center">
        <div className="rc-gauge-num">
          <span className="rc-big">{value}</span>
          <span className="rc-gauge-goal">/ {goal}</span>
        </div>
        <span className="rc-cap">{t('results.dailyGoal')}</span>
        <span className="rc-gauge-pct">{Math.round(pct * 100)}%</span>
      </div>
    </div>
  )
}

/* ================================================================== *
 * Creative gallery
 * ================================================================== */

export function Dual({
  rounds,
  deck,
  hover = 'values',
  labels,
  headlineLabel,
  headlineValue = 'r',
  tone,
  scale = 'split',
}: {
  rounds: { e: number; r: number }[]
  deck: number
  hover?: 'values' | 'crosshair' | 'tooltip' | 'spotlight'
  /** Override the four legend labels (bar ×2, line ×2). */
  labels?: { e: string; r: string; cumE: string; cumR: string }
  /** i18n key for the headline caption; defaults to “reveals”. */
  headlineLabel?: string
  /** Headline number: the reveal total, or review + new together. */
  headlineValue?: 'r' | 'sum'
  /** Extra modifier class for alternate colouring (e.g. "study"). */
  tone?: string
  /** Bars share one y-scale, or keep the exposure ceiling / reveal max. */
  scale?: 'split' | 'shared'
}) {
  const { t } = useI18n()
  const [active, setActive] = useState<number | null>(null)
  const W = 720
  const H = 250
  const PX = 30
  const PY = 26

  // The geometry is a pure function of (rounds, deck, scale). Memoize it so
  // hovering a bar — which re-renders the SVG — does not rebuild the
  // cumulative arrays and path strings on every mouse move.
  const geom = useMemo(() => {
    /** Cards per round — the ceiling for a single round's exposure. */
    const DECK = deck || 1
    const n = rounds.length
    const maxRev = Math.max(1, ...rounds.map((d) => d.r))
    const maxAll = Math.max(1, ...rounds.map((d) => Math.max(d.e, d.r)))
    const expScale = scale === 'shared' ? maxAll : DECK
    const revScale = scale === 'shared' ? maxAll : maxRev

    const cumExp = rounds.reduce<number[]>((acc, d) => {
      acc.push((acc[acc.length - 1] ?? 0) + d.e)
      return acc
    }, [])
    const cumRev = rounds.reduce<number[]>((acc, d) => {
      acc.push((acc[acc.length - 1] ?? 0) + d.r)
      return acc
    }, [])
    const sumE = cumExp[n - 1] ?? 0
    const sumR = cumRev[n - 1] ?? 0
    const totalExp = sumE || 1
    const totalRev = sumR || 1

    const slot = (W - 2 * PX) / Math.max(1, n)
    const bw = slot * 0.26
    const cx = (i: number) => PX + slot * i + slot / 2
    const yExp = (v: number) => H - PY - (v / expScale) * (H - 2 * PY)
    const yRev = (v: number) => H - PY - (v / revScale) * (H - 2 * PY)
    const yCum = (v: number, total: number) =>
      H - PY - (v / total) * (H - 2 * PY)
    // with a shared scale the cumulative lines need one too, or two similarly
    // shaped totals draw on top of each other and read as a single line
    const lineMax = scale === 'shared' ? Math.max(sumE, sumR, 1) : 0
    const expTotal = scale === 'shared' ? lineMax : totalExp
    const revTotal = scale === 'shared' ? lineMax : totalRev
    const lineExp = cumExp
      .map((v, i) => `${i ? 'L' : 'M'} ${cx(i)} ${yCum(v, expTotal)}`)
      .join(' ')
    const lineRev = cumRev
      .map((v, i) => `${i ? 'L' : 'M'} ${cx(i)} ${yCum(v, revTotal)}`)
      .join(' ')
    return {
      cumExp,
      cumRev,
      sumE,
      sumR,
      totalRev,
      expScale,
      revScale,
      slot,
      bw,
      cx,
      yExp,
      yRev,
      yCum,
      expTotal,
      revTotal,
      lineExp,
      lineRev,
    }
  }, [rounds, deck, scale])

  const {
    cumExp,
    cumRev,
    sumE,
    sumR,
    totalRev,
    expScale,
    revScale,
    slot,
    bw,
    cx,
    yExp,
    yRev,
    yCum,
    expTotal,
    revTotal,
    lineExp,
    lineRev,
  } = geom

  const legend = [
    { cls: 'exp-bar', label: labels?.e ?? t('results.exposed'), v: 'bar' },
    { cls: 'rev-bar', label: labels?.r ?? t('results.reveals'), v: 'bar' },
    {
      cls: 'exp-line',
      label: labels?.cumE ?? t('results.chart.cumExposure'),
      v: 'line',
    },
    {
      cls: 'rev-line',
      label: labels?.cumR ?? t('results.chart.cumReveal'),
      v: 'line',
    },
  ]

  return (
    <div
      className={`rc rc-dual rc-dual--${hover}${
        tone ? ` rc-dual--${tone}` : ''
      }${active !== null ? ' is-hover' : ''}`}
      onMouseLeave={() => setActive(null)}
    >
      <div className="rc-dual-top">
        <span className="rc-big">
          {headlineValue === 'sum' ? sumE + sumR : totalRev}
        </span>
        <span className="rc-cap">
          {headlineLabel ? t(headlineLabel) : t('results.reveals')}
        </span>
        <ul className="rc-dual-legend">
          {legend.map((l) => (
            <li key={l.cls} className={l.cls}>
              <i />
              {l.label}
            </li>
          ))}
        </ul>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            className="rc-gridline"
            x1={PX}
            y1={H - PY - f * (H - 2 * PY)}
            x2={W - PX}
            y2={H - PY - f * (H - 2 * PY)}
          />
        ))}
        {/* 16 · crosshair: a guide line snapped to the active round */}
        {hover === 'crosshair' && active !== null && (
          <line
            className="rc-dual-guide"
            x1={cx(active)}
            y1={PY - 6}
            x2={cx(active)}
            y2={H - PY}
          />
        )}

        {/* 18 · spotlight: a soft beam behind the active round */}
        {hover === 'spotlight' && active !== null && (
          <>
            <defs>
              <linearGradient id="dual-beam-grad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="rgba(143,220,160,0.22)" />
                <stop offset="100%" stopColor="rgba(143,220,160,0)" />
              </linearGradient>
            </defs>
            <rect
              className="rc-dual-beam"
              x={cx(active) - slot / 2}
              y={0}
              width={slot}
              height={H}
            />
          </>
        )}

        {rounds.map((d, i) => (
          <g
            key={i}
            className={`rc-dual-slot${active === i ? ' on' : ''}`}
            onMouseEnter={() => setActive(i)}
          >
            {hover === 'values' && (
              <rect
                className="rc-dual-hi"
                x={cx(i) - slot / 2}
                y={PY}
                width={slot}
                height={H - 2 * PY}
              />
            )}
            <rect
              className="rc-dual-bar exposure"
              x={cx(i) - bw - 2}
              y={yExp(d.e)}
              width={bw}
              height={(d.e / expScale) * (H - 2 * PY)}
              rx={3}
              style={{ animationDelay: `${i * 40}ms` } as CSSProperties}
            />
            <rect
              className="rc-dual-bar reveal"
              x={cx(i) + 2}
              y={yRev(d.r)}
              width={bw}
              height={(d.r / revScale) * (H - 2 * PY)}
              rx={3}
              style={{ animationDelay: `${i * 40 + 60}ms` } as CSSProperties}
            />
            {hover === 'values' && (
              <>
                <text
                  className="rc-dual-val exposure"
                  x={cx(i) - bw / 2 - 2}
                  y={yExp(d.e) - 8}
                  textAnchor="middle"
                >
                  {d.e}
                </text>
                <text
                  className="rc-dual-val reveal"
                  x={cx(i) + 2 + bw / 2}
                  y={yRev(d.r) - 8}
                  textAnchor="middle"
                >
                  {d.r}
                </text>
              </>
            )}
          </g>
        ))}
        <path className="rc-dual-line exposure" d={lineExp} />
        <path className="rc-dual-line reveal" d={lineRev} pathLength={1} />
        {cumExp.map((v, i) => (
          <circle
            key={`e${i}`}
            className="rc-dual-pt exposure"
            cx={cx(i)}
            cy={yCum(v, expTotal)}
            r={2.4}
          />
        ))}
        {cumRev.map((v, i) => (
          <circle
            key={`r${i}`}
            className="rc-dual-pt reveal"
            cx={cx(i)}
            cy={yCum(v, revTotal)}
            r={2.4}
          />
        ))}
        {/* 16 · crosshair: enlarge the active round's running-total dots and
            read the round out in the corner */}
        {hover === 'crosshair' && active !== null && (
          <>
            <circle
              className="rc-dual-cross-dot exposure"
              cx={cx(active)}
              cy={yCum(cumExp[active], expTotal)}
              r={4.4}
            />
            <circle
              className="rc-dual-cross-dot reveal"
              cx={cx(active)}
              cy={yCum(cumRev[active], revTotal)}
              r={4.4}
            />
            <text
              className="rc-dual-read"
              x={W - PX}
              y={PY - 12}
              textAnchor="end"
            >
              R{active + 1}
              <tspan className="exp"> · {rounds[active].e}</tspan>
              <tspan className="rev"> · {rounds[active].r}</tspan>
            </text>
          </>
        )}

        {/* 17 · tooltip: a small card floating above the active round */}
        {hover === 'tooltip' && active !== null && (
          <g className="rc-dual-tip">
            <rect x={cx(active) - 46} y={6} width={92} height={40} rx={9} />
            <text x={cx(active)} y={23} textAnchor="middle" className="tip-t">
              R{active + 1}
            </text>
            <text x={cx(active)} y={39} textAnchor="middle" className="tip-v">
              <tspan className="exp">{rounds[active].e}</tspan>
              <tspan className="sep"> · </tspan>
              <tspan className="rev">{rounds[active].r}</tspan>
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}

/** 14 — Halo · gloss: gradient ring with a dotted exposure halo. */
export function PieExplode({
  newWords,
  reviewWords,
  exposed,
  legend = true,
}: {
  newWords: number
  reviewWords: number
  exposed: number
  legend?: boolean
}) {
  const { t } = useI18n()
  const slices = slicesOf(newWords, reviewWords, exposed)
  return (
    <div className="rc-pie rc-pie-explode">
      <div className="rpe-dial">
        <svg viewBox="0 0 260 260" aria-hidden="true">
          {slices.map((s, i) => {
            const [dx, dy] = polar(0, 0, 9, s.mid)
            const [lx, ly] = polar(130, 130, 104 * 0.66, s.mid)
            return (
              <g
                key={s.key}
                className={`rpe-slot ${s.key}`}
                style={
                  {
                    '--ox': `${dx}px`,
                    '--oy': `${dy}px`,
                    '--d': `${i * 130}ms`,
                  } as CSSProperties
                }
              >
                <path
                  className={`rp-slice ${s.key}`}
                  d={wedgePath(130, 130, 104, s.a0 + 2.5, s.a1 - 2.5)}
                />
                {/* slices under 10% are too thin to read a label in */}
                {s.frac >= 0.1 && (
                  <text
                    className="rp-slice-label"
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {Math.round(s.frac * 100)}%
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      {legend && (
        <ul className="rc-legend">
          {slices.map((s) => (
            <li key={s.key} className={s.key}>
              <span className="rc-dot" />
              <span>{t(`results.${s.key}`)}</span>
              <b>{s.n}</b>
              <em>{Math.round(s.frac * 100)}%</em>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Creative: fifteen ways to chart a finished round. */
