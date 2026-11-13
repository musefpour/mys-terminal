import { useEffect, useState, type ReactNode } from 'react'
import { protocolLabel, titledSession, type MessageKey } from '../../../shared/i18n'
import {
  DEFAULT_PORT,
  fontStacks,
  type FtpSecure,
  type Protocol,
  type ProxyType,
  type Session,
} from '../../../shared/types'
import { useI18n } from '../i18n'
import { specFromSession, useModel } from '../model'
import { APP_THEMES } from '../themes'
import { useFolderOptions } from './Sidebar'
import { CloseButton } from './XMark'
import { IconField } from './IconPicker'
import { EyeIcon, EyeOffIcon } from './Keychain'
import { PROTOCOL_GROUPS, PROTOCOLS as PROTOCOL_META, ProtocolIcon, protocolStyle, type ProtocolGroup } from '../protocols'

const PROTOCOL_LIST: Protocol[] = [
  'ssh', 'sftp', 'mosh', 'telnet', 'raw', 'ftp', 's3', 'serial', 'rdp', 'vnc', 'browser', 'local',
  'docker', 'k8s', 'powershell',
  ...(window.mys.platform === 'win32' ? (['wsl'] as Protocol[]) : []),
]
const COMMAND = new Set<Protocol>(['wsl', 'docker', 'k8s', 'powershell'])
/** One-click shortcuts beside the type button; the rest live in the full picker. */
const QUICK: Protocol[] = ['ssh', 'sftp', 'rdp', 'local', 'docker']
const GROUP_KEY: Record<ProtocolGroup, MessageKey> = {
  shell: 'protoGroupShell',
  files: 'protoGroupFiles',
  desktop: 'protoGroupDesktop',
  cloud: 'protoGroupCloud',
}
const isMac = window.mys.platform === 'darwin'

export function SessionDialog() {
  const model = useModel()
  const session = model.dialog.session
  if (!model.dialog.open || !session) return null
  return <Form key={session.id + session.protocol} initial={session} />
}

function Form({ initial }: { initial: Session }) {
  const model = useModel()
  const { t, locale } = useI18n()
  const folders = useFolderOptions()
  const [session, setSession] = useState(initial)
  const [password, setPassword] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [proxyPassword, setProxyPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [ports, setPorts] = useState<string[]>([])
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [makingFolder, setMakingFolder] = useState(false)
  const [picking, setPicking] = useState(false)
  const editing = Boolean(initial.lastUsed || initial.name)

  // Fill the secret fields with what is saved, so they can be shown and edited.
  useEffect(() => {
    if (!initial.hasPassword && !initial.hasPassphrase && !initial.hasProxyPassword) return
    let live = true
    void window.mys.sessions.secrets(initial.id).then((saved) => {
      if (!live) return
      if (saved.password) setPassword((value) => value || saved.password || '')
      if (saved.passphrase) setPassphrase((value) => value || saved.passphrase || '')
      if (saved.proxyPassword) setProxyPassword((value) => value || saved.proxyPassword || '')
    }).catch(() => { /* locked or unreadable: fields stay empty, saved values are kept */ })
    return () => { live = false }
  }, [initial.id])

  useEffect(() => {
    if (session.protocol !== 'serial') return
    void window.mys.serial.list().then(setPorts).catch(() => setPorts([]))
  }, [session.protocol])

  const setProtocol = (protocol: Protocol) => {
    setSession((current) => ({
      ...current,
      protocol,
      port: current.port === DEFAULT_PORT[current.protocol] ? DEFAULT_PORT[protocol] : current.port,
      x11: protocol === 'ssh' ? current.x11 : false,
    }))
    setPicking(false)
    setTried(false)
    setError('')
  }

  const patch = (partial: Partial<Session>) => setSession((current) => ({ ...current, ...partial }))

  /** "root@10.0.0.5:2222" pasted into Host fills user, host and port in one go. */
  const setHost = (value: string) => {
    const match = /^\s*(?:([^@\s]+)@)?([^@\s:]+|\[[0-9a-f:]+\]):(\d{1,5})\s*$/i.exec(value) ?? /^\s*([^@\s]+)@([^@\s:]+)\s*$/.exec(value)
    if (!match || proto === 's3') {
      patch({ host: value })
      return
    }
    const [, user, host, port] = match
    patch({ host, ...(user && needsUser ? { username: user } : {}), ...(port ? { port: Number(port) } : {}) })
  }

  const submit = async (save: boolean, connect = true) => {
    setError('')
    setTried(true)
    if (!valid(session)) {
      setError(t('requiredFields'))
      return
    }
    setSaving(true)
    try {
      const named = { ...session, name: session.name.trim() || titledSession(session, locale) }
      let ready = named
      if (save) {
        ready = await model.saveSession(named, {
          password: clearPassword ? null : password || undefined,
          passphrase: passphrase || undefined,
          proxyPassword: session.proxyType === 'none' ? null : proxyPassword || undefined,
        })
      }
      if (connect) {
        model.launch(
          {
            ...specFromSession(ready, locale),
            sessionId: save ? ready.id : undefined,
            name: ready.name,
            password: password || undefined,
            passphrase: passphrase || undefined,
            proxyPassword: proxyPassword || undefined,
          },
          ready.name,
        )
      }
      model.closeDialog()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const proto = session.protocol
  const needsHost = !['local', 'serial', 'browser'].includes(proto) && !COMMAND.has(proto)
  const needsUser = ['ssh', 'sftp', 'mosh', 'ftp', 'rdp', 's3'].includes(proto)
  const userRequired = ['ssh', 'sftp', 'mosh', 's3'].includes(proto)
  const needsSecret = ['ssh', 'sftp', 'ftp', 'rdp', 'vnc', 's3'].includes(proto)
  const needsKey = proto === 'ssh' || proto === 'sftp' || proto === 'mosh'
  const sshLike = proto === 'ssh' || proto === 'sftp'
  const hasNetwork = sshLike || proto === 'rdp' || proto === 'vnc'
  const hasTerminal = ['ssh', 'local', 'telnet', 'raw', 'mosh', 'serial'].includes(proto) || COMMAND.has(proto)
  const hasStartup = ['ssh', 'local', 'telnet', 'raw', 'mosh'].includes(proto) || COMMAND.has(proto)
  const jumpChoices = model.sessions.filter((item) => item.id !== session.id && (item.protocol === 'ssh' || item.protocol === 'sftp'))
  const isWin = window.mys.platform === 'win32'
  const bad = (empty: boolean) => (tried && empty ? true : undefined)

  const jump = jumpChoices.find((item) => item.id === session.jumpSessionId)
  const keySummary = [
    session.privateKeyPath && session.privateKeyPath.split(/[\\/]/).pop(),
    session.useAgent && t('sshAgent'),
    session.agentForward && 'Agent forwarding',
    session.x11 && 'X11',
  ].filter(Boolean).join(' · ')
  const networkSummary = jump
    ? `${t('jumpHost')}: ${titledSession(jump, locale)}`
    : session.proxyType !== 'none' && sshLike
      ? `${session.proxyType === 'http' ? 'HTTP' : 'SOCKS5'} ${session.proxyHost}${session.proxyHost ? `:${session.proxyPort}` : ''}`
      : ''
  const themeLabel = APP_THEMES.find((item) => item.id === session.termTheme)?.label
  const terminalSummary = [themeLabel, session.termFontSize ? `${session.termFontSize}px` : '', session.startupCommand.trim() && t('startupCommand')].filter(Boolean).join(' · ')

  return (
    <div className="modal-back" onMouseDown={() => model.closeDialog()}>
      <form
        className="modal session-modal"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit(true)
          }
        }}
        onSubmit={(event) => {
          event.preventDefault()
          void submit(true, !editing)
        }}
      >
        <header className="sm-head">
          <span className="sm-title">
            <h2>{editing ? t('editSession') : t('newSession')}</h2>
            {editing && <small><bdi>{titledSession(initial, locale)}</bdi></small>}
          </span>
          <CloseButton label={t('close')} onClick={() => model.closeDialog()} />
        </header>

        <div className="sm-body">
          <IconField protocol={proto} icon={session.icon} color={session.color} onChange={patch}>
            <label className="sm-name">{t('name')}
              <input value={session.name} placeholder={titledSession(session, locale)} onChange={(event) => patch({ name: event.target.value })} />
            </label>
            <label className="sm-folder">
              {t('folder')}
              {makingFolder ? (
                <span className="inline folder-pick">
                  <input
                    value={folderName}
                    autoFocus
                    placeholder={t('folderName')}
                    onChange={(event) => setFolderName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.stopPropagation()
                        setMakingFolder(false)
                        setFolderName('')
                      }
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        if (!folderName.trim()) return
                        void model.saveFolder(folderName).then((id) => {
                          if (!id) return
                          patch({ folderId: id })
                          setMakingFolder(false)
                          setFolderName('')
                        })
                      }
                    }}
                    data-own-escape
                  />
                  <button
                    type="button"
                    className="sm-mini primary"
                    title={t('save')}
                    aria-label={t('save')}
                    disabled={!folderName.trim()}
                    onClick={() => {
                      void model.saveFolder(folderName).then((id) => {
                        if (!id) return
                        patch({ folderId: id })
                        setMakingFolder(false)
                        setFolderName('')
                      })
                    }}
                  >✓</button>
                  <button type="button" className="sm-mini" title={t('cancel')} aria-label={t('cancel')} onClick={() => { setMakingFolder(false); setFolderName('') }}>✕</button>
                </span>
              ) : (
                <span className="inline folder-pick">
                  <select value={session.folderId ?? ''} onChange={(event) => patch({ folderId: event.target.value || null })}>
                    <option value="">{t('noFolder')}</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>{folder.label}</option>
                    ))}
                  </select>
                  <button type="button" className="sm-mini" title={t('newFolder')} aria-label={t('newFolder')} onClick={() => setMakingFolder(true)}>+</button>
                </span>
              )}
            </label>
          </IconField>

          <div className="sm-proto">
            <span className="sm-label">{t('connectionType')}</span>
            <button
              type="button"
              className={picking ? 'sm-proto-btn on' : 'sm-proto-btn'}
              style={protocolStyle(proto)}
              aria-expanded={picking}
              onClick={() => setPicking((value) => !value)}
            >
              <ProtocolIcon protocol={proto} size={15} />
              <strong>{protocolLabel(locale, proto)}</strong>
              {DEFAULT_PORT[proto] ? <em dir="ltr">:{DEFAULT_PORT[proto]}</em> : null}
              <svg className="sm-caret" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 4l2.5 2.5L7.5 4" /></svg>
            </button>
            {!picking && (
              <span className="sm-quick" role="group" aria-label={t('connectionType')}>
                {QUICK.filter((item) => item !== proto).slice(0, 4).map((item) => (
                  <button type="button" key={item} style={protocolStyle(item)} onClick={() => setProtocol(item)}>
                    <ProtocolIcon protocol={item} size={13} />{protocolLabel(locale, item)}
                  </button>
                ))}
              </span>
            )}
          </div>
          {picking && (
            <div
              className="sm-proto-panel"
              data-own-escape
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.stopPropagation()
                setPicking(false)
              }}
            >
              {PROTOCOL_GROUPS.map((group) => {
                const items = PROTOCOL_LIST.filter((item) => PROTOCOL_META[item].group === group)
                if (!items.length) return null
                return (
                  <section key={group}>
                    <h4>{t(GROUP_KEY[group])}</h4>
                    <div className="sm-proto-grid">
                      {items.map((item) => (
                        <button
                          type="button"
                          key={item}
                          className={item === proto ? 'on' : ''}
                          aria-pressed={item === proto}
                          style={protocolStyle(item)}
                          autoFocus={item === proto}
                          onClick={() => setProtocol(item)}
                        >
                          <ProtocolIcon protocol={item} size={16} />
                          <span>{protocolLabel(locale, item)}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          )}

          <div className="sm-card">
            {needsHost && (
              <div className="sm-row host-row">
                <label>{proto === 's3' ? t('s3Bucket') : t('host')}
                  <input
                    dir="ltr"
                    autoFocus={!editing}
                    value={session.host}
                    aria-invalid={bad(!session.host.trim())}
                    placeholder={proto === 's3' ? 'my-bucket' : sshLike || proto === 'mosh' ? 'user@host:port' : '10.0.0.5'}
                    onChange={(event) => setHost(event.target.value)}
                  />
                </label>
                {proto !== 's3' && <label className="port">{t('port')}<input dir="ltr" type="number" min={1} max={65535} value={session.port} onChange={(event) => patch({ port: Number(event.target.value) })} /></label>}
                {proto === 's3' && <label>{t('s3Region')}<input dir="ltr" value={session.domain} onChange={(event) => patch({ domain: event.target.value })} /></label>}
              </div>
            )}
            {(needsUser || needsSecret) && (
              <div className="sm-row">
                {needsUser && (
                  <label>{proto === 's3' ? t('s3AccessKey') : t('user')}
                    <input dir="ltr" value={session.username} placeholder={proto === 'rdp' ? 'Administrator' : proto === 's3' ? '' : 'root'} aria-invalid={bad(userRequired && !session.username.trim())} onChange={(event) => patch({ username: event.target.value })} />
                  </label>
                )}
                {needsSecret && (
                  <label>
                    {proto === 's3' ? t('s3SecretKey') : t('password')}
                    <SecretInput value={password} placeholder={session.hasPassword && !clearPassword ? '••••••••' : ''} onChange={(value) => { setPassword(value); setClearPassword(false) }} />
                  </label>
                )}
              </div>
            )}
            {session.hasPassword && needsSecret && (
              <label className="check sm-check"><input type="checkbox" checked={clearPassword} onChange={(event) => { setClearPassword(event.target.checked); if (event.target.checked) setPassword('') }} /> {t('clearPassword')}</label>
            )}
            {proto === 'rdp' && <label>{t('domain')}<input dir="ltr" value={session.domain} onChange={(event) => patch({ domain: event.target.value })} /></label>}
            {proto === 's3' && <label>{t('s3Endpoint')}<input dir="ltr" value={session.url} placeholder="https://s3.amazonaws.com" onChange={(event) => patch({ url: event.target.value })} /></label>}
            {proto === 'ftp' && (
              <label>{t('security')}
                <select value={session.ftpSecure} onChange={(event) => patch({ ftpSecure: event.target.value as FtpSecure })}>
                  <option value="off">FTP</option>
                  <option value="explicit">{t('ftpsExplicit')}</option>
                  <option value="implicit">{t('ftpsImplicit')}</option>
                </select>
              </label>
            )}
            {proto === 'browser' && (
              <label>{t('address')}<input dir="ltr" autoFocus={!editing} value={session.url} placeholder="https://" aria-invalid={bad(!/^https?:\/\//i.test(session.url))} onChange={(event) => patch({ url: event.target.value })} /></label>
            )}
            {proto === 'rdp' && (
              <div className="sm-toggles">
                <label className="check"><input type="checkbox" checked={session.rdpFullscreen} onChange={(event) => patch({ rdpFullscreen: event.target.checked })} /> {t('rdpFullscreen')}</label>
                <label className="check"><input type="checkbox" checked={session.rdpClipboard} onChange={(event) => patch({ rdpClipboard: event.target.checked })} /> {t('rdpClipboard')}</label>
                <label className="check"><input type="checkbox" checked={session.rdpShareHome} onChange={(event) => patch({ rdpShareHome: event.target.checked })} /> {t('rdpShareHome')}</label>
              </div>
            )}
            {proto === 'docker' && (
              <>
                <TargetField protocol="docker" label={t('dockerContainer')} value={session.host} scope={{ context: session.domain }} invalid={bad(!session.host.trim())} onChange={(host) => patch({ host })} />
                <div className="sm-row">
                  <label>{t('user')}<input dir="ltr" value={session.username} placeholder="root" onChange={(event) => patch({ username: event.target.value })} /></label>
                  <label>{t('dockerContext')}<input dir="ltr" value={session.domain} placeholder="default" onChange={(event) => patch({ domain: event.target.value })} /></label>
                </div>
                <div className="sm-row">
                  <label>{t('shell')}<input dir="ltr" value={session.shell} placeholder="bash / sh" onChange={(event) => patch({ shell: event.target.value })} /></label>
                  <label>{t('startDir')}<input dir="ltr" value={session.cwd} placeholder="/" onChange={(event) => patch({ cwd: event.target.value })} /></label>
                </div>
              </>
            )}
            {proto === 'k8s' && (
              <>
                <div className="sm-row">
                  <label>{t('k8sNamespace')}<input dir="ltr" value={session.domain} placeholder="default" onChange={(event) => patch({ domain: event.target.value })} /></label>
                  <label>{t('k8sContext')}<input dir="ltr" value={session.url} placeholder={t('k8sCurrentContext')} onChange={(event) => patch({ url: event.target.value })} /></label>
                </div>
                <TargetField protocol="k8s" label={t('k8sPod')} value={session.host} scope={{ context: session.url, namespace: session.domain }} invalid={bad(!session.host.trim())} onChange={(host) => patch({ host })} />
                <div className="sm-row">
                  <label>{t('k8sContainer')}<input dir="ltr" value={session.username} onChange={(event) => patch({ username: event.target.value })} /></label>
                  <label>{t('shell')}<input dir="ltr" value={session.shell} placeholder="bash / sh" onChange={(event) => patch({ shell: event.target.value })} /></label>
                </div>
              </>
            )}
            {proto === 'wsl' && (
              <>
                <TargetField protocol="wsl" label={t('wslDistro')} value={session.host} scope={{}} optional onChange={(host) => patch({ host })} />
                <div className="sm-row">
                  <label>{t('user')}<input dir="ltr" value={session.username} onChange={(event) => patch({ username: event.target.value })} /></label>
                  <label>{t('startDir')}<input dir="ltr" value={session.cwd} placeholder="~" onChange={(event) => patch({ cwd: event.target.value })} /></label>
                </div>
              </>
            )}
            {proto === 'powershell' && (
              <div className="sm-row">
                <label>{t('shell')}<input dir="ltr" value={session.shell} placeholder={isWin ? 'powershell.exe / pwsh' : 'pwsh'} onChange={(event) => patch({ shell: event.target.value })} /></label>
                <label>{t('startDir')}<input dir="ltr" value={session.cwd} placeholder="~" onChange={(event) => patch({ cwd: event.target.value })} /></label>
              </div>
            )}
            {proto === 'local' && (
              <div className="sm-row">
                <label>{t('shell')}<input dir="ltr" value={session.shell} placeholder={isWin ? 'powershell.exe' : '/bin/zsh'} onChange={(event) => patch({ shell: event.target.value })} /></label>
                <label>{t('startDir')}<input dir="ltr" value={session.cwd} placeholder="~" onChange={(event) => patch({ cwd: event.target.value })} /></label>
              </div>
            )}
            {proto === 'serial' && (
              <>
                <div className="sm-row host-row">
                  <label>
                    {t('port')}
                    <select dir="ltr" value={session.serialPath} aria-invalid={bad(!session.serialPath)} onChange={(event) => patch({ serialPath: event.target.value })}>
                      <option value="">{t('choose')}</option>
                      {ports.map((port) => <option key={port} value={port}>{port}</option>)}
                    </select>
                  </label>
                  <label className="port">{t('baud')}<input dir="ltr" type="number" value={session.baudRate} onChange={(event) => patch({ baudRate: Number(event.target.value) })} /></label>
                </div>
                <div className="sm-row three">
                  <label>{t('dataBits')}
                    <select value={session.dataBits} onChange={(event) => patch({ dataBits: Number(event.target.value) === 7 ? 7 : 8 })}>
                      <option value={8}>8</option>
                      <option value={7}>7</option>
                    </select>
                  </label>
                  <label>{t('parity')}
                    <select value={session.parity} onChange={(event) => patch({ parity: event.target.value as Session['parity'] })}>
                      <option value="none">{t('parityNone')}</option>
                      <option value="even">{t('parityEven')}</option>
                      <option value="odd">{t('parityOdd')}</option>
                    </select>
                  </label>
                  <label>{t('stopBits')}
                    <select value={session.stopBits} onChange={(event) => patch({ stopBits: Number(event.target.value) === 2 ? 2 : 1 })}>
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                    </select>
                  </label>
                </div>
              </>
            )}
          </div>

          <div className="sm-folds">
          {needsKey && (
            <Fold title={t('sectionKeys')} summary={keySummary} open={Boolean(initial.privateKeyPath || initial.certificatePath || initial.agentForward || initial.x11)}>
              <label>
                {t('privateKey')}
                <span className="inline file-pick">
                  <input dir="ltr" value={session.privateKeyPath} placeholder="~/.ssh/id_ed25519" onChange={(event) => patch({ privateKeyPath: event.target.value })} />
                  <button type="button" onClick={() => void window.mys.dialog.pickFile().then((file) => file && patch({ privateKeyPath: file }))}>{t('choose')}</button>
                </span>
              </label>
              <label>{t('keyPassphrase')}<SecretInput value={passphrase} onChange={setPassphrase} /></label>
              {proto !== 'mosh' && (
                <label>
                  {t('sshCertificate')}
                  <span className="inline file-pick">
                    <input dir="ltr" value={session.certificatePath} placeholder={session.privateKeyPath ? `${session.privateKeyPath}-cert.pub` : ''} onChange={(event) => patch({ certificatePath: event.target.value })} />
                    <button type="button" onClick={() => void window.mys.dialog.pickFile().then((file) => file && patch({ certificatePath: file }))}>{t('choose')}</button>
                  </span>
                </label>
              )}
              {sshLike && (
                <div className="sm-toggles">
                  <label className="check"><input type="checkbox" checked={session.useAgent} onChange={(event) => patch({ useAgent: event.target.checked })} /> {t('sshAgent')}</label>
                  <label className="check"><input type="checkbox" checked={session.agentForward} onChange={(event) => patch({ agentForward: event.target.checked })} /> Agent forwarding</label>
                  {proto === 'ssh' && <label className="check"><input type="checkbox" checked={session.x11} onChange={(event) => patch({ x11: event.target.checked })} /> {t('x11')}</label>}
                </div>
              )}
            </Fold>
          )}

          {hasNetwork && (
            <Fold title={sshLike ? t('sectionNetwork') : t('viaSsh')} summary={networkSummary} open={Boolean(initial.jumpSessionId || (sshLike && initial.proxyType !== 'none'))}>
              <label>
                {sshLike ? t('jumpHost') : t('viaSsh')}
                <select value={session.jumpSessionId} onChange={(event) => patch({ jumpSessionId: event.target.value })}>
                  <option value="">{t('jumpNone')}</option>
                  {jumpChoices.map((item) => (
                    <option key={item.id} value={item.id}>{titledSession(item, locale)}</option>
                  ))}
                </select>
              </label>
              {sshLike && !session.jumpSessionId && (
                <>
                  <label>
                    {t('proxy')}
                    <select
                      value={session.proxyType}
                      onChange={(event) => {
                        const proxyType = event.target.value as ProxyType
                        patch({ proxyType, proxyPort: session.proxyPort === 1080 || session.proxyPort === 8080 ? (proxyType === 'http' ? 8080 : 1080) : session.proxyPort })
                      }}
                    >
                      <option value="none">{t('proxyNone')}</option>
                      <option value="socks5">SOCKS5</option>
                      <option value="http">HTTP CONNECT</option>
                    </select>
                  </label>
                  {session.proxyType !== 'none' && (
                    <>
                      <div className="sm-row host-row">
                        <label>{t('proxyHost')}<input dir="ltr" value={session.proxyHost} aria-invalid={bad(!session.proxyHost.trim())} onChange={(event) => patch({ proxyHost: event.target.value })} /></label>
                        <label className="port">{t('port')}<input dir="ltr" type="number" value={session.proxyPort} onChange={(event) => patch({ proxyPort: Number(event.target.value) })} /></label>
                      </div>
                      <div className="sm-row">
                        <label>{t('proxyUser')}<input dir="ltr" value={session.proxyUser} onChange={(event) => patch({ proxyUser: event.target.value })} /></label>
                        <label>
                          {t('proxyPassword')}
                          <SecretInput value={proxyPassword} placeholder={session.hasProxyPassword ? '••••••••' : ''} onChange={setProxyPassword} />
                        </label>
                      </div>
                    </>
                  )}
                </>
              )}
            </Fold>
          )}

          {hasTerminal && (
            <Fold title={t('sectionTerminal')} summary={terminalSummary} open={Boolean(initial.termTheme || initial.termFontSize || initial.termFontFamily || initial.startupCommand.trim())}>
              <div className="sm-row three">
                <label>
                  {t('theme')}
                  <select value={session.termTheme} onChange={(event) => patch({ termTheme: event.target.value })}>
                    <option value="">{t('useAppDefault')}</option>
                    {APP_THEMES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <label>
                  {t('font')}
                  <select value={session.termFontFamily} onChange={(event) => patch({ termFontFamily: event.target.value })}>
                    <option value="">{t('useAppDefault')}</option>
                    {fontStacks().map((item) => <option key={item.id} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label>
                  {t('fontSize')}
                  <input
                    dir="ltr"
                    type="number"
                    min={0}
                    max={32}
                    value={session.termFontSize || ''}
                    placeholder={String(model.settings.fontSize)}
                    onChange={(event) => patch({ termFontSize: Number(event.target.value) || 0 })}
                  />
                </label>
              </div>
              {hasStartup && (
                <label>{t('startupCommand')}<textarea dir="ltr" rows={2} value={session.startupCommand} placeholder="cd /var/www && git status" onChange={(event) => patch({ startupCommand: event.target.value })} /></label>
              )}
            </Fold>
          )}

          <Fold title={t('notes')} summary={session.notes.trim().split('\n')[0].slice(0, 60)} open={Boolean(initial.notes.trim())}>
            <textarea rows={3} aria-label={t('notes')} value={session.notes} onChange={(event) => patch({ notes: event.target.value })} />
          </Fold>
          </div>
        </div>

        <footer className="sm-foot">
          {error ? <p className="form-error" role="alert">{error}</p> : <span className="sm-hint"><kbd>{isMac ? '⌘' : 'Ctrl'}</kbd><kbd>↵</kbd> {t('saveAndConnect')}</span>}
          <button type="button" className="ghost" disabled={saving} onClick={() => void submit(false)}>{t('connectOnly')}</button>
          {editing ? (
            <>
              <button type="button" disabled={saving} onClick={() => void submit(true)}>{t('saveAndConnect')}</button>
              <button type="submit" className="primary" disabled={saving}>{saving ? t('saving') : t('save')}</button>
            </>
          ) : (
            <>
              <button type="button" disabled={saving} onClick={() => void submit(true, false)}>{t('save')}</button>
              <button type="submit" className="primary" disabled={saving}>{saving ? t('saving') : t('saveAndConnect')}</button>
            </>
          )}
        </footer>
      </form>
    </div>
  )
}

/** Collapsible group of optional settings; the summary tells what is set without opening it. */
function Fold({ title, summary, open, children }: { title: string; summary?: string; open: boolean; children: ReactNode }) {
  const [initialOpen] = useState(open)
  return (
    <details className="sm-fold" open={initialOpen}>
      <summary>
        <svg className="sm-fold-caret" viewBox="0 0 10 10" aria-hidden="true"><path d="M4 2.5L6.5 5 4 7.5" /></svg>
        <strong>{title}</strong>
        {summary ? <small><bdi>{summary}</bdi></small> : null}
      </summary>
      <div className="sm-fold-body">{children}</div>
    </details>
  )
}

function valid(session: Session): boolean {
  if (session.protocol === 'browser') return /^https?:\/\//i.test(session.url)
  if (session.protocol === 'serial') return session.serialPath.startsWith('/dev/') || /^COM\d+$/i.test(session.serialPath)
  if (session.protocol === 'local' || session.protocol === 'wsl' || session.protocol === 'powershell') return true
  if (session.protocol === 'docker' || session.protocol === 'k8s') return Boolean(session.host.trim())
  if (!session.host.trim()) return false
  if (['ssh', 'sftp', 'mosh', 's3'].includes(session.protocol) && !session.username.trim()) return false
  if (session.proxyType !== 'none' && !session.jumpSessionId && ['ssh', 'sftp'].includes(session.protocol) && !session.proxyHost.trim()) return false
  if (session.protocol === 's3' && !session.host.trim()) return false
  return true
}

/** Name field with a "List" button that asks docker / kubectl / wsl for what exists. */
function TargetField({ protocol, label, value, scope, optional = false, invalid, onChange }: {
  protocol: 'docker' | 'k8s' | 'wsl'
  label: string
  value: string
  scope: { context?: string; namespace?: string }
  optional?: boolean
  invalid?: boolean
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const [items, setItems] = useState<string[]>([])
  const [state, setState] = useState<'idle' | 'busy' | 'empty' | string>('idle')
  const listId = `targets-${protocol}`
  const load = async () => {
    setState('busy')
    try {
      const found = await window.mys.targets.list(protocol, scope)
      setItems(found)
      setState(found.length ? 'idle' : 'empty')
    } catch (caught) {
      setItems([])
      setState(caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('listFailed'))
    }
  }
  return (
    <label>
      {label}
      <span className="inline">
        <input dir="ltr" list={listId} value={value} aria-invalid={invalid} placeholder={optional ? t('useAppDefault') : ''} onChange={(event) => onChange(event.target.value)} />
        <button type="button" disabled={state === 'busy'} onClick={() => void load()}>{state === 'busy' ? '…' : t('listTargets')}</button>
      </span>
      <datalist id={listId}>{items.map((item) => <option key={item} value={item} />)}</datalist>
      {state === 'empty' && <small className="hint">{t('targetsNone')}</small>}
      {state !== 'idle' && state !== 'busy' && state !== 'empty' && <small className="form-error">{state}</small>}
    </label>
  )
}

/** Password field with a show / hide button. */
function SecretInput({ value, placeholder, onChange }: { value: string; placeholder?: string; onChange: (value: string) => void }) {
  const { t } = useI18n()
  const [show, setShow] = useState(false)
  return (
    <span className="secret-input">
      <input dir="ltr" type={show ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      <button
        type="button"
        className="secret-eye"
        title={show ? t('hide') : t('show')}
        aria-label={show ? t('hide') : t('show')}
        aria-pressed={show}
        onClick={() => setShow((current) => !current)}
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  )
}
