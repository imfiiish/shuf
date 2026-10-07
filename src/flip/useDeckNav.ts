import { useEffect, useLayoutEffect, useRef } from 'react'

/** Wheel / trackpad ring navigation with progressive acceleration: the first
 *  card of a gesture needs a fair amount of scroll, and the threshold shrinks
 *  with every card advanced, so a continuous scroll speeds up. The gesture
 *  ends after IDLE ms of silence; reversing restarts (slow) in the new
 *  direction. */
export function useWheelNav(
  step: (dir: 1 | -1) => void,
  enabled = true,
): void {
  const enabledRef = useRef(enabled)
  useLayoutEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    const STEP_MAX = 520 // scroll px for the first card of a gesture
    const STEP_MIN = 16 // floor once the gesture is in full swing
    const STEP_DECAY = 40 // threshold drop per card advanced
    const IDLE = 220 // ms of silence ends the gesture
    const COOLDOWN = 70 // min ms between steps (caps the top speed)
    const NOTCH = 80 // |delta| above this is a discrete mouse-wheel notch
    const MOUSE_STEP = 40 // threshold for a notch: one notch, one card
    // Firefox reports much smaller trackpad deltas than Chrome for the same
    // gesture, so scale them up to keep the px thresholds feeling the same.
    const TRACKPAD_SCALE = /firefox/i.test(navigator.userAgent) ? 3 : 1

    let acc = 0
    let steps = 0
    let last = 0
    let idle: ReturnType<typeof setTimeout> | undefined

    const endGesture = () => {
      acc = 0
      steps = 0
    }

    const onWheel = (e: WheelEvent) => {
      if (!enabledRef.current) return
      if (e.ctrlKey) return
      e.preventDefault()

      const unit =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
      const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      const delta = raw * unit
      if (delta === 0) return

      clearTimeout(idle)
      idle = setTimeout(endGesture, IDLE)

      // Reversing restarts the gesture, so it eases in again.
      if (acc !== 0 && Math.sign(delta) !== Math.sign(acc)) {
        acc = 0
        steps = 0
      }
      // A mouse wheel sends big discrete notches (or non-pixel deltaMode);
      // treat one notch as one card so it is not paced by the trackpad ramp.
      const isNotch = e.deltaMode !== 0 || Math.abs(delta) >= NOTCH
      acc += isNotch ? delta : delta * TRACKPAD_SCALE
      const need = isNotch
        ? MOUSE_STEP
        : Math.max(STEP_MIN, STEP_MAX - steps * STEP_DECAY)
      if (Math.abs(acc) < need) return
      const now = performance.now()
      if (now - last < COOLDOWN) return

      const dir = acc > 0 ? 1 : -1
      acc -= dir * need
      steps += 1
      last = now
      step(dir)
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      clearTimeout(idle)
      window.removeEventListener('wheel', onWheel)
    }
  }, [step])
}

/** Two quick right-clicks trigger an action. */
export function useDoubleRightClick(onDouble: () => void): void {
  useEffect(() => {
    let last = 0
    const onCtx = (e: MouseEvent) => {
      e.preventDefault()
      const now = performance.now()
      if (last !== 0 && now - last <= 400) {
        last = 0
        onDouble()
      } else {
        last = now
      }
    }
    window.addEventListener('contextmenu', onCtx)
    return () => window.removeEventListener('contextmenu', onCtx)
  }, [onDouble])
}
