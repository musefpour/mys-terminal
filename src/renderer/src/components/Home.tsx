import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { protocolLabel, type MessageKey } from '../../../shared/i18n'
import { type Protocol, type Session, dayKey, lastDayKeys } from '../../../shared/types'
import { allTabs, isHomeTab } from '../layout'
import { useI18n } from '../i18n'
import { useModel } from '../model'
import { PROTOCOL_GROUPS, PROTOCOLS, ProtocolIcon, ProtocolMark, protocolStyle, type ProtocolGroup } from '../protocols'
import { SessionMenu } from './Sidebar'
import '../home.css'

const GROUP_LABEL: Record<ProtocolGroup, MessageKey> = {
  shell: 'protoGroupShell',
  files: 'protoGroupFiles',
  desktop: 'protoGroupDesktop',
  cloud: 'protoGroupCloud',
}

/** Default port shown on the protocol tile; purely a hint. */
const PORT_HINT: Partial<Record<Protocol, string>> = {
  ssh: ':22', sftp: ':22', mosh: 'udp', telnet: ':23', raw: 'tcp', ftp: ':21', s3: ':443',
  serial: 'tty', rdp: ':3389', vnc: ':5900', browser: 'http', docker: 'sock', k8s: ':6443', powershell: 'pwsh', wsl: 'wsl',
}

const SERIES_COLORS = ['#3ad6b4', '#74a9ff', '#f2c66d', '#c39bff', '#ff8a7a', '#4cc9f0', '#f38bc0', '#9be38a', '#ec9f5e', '#97a6ff']


export function Home({ onPick }: { onPick: (protocol: Protocol) => void }) {
  const model = useModel()
  const { t, locale } = useI18n()
  const [query, setQuery] = useState('')
  const [quick, setQuick] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const quickRef = useRef<HTMLInputElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const q = query.trim().toLowerCase()
  const folders = model.folders.filter((folder) => !folder.parentId)
  const hosts = model.sessions.filter((session) => {
    if (!q) return true
    return `${session.name} ${session.host} ${session.username} ${session.protocol}`.toLowerCase().includes(q)
  })
  const cards: Protocol[] = ['ssh', 'sftp', 'mosh', 'telnet', 'raw', 'ftp', 's3', 'serial', 'rdp', 'vnc', 'browser', 'docker', 'k8s', 'powershell', ...(window.mys.platform === 'win32' ? (['wsl'] as Protocol[]) : [])]
  const ranked = [...model.sessions]
    .filter((session) => session.opens || session.activeMs || session.bytesIn || session.bytesOut || session.errors)
    .sort((a, b) => (b.activeMs + b.opens * 1000) - (a.activeMs + a.opens * 1000))
    .slice(0, 10)
  const openTabs = allTabs(model.layout).filter((tab) => !isHomeTab(tab))
  const liveIds = new Set(openTabs.map((tab) => tab.spec.sessionId).filter(Boolean) as string[])

  // "/" → host filter. (⌘K is the app-wide command palette.) Only while Home is the visible surface.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!rootRef.current || rootRef.current.offsetParent === null) return
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')
      if (event.key === '/' && !typing) {
        event.preventDefault()
        filterRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="home" ref={rootRef}>
      <div className="home-inner">
        <Greeting liveCount={openTabs.length} />
        <form
          className="cmd-bar"
          dir="ltr"
          onSubmit={(event) => {
            event.preventDefault()
            if (!quick.trim()) return
            model.openQuick(quick)
            setQuick('')
          }}
        >
          <svg className="cmd-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z" /><path d="M8 10.5l2.5 1.8L8 14" /><path d="M13 14h3" /></svg>
          <input
            ref={quickRef}
            dir="ltr"
            value={quick}
            aria-label={t('hostFind')}
            placeholder={t('hostFind')}
            onChange={(event) => setQuick(event.target.value)}
          />
          <button type="submit" className="primary">{t('connect')}</button>
        </form>

        <section className="home-section" aria-labelledby="home-hosts">
          <header className="sec-head">
            <h2 id="home-hosts">{t('hosts')}<span className="sec-count">{model.sessions.length}</span></h2>
            <div className="sec-tools">
              <button type="button" className="ghost-btn" onClick={() => model.openLocal()}>
                <ProtocolIcon protocol="local" size={14} />{t('localTerminal')}
              </button>
              <button type="button" className="ghost-btn" onClick={() => onPick('serial')}>
                <ProtocolIcon protocol="serial" size={14} />{protocolLabel(locale, 'serial')}
              </button>
              <label className="sec-filter">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z" /><path d="M15.5 15.5L20 20" /></svg>
                <input ref={filterRef} value={query} placeholder={t('search')} aria-label={t('search')} onChange={(event) => setQuery(event.target.value)} />
                {!query && <kbd className="kbd">/</kbd>}
              </label>
            </div>
          </header>
          {folders.length > 0 && (
            <div className="group-row">
              {folders.map((folder) => {
                const count = model.sessions.filter((session) => session.folderId === folder.id).length
                return (
                  <button key={folder.id} type="button" className="group-chip" onClick={() => model.setSidebar(true)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h6l2 2h10v11H3z" /></svg>
                    <strong>{folder.name}</strong>
                    <small>{count === 1 ? t('hostCountOne') : t('hostCount', { n: count })}</small>
                  </button>
                )
              })}
            </div>
          )}
          <div className="host-grid">
            {hosts.map((session) => <HostCard key={session.id} session={session} live={liveIds.has(session.id)} />)}
            {!q && (
              <button type="button" className="host-add" onClick={() => onPick('ssh')}>
                <span className="host-add-plus" aria-hidden="true">+</span>
                <span>
                  <strong>{t('newHost')}</strong>
                  <small>{model.sessions.length ? t('hostAddHint') : t('emptySessions')}</small>
                </span>
              </button>
            )}
          </div>
          {q && hosts.length === 0 && <p className="home-empty">{t('emptySessions')}</p>}
        </section>

        <section className="home-section" aria-labelledby="home-new">
          <header className="sec-head">
            <h2 id="home-new">{t('newSession')}</h2>
          </header>
          <div className="proto-groups">
            {PROTOCOL_GROUPS.map((group) => {
              const items = cards.filter((protocol) => PROTOCOLS[protocol].group === group)
              if (!items.length) return null
              return (
                <div key={group} className="proto-group">
                  <h3>{t(GROUP_LABEL[group])}</h3>
                  <div className="proto-grid">
                    {items.map((protocol) => (
                      <button type="button" key={protocol} className="proto-tile" style={protocolStyle(protocol)} onClick={() => onPick(protocol)}>
                        <ProtocolMark protocol={protocol} size={30} />
                        <strong>{protocolLabel(locale, protocol)}</strong>
                        {PORT_HINT[protocol] && <code dir="ltr">{PORT_HINT[protocol]}</code>}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="home-section" aria-labelledby="home-usage">
          <header className="sec-head">
            <h2 id="home-usage">{t('usage')}</h2>
            <span className="sec-note">{t('last7Days')}</span>
          </header>
          <UsageDashboard sessions={ranked} locale={locale} />
        </section>
      </div>
    </div>
  )
}

/* ─── header ─────────────────────────────────────────────────────────────── */

function Greeting({ liveCount }: { liveCount: number }) {
  const model = useModel()
  const { t, locale } = useI18n()
  const hour = new Date().getHours()
  const greet = hour < 5 ? t('greetEvening') : hour < 12 ? t('greetMorning') : hour < 18 ? t('greetAfternoon') : t('greetEvening')
  const name = (model.account?.name || model.account?.username || '').split(' ')[0]
  const days = lastDayKeys(7)
  const opensByDay = days.map((day) => model.sessions.reduce((sum, session) => sum + dailyValue(session, 'opens', day), 0))
  const errorsByDay = days.map((day) => model.sessions.reduce((sum, session) => sum + dailyValue(session, 'errors', day), 0))
  const opens7 = opensByDay.reduce((a, b) => a + b, 0)
  const errors7 = errorsByDay.reduce((a, b) => a + b, 0)
  const attempts = opens7 + errors7
  const rate = attempts ? errors7 / attempts : 0
  const delta = opensByDay[6] - opensByDay[5]
  const favorites = model.sessions.filter((session) => session.favorite).length
  const live = new Set(allTabs(model.layout).map((tab) => tab.spec.sessionId).filter(Boolean)).size
  const dateLine = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

  return (
    <header className="greet">
      <div className="greet-copy">
        <p className="eyebrow"><i className="eyebrow-dot" aria-hidden="true" />{dateLine}</p>
        <h1>{name ? `${greet}, ${name}` : greet}</h1>
        <p className="greet-sub">{t('homeBody')}</p>
      </div>
      <div className="kpis" role="list">
        <Kpi label={t('kpiHosts')} value={String(model.sessions.length)} sub={favorites ? `★ ${favorites}` : undefined} />
        <Kpi label={t('kpiLive')} value={String(liveCount)} sub={live ? t('hostCount', { n: live }) : undefined} tone={liveCount ? 'live' : undefined} />
        <Kpi
          label={t('kpiToday')}
          value={String(opensByDay[6] ?? 0)}
          sub={delta ? `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}` : undefined}
          spark={opensByDay}
        />
        <Kpi
          label={t('kpiErrorRate')}
          value={`${(rate * 100).toFixed(rate && rate < 0.1 ? 1 : 0)}%`}
          sub={errors7 ? `${errors7} / ${attempts}` : undefined}
          spark={errorsByDay}
          tone={rate > 0.1 ? 'danger' : undefined}
        />
      </div>
    </header>
  )
}

function Kpi({ label, value, sub, spark, tone }: { label: string; value: string; sub?: string; spark?: number[]; tone?: 'live' | 'danger' }) {
  return (
    <div className={tone ? `kpi tone-${tone}` : 'kpi'} role="listitem">
      <span className="kpi-label">{label}</span>
      <div className="kpi-row">
        <span className="kpi-figure">
          <span className="kpi-value" dir="ltr">{value}</span>
          {sub && <span className="kpi-sub" dir="ltr">{sub}</span>}
        </span>
        {spark && <Sparkline values={spark} className="kpi-spark" />}
      </div>
    </div>
  )
}

function Sparkline({ values, className, color }: { values: number[]; className?: string; color?: string }) {
  const width = 72
  const height = 22
  const max = Math.max(1, ...values)
  const points = values.map((value, index) => ({
    x: values.length > 1 ? (index / (values.length - 1)) * width : width / 2,
    y: height - 2 - (value / max) * (height - 4),
  }))
  const line = smoothPath(points)
  const empty = values.every((value) => !value)
  return (
    <svg className={className ? `spark ${className}` : 'spark'} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={color ? { color } : undefined}>
      {!empty && <path d={`${line} L${width} ${height} L0 ${height} Z`} className="spark-fill" />}
      <path d={line} className={empty ? 'spark-line idle' : 'spark-line'} />
    </svg>
  )
}

/* ─── hosts ──────────────────────────────────────────────────────────────── */

function HostCard({ session, live }: { session: Session; live: boolean }) {
  const model = useModel()
  const { t, locale } = useI18n()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const skipOpen = useRef(false)
  const title = session.name || session.host || protocolLabel(locale, session.protocol)
  const meta = session.host ? `${session.username ? `${session.username}@` : ''}${session.host}${session.port && ![22, 0].includes(session.port) ? `:${session.port}` : ''}` : protocolLabel(locale, session.protocol)
  const status = live ? 'live' : session.lastUsed ? 'seen' : 'never'
  const statusText = live ? t('hostLive') : session.lastUsed ? relativeTime(session.lastUsed, locale) : t('hostNever')
  const open = () => {
    if (skipOpen.current || menuAt) {
      skipOpen.current = false
      return
    }
    model.openSession(session)
  }
  const stop = (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    skipOpen.current = false
  }
  return (
    <div
      className={`host-card is-${status}`}
      style={protocolStyle(session.protocol, session.color)}
      role="button"
      tabIndex={0}
      aria-label={`${title} — ${meta}`}
      onDoubleClick={open}
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          model.openSession(session)
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        skipOpen.current = true
        setMenuAt({ x: event.clientX, y: event.clientY })
      }}
    >
      <div className="host-top">
        <ProtocolMark protocol={session.protocol} icon={session.icon} color={session.color} size={34} />
        <span className="host-copy">
          <strong dir="auto" title={title}>{title}</strong>
          <small dir="ltr" title={meta}>{meta}</small>
        </span>
        {session.favorite && <span className="host-star" aria-label={t('favorite')}>★</span>}
      </div>
      <div className="host-foot">
        <span className={`host-status ${status}`}><i aria-hidden="true" />{statusText}</span>
        <span className="host-proto" dir="ltr">{session.protocol.toUpperCase()}</span>
      </div>
      <div className="host-actions" onClick={stop}>
        <button type="button" title={t('connect')} aria-label={t('connect')} onClick={() => model.openSession(session)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>
        </button>
        {session.protocol === 'ssh' && (
          <button type="button" title={protocolLabel(locale, 'sftp')} aria-label={protocolLabel(locale, 'sftp')} onClick={() => model.openSession({ ...session, protocol: 'sftp' })}>
            <ProtocolIcon protocol="sftp" size={15} />
          </button>
        )}
        <button type="button" title={t('edit')} aria-label={t('edit')} onClick={() => model.editSession(session)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
        </button>
        <button
          type="button"
          title={t('more')}
          aria-label={t('more')}
          aria-haspopup="menu"
          onClick={(event) => {
            skipOpen.current = true
            const box = event.currentTarget.getBoundingClientRect()
            setMenuAt(menuAt ? null : { x: box.left, y: box.bottom + 4 })
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h.01" /><path d="M12 12h.01" /><path d="M18 12h.01" /></svg>
        </button>
      </div>
      {menuAt && (
        <SessionMenu
          session={session}
          x={menuAt.x}
          y={menuAt.y}
          onClose={() => {
            skipOpen.current = true
            setMenuAt(null)
            window.setTimeout(() => { skipOpen.current = false }, 300)
          }}
        />
      )}
    </div>
  )
}

/* ─── usage ──────────────────────────────────────────────────────────────── */

function chartLabel(session: Session, locale: string): string {
  return session.name || session.host || protocolLabel(locale, session.protocol)
}

function UsageDashboard({ sessions, locale }: { sessions: Session[]; locale: string }) {
  const { t } = useI18n()
  const days = lastDayKeys(7)
  const series = sessions.map((session, index) => ({
    id: session.id,
    label: chartLabel(session, locale),
    color: SERIES_COLORS[index % SERIES_COLORS.length],
    opens: days.map((day) => dailyValue(session, 'opens', day)),
    errors: days.map((day) => dailyValue(session, 'errors', day)),
  }))
  const usageTotal = Math.max(1, sessions.reduce((sum, session) => sum + usageWeight(session), 0))
  const slices = sessions.map((session, index) => ({
    id: session.id,
    label: chartLabel(session, locale),
    color: SERIES_COLORS[index % SERIES_COLORS.length],
    value: usageWeight(session),
    pct: usageWeight(session) / usageTotal,
  }))
  const rows = sessions
    .map((session, index) => ({
      session,
      label: chartLabel(session, locale),
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      value: usageWeight(session),
      spark: days.map((day) => dailyValue(session, 'opens', day)),
    }))
    .sort((a, b) => b.value - a.value)
  const dayLabels = days.map((day) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(`${day}T12:00:00`)))
  const dayLong = days.map((day) => new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00`)))
  const activeMs = sessions.reduce((sum, session) => sum + session.activeMs, 0)

  return (
    <div className="usage-dash">
      <div className="usage-top">
        <AreaChart title={t('chartDailyOpens')} days={dayLabels} daysLong={dayLong} series={series.map((row) => ({ ...row, values: row.opens }))} tone="ok" />
        <AreaChart title={t('chartDailyErrors')} days={dayLabels} daysLong={dayLong} series={series.map((row) => ({ ...row, values: row.errors }))} tone="danger" />
        <ShareDonut title={t('chartShare')} slices={slices} center={formatDuration(activeMs)} centerLabel={t('chartTime')} />
      </div>
      <div className="usage-bottom">
        <SessionRows title={t('chartConsume')} rows={rows} />
        <ErrorLog sessions={sessions} locale={locale} />
      </div>
    </div>
  )
}

function usageWeight(session: Session): number {
  return Math.max(session.activeMs, 0) + Math.max(session.bytesIn + session.bytesOut, 0) + session.opens * 1000
}

function dailyValue(session: Session, kind: 'opens' | 'errors', day: string): number {
  const map = kind === 'opens' ? session.dailyOpens : session.dailyErrors
  if (map && Object.keys(map).length) return map[day] || 0
  if (kind === 'opens' && session.opens) {
    const stamp = dayKey(session.lastUsed || session.createdAt || Date.now())
    return stamp === day ? session.opens : 0
  }
  if (kind === 'errors' && session.errors) {
    const stamp = dayKey(session.lastUsed || session.createdAt || Date.now())
    return stamp === day ? session.errors : 0
  }
  return 0
}

/** Horizontal-tangent cubic: smooth, never overshoots below the baseline. */
function smoothPath(points: { x: number; y: number }[]): string {
  if (!points.length) return ''
  let d = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const dx = (b.x - a.x) / 2.4
    d += ` C${(a.x + dx).toFixed(1)} ${a.y.toFixed(1)} ${(b.x - dx).toFixed(1)} ${b.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
  }
  return d
}

function AreaChart({
  title,
  days,
  daysLong,
  series,
  tone,
}: {
  title: string
  days: string[]
  daysLong: string[]
  series: { id: string; label: string; color: string; values: number[] }[]
  tone: 'ok' | 'danger'
}) {
  const { t } = useI18n()
  const uid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const width = 480
  const height = 168
  const padX = 14
  const padT = 14
  const padB = 26
  const active = series.filter((row) => row.values.some(Boolean))
  const totals = days.map((_, index) => series.reduce((sum, row) => sum + row.values[index], 0))
  const sum = totals.reduce((a, b) => a + b, 0)
  const max = Math.max(1, ...active.flatMap((row) => row.values))
  const xAt = (index: number) => padX + (days.length > 1 ? (index / (days.length - 1)) * (width - padX * 2) : (width - padX * 2) / 2)
  const yAt = (value: number) => height - padB - (value / max) * (height - padT - padB)
  const base = yAt(0)

  return (
    <section className={`panel chart tone-${tone}`}>
      <header className="panel-head">
        <h3>{title}</h3>
        <span className="panel-figure" dir="ltr">{sum}</span>
      </header>
      <div
        className="chart-box"
        dir="ltr"
        tabIndex={active.length ? 0 : -1}
        role="img"
        aria-label={`${title}: ${days.map((day, index) => `${daysLong[index]} ${totals[index]}`).join(', ')}`}
        onMouseLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') setHover((value) => Math.min(days.length - 1, (value ?? -1) + 1))
          else if (event.key === 'ArrowLeft') setHover((value) => Math.max(0, (value ?? days.length) - 1))
          else if (event.key === 'Escape') setHover(null)
        }}
      >
        <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          <defs>
            {active.map((row) => (
              <linearGradient key={row.id} id={`${uid}-${row.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={row.color} stopOpacity={active.length > 1 ? 0.16 : 0.32} />
                <stop offset="100%" stopColor={row.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {[0.5, 1].map((ratio) => (
            <line key={ratio} className="chart-grid" x1={padX} x2={width - padX} y1={yAt(max * ratio)} y2={yAt(max * ratio)} />
          ))}
          <line className="chart-base" x1={padX} x2={width - padX} y1={base} y2={base} />
          {active.length === 0 ? (
            <path className="chart-ghost" d={smoothPath(days.map((_, index) => ({ x: xAt(index), y: base - 18 - Math.sin(index * 1.3) * 12 })))} />
          ) : active.map((row) => {
            const coords = row.values.map((value, index) => ({ x: xAt(index), y: yAt(value) }))
            const line = smoothPath(coords)
            return (
              <g key={row.id}>
                <path d={`${line} L${coords[coords.length - 1].x.toFixed(1)} ${base} L${coords[0].x.toFixed(1)} ${base} Z`} fill={`url(#${uid}-${row.id})`} />
                <path d={line} fill="none" stroke={row.color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )
          })}
          {hover !== null && active.length > 0 && (
            <g>
              <line className="chart-cursor" x1={xAt(hover)} x2={xAt(hover)} y1={padT - 4} y2={base} />
              {active.map((row) => (
                <circle key={row.id} cx={xAt(hover)} cy={yAt(row.values[hover])} r="3.5" fill={row.color} className="chart-dot" />
              ))}
            </g>
          )}
          {days.map((day, index) => (
            <text key={`${day}-${index}`} className={hover === index ? 'chart-axis on' : 'chart-axis'} x={xAt(index)} y={height - 7} textAnchor="middle">{day}</text>
          ))}
          {active.length > 0 && days.map((_, index) => (
            <rect
              key={index}
              x={xAt(index) - (width - padX * 2) / (days.length - 1 || 1) / 2}
              y={0}
              width={(width - padX * 2) / (days.length - 1 || 1)}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          ))}
        </svg>
        {active.length === 0 && (
          <p className="chart-empty">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l5-5 4 3 8-8" /><path d="M15 7h5v5" /></svg>
            {tone === 'danger' ? t('chartNoErrors') : t('chartQuiet')}
          </p>
        )}
        {hover !== null && active.length > 0 && (
          <div className="chart-tip" style={{ left: `${(xAt(hover) / width) * 100}%` }} data-edge={hover === 0 ? 'start' : hover === days.length - 1 ? 'end' : undefined}>
            <header><span>{daysLong[hover]}</span><b>{totals[hover]}</b></header>
            <ul>
              {active
                .filter((row) => row.values[hover])
                .sort((a, b) => b.values[hover] - a.values[hover])
                .slice(0, 5)
                .map((row) => (
                  <li key={row.id}><i style={{ background: row.color }} /><span dir="auto">{row.label}</span><b>{row.values[hover]}</b></li>
                ))}
            </ul>
          </div>
        )}
      </div>
      {active.length > 0 && (
        <ul className="chart-legend">
          {active.map((row) => (
            <li key={row.id}><i style={{ background: row.color }} /><span dir="auto" title={row.label}>{row.label}</span></li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ShareDonut({
  title,
  slices,
  center,
  centerLabel,
}: {
  title: string
  slices: { id: string; label: string; color: string; value: number; pct: number }[]
  center: string
  centerLabel: string
}) {
  const [hover, setHover] = useState<string | null>(null)
  const size = 160
  const c = size / 2
  const r = 60
  const stroke = 14
  const circ = 2 * Math.PI * r
  const gap = slices.length > 1 ? 3 : 0
  let offset = 0
  const arcs = slices.filter((slice) => slice.value > 0).map((slice) => {
    const length = Math.max(0, slice.pct * circ - gap)
    const arc = { ...slice, length, offset }
    offset += slice.pct * circ
    return arc
  })
  const focus = hover ? slices.find((slice) => slice.id === hover) : null

  return (
    <section className="panel donut">
      <header className="panel-head"><h3>{title}</h3></header>
      <div className="donut-wrap">
        <div className="donut-ring" dir="ltr">
          <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}: ${slices.map((slice) => `${slice.label} ${Math.round(slice.pct * 100)}%`).join(', ')}`}>
            <circle cx={c} cy={c} r={r} className="donut-track" strokeWidth={stroke} fill="none" />
            {arcs.map((arc) => (
              <circle
                key={arc.id}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={arc.color}
                strokeWidth={hover === arc.id ? stroke + 4 : stroke}
                strokeDasharray={`${arc.length} ${circ - arc.length}`}
                strokeDashoffset={-arc.offset}
                transform={`rotate(-90 ${c} ${c})`}
                opacity={hover && hover !== arc.id ? 0.35 : 1}
                className="donut-arc"
                onMouseEnter={() => setHover(arc.id)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </svg>
          <div className="donut-center">
            <b>{focus ? `${Math.round(focus.pct * 100)}%` : center}</b>
            <small dir="auto">{focus ? focus.label : centerLabel}</small>
          </div>
        </div>
        {slices.length > 0 ? (
          <ul className="donut-legend">
            {slices.map((slice) => (
              <li
                key={slice.id}
                className={hover === slice.id ? 'on' : ''}
                onMouseEnter={() => setHover(slice.id)}
                onMouseLeave={() => setHover(null)}
              >
                <i style={{ background: slice.color }} />
                <span dir="auto" title={slice.label}>{slice.label}</span>
                <b dir="ltr">{Math.round(slice.pct * 100)}%</b>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote />
        )}
      </div>
    </section>
  )
}

function SessionRows({ title, rows }: { title: string; rows: { session: Session; label: string; color: string; value: number; spark: number[] }[] }) {
  const { t } = useI18n()
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <section className="panel sessions">
      <header className="panel-head"><h3>{title}</h3></header>
      {rows.length === 0 ? (
        <SkeletonRows />
      ) : (
        <ul className="srows">
          {rows.map(({ session, label, color, value, spark }) => (
            <li key={session.id} style={{ ['--row' as string]: color }}>
              <div className="srow-name">
                <ProtocolMark protocol={session.protocol} icon={session.icon} color={session.color} size={26} />
                <span>
                  <strong dir="auto" title={label}>{label}</strong>
                  <i className="srow-bar" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} aria-hidden="true" />
                </span>
              </div>
              <Sparkline values={spark} className="srow-spark" color={color} />
              <span className="srow-num" dir="ltr" title={t('chartTime')}>{formatDuration(session.activeMs)}</span>
              <span className="srow-io" dir="ltr" title={t('chartTraffic')}>
                <span>↓ {formatBytes(session.bytesIn)}</span>
                <span>↑ {formatBytes(session.bytesOut)}</span>
              </span>
              <span className="srow-pills" dir="ltr">
                <span className="pill ok" title={t('chartSuccess')}>{session.opens}</span>
                <span className={session.errors ? 'pill err' : 'pill err zero'} title={t('chartErrors')}>{session.errors}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const ERROR_CODE = /\b(E[A-Z][A-Z0-9_]{2,}|ERR_[A-Z0-9_]+|HTTP \d{3})\b/
const AUTH_HINT = /auth|permission|denied|password|passphrase|key|credential|login/i

function ErrorLog({ sessions, locale }: { sessions: Session[]; locale: string }) {
  const { t } = useI18n()
  const entries = sessions
    .flatMap((session) => (session.errorLog || []).map((entry) => ({
      session,
      host: chartLabel(session, locale),
      at: entry.at,
      message: entry.message,
    })))
    .sort((a, b) => b.at - a.at)
  // Collapse consecutive identical (host, message) entries into one row with a count.
  const groups: { key: string; host: string; session: Session; at: number; first: number; message: string; count: number }[] = []
  for (const entry of entries) {
    const key = `${entry.session.id}|${entry.message}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.count += 1
      last.first = entry.at
    } else {
      groups.push({ key, host: entry.host, session: entry.session, at: entry.at, first: entry.at, message: entry.message, count: 1 })
    }
  }
  const shown = groups.slice(0, 8)

  return (
    <section className="panel errlog">
      <header className="panel-head">
        <h3>{t('chartErrorReasons')}</h3>
        {entries.length > 0 && <span className="panel-figure tone-danger" dir="ltr">{entries.length}</span>}
      </header>
      {shown.length === 0 ? (
        <p className="errlog-clear">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>
          {t('chartNoErrors')}
        </p>
      ) : (
        <ol className="errlog-list">
          {shown.map((row) => {
            const code = row.message.match(ERROR_CODE)?.[0]
            const severity = AUTH_HINT.test(row.message) ? 'warn' : 'err'
            const parts = code ? row.message.split(code) : [row.message]
            return (
              <li key={`${row.key}-${row.at}`} className={`sev-${severity}`} title={new Date(row.at).toLocaleString(locale)}>
                <div className="errlog-meta">
                  <span className="host-chip" style={protocolStyle(row.session.protocol, row.session.color)}>
                    <ProtocolIcon protocol={row.session.protocol} icon={row.session.icon} size={11} />
                    <span dir="auto">{row.host}</span>
                  </span>
                  {row.count > 1 && <span className="errlog-count" dir="ltr">×{row.count}</span>}
                  <time dateTime={new Date(row.at).toISOString()}>{relativeTime(row.at, locale)}</time>
                </div>
                <p className="errlog-msg" dir="ltr">
                  {code ? <>{parts[0]}<code>{code}</code>{parts.slice(1).join(code)}</> : row.message}
                </p>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function EmptyNote() {
  const { t } = useI18n()
  return <p className="panel-empty">{t('chartEmpty')}</p>
}

function SkeletonRows() {
  const { t } = useI18n()
  return (
    <div className="skeleton-rows">
      {[0.9, 0.6, 0.75].map((w) => (
        <div key={w} className="skeleton-row" aria-hidden="true">
          <i className="sk sk-mark" />
          <i className="sk" style={{ width: `${w * 40}%` }} />
          <i className="sk sk-end" />
        </div>
      ))}
      <p className="panel-empty">{t('chartEmpty')}</p>
    </div>
  )
}

/* ─── formatting ─────────────────────────────────────────────────────────── */

function relativeTime(at: number, locale: string): string {
  const diff = (at - Date.now()) / 1000
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  if (abs < 45) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(at)
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}
