import { useState, type CSSProperties } from 'react'
import { protocolBadge, protocolLabel } from '../../../shared/i18n'
import type { Session } from '../../../shared/types'
import { APP_THEMES } from '../themes'
import { useI18n } from '../i18n'
import { useModel } from '../model'
import { FilePanel } from './FilePanel'
import { SessionMenu } from './Sidebar'
import { CloseButton } from './XMark'
import { KEY_ALT, ScriptsTab } from './SnippetList'
import { titled } from '../keys'
import { HostBadge } from '../protocols'
import type { TermThemeName } from '../../../shared/types'

type SideTab = 'folders' | 'scripts' | 'history' | 'theme'

export function RightPanel({ instanceId, mode, terminal = false, visible = true, onClose }: {
  instanceId: string
  mode: 'sftp' | 'ftp' | 's3' | 'local'
  terminal?: boolean
  visible?: boolean
  onClose?: () => void
}) {
  const { t } = useI18n()
  const [tab, setTab] = useState<SideTab>('folders')
  const tabs: { id: SideTab; label: string; icon: 'rocket' | 'code' | 'clock' | 'palette' }[] = [
    { id: 'folders', label: t('folders'), icon: 'rocket' },
    { id: 'scripts', label: t('scripts'), icon: 'code' },
    { id: 'history', label: t('history'), icon: 'clock' },
    { id: 'theme', label: t('theme'), icon: 'palette' },
  ]
  return (
    <aside
      className="files"
      onKeyDown={(event) => {
        // ⌥1–⌥4 switch tabs while focus is inside the panel.
        const digit = /^Digit([1-4])$/.exec(event.code)
        if (!digit || !event.altKey || event.metaKey || event.ctrlKey) return
        event.preventDefault()
        setTab(tabs[Number(digit[1]) - 1].id)
      }}
    >
      <div className="side-tabs-bar">
        <div
          className="side-tabs"
          role="tablist"
          aria-orientation="horizontal"
          style={{ '--seg-i': tabs.findIndex((item) => item.id === tab) } as CSSProperties}
          onKeyDown={(event) => {
            const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key as 'ArrowRight' | 'ArrowLeft']
            if (!step) return
            event.preventDefault()
            const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
            const at = tabs.findIndex((item) => item.id === tab)
            const next = (at + (rtl ? -step : step) + tabs.length) % tabs.length
            setTab(tabs[next].id)
            event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
          }}
        >
          <span className="seg-indicator" aria-hidden="true" />
          {tabs.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              data-tip={`${item.label}  ${KEY_ALT}${index + 1}`}
              aria-label={item.label}
              aria-keyshortcuts={`Alt+${index + 1}`}
              aria-selected={tab === item.id}
              tabIndex={tab === item.id ? 0 : -1}
              className={tab === item.id ? 'on tip' : 'tip'}
              onClick={() => setTab(item.id)}
            >
              <SideIcon name={item.icon} />
            </button>
          ))}
        </div>
        {onClose && <CloseButton label={titled(t('close'), 'sidePanel')} onClick={onClose} />}
      </div>
      <div className="side-body">
        {tab === 'history' && <HistoryTab />}
        {tab === 'scripts' && <ScriptsTab />}
        {tab === 'theme' && <ThemeTab />}
        {tab === 'folders' && <FilePanel instanceId={instanceId} mode={mode} terminal={terminal} visible={visible} bare />}
      </div>
    </aside>
  )
}

function SideIcon({ name }: { name: 'rocket' | 'code' | 'clock' | 'palette' }) {
  if (name === 'rocket') {
    return (
      <svg className="side-ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 19c-2.5-1.2-4-3.6-4.5-6.5C8 8 10 4.5 12 3c2 1.5 4 5 4.5 9.5-.5 2.9-2 5.3-4.5 6.5z" />
        <path d="M12 19c0 1.2.4 2.2 1 3M12 19c0 1.2-.4 2.2-1 3" />
        <path d="M8.2 14.2C6.5 14.6 5 16 4.5 17.5c1.6.2 3.2-.4 4.2-1.6M15.8 14.2c1.7.4 3.2 1.8 3.7 3.3-1.6.2-3.2-.4-4.2-1.6" />
        <circle cx="12" cy="10" r="1.3" />
      </svg>
    )
  }
  if (name === 'code') {
    return (
      <svg className="side-ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 5.2c-2 .35-2.8 1.55-2.8 3.05 0 1.75 1.25 2.35 1.25 3.75S7.2 14 7.2 15.75c0 1.5.8 2.7 2.8 3.05" />
        <path d="M14 5.2c2 .35 2.8 1.55 2.8 3.05 0 1.75-1.25 2.35-1.25 3.75s1.25 1.95 1.25 3.7c0 1.5-.8 2.7-2.8 3.05" />
      </svg>
    )
  }
  if (name === 'clock') {
    return (
      <svg className="side-ico" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7.25" />
        <path d="M12 8.5V12l2.5 2" />
      </svg>
    )
  }
  return (
    <svg className="side-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4.2c-4.3 0-7.5 2.85-7.5 6.5 0 2.15 1.15 3.7 2.9 4.4.65.25.95.75.95 1.35 0 1.05.85 1.7 2 1.7 4.15 0 7.45-2.95 7.45-6.85 0-3.85-2.75-7.1-5.8-7.1z" />
      <circle cx="9.15" cy="15.55" r="1.15" />
      <circle className="dot" cx="8.35" cy="8.35" r="1.05" />
      <circle className="dot" cx="11.9" cy="7.15" r="1.05" />
      <circle className="dot" cx="15.15" cy="8.9" r="1.05" />
    </svg>
  )
}

function HistoryTab() {
  const model = useModel()
  const { t, locale } = useI18n()
  const items = [...model.sessions].filter((session) => session.lastUsed > 0).sort((a, b) => b.lastUsed - a.lastUsed)
  const format = new Intl.DateTimeFormat(locale === 'de-AT' ? 'de-AT' : locale, { month: 'numeric', day: 'numeric', year: '2-digit' })
  if (!items.length) return <p className="hint">{t('emptyHistory')}</p>
  return (
    <div className="side-scroll">
      {items.map((session) => (
        <HistoryCard key={session.id} session={session} when={format.format(session.lastUsed)} />
      ))}
    </div>
  )
}

function HistoryCard({ session, when }: { session: Session; when: string }) {
  const model = useModel()
  const { t, locale } = useI18n()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const title = session.name || session.host || protocolLabel(locale, session.protocol)
  const host = `${session.username ? `${session.username}@` : ''}${session.host}${session.port ? `:${session.port}` : ''}`
  return (
    <article
      className="hist-card"
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuAt({ x: event.clientX, y: event.clientY })
      }}
    >
      <button type="button" className="hist-open" onClick={() => model.openSession(session)}>
        <HostBadge protocol={session.protocol} label={protocolBadge(locale, session.protocol)} icon={session.icon} color={session.color} />
        <span className="hist-copy">
          <strong>{title}</strong>
          <small className="item-meta">
            <time>{when}</time>
            <span dir="ltr">{host || protocolLabel(locale, session.protocol)}</span>
          </small>
        </span>
      </button>
      <button
        type="button"
        className="star"
        onClick={(event) => {
          event.stopPropagation()
          const box = event.currentTarget.getBoundingClientRect()
          setMenuAt(menuAt ? null : { x: box.left, y: box.bottom + 4 })
        }}
      >⋯</button>
      {menuAt && <SessionMenu session={session} x={menuAt.x} y={menuAt.y} onClose={() => setMenuAt(null)} />}
      <button
        type="button"
        className="hist-del"
        title={t('delete')}
        aria-label={t('delete')}
        onClick={() => { void model.saveSession({ ...session, lastUsed: 0 }, undefined, { quiet: true }) }}
      >
        <TrashIcon />
      </button>
    </article>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 12h8l1-12" />
    </svg>
  )
}

function ThemeTab() {
  const model = useModel()
  const { t } = useI18n()
  const pick = (theme: TermThemeName) => {
    void model.saveSettings({ ...model.settings, theme }, { quiet: true })
  }
  return (
    <div className="side-scroll">
      <p className="hint">{t('themeNight')}</p>
      {APP_THEMES.filter((item) => item.mode === 'night').map((item) => (
        <ThemeRow key={item.id} id={item.id} label={item.label} bg={item.term.background || '#000'} accent={item.chrome.accent} on={model.settings.theme === item.id} onPick={pick} />
      ))}
      <p className="hint">{t('themeDay')}</p>
      {APP_THEMES.filter((item) => item.mode === 'day').map((item) => (
        <ThemeRow key={item.id} id={item.id} label={item.label} bg={item.term.background || '#fff'} accent={item.chrome.accent} on={model.settings.theme === item.id} onPick={pick} />
      ))}
    </div>
  )
}

function ThemeRow({ id, label, bg, accent, on, onPick }: { id: TermThemeName; label: string; bg: string; accent: string; on: boolean; onPick: (id: TermThemeName) => void }) {
  return (
    <button type="button" className={on ? 'side-row theme on' : 'side-row theme'} onClick={() => onPick(id)}>
      <i className="swatch" style={{ background: bg, boxShadow: `inset 0 0 0 3px ${accent}` }} />
      <strong>{label}</strong>
    </button>
  )
}
