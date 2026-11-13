import { Terminal } from '@xterm/xterm'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RecordingInfo } from '../../../shared/types'
import { useI18n } from '../i18n'
import { useModel } from '../model'
import { themeOf } from '../themes'
import { CloseButton } from './XMark'
import { parseCast, type Cast } from '../cast'

const SPEEDS = [0.5, 1, 2, 4, 8]

export function RecordingsPanel() {
  const model = useModel()
  const { t, locale } = useI18n()
  const [items, setItems] = useState<RecordingInfo[]>([])
  const refresh = () => void window.mys.recording.list().then(setItems).catch(() => setItems([]))
  useEffect(() => {
    refresh()
    return window.mys.subscribe((event) => {
      if (event.type === 'recording') refresh()
    })
  }, [])
  const when = useMemo(() => new Intl.DateTimeFormat(locale === 'de-AT' ? 'de-AT' : locale, { dateStyle: 'medium', timeStyle: 'short' }), [locale])
  return (
    <div className="side-panel recordings-panel">
      <div className="side-panel-head">
        <strong>{t('recordings')}</strong>
      </div>
      {items.length === 0 ? (
        <p className="hint">{t('recordingsEmpty')}</p>
      ) : (
        <ul className="plain recordings-list">
          {items.map((item) => (
            <li key={item.path} className="recording-row">
              <button type="button" className="recording-open" disabled={item.active} onClick={() => model.setPlayer(item.path)}>
                <strong>{item.title}</strong>
                <small>{when.format(item.startedAt)} · {formatSize(item.size)}{item.active ? ` · ${t('recordingLive')}` : ''}</small>
              </button>
              <span className="recording-ops">
                <button type="button" title={t('reveal')} aria-label={t('reveal')} onClick={() => void window.mys.recording.reveal(item.path)}>↗</button>
                <button
                  type="button"
                  title={t('delete')}
                  aria-label={t('delete')}
                  disabled={item.active}
                  onClick={() => {
                    void model.ask(t('deleteAsk', { name: item.title })).then((ok) => {
                      if (ok) void window.mys.recording.remove(item.path).then(refresh)
                    })
                  }}
                >✕</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Modal player: a read-only xterm fed from the .cast file at the chosen speed, with seeking. */
export function RecordingPlayer() {
  const model = useModel()
  const { t } = useI18n()
  const file = model.player
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const [cast, setCast] = useState<Cast | null>(null)
  const [error, setError] = useState('')
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const state = useRef({ index: 0, position: 0 })

  useEffect(() => {
    if (!file) return
    setCast(null)
    setError('')
    void window.mys.recording.read(file).then((text) => setCast(parseCast(text))).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : t('fileOpenFailed'))
    })
  }, [file])

  useEffect(() => {
    if (!cast || !host.current) return
    const term = new Terminal({ cols: cast.cols, rows: cast.rows, disableStdin: true, cursorBlink: false, fontSize: model.settings.fontSize, fontFamily: model.settings.fontFamily, theme: { ...themeOf(model.settings.theme).term }, scrollback: 5000 })
    term.open(host.current)
    termRef.current = term
    state.current = { index: 0, position: 0 }
    setPosition(0)
    setPlaying(true)
    return () => {
      term.dispose()
      termRef.current = null
    }
  }, [cast])

  // Feed events up to the current time each animation frame.
  useEffect(() => {
    if (!cast || !playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const term = termRef.current
      if (!term) return
      state.current.position = Math.min(cast.duration, state.current.position + ((now - last) / 1000) * speed)
      last = now
      flush(term, cast, state.current)
      setPosition(state.current.position)
      if (state.current.position >= cast.duration) {
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [cast, playing, speed])

  if (!file) return null
  const seek = (target: number) => {
    const term = termRef.current
    if (!term || !cast) return
    term.reset()
    if (cast.cols !== term.cols || cast.rows !== term.rows) term.resize(cast.cols, cast.rows)
    state.current = { index: 0, position: target }
    flush(term, cast, state.current)
    setPosition(target)
  }

  return (
    <div className="modal-back" onMouseDown={() => model.setPlayer(null)}>
      <div className="modal player" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{cast?.title || t('recordings')}</h2>
          <CloseButton label={t('close')} onClick={() => model.setPlayer(null)} />
        </header>
        {error && <p className="form-error">{error}</p>}
        <div className="player-screen" dir="ltr"><div ref={host} /></div>
        {cast && (
          <div className="player-controls" dir="ltr">
            <button
              type="button"
              aria-label={playing ? t('pause') : t('resume')}
              onClick={() => {
                if (!playing && position >= cast.duration) seek(0)
                setPlaying(!playing)
              }}
            >{playing ? '❚❚' : '▶'}</button>
            <input
              type="range"
              min={0}
              max={cast.duration || 0.001}
              step={0.05}
              value={position}
              aria-label={t('recordingPosition')}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span className="player-time">{clock(position)} / {clock(cast.duration)}</span>
            <select value={speed} aria-label={t('recordingSpeed')} onChange={(event) => setSpeed(Number(event.target.value))}>
              {SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
            </select>
          </div>
        )}
      </div>
    </div>
  )
}

function flush(term: Terminal, cast: Cast, state: { index: number; position: number }): void {
  let out = ''
  while (state.index < cast.events.length && cast.events[state.index].at <= state.position) {
    const event = cast.events[state.index]
    if (event.kind === 'o') out += event.data
    else {
      const [cols, rows] = event.data.split('x').map(Number)
      if (out) term.write(out)
      out = ''
      if (cols > 1 && rows > 1) term.resize(cols, rows)
    }
    state.index += 1
  }
  if (out) term.write(out)
}

function clock(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
