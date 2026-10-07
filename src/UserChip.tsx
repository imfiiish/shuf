import { useEffect, useRef, useState } from 'react'
import './userChip.css'

/**
 * User chip: name on the left, avatar on the right. When signed in, clicking
 * opens a small menu (sign out); otherwise it opens the login popup.
 */
export default function UserChip({
  name,
  initials = 'SF',
  signedIn = false,
  logoutLabel = 'Sign out',
  onClick,
  onLogout,
}: {
  name: string
  initials?: string
  signedIn?: boolean
  logoutLabel?: string
  onClick?: () => void
  onLogout?: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape while the menu is open.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="user-chip-wrap" ref={wrapRef}>
      <button
        type="button"
        className="user-chip"
        aria-haspopup={signedIn ? 'menu' : undefined}
        aria-expanded={signedIn ? open : undefined}
        onClick={() => {
          if (signedIn) setOpen((v) => !v)
          else onClick?.()
        }}
      >
        <span className="user-chip-name">{name}</span>
        <span className="user-chip-avatar" aria-hidden="true">
          {initials}
        </span>
      </button>

      {signedIn && (
        <div className={`user-menu${open ? ' open' : ''}`} role="menu">
          <button
            type="button"
            className="user-menu-item"
            role="menuitem"
            tabIndex={open ? 0 : -1}
            onClick={() => {
              setOpen(false)
              onLogout?.()
            }}
          >
            {logoutLabel}
          </button>
        </div>
      )}
    </div>
  )
}
