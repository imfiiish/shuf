import { useState, type CSSProperties } from 'react'
import { useI18n } from '../i18n'
import { SHADES, type BurstCat } from './progressBurstData'
import './progressCharts.css'

/* ------------------------------------------------------------------ *
 * Demo progress data — languages × reveal status, a year of daily
 * study and a 30-day accumulation.
 * ------------------------------------------------------------------ */

/** Place the two rings for any burst — angles follow the data. */
function layoutBurst(burst: BurstCat[]) {
  const total = burst.reduce(
    (sum, c) => sum + c.children.reduce((s, x) => s + x.n, 0),
    0,
  )
  let a = 0
  const cats = burst.map((c) => {
    const catTotal = c.children.reduce((s, x) => s + x.n, 0)
    const a0 = a
    const a1 = a + (catTotal / total) * 360
    a = a1
    let ca = a0
    const children = c.children.map((x, i) => {
      const c0 = ca
      const c1 = ca + (x.n / catTotal) * (a1 - a0)
      ca = c1
      return { ...x, a0: c0, a1: c1, i }
    })
    return { ...c, total: catTotal, a0, a1, children }
  })
  return { total, cats }
}

/* ---- geometry helpers ---- */

/** angle 0 = 12 o'clock, clockwise. */
function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
}

/** Open arc at radius r, a0 → a1 degrees (drawn as a stroked path). */
function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`
}

/** Filled annular sector — the hit region when r0 is 0. */
function sectorPath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
) {
  const [x0o, y0o] = polar(cx, cy, r1, a0)
  const [x1o, y1o] = polar(cx, cy, r1, a1)
  const [x1i, y1i] = polar(cx, cy, r0, a1)
  const [x0i, y0i] = polar(cx, cy, r0, a0)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M ${x0o} ${y0o} A ${r1} ${r1} 0 ${large} 1 ${x1o} ${y1o} L ${x1i} ${y1i} A ${r0} ${r0} 0 ${large} 0 ${x0i} ${y0i} Z`
}

/** Unit outward nudge for a segment at mid-angle `mid`. */
function outward(mid: number, dist: number) {
  const [ox, oy] = polar(0, 0, dist, mid)
  return { '--ox': `${ox}px`, '--oy': `${oy}px` }
}

/** Soft same-colour glow for a segment (borrowed from the composition pie). */
function glow(color: string) {
  return { '--glow': `${color}66` } as CSSProperties
}

/* ------------------------------------------------------------------ *
 * Chart bodies (reused by the Progress page)
 * ------------------------------------------------------------------ */

type Active = { label: string; n: number; cat: string; stage?: string }

/** Centre readout — HTML so it stays optically centred in the hole. */
function Center({ active, total }: { active: Active | null; total: number }) {
  const { t } = useI18n()
  return (
    <div className="pb-center">
      <b className="pb-num">{active ? active.n : total}</b>
      <span className="pb-cap">
        {active ? active.label : t('progress.words')}
      </span>
    </div>
  )
}

/** Nested legend for the sunburst. */
function Legend({ burst }: { burst: BurstCat[] }) {
  const { t } = useI18n()
  const { cats } = layoutBurst(burst)
  return (
    <ul className="pb-legend">
      {cats.map((c) => (
        <li key={c.key}>
          <div className="pb-leg-row">
            <i style={{ background: SHADES[c.key][1] }} />
            <span>{t(c.label)}</span>
            <b>{c.total}</b>
          </div>
          <ul className="pb-leg-sub">
            {c.children.map((x) => (
              <li key={x.key}>
                <i style={{ background: SHADES[c.key][x.i] }} />
                <span>{t(x.label)}</span>
                <b>{x.n}</b>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

/** Sunburst: language inside, reveal status outside. Hover slides the whole
 *  branch outward; a static hit layer keeps the ring gap from dropping the
 *  state (the gap counts as the outer ring). */
export function Sunburst({
  burst,
  legend = true,
}: {
  burst: BurstCat[]
  legend?: boolean
}) {
  const { t } = useI18n()
  const [active, setActive] = useState<Active | null>(null)
  const { total, cats } = layoutBurst(burst)
  const S = 340
  const C = S / 2
  const R_IN = 82
  const R_OUT = 128
  const W_IN = 34
  const W_OUT = 30
  const GAP = 1.8
  const MID = R_IN + W_IN / 2 // inner ring's outer edge — the gap starts here
  const OUT_EDGE = R_OUT + W_OUT / 2

  return (
    <div className="rc rc-pburst">
      <div className="pb-dial" onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${S} ${S}`} className="pb-sun" aria-hidden="true">
          <circle className="pb-track" cx={C} cy={C} r={R_IN} strokeWidth={W_IN} />
          <circle className="pb-track" cx={C} cy={C} r={R_OUT} strokeWidth={W_OUT} />

          {/* visual layer — the parts that move on hover */}
          {cats.map((c) => {
            const catDim = active && active.cat !== c.key
            return (
              <g key={c.key} className={catDim ? 'dim' : ''}>
                <g
                  className={`pb-slot${active?.cat === c.key ? ' move' : ''}`}
                  style={outward((c.a0 + c.a1) / 2, 6) as CSSProperties}
                >
                  <path
                    className="pb-arc"
                    pathLength={1}
                    d={arc(C, C, R_IN, c.a0 + GAP, c.a1 - GAP)}
                    stroke={SHADES[c.key][1]}
                    strokeWidth={W_IN}
                    style={glow(SHADES[c.key][1])}
                  />
                </g>
                {c.children.map((x) => {
                  const dim =
                    active &&
                    (active.cat !== c.key ||
                      (active.stage && active.stage !== x.key))
                  return (
                    <g
                      key={x.key}
                      className={`pb-slot${dim ? ' dim' : ''}${
                        active?.cat === c.key &&
                        (!active.stage || active.stage === x.key)
                          ? ' move'
                          : ''
                      }`}
                      style={outward((x.a0 + x.a1) / 2, 8) as CSSProperties}
                    >
                      <path
                        className="pb-arc"
                        pathLength={1}
                        d={arc(C, C, R_OUT, x.a0 + GAP, x.a1 - GAP)}
                        stroke={SHADES[c.key][x.i]}
                        strokeWidth={W_OUT}
                        style={glow(SHADES[c.key][x.i])}
                      />
                    </g>
                  )
                })}
              </g>
            )
          })}

          {/* static hit layer — outer sectors reach inward across the gap */}
          {cats.map((c) => (
            <g key={`${c.key}-hit`}>
              <path
                className="pb-hit"
                d={sectorPath(C, C, R_IN - W_IN / 2, MID, c.a0 + GAP, c.a1 - GAP)}
                onMouseEnter={() =>
                  setActive({ label: t(c.label), n: c.total, cat: c.key })
                }
              />
              {c.children.map((x) => (
                <path
                  key={x.key}
                  className="pb-hit"
                  d={sectorPath(C, C, MID, OUT_EDGE, x.a0 + GAP, x.a1 - GAP)}
                  onMouseEnter={() =>
                    setActive({
                      label: t(x.label),
                      n: x.n,
                      cat: c.key,
                      stage: x.key,
                    })
                  }
                />
              ))}
            </g>
          ))}
        </svg>
        <Center active={active} total={total} />
      </div>
      {legend && <Legend burst={burst} />}
    </div>
  )
}

