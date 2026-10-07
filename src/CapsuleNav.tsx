import { useState, type ReactNode } from 'react'
import './capsuleNav.css'

export interface CapsuleNavItem {
  id: string
  /** Accessible label / tooltip text. */
  label: string
  icon: ReactNode
}

export interface CapsuleNavProps {
  items: CapsuleNavItem[]
  /** Controlled active item id. Omit to let the nav manage its own state. */
  active?: string
  defaultActive?: string
  onSelect?: (id: string) => void
}

/** Floating capsule navigation rail — extracted from the design sample's
 *  "Navigation · Capsule" scene. Fixed to the left, vertically centered. */
export default function CapsuleNav({
  items,
  active,
  defaultActive,
  onSelect,
}: CapsuleNavProps) {
  const [internal, setInternal] = useState(defaultActive ?? items[0]?.id)
  const current = active ?? internal

  function select(id: string) {
    if (active === undefined) setInternal(id)
    onSelect?.(id)
  }

  return (
    <aside className="cap-nav">
      <nav className="cap-items">
        {items.map((item) => {
          const on = item.id === current
          return (
            <button
              key={item.id}
              type="button"
              className={`cap-link${on ? ' on' : ''}`}
              title={item.label}
              aria-label={item.label}
              aria-current={on ? 'page' : undefined}
              onClick={() => select(item.id)}
            >
              {item.icon}
              <span className="cap-link-label">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
