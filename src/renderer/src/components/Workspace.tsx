import { useCallback, useEffect, useRef, useState } from 'react'
import { protocolBadge, protocolLabel, type MessageKey } from '../../../shared/i18n'
import { type OpenResult, type Protocol, type TermThemeName, dayKey, lastDayKeys } from '../../../shared/types'
import type { Layout, Leaf, Tab } from '../layout'
import { isHomeTab } from '../layout'
import { useI18n } from '../i18n'
import { useModel } from '../model'
import { APP_THEMES } from '../themes'
import { LanguageField } from './LanguagePicker'
import { CloseButton, XMark } from './XMark'
import { EditorModal } from './FilePanel'
import { DockResize, useDockSize } from './DockResize'
import { RightPanel } from './RightPanel'
import { snippetCommand } from '../snippet-command'
import { HostBadge } from '../protocols'
import { titled } from '../keys'
import { FONT_DEFAULT, FONT_MAX, FONT_MIN } from '../terminal-protocols'
import { TabMenu } from './TabMenu'
import { wasHandedOff } from '../term-registry'
import { isTerminalProtocol, TerminalView } from './TerminalView'
import { MonitorBar } from './MonitorBar'
import { LockSettings } from './Lock'
import { RecordingPlayer } from './Recordings'
import { ServersDrawer } from './Servers'
import { Home } from './Home'

export function Workspace() {
  const model = useModel()
  const { t } = useI18n()
  const tab = model.activeTab()
  const shared = tab && !isHomeTab(tab) && (tab.protocol === 'ssh' || tab.protocol === 'local')
  const [filesWidth, setFilesWidth] = useDockSize('mys.dock.end', 340)
  return (
    <div className="workspace">
      <LayoutView node={model.layout} />
      {shared && (
        <div className={`side-slot end${tab.showFiles ? ' open' : ''}`} style={{ ['--dock-size' as string]: `${filesWidth}px` }}>
          <div className="dock">
            <RightPanel
              instanceId={tab.instanceId}
              mode={tab.protocol === 'local' ? 'local' : 'sftp'}
              terminal
              visible={tab.showFiles}
              onClose={() => model.toggleFiles(tab.instanceId)}
            />
            <DockResize edge="end" width={filesWidth} onWidth={setFilesWidth} />
          </div>
        </div>
      )}
    </div>
  )
}

function LayoutView({ node }: { node: Layout }) {
  const model = useModel()
  if (node.kind === 'leaf') return <LeafView leaf={node} />
  const onDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const parent = event.currentTarget.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const horizontal = node.dir === 'h'
    const update = (client: number) => {
      const ratio = horizontal ? (client - rect.top) / rect.height : (client - rect.left) / rect.width
      model.resizeSplit(node.id, ratio)
    }
    const move = (ev: PointerEvent) => update(horizontal ? ev.clientY : ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className={`split split-${node.dir}`} style={{ ['--ratio' as string]: String(node.ratio) }}>
      <LayoutView node={node.a} />
      <div className="gutter" onPointerDown={onDrag} />
      <LayoutView node={node.b} />
    </div>
  )
}

function LeafView({ leaf }: { leaf: Leaf }) {
  const model = useModel()
  const { t, locale } = useI18n()
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const menuTab = menu ? leaf.tabs.find((tab) => tab.instanceId === menu.tabId) : undefined
  const active = leaf.tabs.find((tab) => tab.instanceId === leaf.activeTabId) ?? null
  const focused = model.activeLeafId === leaf.id
  return (
    <section className={focused ? 'leaf focused' : 'leaf'} onMouseDown={() => model.focusLeaf(leaf.id)}>
      <div className="tabbar">
        <div className="tabs">
          {leaf.tabs.filter((tab) => !(model.detached && isHomeTab(tab))).map((tab) => (
            <button
              type="button"
              key={tab.instanceId}
              className={['tab', tab.instanceId === leaf.activeTabId && 'on', tab.color && 'colored', tab.pinned && 'pinned'].filter(Boolean).join(' ')}
              style={tab.color ? { ['--tab-color' as string]: tab.color } : undefined}
              title={tab.title}
              onClick={() => model.activateTab(leaf.id, tab.instanceId)}
              onAuxClick={(event) => {
                // Middle click closes, like a browser tab.
                if (event.button === 1 && !isHomeTab(tab) && !tab.pinned) void model.closeTabById(leaf.id, tab.instanceId)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                if (isHomeTab(tab)) return
                setMenu({ tabId: tab.instanceId, x: event.clientX, y: event.clientY })
              }}
            >
              {isHomeTab(tab) ? (
                <i className="badge p-home" aria-hidden="true">
                  <svg viewBox="0 0 16 16"><path d="M2.8 7.2 8 2.8l5.2 4.4V13H9.7V9.6H6.3V13H2.8z" /></svg>
                </i>
              ) : <TabBadge tab={tab} />}
              <span>{isHomeTab(tab) ? t('home') : tab.title}</span>
              {tab.pinned && (
                <i className="tab-pin" aria-label={t('tabUnpin')}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5" /></svg>
                </i>
              )}
              {!isHomeTab(tab) && !tab.pinned && (
                <em
                  title={t('close')}
                  onClick={(event) => {
                    event.stopPropagation()
                    model.closeTabById(leaf.id, tab.instanceId)
                  }}
                ><XMark /></em>
              )}
            </button>
          ))}
        </div>
        <div className="tab-tools">
          {active && !isHomeTab(active) && isTerminalProtocol(active.protocol) && <FontSizeControl sessionId={active.spec.sessionId} />}
          {active && !isHomeTab(active) && isTerminalProtocol(active.protocol) && (
            <button
              type="button"
              title={titled(model.recordingIds.includes(active.instanceId) ? t('recordStop') : t('recordStart'), 'record')}
              aria-label={model.recordingIds.includes(active.instanceId) ? t('recordStop') : t('recordStart')}
              aria-pressed={model.recordingIds.includes(active.instanceId)}
              className={model.recordingIds.includes(active.instanceId) ? 'record-btn on' : 'record-btn'}
              onClick={() => model.toggleRecording(active.instanceId)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" /></svg>
            </button>
          )}
          {model.layout.kind === 'split' && (
            <CloseButton label={titled(t('closePane'), 'closePane')} onClick={() => model.closePane(leaf.id)} />
          )}
          {/* Last, so it sits next to the side panel it opens. */}
          {active && !isHomeTab(active) && ['ssh', 'local', 'sftp', 'ftp', 's3'].includes(active.protocol) && (
            <button
              type="button"
              title={titled(t('sidePanel'), 'sidePanel')}
              aria-label={t('sidePanel')}
              aria-pressed={active.showFiles}
              className={active.showFiles ? 'side-end-btn on' : 'side-end-btn'}
              onClick={() => model.toggleFiles(active.instanceId)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.5 2.5h11v11h-11z" />
                <path d="M10.5 2.5v11" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {menu && menuTab && <TabMenu leaf={leaf} tab={menuTab} x={menu.x} y={menu.y} onClose={closeMenu} />}
      {leaf.tabs.map((tab) => (
        <div key={tab.instanceId} data-tab-slot={tab.instanceId} className={tab.instanceId === leaf.activeTabId ? 'surface-slot' : 'surface-slot hidden'}>
          {isHomeTab(tab) ? <Home onPick={(protocol) => model.openBlank(protocol)} /> : <Surface tabId={tab.instanceId} />}
        </div>
      ))}
    </section>
  )
}

const RECONNECTABLE = new Set<Protocol>(['ssh', 'sftp', 'telnet', 'raw', 'serial', 'ftp'])
const MAX_ATTEMPTS = 6

function TabBadge({ tab }: { tab: Tab }) {
  const model = useModel()
  const { locale } = useI18n()
  const session = tab.spec.sessionId ? model.sessions.find((item) => item.id === tab.spec.sessionId) : undefined
  return <HostBadge protocol={tab.protocol} label={protocolBadge(locale, tab.protocol)} icon={session?.icon} color={session?.color} />
}

function Surface({ tabId }: { tabId: string }) {
  const model = useModel()
  const { t } = useI18n()
  const tab = findTab(model.layout, tabId)
  const [phase, setPhase] = useState<'connecting' | 'open' | 'error'>('connecting')
  const [failure, setFailure] = useState<Extract<OpenResult, { ok: false }> | null>(null)
  const [detail, setDetail] = useState('')
  const [vnc, setVnc] = useState<{ listen: number; password: string } | null>(null)
  const [password, setPassword] = useState('')
  const [retry, setRetry] = useState<{ in: number; next: number } | null>(null)
  const attempt = tab?.attempt ?? 0
  const autoRef = useRef(model.settings.autoReconnect)
  autoRef.current = model.settings.autoReconnect

  // Count down, then reopen the tab with the next attempt number.
  useEffect(() => {
    if (!retry || !tab) return
    if (retry.in <= 0) {
      model.reconnect(tab.instanceId, undefined, retry.next)
      return
    }
    const timer = window.setTimeout(() => setRetry((value) => (value ? { ...value, in: value.in - 1 } : null)), 1000)
    return () => window.clearTimeout(timer)
  }, [retry])

  useEffect(() => {
    if (!tab) return
    let cancelled = false
    const scheduleRetry = (next: number) => {
      if (!autoRef.current || !RECONNECTABLE.has(tab.protocol) || next > MAX_ATTEMPTS) return false
      setRetry({ in: Math.min(30, 2 ** next), next })
      return true
    }
    const unsub = window.mys.subscribe((event) => {
      if (event.type === 'exit' && event.instanceId === tab.instanceId) {
        setFailure({ ok: false, message: t(event.reason === 'lost' ? 'connectionLost' : 'connectionClosed'), code: 'error' })
        setPhase('error')
        if (event.reason === 'lost') scheduleRetry(1)
      }
    })
    if (tab.adopted) {
      // Moved here from another window: the connection is already up.
      setPhase('open')
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('mys-fit', { detail: tab.instanceId })), 50)
      return () => {
        cancelled = true
        unsub()
        if (!wasHandedOff(tab.instanceId)) void window.mys.close(tab.instanceId)
      }
    }
    void window.mys.open(tab.spec).then((result) => {
      if (cancelled) {
        void window.mys.close(tab.instanceId)
        return
      }
      if (!result.ok) {
        setFailure(result)
        setPhase('error')
        if (tab.spec.sessionId) void model.refresh()
        // Only keep retrying a link that was up before; auth and host-key problems need the user.
        if (attempt > 0 && result.code === 'error') scheduleRetry(attempt + 1)
        return
      }
      if (attempt > 0) model.patchTab(tab.instanceId, { attempt: 0 })
      setDetail(result.detail || '')
      if (result.vncListen) setVnc({ listen: result.vncListen, password: result.vncPassword || '' })
      setPhase('open')
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('mys-fit', { detail: tab.instanceId }))
      }, 50)
    })
    return () => {
      cancelled = true
      unsub()
      // A tab moved to another window keeps its connection.
      if (!wasHandedOff(tab.instanceId)) void window.mys.close(tab.instanceId)
    }
  }, [tab?.instanceId])

  if (!tab) return null
  const isCurrent = model.activeTab()?.instanceId === tab.instanceId
  const terminal = isTerminalProtocol(tab.protocol)
  const filesOnly = tab.protocol === 'sftp' || tab.protocol === 'ftp' || tab.protocol === 's3'
  const hasSide = phase === 'open' && filesOnly

  return (
    <div className="surface">
      <div className="surface-main">
        {terminal && phase === 'open' && <TerminalView instanceId={tab.instanceId} active={isCurrent} sessionId={tab.spec.sessionId} protocol={tab.protocol} />}
        {tab.protocol === 'ssh' && phase === 'open' && isCurrent && model.settings.serverMonitor && <MonitorBar instanceId={tab.instanceId} />}
        {tab.protocol === 'browser' && phase === 'open' && <BrowserPane initial={tab.spec.url || 'https://example.com'} />}
        {tab.protocol === 'vnc' && phase === 'open' && vnc && <VncPane listen={vnc.listen} password={vnc.password} />}
        {tab.protocol === 'rdp' && phase === 'open' && <RdpCard detail={detail} onAgain={() => model.reconnect(tab.instanceId)} />}
        {phase === 'connecting' && (
          <div className="overlay connecting" aria-busy="true">
            <span className="connecting-spin" aria-hidden="true" />
            <span className="connecting-label">{t('connecting')}</span>
          </div>
        )}
        {phase === 'error' && failure && (
          <div className="overlay">
            <div className="overlay-panel">
              <strong>{failure.message}</strong>
              {retry && <p className="hint">{t('reconnectingIn', { s: Math.max(0, retry.in), n: retry.next, max: MAX_ATTEMPTS })}</p>}
              {failure.fingerprint && <code dir="ltr">{failure.fingerprint}</code>}
              {failure.code === 'auth' && (
                <input dir="ltr" type="password" value={password} placeholder={t('password')} onChange={(event) => setPassword(event.target.value)} />
              )}
              <div className="row">
                {failure.code === 'hostkey' && (
                  <button type="button" className="primary" onClick={() => model.reconnect(tab.instanceId, { forceHostKey: true })}>{t('acceptHostKey')}</button>
                )}
                {failure.code === 'auth' && (
                  <button type="button" className="primary" onClick={() => model.reconnect(tab.instanceId, { password })}>{t('connectWithPassword')}</button>
                )}
                <button type="button" onClick={() => model.reconnect(tab.instanceId)}>{t('retry')}</button>
                {retry && <button type="button" onClick={() => setRetry(null)}>{t('cancel')}</button>}
              </div>
            </div>
          </div>
        )}
      </div>
      {hasSide && (
        <div className={`side-slot end${tab.showFiles ? ' open' : ''}${filesOnly ? ' fill' : ''}`}>
          <div className="dock">
            <RightPanel
              instanceId={tab.instanceId}
              mode={tab.protocol === 'ftp' ? 'ftp' : tab.protocol === 's3' ? 's3' : tab.protocol === 'local' ? 'local' : 'sftp'}
              visible={tab.showFiles}
              onClose={() => model.toggleFiles(tab.instanceId)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function findTab(layout: Layout, id: string): Tab | null {
  if (layout.kind === 'leaf') return layout.tabs.find((tab) => tab.instanceId === id) ?? null
  return findTab(layout.a, id) || findTab(layout.b, id)
}

function BrowserPane({ initial }: { initial: string }) {
  const { t } = useI18n()
  const [url, setUrl] = useState(initial)
  const [current, setCurrent] = useState(initial)
  const ref = useStateElement(current)
  return (
    <div className="browser" dir="ltr">
      <form onSubmit={(event) => { event.preventDefault(); setCurrent(normalize(url)) }}>
        <input value={url} onChange={(event) => setUrl(event.target.value)} />
        <button type="submit">{t('go')}</button>
      </form>
      <div className="browser-host" ref={ref} />
    </div>
  )
}

function useStateElement(url: string) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = ref.current
    if (!host) return
    host.replaceChildren()
    const view = document.createElement('webview')
    view.setAttribute('src', url)
    view.setAttribute('partition', 'persist:mysbrowser')
    view.setAttribute('allowpopups', 'true')
    view.style.width = '100%'
    view.style.height = '100%'
    host.appendChild(view)
  }, [url])
  return ref
}

function normalize(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return `https://${url}`
}

function VncPane({ listen, password }: { listen: number; password: string }) {
  const ref = useEffectVnc(listen, password)
  return <div className="vnc-host" dir="ltr" ref={ref} />
}

function useEffectVnc(listen: number, password: string) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = ref.current
    if (!host) return
    let dead = false
    let client: { disconnect?: () => void } | null = null
    void import('@novnc/novnc').then((mod) => {
      if (dead || !ref.current) return
      const exported = mod as unknown as { default?: VncCtor }
      const RFB = exported.default
      if (!RFB) return
      const session = new RFB(ref.current, `ws://127.0.0.1:${listen}`, { credentials: { password } })
      session.scaleViewport = true
      session.resizeSession = true
      client = session
    }).catch(() => undefined)
    return () => {
      dead = true
      client?.disconnect?.()
    }
  }, [listen, password])
  return ref
}

interface VncCtor {
  new (target: HTMLElement, url: string, options: { credentials: { password: string } }): {
    scaleViewport: boolean
    resizeSession: boolean
    disconnect: () => void
  }
}

function RdpCard({ detail, onAgain }: { detail: string; onAgain: () => void }) {
  const { t } = useI18n()
  return (
    <div className="overlay">
      <div className="overlay-panel">
        <strong>Remote Desktop</strong>
        <p>{detail || t('externalDetail')}</p>
        <button type="button" onClick={onAgain}>{t('openAgain')}</button>
      </div>
    </div>
  )
}

export function Drawers() {
  const model = useModel()
  return (
    <>
      {model.drawer === 'tunnels' && <TunnelDrawer />}
      {model.drawer === 'macros' && <MacroDrawer />}
      {model.drawer === 'tools' && <ToolDrawer />}
      {model.drawer === 'settings' && <SettingsDrawer />}
      {model.drawer === 'servers' && <ServersDrawer />}
      <EditorModal />
      <RecordingPlayer />
    </>
  )
}

function TunnelDrawer() {
  const model = useModel()
  const { t } = useI18n()
  const tab = model.activeTab()
  const [mode, setMode] = useState<'local' | 'remote' | 'dynamic'>('local')
  const [listenPort, setListenPort] = useState(8080)
  const [targetHost, setTargetHost] = useState('127.0.0.1')
  const [targetPort, setTargetPort] = useState(80)
  const [items, setItems] = useState<{ id: string; mode: string; listenPort: number; targetHost: string; targetPort: number }[]>([])
  const [error, setError] = useState('')

  const refresh = async () => {
    if (!tab) return
    setItems(await window.mys.tunnels.list(tab.instanceId))
  }
  useEffect(() => { void refresh() }, [tab?.instanceId])

  return (
    <aside className="drawer">
      <header><h2>{t('sshTunnel')}</h2><CloseButton label={t('close')} onClick={() => model.setDrawer(null)} /></header>
      {!tab || (tab.protocol !== 'ssh' && tab.protocol !== 'sftp') ? (
        <p className="hint">{t('needSsh')}</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setError('')
            void window.mys.tunnels.start(tab.instanceId, {
              id: crypto.randomUUID(),
              mode,
              listenPort,
              targetHost,
              targetPort,
            }, tab.spec.sessionId).then(() => refresh()).catch((caught: unknown) => {
              setError(caught instanceof Error ? caught.message : t('tunnelFailed'))
            })
          }}
        >
          <label>{t('kind')}
            <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
              <option value="local">{t('modeLocal')}</option>
              <option value="remote">{t('modeRemote')}</option>
              <option value="dynamic">{t('modeDynamic')}</option>
            </select>
          </label>
          <label>{t('listenPort')}<input dir="ltr" type="number" value={listenPort} onChange={(event) => setListenPort(Number(event.target.value))} /></label>
          {mode !== 'dynamic' && (
            <>
              <label>{t('targetHost')}<input dir="ltr" value={targetHost} onChange={(event) => setTargetHost(event.target.value)} /></label>
              <label>{t('targetPort')}<input dir="ltr" type="number" value={targetPort} onChange={(event) => setTargetPort(Number(event.target.value))} /></label>
            </>
          )}
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="primary">{t('startTunnel')}</button>
        </form>
      )}
      <ul className="plain">
        {items.map((item) => (
          <li key={item.id}>
            <span dir="ltr">{item.mode} :{item.listenPort}{item.mode === 'dynamic' ? ' SOCKS' : ` → ${item.targetHost}:${item.targetPort}`}</span>
            <button type="button" onClick={() => void window.mys.tunnels.stop(item.id).then(() => refresh())}>{t('stop')}</button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

/** − size + for the active terminal; the menu shortcuts (⌘= ⌘- ⌘0) do the same through model.changeFontSize. */
function FontSizeControl({ sessionId }: { sessionId?: string }) {
  const model = useModel()
  const { t } = useI18n()
  const session = sessionId ? model.sessions.find((item) => item.id === sessionId) : undefined
  const size = session?.termFontSize || model.settings.fontSize
  return (
    <div className="font-size-ctl" role="group" aria-label={t('fontSize')}>
      <button type="button" title={titled(t('fontSmaller'), 'fontSmaller')} aria-label={t('fontSmaller')} disabled={size <= FONT_MIN} onClick={() => model.changeFontSize(-1)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" /></svg>
      </button>
      <button type="button" className="font-size-value" title={titled(t('fontReset', { n: FONT_DEFAULT }), 'fontReset')} aria-label={t('fontReset', { n: FONT_DEFAULT })} onClick={() => model.changeFontSize(null)}>
        {size}
      </button>
      <button type="button" title={titled(t('fontBigger'), 'fontBigger')} aria-label={t('fontBigger')} disabled={size >= FONT_MAX} onClick={() => model.changeFontSize(1)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8M8 4v8" /></svg>
      </button>
    </div>
  )
}

function MacroDrawer() {
  const model = useModel()
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [sendEnter, setSendEnter] = useState(true)
  const send = (value: string, enter: boolean) => {
    const tab = model.activeTab()
    if (!tab || !isTerminalProtocol(tab.protocol)) {
      model.toast(t('pickTerminal'), 'err')
      return
    }
    const data = enter ? `${value}\n` : value
    window.mys.write(tab.instanceId, data)
    if (model.multiExec) model.broadcast(data, tab.instanceId)
    window.dispatchEvent(new CustomEvent('mys-focus', { detail: tab.instanceId }))
  }
  return (
    <aside className="drawer">
      <header><h2>{t('macros')}</h2><CloseButton label={t('close')} onClick={() => model.setDrawer(null)} /></header>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim() || !command) return
          void model.saveMacros([...model.macros, { id: crypto.randomUUID(), name: name.trim(), command, sendEnter }])
          setName('')
          setCommand('')
        }}
      >
        <label>{t('name')}<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>{t('command')}<textarea dir="ltr" value={command} onChange={(event) => setCommand(event.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={sendEnter} onChange={(event) => setSendEnter(event.target.checked)} /> {t('sendEnter')}</label>
        <button type="submit" className="primary">{t('add')}</button>
      </form>
      <ul className="plain">
        {model.macros.map((macro) => (
          <li key={macro.id}>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void snippetCommand(macro).then((command) => { if (command) send(command, macro.sendEnter) })}
            >{macro.name}</button>
            <button type="button" onClick={() => void model.saveMacros(model.macros.filter((item) => item.id !== macro.id))}>{t('delete')}</button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function ToolDrawer() {
  const model = useModel()
  const { t } = useI18n()
  const [host, setHost] = useState('')
  const [mac, setMac] = useState('')
  const [output, setOutput] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  useEffect(() => window.mys.subscribe((event) => {
    if (event.type !== 'tool') return
    if (event.stream === 'done') setRunId(null)
    else setOutput((prev) => prev + (event.data || ''))
  }), [])
  const run = (tool: 'ping' | 'traceroute' | 'nslookup' | 'whois' | 'ports' | 'wol') => {
    const id = crypto.randomUUID()
    setRunId(id)
    setOutput('')
    void window.mys.tools.run({ runId: id, tool, host, mac })
  }
  return (
    <aside className="drawer wide">
      <header><h2>{t('networkTools')}</h2><CloseButton label={t('close')} onClick={() => model.setDrawer(null)} /></header>
      <label>{t('host')}<input dir="ltr" value={host} onChange={(event) => setHost(event.target.value)} /></label>
      <div className="wrap-row">
        <button type="button" onClick={() => run('ping')}>Ping</button>
        <button type="button" onClick={() => run('traceroute')}>Traceroute</button>
        <button type="button" onClick={() => run('nslookup')}>DNS</button>
        <button type="button" onClick={() => run('whois')}>Whois</button>
        <button type="button" onClick={() => run('ports')}>{t('commonPorts')}</button>
        {runId && <button type="button" onClick={() => void window.mys.tools.cancel(runId)}>{t('stop')}</button>}
      </div>
      <label>{t('macWol')}<input dir="ltr" value={mac} placeholder="aa:bb:cc:dd:ee:ff" onChange={(event) => setMac(event.target.value)} /></label>
      <button type="button" onClick={() => run('wol')}>{t('wake')}</button>
      <pre dir="ltr">{output || t('toolOutput')}</pre>
    </aside>
  )
}

function SettingsDrawer() {
  const model = useModel()
  const { t } = useI18n()
  const [draft, setDraft] = useState(model.settings)
  useEffect(() => setDraft(model.settings), [model.settings])
  return (
    <div className="modal-back" onMouseDown={() => model.setDrawer(null)}>
    <div className="modal settings" onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>{t('settings')}</h2><CloseButton label={t('close')} onClick={() => model.setDrawer(null)} /></header>
      <div className="settings-lang">
        <label>{t('language')}</label>
        <LanguageField />
      </div>
      <div className="settings-grid">
        <label>{t('fontSize')}<input type="number" min={10} max={24} value={draft.fontSize} onChange={(event) => setDraft({ ...draft, fontSize: Number(event.target.value) })} /></label>
        <label>{t('font')}
          <select value={draft.fontFamily} onChange={(event) => setDraft({ ...draft, fontFamily: event.target.value })}>
            <option value='Menlo, "SF Mono", ui-monospace, monospace'>Menlo</option>
            <option value='"SF Mono", Menlo, ui-monospace, monospace'>SF Mono</option>
            <option value='"JetBrains Mono", Menlo, ui-monospace, monospace'>JetBrains Mono</option>
            <option value="ui-monospace, Menlo, monospace">{t('fontSystem')}</option>
          </select>
        </label>
        <label>{t('theme')}
          <select
            value={draft.theme}
            onChange={(event) => {
              const theme = event.target.value as TermThemeName
              const next = { ...draft, theme }
              setDraft(next)
              void model.saveSettings(next, { quiet: true })
            }}
          >
            <optgroup label={t('themeNight')}>
              {APP_THEMES.filter((item) => item.mode === 'night').map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </optgroup>
            <optgroup label={t('themeDay')}>
              {APP_THEMES.filter((item) => item.mode === 'day').map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>{t('scrollback')}<input type="number" min={1000} max={100000} value={draft.scrollback} onChange={(event) => setDraft({ ...draft, scrollback: Number(event.target.value) })} /></label>
      </div>
      <div className="settings-checks">
        <label className="check"><input type="checkbox" checked={draft.cursorBlink} onChange={(event) => setDraft({ ...draft, cursorBlink: event.target.checked })} /> {t('cursorBlink')}</label>
        <label className="check"><input type="checkbox" checked={draft.copyOnSelect} onChange={(event) => setDraft({ ...draft, copyOnSelect: event.target.checked })} /> {t('copyOnSelect')}</label>
        <label className="check"><input type="checkbox" checked={draft.logAll} onChange={(event) => setDraft({ ...draft, logAll: event.target.checked })} /> {t('logAll')}</label>
        <label className="check"><input type="checkbox" checked={draft.openLocalOnStart} onChange={(event) => setDraft({ ...draft, openLocalOnStart: event.target.checked })} /> {t('openLocalOnStart')}</label>
        <label className="check"><input type="checkbox" checked={draft.autoReconnect} onChange={(event) => setDraft({ ...draft, autoReconnect: event.target.checked })} /> {t('autoReconnect')}</label>
        <label className="check"><input type="checkbox" checked={draft.restoreTabs} onChange={(event) => setDraft({ ...draft, restoreTabs: event.target.checked })} /> {t('restoreTabs')}</label>
        <label className="check"><input type="checkbox" checked={draft.serverMonitor} onChange={(event) => setDraft({ ...draft, serverMonitor: event.target.checked })} /> {t('serverMonitorSetting')}</label>
        <label className="check"><input type="checkbox" checked={draft.autoUpdate} onChange={(event) => setDraft({ ...draft, autoUpdate: event.target.checked })} /> {t('autoUpdateSetting')}</label>
        <label className="check"><input type="checkbox" checked={draft.webgl} onChange={(event) => setDraft({ ...draft, webgl: event.target.checked })} /> {t('webglSetting')}</label>
        <label className="check"><input type="checkbox" checked={draft.pasteWarning} onChange={(event) => setDraft({ ...draft, pasteWarning: event.target.checked })} /> {t('pasteWarningSetting')}</label>
        <label className="check"><input type="checkbox" checked={draft.highlightKeywords} onChange={(event) => setDraft({ ...draft, highlightKeywords: event.target.checked })} /> {t('highlightSetting')}</label>
        <label className="check"><input type="checkbox" checked={draft.recordAll} onChange={(event) => setDraft({ ...draft, recordAll: event.target.checked })} /> {t('recordAllSetting')}</label>
      </div>
      <LockSettings />
      <footer>
        <button type="button" onClick={() => void window.mys.updates.check()}>{t('updateCheck')}</button>
        <button type="button" onClick={() => void window.mys.settings.openLogs()}>{t('openLogs')}</button>
        <span className="grow" />
        <button type="button" className="primary" onClick={() => void model.saveSettings(draft)}>{t('save')}</button>
      </footer>
    </div>
    </div>
  )
}

export function StatusBar() {
  const model = useModel()
  const { t, locale } = useI18n()
  const tab = model.activeTab()
  const [stats, setStats] = useState({ inn: 0, out: 0 })
  useEffect(() => window.mys.subscribe((event) => {
    if (event.type === 'stats' && tab && event.instanceId === tab.instanceId) {
      setStats({ inn: event.bytesIn, out: event.bytesOut })
    }
  }), [tab?.instanceId])
  return (
    <footer className="statusbar">
      <span>{tab && !isHomeTab(tab) ? (tab.title === protocolLabel(locale, tab.protocol) ? tab.title : `${protocolLabel(locale, tab.protocol)} · ${tab.title}`) : t('ready')}</span>
      {model.multiExec && <MultiBar />}
      <span dir="ltr">{tab && !isHomeTab(tab) ? `↓ ${formatBytes(stats.inn)}   ↑ ${formatBytes(stats.out)}` : ''}</span>
    </footer>
  )
}

function MultiBar() {
  const model = useModel()
  const { t } = useI18n()
  const [line, setLine] = useState('')
  const send = (data: string) => {
    if (!data) return
    const tab = model.activeTab()
    if (tab && isTerminalProtocol(tab.protocol)) window.mys.write(tab.instanceId, data)
    model.broadcast(data, tab?.instanceId)
  }
  return (
    <form className="multi" onSubmit={(event) => event.preventDefault()}>
      <input
        dir="ltr"
        value={line}
        placeholder={t('multiPlaceholder')}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text')
          if (!text) return
          event.preventDefault()
          setLine((value) => value + text)
          send(text)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
          if (event.key === 'Enter') {
            event.preventDefault()
            send('\n')
            setLine('')
            return
          }
          if (event.key === 'Backspace') {
            event.preventDefault()
            setLine((value) => value.slice(0, -1))
            send('\x7f')
            return
          }
          if (event.key === 'Tab') {
            event.preventDefault()
            setLine((value) => `${value}\t`)
            send('\t')
            return
          }
          if (event.key.length !== 1) return
          event.preventDefault()
          setLine((value) => value + event.key)
          send(event.key)
        }}
      />
    </form>
  )
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
