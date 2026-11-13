import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Floating menu at a point (right-click or a "⋯" button). Kept inside the window,
 * closed by Escape or a click elsewhere. Children are `.menu-item` buttons and `.menu-sep` rules.
 */
export function PopupMenu({ x, y, onClose, className = '', children }: {
  x: number
  y: number
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: y, left: x, visibility: 'hidden' })

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const box = menu.getBoundingClientRect()
    const left = Math.min(window.innerWidth - box.width - 8, Math.max(8, x))
    const top = y + box.height > window.innerHeight - 8 ? Math.max(8, y - box.height) : y
    setStyle({ position: 'fixed', top, left, visibility: 'visible', maxHeight: window.innerHeight - 16 })
  }, [x, y, children])

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className={`row-menu popup-menu ${className}`.trim()}
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  )
}

/** One menu row: icon, label, optional shortcut hint. */
export function MenuItem({ icon, label, hint, danger, disabled, onClick }: {
  icon?: ReactNode
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" role="menuitem" className={danger ? 'menu-item danger' : 'menu-item'} disabled={disabled} onClick={onClick}>
      <span className="menu-ico" aria-hidden="true">{icon}</span>
      <span className="menu-label">{label}</span>
      {hint && <kbd className="menu-hint">{hint}</kbd>}
    </button>
  )
}

export function MenuSep() {
  return <hr className="menu-sep" />
}
