import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { localeInfo, translate, type MessageKey } from '../../../shared/i18n'
import type { LockStatus } from '../../../shared/types'
import { useI18n } from '../i18n'
import { useModel } from '../model'
import { applyChrome } from '../themes'
import { BrandMark } from './BrandLogo'
import { EyeIcon, EyeOffIcon } from './Keychain'
import '../lock.css'

const MINUTES = [0, 1, 5, 10, 15, 30, 60]
const ACTIVITY_EVERY = 20_000

/**
 * Holds the app back until the master password is entered on launch, then
 * covers it (without unmounting live sessions) whenever it locks again.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LockStatus | null>(null)
  const [opened, setOpened] = useState(false)
  // The lock screen stays up after unlocking until its opening animation has played.
  const [shown, setShown] = useState(false)

  useEffect(() => {
    void window.mys.lock.status().then((next) => {
      setStatus(next)
      if (!next.locked) setOpened(true)
    })
    return window.mys.lock.onChange((locked) => {
      void window.mys.lock.status().then(setStatus)
      if (!locked) setOpened(true)
    })
  }, [])

  // Tell main the user is here; it locks after the idle limit.
  useEffect(() => {
    let last = 0
    const ping = () => {
      const now = Date.now()
      if (now - last < ACTIVITY_EVERY) return
      last = now
      window.mys.lock.activity()
    }
    const events = ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart'] as const
    for (const name of events) window.addEventListener(name, ping, { passive: true, capture: true })
    return () => {
      for (const name of events) window.removeEventListener(name, ping, { capture: true })
    }
  }, [])

  useEffect(() => {
    if (status?.locked) setShown(true)
  }, [status?.locked])

  if (!status) return null
  return (
    <>
      {opened && children}
      {shown && <LockScreen status={status} unlocked={!status.locked} onDone={() => setShown(false)} />}
    </>
  )
}

const BURST_EVENT = 'mys-lock-burst'
const UNLOCK_MS = 1100

function LockScreen({ status, unlocked, onDone }: { status: LockStatus; unlocked: boolean; onDone: () => void }) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(status.locale, key, vars)
  const lang = localeInfo(status.locale).id
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [wait, setWait] = useState(Math.ceil(status.retryIn / 1000))
  const [waitFrom, setWaitFrom] = useState(Math.max(1, Math.ceil(status.retryIn / 1000)))
  const [busy, setBusy] = useState(false)
  const [caps, setCaps] = useState(false)
  const [miss, setMiss] = useState(0)
  const [phase, setPhase] = useState<'enter' | 'idle' | 'opening'>('enter')
  const [now, setNow] = useState(() => new Date())
  const input = useRef<HTMLInputElement>(null)
  const opening = useRef(false)

  /** Burst, tear the screen open, then let the app through. Runs once. */
  const open = () => {
    if (opening.current) return
    opening.current = true
    setPassword('')
    setPhase('opening')
    window.dispatchEvent(new CustomEvent(BURST_EVENT))
    window.setTimeout(onDone, UNLOCK_MS)
  }

  // Unlocked elsewhere (another window, or main's change notice beat our own reply).
  useEffect(() => {
    if (unlocked) open()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked])

  useEffect(() => {
    applyChrome(status.theme)
    document.documentElement.dir = localeInfo(status.locale).dir
    const timer = window.setTimeout(() => {
      setPhase((value) => (value === 'enter' ? 'idle' : value))
      input.current?.focus()
    }, 900)
    return () => window.clearTimeout(timer)
  }, [status.theme, status.locale])

  useEffect(() => {
    let timer = 0
    const tick = () => {
      setNow(new Date())
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5)
    }
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (wait <= 0) return
    const timer = window.setTimeout(() => setWait((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [wait])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!password || busy || wait > 0 || phase === 'opening') return
    setBusy(true)
    setError('')
    const result = await window.mys.lock.unlock(password)
    setBusy(false)
    if (result.ok) {
      open()
      return
    }
    setPassword('')
    setMiss((value) => value + 1)
    setError(t(result.code === 'wait' ? 'lockWait' : 'lockWrongPassword'))
    const seconds = Math.ceil(result.retryIn / 1000)
    setWait(seconds)
    setWaitFrom(Math.max(1, seconds))
    input.current?.focus()
  }

  const keys = (event: ReactKeyboardEvent<HTMLInputElement>) => setCaps(event.getModifierState('CapsLock'))
  const time = now.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const date = now.toLocaleDateString(lang, { weekday: 'long', month: 'long', day: 'numeric' })
  const dots = Math.min(password.length, 18)

  return (
    <div className={`lk lk-${phase}`} role="dialog" aria-modal="true" aria-labelledby="lk-title">
      <div className="lk-aurora" aria-hidden="true"><i /><i /><i /></div>
      <LockBackdrop />
      <div className="lk-grid" aria-hidden="true" />
      <div className="lk-vignette" aria-hidden="true" />

      <div className="lk-clock" aria-hidden="true">
        <time dateTime={now.toISOString()}>
          {/* Fixed-width cells: digits of any script stay evenly spaced and never jiggle. */}
          {[...time].map((char, index) => <span key={index} className={/\d/u.test(char) || /[\u06F0-\u06F9\u0660-\u0669]/.test(char) ? 'lk-d' : 'lk-sep'}>{char}</span>)}
        </time>
        <span>{date}</span>
      </div>

      <form className={`lk-card${miss ? ` lk-miss-${miss % 2}` : ''}`} onSubmit={(event) => void submit(event)}>
        <div className={`lk-emblem${miss ? ` lk-glitch-${miss % 2}` : ''}`}>
          <span className="lk-halo" aria-hidden="true" />
          <span className="lk-ring" aria-hidden="true" />
          <svg className="lk-orbits" viewBox="0 0 200 200" aria-hidden="true">
            <circle className="lk-orbit a" cx="100" cy="100" r="92" />
            <circle className="lk-orbit b" cx="100" cy="100" r="80" />
            <g className="lk-sat a"><circle cx="100" cy="8" r="3.2" /></g>
            <g className="lk-sat b"><circle cx="100" cy="20" r="2.4" /></g>
          </svg>
          <div className="lk-logo">
            <BrandMark theme={status.theme} size={92} />
            <span className="lk-scan" aria-hidden="true" />
          </div>
          <span className={`lk-padlock${phase === 'opening' ? ' open' : ''}`} aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path className="shackle" d="M8 11V8a4 4 0 0 1 8 0v3" />
              <rect x="5" y="11" width="14" height="10" rx="2.5" />
              <circle cx="12" cy="16" r="1.4" />
            </svg>
          </span>
        </div>

        <h2 id="lk-title" className="lk-title"><span>{t('lockTitle')}</span><i className="lk-caret" aria-hidden="true" /></h2>
        <p className="lk-hint">{t('lockHint')}</p>

        <label className={`lk-field${error ? ' bad' : ''}`}>
          <span className="lk-field-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M15 7a4 4 0 1 1-3.5 5.9L4 20.4V17h3v-3h3l1.1-1.1A4 4 0 0 1 15 7z" /><circle cx="15.5" cy="10.5" r="1" /></svg>
          </span>
          <input
            ref={input}
            type={show ? 'text' : 'password'}
            dir="ltr"
            autoComplete="current-password"
            spellCheck={false}
            value={password}
            placeholder={t('lockPassword')}
            aria-label={t('lockPassword')}
            aria-invalid={Boolean(error)}
            disabled={phase === 'opening'}
            onKeyDown={keys}
            onKeyUp={keys}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="button" className="lk-eye" title={show ? translate(status.locale, 'hide') : translate(status.locale, 'show')} aria-pressed={show} onClick={() => { setShow((value) => !value); input.current?.focus() }}>
            {show ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </label>

        <div className="lk-keys" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => <i key={index} className={index < dots ? 'on' : ''} />)}
        </div>

        <div className="lk-status" role="alert">
          {caps && !error && <span className="lk-caps">{t('capsLockOn')}</span>}
          {error && (
            <span className="lk-error">
              {wait > 0 && (
                <svg className="lk-wait" viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="10" cy="10" r="8" />
                  <circle className="left" cx="10" cy="10" r="8" style={{ strokeDashoffset: `${50.3 * (1 - wait / waitFrom)}` }} />
                </svg>
              )}
              {error}{wait > 0 ? ` (${wait.toLocaleString(lang)})` : ''}
            </span>
          )}
        </div>

        <button type="submit" className={`lk-unlock${busy ? ' busy' : ''}`} disabled={!password || busy || wait > 0 || phase === 'opening'}>
          <span className="lk-unlock-shine" aria-hidden="true" />
          {busy ? <span className="lk-spin" aria-hidden="true" /> : (
            <svg className="lk-unlock-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11V8a4 4 0 0 1 7.6-1.7" /><rect x="5" y="11" width="14" height="10" rx="2.5" /></svg>
          )}
          <span>{t('lockUnlock')}</span>
        </button>
      </form>
    </div>
  )
}

/**
 * Canvas behind the lock card: falling terminal glyphs, drifting nodes that link up near
 * each other and the pointer, and a spark burst when the lock opens.
 */
function LockBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const css = getComputedStyle(document.documentElement)
    const accent = hexRgb(css.getPropertyValue('--accent').trim()) ?? [47, 191, 166]
    const hot: [number, number, number] = [229, 56, 59]
    const GLYPHS = '01<>/{}[]$#_=+*;:|~ABCDEF0123456789'
    const CELL = 18
    let w = 0
    let h = 0
    let raf = 0
    let last = performance.now()
    const mouse = { x: -9999, y: -9999 }
    type Column = { x: number; y: number; speed: number; len: number; chars: string[] }
    type Node = { x: number; y: number; vx: number; vy: number; r: number }
    type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; hot: boolean }
    let columns: Column[] = []
    let nodes: Node[] = []
    let sparks: Spark[] = []
    const pick = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
    const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      columns = []
      for (let x = CELL / 2; x < w; x += CELL * 1.6) {
        if (Math.random() < 0.45) continue
        const len = 6 + Math.floor(Math.random() * 16)
        columns.push({ x, y: Math.random() * h * 1.5 - h * 0.5, speed: 40 + Math.random() * 110, len, chars: Array.from({ length: len }, pick) })
      }
      const count = Math.round(Math.min(90, (w * h) / 16000))
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 18, vy: (Math.random() - 0.5) * 18, r: 0.8 + Math.random() * 1.6,
      }))
    }

    const burst = () => {
      const cx = w / 2
      const cy = h / 2 - 40
      for (let i = 0; i < 220; i += 1) {
        const angle = Math.random() * Math.PI * 2
        const speed = 120 + Math.random() * 620
        const max = 0.6 + Math.random() * 0.9
        sparks.push({ x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: max, max, hot: Math.random() < 0.18 })
      }
    }

    const frame = (time: number) => {
      const dt = Math.min(0.05, (time - last) / 1000)
      last = time
      ctx.clearRect(0, 0, w, h)

      // Glyph rain
      ctx.font = `600 ${CELL - 4}px "SF Mono", Menlo, Consolas, monospace`
      ctx.textAlign = 'center'
      for (const col of columns) {
        col.y += col.speed * dt
        if (Math.random() < 0.04) col.chars[Math.floor(Math.random() * col.len)] = pick()
        for (let i = 0; i < col.len; i += 1) {
          const y = col.y - i * CELL
          if (y < -CELL || y > h + CELL) continue
          const fade = 1 - i / col.len
          ctx.fillStyle = i === 0 ? `rgba(220,255,240,${0.55})` : rgba(accent, 0.28 * fade * fade)
          ctx.fillText(col.chars[i], col.x, y)
        }
        if (col.y - col.len * CELL > h) {
          col.y = -Math.random() * h * 0.4
          col.speed = 40 + Math.random() * 110
        }
      }

      // Linked nodes
      for (const node of nodes) {
        node.x += node.vx * dt
        node.y += node.vy * dt
        const dx = node.x - mouse.x
        const dy = node.y - mouse.y
        const near = dx * dx + dy * dy
        if (near < 140 * 140 && near > 1) {
          // Nodes lean away from the pointer.
          const push = (1 - Math.sqrt(near) / 140) * 60 * dt
          node.x += (dx / Math.sqrt(near)) * push
          node.y += (dy / Math.sqrt(near)) * push
        }
        if (node.x < -20) node.x = w + 20
        if (node.x > w + 20) node.x = -20
        if (node.y < -20) node.y = h + 20
        if (node.y > h + 20) node.y = -20
      }
      ctx.lineWidth = 1
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i]
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j]
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          if (d > 130) continue
          ctx.strokeStyle = rgba(accent, 0.22 * (1 - d / 130))
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
        const dm = Math.hypot(a.x - mouse.x, a.y - mouse.y)
        if (dm < 190) {
          ctx.strokeStyle = rgba(accent, 0.5 * (1 - dm / 190))
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(mouse.x, mouse.y)
          ctx.stroke()
        }
        ctx.fillStyle = rgba(accent, 0.75)
        ctx.beginPath()
        ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2)
        ctx.fill()
      }

      // Unlock sparks
      if (sparks.length) {
        ctx.globalCompositeOperation = 'lighter'
        sparks = sparks.filter((spark) => (spark.life -= dt) > 0)
        for (const spark of sparks) {
          spark.vx *= 1 - 1.6 * dt
          spark.vy = spark.vy * (1 - 1.6 * dt) + 140 * dt
          const px = spark.x
          const py = spark.y
          spark.x += spark.vx * dt
          spark.y += spark.vy * dt
          const alpha = spark.life / spark.max
          ctx.strokeStyle = spark.hot ? rgba(hot, alpha) : rgba(accent, alpha)
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.lineTo(spark.x, spark.y)
          ctx.stroke()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
      raf = window.requestAnimationFrame(frame)
    }

    const move = (event: PointerEvent) => {
      mouse.x = event.clientX
      mouse.y = event.clientY
    }
    const leave = () => {
      mouse.x = -9999
      mouse.y = -9999
    }
    const visible = () => {
      window.cancelAnimationFrame(raf)
      if (!document.hidden && !reduce) {
        last = performance.now()
        raf = window.requestAnimationFrame(frame)
      }
    }
    resize()
    if (reduce) {
      // One still frame, no motion.
      frame(performance.now())
      window.cancelAnimationFrame(raf)
    } else {
      raf = window.requestAnimationFrame(frame)
    }
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', move)
    document.addEventListener('pointerleave', leave)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener(BURST_EVENT, burst)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', leave)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener(BURST_EVENT, burst)
    }
  }, [])
  return <canvas ref={ref} className="lk-canvas" aria-hidden="true" />
}

function hexRgb(value: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value)
  if (!match) return null
  const n = parseInt(match[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Settings section: turn the master password on/off, change it, pick the idle limit. */
export function LockSettings() {
  const model = useModel()
  const { t } = useI18n()
  const [status, setStatus] = useState<LockStatus | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [minutes, setMinutes] = useState(15)
  const [mode, setMode] = useState<'idle' | 'change' | 'disable'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    void window.mys.lock.status().then((value) => {
      setStatus(value)
      if (value.enabled) setMinutes(value.minutes)
    })
  }, [])

  if (!status) return null
  const reset = () => {
    setCurrent('')
    setNext('')
    setConfirm('')
    setMode('idle')
    setError('')
  }
  const run = async (task: () => Promise<LockStatus>, done: MessageKey) => {
    setError('')
    try {
      setStatus(await task())
      reset()
      model.toast(t(done))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('saveFailed'))
    }
  }
  const setPassword = () => {
    if (next !== confirm) {
      setError(t('lockMismatch'))
      return
    }
    void run(() => window.mys.lock.setPassword(next, minutes, status.enabled ? current : undefined), status.enabled ? 'lockChanged' : 'lockEnabled')
  }

  return (
    <section className="lock-settings">
      <h3>{t('lockSection')}</h3>
      <label>
        {t('lockAfter')}
        <select
          value={minutes}
          onChange={(event) => {
            const value = Number(event.target.value)
            setMinutes(value)
            if (status.enabled) void window.mys.lock.setMinutes(value).then(setStatus)
          }}
        >
          {MINUTES.map((value) => (
            <option key={value} value={value}>{value === 0 ? t('lockNever') : t('lockMinutes', { n: value })}</option>
          ))}
        </select>
      </label>
      {(!status.enabled || mode === 'change') && (
        <>
          {status.enabled && <input type="password" dir="ltr" value={current} placeholder={t('lockCurrent')} onChange={(event) => setCurrent(event.target.value)} />}
          <input type="password" dir="ltr" autoComplete="new-password" value={next} placeholder={t('lockNew')} onChange={(event) => setNext(event.target.value)} />
          <input type="password" dir="ltr" autoComplete="new-password" value={confirm} placeholder={t('lockConfirm')} onChange={(event) => setConfirm(event.target.value)} />
        </>
      )}
      {mode === 'disable' && <input type="password" dir="ltr" value={current} placeholder={t('lockCurrent')} onChange={(event) => setCurrent(event.target.value)} />}
      {error && <p className="form-error">{error}</p>}
      <div className="row">
        {!status.enabled && <button type="button" className="primary" disabled={!next} onClick={setPassword}>{t('lockEnable')}</button>}
        {status.enabled && mode === 'idle' && (
          <>
            <button type="button" onClick={() => void window.mys.lock.lockNow()}>{t('lockNow')}</button>
            <button type="button" onClick={() => setMode('change')}>{t('lockChange')}</button>
            <button type="button" className="danger" onClick={() => setMode('disable')}>{t('lockDisable')}</button>
          </>
        )}
        {mode === 'change' && <button type="button" className="primary" disabled={!next || !current} onClick={setPassword}>{t('save')}</button>}
        {mode === 'disable' && (
          <button type="button" className="primary" disabled={!current} onClick={() => void run(() => window.mys.lock.disable(current), 'lockDisabled')}>{t('lockDisable')}</button>
        )}
        {mode !== 'idle' && <button type="button" onClick={reset}>{t('cancel')}</button>}
      </div>
    </section>
  )
}
