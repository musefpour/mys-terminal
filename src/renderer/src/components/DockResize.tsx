import { useState, type PointerEvent as ReactPointerEvent } from 'react'

const MIN = 280
const MAX = 720

export function useDockSize(storageKey: string, fallback: number): [number, (next: number) => void] {
  const [width, setWidth] = useState(() => readDockSize(storageKey, fallback))
  const commit = (next: number) => {
    const clamped = clampDock(next)
    setWidth(clamped)
    localStorage.setItem(storageKey, String(clamped))
  }
  return [width, commit]
}

export function DockResize({ edge, width, onWidth }: { edge: 'start' | 'end'; width: number; onWidth: (next: number) => void }) {
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const rtl = document.documentElement.dir === 'rtl'
    const grow = edge === 'start' ? (rtl ? -1 : 1) : (rtl ? 1 : -1)
    const slot = event.currentTarget.closest('.side-slot')
    slot?.classList.add('resizing')
    document.documentElement.classList.add('dock-resizing')
    const move = (ev: PointerEvent) => onWidth(width + (ev.clientX - startX) * grow)
    const up = () => {
      slot?.classList.remove('resizing')
      document.documentElement.classList.remove('dock-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return <div className="dock-resize" onPointerDown={onPointerDown} />
}

function readDockSize(key: string, fallback: number): number {
  const saved = Number(localStorage.getItem(key))
  return Number.isFinite(saved) ? clampDock(saved) : fallback
}

function clampDock(value: number): number {
  return Math.round(Math.min(MAX, Math.max(MIN, value)))
}
