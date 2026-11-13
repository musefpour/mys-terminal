import { useEffect, useState } from 'react'
import type { LocalServerInfo, LocalServerKind } from '../../../shared/types'
import { useI18n } from '../i18n'
import { useModel } from '../model'
import { CloseButton } from './XMark'

const KINDS: { kind: LocalServerKind; label: string; port: number }[] = [
  { kind: 'http', label: 'HTTP', port: 8080 },
  { kind: 'tftp', label: 'TFTP', port: window.mys.platform === 'linux' ? 6969 : 69 },
  { kind: 'ftp', label: 'FTP', port: 2121 },
]

/** Share a local folder over HTTP / TFTP / FTP for devices on the LAN. */
export function ServersDrawer() {
  const model = useModel()
  const { t } = useI18n()
  const [running, setRunning] = useState<LocalServerInfo[]>([])
  useEffect(() => {
    void window.mys.servers.list().then(setRunning)
    return window.mys.subscribe((event) => {
      if (event.type === 'servers') setRunning(event.items)
    })
  }, [])
  return (
    <aside className="drawer wide servers-drawer">
      <header><h2>{t('localServers')}</h2><CloseButton label={t('close')} onClick={() => model.setDrawer(null)} /></header>
      <p className="hint">{t('localServersHint')}</p>
      {KINDS.map((item) => (
        <ServerCard
          key={item.kind}
          kind={item.kind}
          label={item.label}
          defaultPort={item.port}
          live={running.find((server) => server.kind === item.kind) ?? null}
          onStarted={(info) => setRunning((list) => [...list.filter((server) => server.id !== info.id), info])}
        />
      ))}
    </aside>
  )
}

function ServerCard({ kind, label, defaultPort, live, onStarted }: {
  kind: LocalServerKind
  label: string
  defaultPort: number
  live: LocalServerInfo | null
  onStarted: (info: LocalServerInfo) => void
}) {
  const { t } = useI18n()
  const storeKey = `mys.server.${kind}`
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) || '{}') as Partial<{ root: string; port: number; lanAccess: boolean; allowWrite: boolean; user: string }>
    } catch {
      return {}
    }
  })()
  const [root, setRoot] = useState(saved.root || '')
  const [port, setPort] = useState(saved.port || defaultPort)
  const [lanAccess, setLanAccess] = useState(saved.lanAccess ?? true)
  const [allowWrite, setAllowWrite] = useState(saved.allowWrite ?? false)
  const [user, setUser] = useState(saved.user || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setError('')
    setBusy(true)
    try {
      localStorage.setItem(storeKey, JSON.stringify({ root, port, lanAccess, allowWrite, user }))
      onStarted(await window.mys.servers.start(kind, { root, port, lanAccess, allowWrite, user, password }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={live ? 'server-card on' : 'server-card'}>
      <header>
        <strong>{label}</strong>
        <span className={live ? 'server-state on' : 'server-state'}>{live ? t('serverRunning') : t('serverStopped')}</span>
      </header>
      {live ? (
        <>
          <ul className="plain server-addresses" dir="ltr">
            {live.addresses.map((address) => (
              <li key={address}>
                <code>{address}</code>
                <button type="button" onClick={() => void navigator.clipboard.writeText(address)}>{t('copy')}</button>
              </li>
            ))}
          </ul>
          <small className="hint" dir="ltr">{live.root}{live.allowWrite ? ` · ${t('serverWritable')}` : ` · ${t('serverReadOnly')}`}</small>
          {live.log.length > 0 && <pre className="server-log" dir="ltr">{live.log.slice(-8).join('\n')}</pre>}
          <button type="button" onClick={() => void window.mys.servers.stop(live.id)}>{t('stop')}</button>
        </>
      ) : (
        <>
          <label>
            {t('serverFolder')}
            <span className="inline">
              <input dir="ltr" value={root} onChange={(event) => setRoot(event.target.value)} />
              <button type="button" onClick={() => void window.mys.dialog.pickFolder().then((folder) => folder && setRoot(folder))}>{t('choose')}</button>
            </span>
          </label>
          <div className="grid-2">
            <label>{t('port')}<input dir="ltr" type="number" min={1} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} /></label>
            {kind === 'ftp' && <label>{t('user')}<input dir="ltr" value={user} placeholder="anonymous" onChange={(event) => setUser(event.target.value)} /></label>}
          </div>
          {kind === 'ftp' && user && <label>{t('password')}<input dir="ltr" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
          <label className="check"><input type="checkbox" checked={lanAccess} onChange={(event) => setLanAccess(event.target.checked)} /> {t('serverLan')}</label>
          {kind !== 'http' && <label className="check"><input type="checkbox" checked={allowWrite} onChange={(event) => setAllowWrite(event.target.checked)} /> {t('serverAllowWrite')}</label>}
          {error && <p className="form-error">{error}</p>}
          <button type="button" className="primary" disabled={!root || busy} onClick={() => void start()}>{t('serverStart')}</button>
        </>
      )}
    </section>
  )
}
