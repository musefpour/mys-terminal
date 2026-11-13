import { useEffect, useMemo, useState } from 'react'
import type { ConnectionLog, Protocol } from '../../../shared/types'
import { protocolLabel } from '../../../shared/i18n'
import { useI18n } from '../i18n'
import { useModel } from '../model'

export function LogsPanel() {
  const { t, locale } = useI18n()
  const model = useModel()
  const [items, setItems] = useState<ConnectionLog[]>([])
  const [sortDesc, setSortDesc] = useState(true)

  const refresh = () => void window.mys.connectionLogs.list().then(setItems)
  useEffect(() => { refresh() }, [])

  // Refresh when leaving an active tab / periodically while open
  useEffect(() => {
    const timer = window.setInterval(refresh, 4000)
    return () => window.clearInterval(timer)
  }, [])

  const rows = useMemo(() => {
    const list = [...items]
    list.sort((a, b) => sortDesc ? b.startedAt - a.startedAt : a.startedAt - b.startedAt)
    return list
  }, [items, sortDesc])

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale === 'de-AT' ? 'de-AT' : locale, { month: 'short', day: 'numeric', year: 'numeric' }),
    [locale],
  )
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale === 'de-AT' ? 'de-AT' : locale, { hour: '2-digit', minute: '2-digit', hour12: false }),
    [locale],
  )

  return (
    <div className="side-panel logs-panel">
      <div className="side-panel-head logs-head">
        <strong>{t('logs')}</strong>
        <button type="button" className="textish" onClick={() => void window.mys.settings.openLogs()}>{t('openLogsFolder')}</button>
      </div>

      {rows.length === 0 ? (
        <div className="kc-empty">
          <div className="kc-empty-ico" aria-hidden="true"><ClockIcon /></div>
          <strong>{t('logsEmpty')}</strong>
          <p>{t('logsEmptyHint')}</p>
        </div>
      ) : (
        <div className="logs-table-wrap">
          <table className="logs-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="logs-sort" onClick={() => setSortDesc((value) => !value)}>
                    {t('logDate')} <span aria-hidden="true">{sortDesc ? '↓' : '↑'}</span>
                  </button>
                </th>
                <th>{t('logUser')}</th>
                <th>{t('logHost')}</th>
                <th title={t('logSaved')}><BookmarkIcon /></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const user = row.userEmail || row.userName || model.account?.email || model.account?.name || t('offlineMode')
                const client = [row.clientIp, row.clientHost].filter(Boolean).join(' ')
                const initial = (user.trim()[0] || '?').toUpperCase()
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{dateFmt.format(row.startedAt)}</strong>
                      <small dir="ltr">{formatRange(row.startedAt, row.endedAt, timeFmt)}</small>
                    </td>
                    <td>
                      <div className="logs-user">
                        <span className="logs-avatar" aria-hidden="true">{initial}</span>
                        <span className="logs-user-text">
                          <strong dir="ltr">{user}</strong>
                          <small dir="ltr">{client || '—'}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="logs-host">
                        <span className={`logs-proto ${row.protocol}`} aria-hidden="true">{protoGlyph(row.protocol)}</span>
                        <span className="logs-host-text">
                          <strong>{row.hostLabel || protocolLabel(locale, row.protocol)}</strong>
                          <small dir="ltr">{protocolLabel(locale, row.protocol)}{row.username ? `, ${row.username}` : ''}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={row.saved ? 'logs-save on' : 'logs-save'}
                        title={t('logSaved')}
                        aria-label={t('logSaved')}
                        onClick={() => void window.mys.connectionLogs.toggleSaved(row.id).then(setItems)}
                      >
                        <BookmarkIcon filled={row.saved} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function formatRange(start: number, end: number, timeFmt: Intl.DateTimeFormat): string {
  const a = timeFmt.format(start)
  const b = timeFmt.format(end)
  const daySpan = Math.floor((new Date(end).setHours(0, 0, 0, 0) - new Date(start).setHours(0, 0, 0, 0)) / 86_400_000)
  const plus = daySpan > 0 ? ` (+${daySpan}d)` : ''
  return `${a} – ${b}${plus}`
}

function protoGlyph(protocol: Protocol): string {
  if (protocol === 'local') return '>'
  if (protocol === 'ssh' || protocol === 'sftp') return 'S'
  if (protocol === 'ftp') return 'F'
  if (protocol === 'vnc' || protocol === 'rdp') return 'V'
  return protocol.slice(0, 1).toUpperCase()
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <circle cx="12" cy="12" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8.5V12l2.5 2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function BookmarkIcon({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M7 4h10v16l-5-3.2L7 20z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}
