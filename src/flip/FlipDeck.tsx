import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import FlipCard, { SIDE, type CardData, type Slot } from './FlipCard'
import './deck.css'

export type { CardData, Slot } from './FlipCard'

function slotOf(p: number, center: number, n: number): Slot {
  let d = (p - center) % n
  if (d < 0) d += n
  if (n === 2) return d === 0 ? 0 : 'S'
  if (n % 2 === 0 && d === n / 2) return 'B'
  if (d > n / 2) d -= n
  return d
}

type FlipDeckProps = {
  deck: CardData[]
  center: number
  revealed?: boolean
  centerNotice?: string | null
  revealCounts?: Record<string, number>
  scale: number
  stageKey?: number | string
  onCardClick?: (name: string, slot: Slot) => void
}

/** Card ring: cards absolutely stacked at center, slid around via transform. */
export default function FlipDeck({
  deck,
  center,
  revealed = false,
  centerNotice = null,
  revealCounts = {},
  scale,
  stageKey,
  onCardClick,
}: FlipDeckProps) {
  const TOTAL = deck.length

  // Hover glow follows the pointer position, not CSS :hover (so it does not
  // stick to a card that is moving).
  const [hoveredName, setHoveredName] = useState<string | null>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const hoverRaf = useRef(0)

  const updateHover = useCallback(() => {
    const pt = pointer.current
    if (!pt) return
    const el = document.elementFromPoint(pt.x, pt.y)
    const cardEl = el?.closest<HTMLElement>('.card[data-word]')
    setHoveredName(cardEl?.dataset.word ?? null)
  }, [])

  // Coalesce raw pointer moves into one hit-test per frame: `elementFromPoint`
  // forces layout, so calling it per mousemove is the expensive part.
  const onCardsMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY }
      if (hoverRaf.current) return
      hoverRaf.current = requestAnimationFrame(() => {
        hoverRaf.current = 0
        updateHover()
      })
    },
    [updateHover],
  )

  const onCardsMouseLeave = useCallback(() => {
    pointer.current = null
    if (hoverRaf.current) {
      cancelAnimationFrame(hoverRaf.current)
      hoverRaf.current = 0
    }
    setHoveredName(null)
  }, [])

  useEffect(() => () => cancelAnimationFrame(hoverRaf.current), [])

  useEffect(() => {
    if (!pointer.current) return
    let raf = 0
    const start = performance.now()
    const tick = () => {
      updateHover()
      if (performance.now() - start < 520) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [center, deck, updateHover])

  return (
    <div
      className="stage"
      key={stageKey}
      style={{ '--stage-scale': scale } as CSSProperties}
    >
      <div
        className="cards"
        onMouseMove={onCardsMouseMove}
        onMouseLeave={onCardsMouseLeave}
      >
        {deck.map((word, p) => {
          const slot = slotOf(p, center, TOTAL)
          // Mount only the visible ring. Parked slots (|slot| > SIDE) and the
          // hidden back 'B' sit at opacity 0, so keeping them in the DOM only
          // costs compositing layers. Culling them is visually identical.
          if (slot === 'B') return null
          if (typeof slot === 'number' && Math.abs(slot) > SIDE) return null
          return (
            <FlipCard
              key={word.word}
              word={word}
              slot={slot}
              revealed={slot === 0 && revealed}
              notice={slot === 0 ? centerNotice : null}
              hovered={hoveredName === word.word}
              dots={revealCounts[word.word] || 0}
              onClick={onCardClick}
            />
          )
        })}
      </div>
    </div>
  )
}
