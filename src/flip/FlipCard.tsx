import { memo } from 'react'
import './card.css'

type CardSense = { pos?: string; defs: string[] }

export type CardData = {
  word: string
  phonetic: string
  senses: CardSense[]
  tags: string[]
}

/** Ring slot: a position, 'B' the hidden back for even counts, 'S' the right
 *  slot when only two cards remain. */
export type Slot = number | 'B' | 'S'

/** Dot colors: r red / y yellow / g green / empty grey. */
type DotColor = 'r' | 'y' | 'g' | 'empty'

const DOT_TIERS: DotColor[] = ['g', 'y', 'r']

// Reveal count -> three dots:
//   1-3: one/two/three green; 4-6: yellow; 7-9: red; stops at three red.
function dotColors(n: number): DotColor[] {
  if (n <= 0) return ['empty', 'empty', 'empty']
  const tier = Math.min(Math.floor((n - 1) / 3), DOT_TIERS.length - 1)
  const filled = n >= 9 ? 3 : ((n - 1) % 3) + 1
  return Array.from({ length: 3 }, (_, i) =>
    i < filled ? DOT_TIERS[tier] : 'empty',
  )
}

// Visible window: ±2 is the off-stage transition slot; beyond that is parked.
export const SIDE = 2

type FlipCardProps = {
  word: CardData
  slot: Slot
  revealed?: boolean
  /** Reveal style: 'default' grows the box by layout; 'swap' flips to a
   *  natively larger back face. */
  reveal?: 'default' | 'swap'
  hovered?: boolean
  dots?: number
  notice?: string | null
  onClick?: (name: string, slot: Slot) => void
}

/** One two-sided card in the ring: a word on the front, definition on the
 *  back. The ring placement comes from `slot`; the deck positions it. */
function FlipCard({
  word,
  slot,
  revealed = false,
  reveal = 'default',
  hovered = false,
  dots = 0,
  notice = null,
  onClick,
}: FlipCardProps) {
  const isCenter = slot === 0
  const off = typeof slot === 'number' && Math.abs(slot) > SIDE
  const posClass = off
    ? slot > 0
      ? 'pos-off-r'
      : 'pos-off-l'
    : `pos-${slot}`

  const showNotice = isCenter && notice
  const wordLine = (
    <div className={`word${showNotice ? ' copying' : ''}`}>
      <span className="word-text">{word.word}</span>
      {showNotice && <span className="copy-notice">{notice}</span>}
    </div>
  )

  return (
    <div
      className={`card ${posClass}${isCenter ? ' active' : ''}${
        hovered ? ' hovered' : ''
      }${reveal === 'swap' ? ' card--swap' : ''}`}
      data-word={word.word}
      onClick={onClick ? () => onClick(word.word, slot) : undefined}
    >
      <div className={`card-flip${isCenter && revealed ? ' flipped' : ''}`}>
        <div className="face front">
          <div className="inner">{wordLine}</div>
        </div>

        <div className="face back">
          {isCenter && revealed && dots > 0 && (
            <div className="dots-wrap">
              <div className="dots">
                {dotColors(dots).map((c, i) => (
                  <span key={i} className={`dot ${c}`} />
                ))}
              </div>
            </div>
          )}
          <div className="inner">
            {wordLine}
            {isCenter && revealed && (
              <div className="detail">
                <div className="phonetic">{word.phonetic}</div>
                <div className="definition">
                  {word.senses.map((s, i) => (
                    <div className="sense" key={i}>
                      {s.pos && <span className="sense-pos">{s.pos}</span>}
                      <span className="sense-defs">{s.defs.join('；')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {isCenter && revealed && word.tags.length > 0 && (
            <div className="tag-list">
              {word.tags.map((label) => (
                <span className="tag" key={label}>
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(FlipCard)
