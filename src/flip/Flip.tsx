import { useCallback, useEffect, useRef, useState } from 'react'
import FlipDeck, { type CardData, type Slot } from './FlipDeck'
import { useCopyNotice } from './useCopyNotice'
import { useDoubleRightClick, useWheelNav } from './useDeckNav'
import { useStageScale } from './useStageScale'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import { logicalDay } from '../utils'
import {
  fetchRound,
  saveProgress,
  saveProgressBeacon,
  toCards,
} from '../api/study'
import { fetchProgress } from '../api/progress'
import {
  reachedMilestone,
  setShownMilestone,
  shownMilestone,
} from '../results/milestone'
import { WORDS } from './data'
import './flip.css'
import './flipForest.css'

/** The Flip page: a ring of cards you shuffle, reveal and flip through.
 *  Rounds are dealt by the server (cascading windows); exposure and learning
 *  are reported back per word. The default wears the forest theme; `plain`
 *  drops it. */
export default function Flip({
  variant,
  book = 'en-cet4',
  onBack,
  onFinish,
}: {
  variant?: string
  book?: string
  onBack?: () => void
  onFinish?: () => void
}) {
  const { t } = useI18n()
  const { ready, user, enterAsGuest } = useAuth()
  const shown = variant ?? 'default'
  // Milestones are remembered per account, so a switch does not suppress the
  // next Results (see results/milestone.ts).
  const uid = user?.id ?? null

  const [deck, setDeck] = useState<CardData[]>([])
  const [center, setCenter] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [revealCounts, setRevealCounts] = useState<Record<string, number>>({})
  const [stageKey, setStageKey] = useState(0)

  const { copied, copy, clear: clearCopy } = useCopyNotice()

  const { stageRef, scale } = useStageScale()
  const TOTAL = deck.length
  const centerName = deck[center]?.word ?? null

  // --- progress: bringing a word to the centre = exposed, flipping = met ---
  // seenRef dedupes exposure for the whole round; exposed / met are sent as
  // deltas since the last push, so repeated flushes never double-count.
  const seenRef = useRef<Set<string>>(new Set())
  const pendingExposedRef = useRef<Set<string>>(new Set())
  const pendingMetRef = useRef<Map<string, number>>(new Map())
  const roundSeqRef = useRef(0)
  const lastWordRef = useRef<string | null>(null)
  const pushTimer = useRef<number | undefined>(undefined)

  const flushProgress = useCallback(async () => {
    if (pushTimer.current) {
      window.clearTimeout(pushTimer.current)
      pushTimer.current = undefined
    }
    const exposed = [...pendingExposedRef.current]
    const met = Object.fromEntries(pendingMetRef.current)
    if (exposed.length === 0 && met.length === 0) return
    pendingExposedRef.current.clear()
    pendingMetRef.current.clear()
    try {
      await saveProgress(
        book,
        roundSeqRef.current,
        logicalDay(),
        exposed,
        met,
        lastWordRef.current,
      )
    } catch {
      // Send failed: put the deltas back so a later flush retries them.
      for (const w of exposed) pendingExposedRef.current.add(w)
      for (const [w, n] of Object.entries(met)) {
        pendingMetRef.current.set(w, (pendingMetRef.current.get(w) ?? 0) + n)
      }
    }
  }, [book])

  const schedulePush = useCallback(() => {
    if (pushTimer.current) return
    pushTimer.current = window.setTimeout(() => {
      pushTimer.current = undefined
      flushProgress()
    }, 800)
  }, [flushProgress])

  const markExposed = useCallback(
    (word: string) => {
      if (seenRef.current.has(word)) return
      seenRef.current.add(word)
      pendingExposedRef.current.add(word)
      schedulePush()
    },
    [schedulePush],
  )

  // Every word that reaches the centre is exposed (at most once per round);
  // the last one is remembered for cross-device resume.
  useEffect(() => {
    const word = deck[center]?.word
    if (!word) return
    lastWordRef.current = word
    markExposed(word)
    schedulePush()
  }, [deck, center, markExposed, schedulePush])

  // Flush on page hide (survives unload) and on unmount.
  useEffect(() => {
    const onHide = () =>
      saveProgressBeacon(
        book,
        roundSeqRef.current,
        logicalDay(),
        [...pendingExposedRef.current],
        Object.fromEntries(pendingMetRef.current),
        lastWordRef.current,
      )
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      flushProgress()
    }
  }, [book, flushProgress])

  // Deal the first round once the session probe settles. Study needs an
  // account (even a guest one), so start a guest session when there is none.
  useEffect(() => {
    if (!ready) return
    let alive = true
    ;(async () => {
      let startIndex = 0
      try {
        if (!user) await enterAsGuest()
        const round = await fetchRound(book)
        roundSeqRef.current = round.roundSeq
        if (round.lastWord) {
          const idx = round.words.indexOf(round.lastWord)
          if (idx >= 0) startIndex = idx
        }
        if (alive) setDeck(toCards(round.items))
      } catch {
        if (alive) setDeck(WORDS) // API down: keep the demo deck usable
      }
      if (alive) setCenter(startIndex)
    })()
    return () => {
      alive = false
    }
  }, [ready, user, enterAsGuest, book])

  const go = useCallback(
    (delta: number) => {
      if (!TOTAL) return
      setRevealed(false)
      clearCopy()
      setCenter((c) => (c + delta + TOTAL) % TOTAL)
    },
    [TOTAL, clearCopy],
  )

  const reveal = useCallback(() => {
    setRevealed(true)
    const name = deck[center]?.word
    if (!name) return
    setRevealCounts((c) => ({ ...c, [name]: (c[name] || 0) + 1 }))
    markExposed(name)
    pendingMetRef.current.set(name, (pendingMetRef.current.get(name) ?? 0) + 1)
    schedulePush()
  }, [deck, center, markExposed, schedulePush])

  // reveal / flip back (no audio to replay, so a second click hides it)
  const toggleReveal = useCallback(() => {
    if (revealed) setRevealed(false)
    else reveal()
  }, [revealed, reveal])

  const copyCurrent = useCallback(() => {
    if (centerName) copy(centerName)
  }, [centerName, copy])

  const nextRound = useCallback(async () => {
    // Close out this round's progress before dealing the next one.
    flushProgress()
    seenRef.current.clear()
    try {
      const round = await fetchRound(book, true)
      roundSeqRef.current = round.roundSeq
      setDeck(toCards(round.items))
    } catch {
      return
    }
    setCenter(0)
    setRevealed(false)
    clearCopy()
    setStageKey((k) => k + 1)
  }, [book, clearCopy, flushProgress])

  // "Next": deal the next round, unless today's reveals just crossed a
  // milestone (5 / 20 / 50 / 200) — then show Results instead.
  const advanceOrFinish = useCallback(async () => {
    await flushProgress()
    const day = logicalDay()
    try {
      const p = await fetchProgress(day, 1)
      const reached = reachedMilestone(p.today.learned)
      if (reached > shownMilestone(day, uid)) {
        setShownMilestone(day, reached, uid)
        onFinish?.()
        return
      }
    } catch {
      // network error: just continue
    }
    await nextRound()
  }, [flushProgress, onFinish, nextRound, uid])

  // wheel: down / right -> next, up / left -> previous
  useWheelNav(go)

  // keyboard: Space reveal / Enter next round / H L arrows navigate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k.toLowerCase() === 'c') {
        e.preventDefault()
        copyCurrent()
        return
      }
      if (k === ' ') {
        e.preventDefault()
        if (e.repeat) return
        toggleReveal()
        return
      }
      if (k === 'Enter') {
        e.preventDefault()
        if (e.repeat) return
        void advanceOrFinish()
        return
      }
      const low = k.toLowerCase()
      if (low === 'h' || k === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      } else if (low === 'l' || k === 'ArrowRight') {
        e.preventDefault()
        go(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, toggleReveal, copyCurrent, advanceOrFinish])

  // double right-click (trackpad two-finger double tap), anywhere including
  // the center card
  useDoubleRightClick(advanceOrFinish)

  const onCardClick = useCallback(
    (_name: string, slot: Slot) => {
      if (slot === 0) toggleReveal()
      else if (slot === 1 || slot === 'S') go(1)
      else if (slot === -1) go(-1)
    },
    [toggleReveal, go],
  )

  return (
    <div className={`flip${shown === 'plain' ? '' : ' flip--forest'}`}>
      <button
        type="button"
        className="flip-back"
        onClick={onBack}
        aria-label="Back"
        title="Back"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      </button>

      <div className="deck-stage" ref={stageRef}>
        <FlipDeck
          deck={deck}
          center={center}
          revealed={revealed}
          centerNotice={copied ? t('common.copied') : null}
          revealCounts={revealCounts}
          scale={scale}
          stageKey={stageKey}
          onCardClick={onCardClick}
        />
      </div>

      <button
        type="button"
        className="deck-action"
        onClick={() => void advanceOrFinish()}
        aria-label={t('flip.next')}
        title={t('flip.next')}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>

      <div className="hints">
        <span>
          <kbd>Space</kbd> {revealed ? t('flip.replay') : t('flip.reveal')}
        </span>
        <span>
          <kbd>Enter</kbd> {t('flip.next')}
        </span>
      </div>
    </div>
  )
}
