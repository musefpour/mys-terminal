import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Session, TunnelMode } from '../../../shared/types'
import { useI18n } from '../i18n'
import { allTabs } from '../layout'
import { useModel } from '../model'

type View = { id: 'home' } | { id: 'create'; mode: TunnelMode }

export function PortForwardingPanel() {
  const { t } = useI18n()
  const model = useModel()
  const [view, setView] = useState<View>({ id: 'home' })
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [items, setItems] = useState<{ id: string; mode: string; listenPort: number; targetHost: string; targetPort: number }[]>([])
  const vaultName = model.workspaces.find((item) => item.id === model.settings.activeWorkspaceId)?.name
    || t('personalVault')
  const tab = model.activeTab()
  const sshReady = Boolean(tab && (tab.protocol === 'ssh' || tab.protocol === 'sftp'))

  const refresh = async () => {
    if (!tab || !sshReady) {
      setItems([])
      return
    }
    setItems(await window.mys.tunnels.list(tab.instanceId))
  }
  useEffect(() => { void refresh() }, [tab?.instanceId, sshReady])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  if (view.id === 'create') {
    return (
      <CreateForwardView
        mode={view.mode}
        vault={vaultName}
        onBack={() => setView({ id: 'home' })}
        onSaved={() => { void refresh(); setView({ id: 'home' }) }}
      />
    )
  }

  return (
    <div className="side-panel pf">
      <div className="kc-toolbar">
        <div className="kc-split">
          <button type="button" className="kc-new" onClick={() => setView({ id: 'create', mode: 'local' })}>
            <span aria-hidden="true">+</span> {t('newForwarding')}
          </button>
          <button
            type="button"
            className="kc-chevron"
            title={t('more')}
            aria-label={t('more')}
            aria-expanded={Boolean(menu)}
            onClick={(event) => {
              event.stopPropagation()
              const box = event.currentTarget.getBoundingClientRect()
              setMenu(menu ? null : { x: box.left, y: box.bottom + 4 })
            }}
          >
            <ChevronIcon up={Boolean(menu)} />
          </button>
        </div>
      </div>

      {!sshReady && <p className="hint pf-hint">{t('needSsh')}</p>}

      {items.length === 0 ? (
        <div className="kc-empty">
          <div className="kc-empty-ico" aria-hidden="true"><ForwardIcon /></div>
          <strong>{t('addForwarding')}</strong>
          <p>{t('addForwardingHint')}</p>
        </div>
      ) : (
        <div className="side-scroll kc-list">
          {items.map((item) => (
            <article key={item.id} className="kc-card">
              <div className={`pf-badge ${item.mode}`} aria-hidden="true">{modeLetter(item.mode)}</div>
              <div className="kc-card-body">
                <strong dir="ltr">
                  {item.mode === 'dynamic'
                    ? `SOCKS :${item.listenPort}`
                    : `:${item.listenPort} → ${item.targetHost}:${item.targetPort}`}
                </strong>
                <small>{modeTitle(item.mode, t)}</small>
              </div>
              <button type="button" className="danger textish" onClick={() => void window.mys.tunnels.stop(item.id).then(() => refresh())}>
                {t('stop')}
              </button>
            </article>
          ))}
        </div>
      )}

      {menu && createPortal(
        <div className="kc-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { setMenu(null); setView({ id: 'create', mode: 'local' }) }}>
            <span className="pf-badge local">L</span> {t('localForwarding')}
          </button>
          <button type="button" onClick={() => { setMenu(null); setView({ id: 'create', mode: 'remote' }) }}>
            <span className="pf-badge remote">R</span> {t('remoteForwarding')}
          </button>
          <button type="button" onClick={() => { setMenu(null); setView({ id: 'create', mode: 'dynamic' }) }}>
            <span className="pf-badge dynamic">D</span> {t('dynamicForwarding')}
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}

function CreateForwardView({
  mode: initial,
  vault,
  onBack,
  onSaved,
}: {
  mode: TunnelMode
  vault: string
  onBack: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const model = useModel()
  const [mode, setMode] = useState<TunnelMode>(initial)
  const [label, setLabel] = useState('')
  const [listenPort, setListenPort] = useState('')
  const [bindAddress, setBindAddress] = useState('')
  const [targetHost, setTargetHost] = useState('')
  const [targetPort, setTargetPort] = useState('')
  const [hostId, setHostId] = useState('')
  const [hostsOpen, setHostsOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [help, setHelp] = useState(false)

  const sshSessions = model.sessions.filter((item) => item.protocol === 'ssh' || item.protocol === 'sftp')
  const openSsh = useMemo(
    () => allTabs(model.layout).filter((item) => item.protocol === 'ssh' || item.protocol === 'sftp'),
    [model.layout],
  )
  const selectedOpen = openSsh.find((item) => (item.spec.sessionId || item.instanceId) === hostId) || null
  const selectedSaved = sshSessions.find((item) => item.id === hostId) || null
  const hostLabel = selectedOpen?.title
    || (selectedSaved ? (selectedSaved.name || selectedSaved.host) : '')
    || (openSsh[0]?.title ?? '')

  useEffect(() => {
    if (hostId) return
    const active = model.activeTab()
    if (active && (active.protocol === 'ssh' || active.protocol === 'sftp')) {
      setHostId(active.spec.sessionId || active.instanceId)
    } else if (openSsh[0]) {
      setHostId(openSsh[0].spec.sessionId || openSsh[0].instanceId)
    }
  }, [hostId, model, openSsh])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const port = Number(listenPort)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(t('invalidListen'))
      return
    }
    if (mode !== 'dynamic') {
      if (!targetHost.trim() || !Number(targetPort)) {
        setError(t('invalidTunnelTarget'))
        return
      }
    }
    let tab = selectedOpen || openSsh.find((item) => (item.spec.sessionId || item.instanceId) === hostId) || null
    if (!tab && selectedSaved) {
      model.openSession(selectedSaved)
      setError(t('needSsh'))
      return
    }
    if (!tab) {
      tab = model.activeTab()
      if (!tab || (tab.protocol !== 'ssh' && tab.protocol !== 'sftp')) {
        setError(t('needSsh'))
        return
      }
    }
    setBusy(true)
    try {
      await window.mys.tunnels.start(tab.instanceId, {
        id: crypto.randomUUID(),
        mode,
        listenPort: port,
        targetHost: mode === 'dynamic' ? '' : targetHost.trim(),
        targetPort: mode === 'dynamic' ? 0 : Number(targetPort),
        label: label.trim() || undefined,
        bindAddress: bindAddress.trim() || undefined,
      }, tab.spec.sessionId)
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('tunnelFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="side-panel pf">
      <header className="kc-head">
        <div>
          <strong>{t('newPortForwarding')}</strong>
          <span className="kc-vault">{vault}</span>
        </div>
        <button type="button" className="kc-exit" title={t('close')} aria-label={t('close')} onClick={onBack}>
          <ExitIcon />
        </button>
      </header>

      <form className="side-scroll kc-form" onSubmit={(event) => void submit(event)}>
        <div className="kc-block">
          <div className="kc-seg pf-seg" role="group" aria-label={t('kind')}>
            {([
              ['local', t('modeLocal')],
              ['remote', t('modeRemote')],
              ['dynamic', t('modeDynamic')],
            ] as const).map(([id, title]) => (
              <button key={id} type="button" className={mode === id ? 'on' : ''} onClick={() => setMode(id)}>{title}</button>
            ))}
          </div>

          <div className="kc-identity-row">
            <div className={`pf-badge ${mode}`} aria-hidden="true">{modeLetter(mode)}</div>
            <label className={label ? 'kc-float on' : 'kc-float'} style={{ flex: 1 }}>
              <span>{t('label')}</span>
              <input value={label} onChange={(event) => setLabel(event.target.value)} />
            </label>
          </div>

          {mode === 'remote' && (
            <HostField
              label={`${t('remoteHost')} *`}
              value={hostLabel}
              onOpen={() => setHostsOpen(true)}
            />
          )}

          <input
            dir="ltr"
            type="number"
            placeholder={`${mode === 'remote' ? t('remotePort') : t('localPort')} *`}
            value={listenPort}
            onChange={(event) => setListenPort(event.target.value)}
          />

          <input
            dir="ltr"
            placeholder={t('bindAddress')}
            value={bindAddress}
            onChange={(event) => setBindAddress(event.target.value)}
          />

          {mode !== 'remote' && (
            <HostField
              label={`${t('intermediateHost')} *`}
              value={hostLabel}
              onOpen={() => setHostsOpen(true)}
            />
          )}

          {mode !== 'dynamic' && (
            <>
              <input
                dir="ltr"
                placeholder={`${t('destinationAddress')} *`}
                value={targetHost}
                onChange={(event) => setTargetHost(event.target.value)}
              />
              <input
                dir="ltr"
                type="number"
                placeholder={`${t('destinationPort')} *`}
                value={targetPort}
                onChange={(event) => setTargetPort(event.target.value)}
              />
            </>
          )}
        </div>

        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="primary kc-cta" disabled={busy}>{t('startTunnel')}</button>

        <div className="pf-help">
          <p>{t('forwardingHelp')}</p>
          <button type="button" className="pf-help-link" onClick={() => setHelp((value) => !value)}>
            {t('openForwardingWizard')}
          </button>
          {help && <p className="hint">{t('forwardingWizardHint')}</p>}
        </div>
      </form>

      {hostsOpen && (
        <HostsPicker
          open={openSsh.map((item) => ({
            id: item.spec.sessionId || item.instanceId,
            label: item.title,
            open: true,
          }))}
          saved={sshSessions}
          selected={hostId}
          onClose={() => setHostsOpen(false)}
          onPick={(id) => { setHostId(id); setHostsOpen(false) }}
        />
      )}
    </div>
  )
}

function HostField({ label, value, onOpen }: { label: string; value: string; onOpen: () => void }) {
  const { t } = useI18n()
  return (
    <div className="pf-host">
      <input dir="ltr" readOnly value={value} placeholder={label} onClick={onOpen} />
      <button type="button" className="pf-hosts-btn" onClick={onOpen}>{t('hosts')}</button>
    </div>
  )
}

function HostsPicker({
  open,
  saved,
  selected,
  onClose,
  onPick,
}: {
  open: { id: string; label: string; open: boolean }[]
  saved: Session[]
  selected: string
  onClose: () => void
  onPick: (id: string) => void
}) {
  const { t } = useI18n()
  return createPortal(
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal pf-hosts-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{t('hosts')}</h2>
          <button type="button" onClick={onClose}>{t('close')}</button>
        </header>
        <div className="side-scroll">
          {open.length > 0 && <p className="hint">{t('openSessions')}</p>}
          {open.map((item) => (
            <button
              key={`open-${item.id}`}
              type="button"
              className={selected === item.id ? 'side-row on' : 'side-row'}
              onClick={() => onPick(item.id)}
            >
              <strong dir="ltr">{item.label}</strong>
              <small>{t('connected')}</small>
            </button>
          ))}
          {saved.length > 0 && <p className="hint">{t('savedHosts')}</p>}
          {saved.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selected === item.id ? 'side-row on' : 'side-row'}
              onClick={() => onPick(item.id)}
            >
              <strong>{item.name || item.host}</strong>
              <small dir="ltr">{item.host}:{item.port}</small>
            </button>
          ))}
          {open.length === 0 && saved.length === 0 && <p className="hint">{t('needSsh')}</p>}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function modeLetter(mode: string): string {
  if (mode === 'remote') return 'R'
  if (mode === 'dynamic') return 'D'
  return 'L'
}

function modeTitle(mode: string, t: (key: 'localForwarding' | 'remoteForwarding' | 'dynamicForwarding') => string): string {
  if (mode === 'remote') return t('remoteForwarding')
  if (mode === 'dynamic') return t('dynamicForwarding')
  return t('localForwarding')
}

function ChevronIcon({ up }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style={{ transform: up ? 'rotate(180deg)' : undefined }}>
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ExitIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M14 12H7M14 12l-3-3M14 12l-3 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ForwardIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path d="M4 8h12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16h12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 12l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
