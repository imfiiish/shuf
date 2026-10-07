import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

// Stage design size (basis for the equal-ratio scaling).
const STAGE_W = 1200
const STAGE_H = 360

/** Equal-ratio scaling: measure the stage area, fit a `width`x`height` design
 *  canvas into it (defaults to the deck stage). Capped at 1 so large screens
 *  show the design at 100% instead of stretching it. */
export function useStageScale(
  width: number = STAGE_W,
  height: number = STAGE_H,
): {
  stageRef: RefObject<HTMLDivElement | null>
  scale: number
} {
  const stageRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setScale(Math.max(0.2, Math.min(1, r.width / width, r.height / height)))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width, height])

  return { stageRef, scale }
}
