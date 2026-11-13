import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Macro, MacroPackage, Session } from '../../../shared/types'
import { useI18n } from '../i18n'
import { allTabs } from '../layout'
import { useModel } from '../model'
import { snippetCommand } from '../snippet-command'
import { SECRET_MASK } from '../snippets'
import { isTerminalProtocol } from './TerminalView'

type View =
  | { id: 'home' }
  | { id: 'history' }
  | { id: 'package'; packageId?: string }
  | { id: 'snippet'; snippetId?: string }

export function SnippetsPanel() {
  const { t } = useI18n()
  const model = useModel()
  const [view, setView] = useState<View>({ id: 'home' })
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const vaultName = model.workspaces.find((item) => item.id === model.settings.activeWorkspaceId)?.name
    || t('personalVault')

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const q = query.trim().toLowerCase()
  const packages = model.packages
  const snippets = useMemo(() => {
    const list = [...model.macros]
    if (!q) return list
    return list.filter((item) => item.name.toLowerCase().includes(q) || item.command.toLowerCase().includes(q))
  }, [model.macros, q])
  const visiblePackages = useMemo(() => {
    if (!q) return packages
    return packages.filter((item) => {
      if (item.name.toLowerCase().includes(q)) return true
      return model.macros.some((macro) => macro.packageId === item.id && (macro.name.toLowerCase().includes(q) || macro.command.toLowerCase().includes(q)))
    })
  }, [packages, model.macros, q])

  const runMacro = async (macro: Macro) => {
    const command = await snippetCommand(macro)
    if (!command) {
      model.toast(t('snippetSecretMissing'), 'err')
      return
    }
    await run(command, macro.sendEnter, macro.targetIds, macro.secret)
  }

  const run = async (command: string, sendEnter = true, targets?: string[], secret = false) => {
    const data = sendEnter ? `${command}\n` : command
    const ids = new Set<string>()
    if (targets?.length) {
      for (const sessionId of targets) {
        for (const tab of allTabs(model.layout)) {
          if (tab.spec.sessionId === sessionId && isTerminalProtocol(tab.protocol)) ids.add(tab.instanceId)
        }
        if (![...ids].some((id) => allTabs(model.layout).some((tab) => tab.instanceId === id && tab.spec.sessionId === sessionId))) {
          const session = model.sessions.find((item) => item.id === sessionId)
          if (session) model.openSession(session)
        }
      }
    }
    if (!ids.size) {
      const tab = model.activeTab()
      if (!tab || !isTerminalProtocol(tab.protocol)) {
        model.toast(t('pickTerminal'), 'err')
        return
      }
      ids.add(tab.instanceId)
    }
    for (const id of ids) {
      window.mys.write(id, data)
      if (model.multiExec) model.broadcast(data, id)
      window.dispatchEvent(new CustomEvent('mys-focus', { detail: id }))
    }
    if (!secret) await model.pushShellHistory(command)
  }

  if (view.id === 'history') {
    return (
      <HistoryView
        vault={vaultName}
        onBack={() => setView({ id: 'home' })}
        onRun={(command) => void run(command)}
        onClear={() => void model.clearShellHistory()}
      />
    )
  }
  if (view.id === 'package') {
    return (
      <PackageView
        vault={vaultName}
        packageId={view.packageId}
        onBack={() => setView({ id: 'home' })}
      />
    )
  }
  if (view.id === 'snippet') {
    return (
      <SnippetView
        vault={vaultName}
        snippetId={view.snippetId}
        onBack={() => setView({ id: 'home' })}
        onRun={(macro) => void run(macro.command, macro.sendEnter, macro.targetIds, macro.secret)}
      />
    )
  }

  return (
    <div className="side-panel sn">
      <div className="kc-toolbar sn-toolbar">
        <div className="kc-split">
          <button type="button" className="kc-new" onClick={() => setView({ id: 'snippet' })}>
            <span aria-hidden="true">+</span> {t('newSnippet')}
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
        <button type="button" className="kc-link" onClick={() => setView({ id: 'history' })}>
          <ClockIcon /> {t('shellHistory')}
        </button>
        <div className="sn-tools">
          <button type="button" className="kc-link" title={t('search')} aria-label={t('search')} onClick={() => setSearchOpen((value) => !value)}>
            <SearchIcon />
          </button>
        </div>
      </div>

      {searchOpen && (
        <input
          className="search sn-search"
          value={query}
          placeholder={t('search')}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
      )}

      <div className="side-scroll sn-body">
        <section className="sn-section">
          <h3>{t('packages')}</h3>
          {visiblePackages.length === 0 ? (
            <p className="hint">{t('packagesEmpty')}</p>
          ) : (
            <div className="sn-grid">
              {visiblePackages.map((item) => {
                const count = model.macros.filter((macro) => macro.packageId === item.id).length
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="sn-card"
                    onClick={() => setView({ id: 'package', packageId: item.id })}
                  >
                    <span className="sn-ico pack" aria-hidden="true"><PackIcon /></span>
                    <span className="sn-card-text">
                      <strong>{item.name}</strong>
                      <small>{t('snippetCount', { n: count })}</small>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="sn-section">
          <h3>{t('snippets')}</h3>
          {snippets.length === 0 ? (
            <div className="kc-empty">
              <div className="kc-empty-ico" aria-hidden="true"><BraceIcon /></div>
              <strong>{t('addSnippet')}</strong>
              <p>{t('addSnippetHint')}</p>
            </div>
          ) : (
            <div className="sn-grid">
              {snippets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="sn-card"
                  onClick={() => setView({ id: 'snippet', snippetId: item.id })}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    void runMacro(item)
                  }}
                >
                  <span className="sn-ico brace" aria-hidden="true"><BraceIcon /></span>
                  <span className="sn-card-text">
                    <strong>{item.name}</strong>
                    <small dir="ltr">{item.secret ? SECRET_MASK : item.command}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {menu && createPortal(
        <div className="kc-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { setMenu(null); setView({ id: 'snippet' }) }}>
            <BraceIcon /> {t('newSnippet')}
          </button>
          <button type="button" onClick={() => { setMenu(null); setView({ id: 'package' }) }}>
            <PackIcon /> {t('newPackage')}
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}

function HistoryView({
  vault,
  onBack,
  onRun,
  onClear,
}: {
  vault: string
  onBack: () => void
  onRun: (command: string) => void
  onClear: () => void
}) {
  const { t } = useI18n()
  const model = useModel()
  return (
    <div className="side-panel sn">
      <header className="kc-head">
        <div>
          <strong>{t('shellHistory')}</strong>
          <span className="kc-vault">{vault}</span>
        </div>
        <div className="sn-head-actions">
          <button type="button" className="kc-exit" title={t('more')} aria-label={t('more')} onClick={() => void onClear()}>⋯</button>
          <button type="button" className="kc-exit" title={t('close')} aria-label={t('close')} onClick={onBack}><ExitIcon /></button>
        </div>
      </header>
      <div className="side-scroll sn-history">
        {model.shellHistory.length === 0 && <p className="hint">{t('shellHistoryEmpty')}</p>}
        {model.shellHistory.map((item, index) => (
          <button
            key={`${index}-${item}`}
            type="button"
            className="sn-history-row"
            dir="ltr"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRun(item)}
          >{item}</button>
        ))}
      </div>
    </div>
  )
}

function PackageView({ vault, packageId, onBack }: { vault: string; packageId?: string; onBack: () => void }) {
  const { t } = useI18n()
  const model = useModel()
  const existing = model.packages.find((item) => item.id === packageId) || null
  const [label, setLabel] = useState(existing?.name || '')
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!label.trim()) {
      setError(t('labelRequired'))
      return
    }
    if (existing) {
      await model.savePackages(model.packages.map((item) => item.id === existing.id ? { ...item, name: label.trim() } : item))
    } else {
      await model.savePackages([...model.packages, { id: crypto.randomUUID(), name: label.trim() }])
    }
    onBack()
  }

  return (
    <div className="side-panel sn">
      <header className="kc-head">
        <div>
          <strong>{existing ? t('editPackage') : t('newPackage')}</strong>
          <span className="kc-vault">{vault}</span>
        </div>
        <button type="button" className="kc-exit" title={t('close')} aria-label={t('close')} onClick={onBack}><ExitIcon /></button>
      </header>
      <form className="side-scroll kc-form" onSubmit={(event) => void submit(event)}>
        <div className="kc-block">
          <div className="kc-identity-row">
            <div className="sn-ico pack" aria-hidden="true"><PackIcon /></div>
            <input value={label} placeholder={`${t('label')} *`} autoFocus onChange={(event) => setLabel(event.target.value)} />
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="primary kc-cta">{t('save')}</button>
        {existing && (
          <button
            type="button"
            className="danger"
            onClick={() => {
              void model.savePackages(model.packages.filter((item) => item.id !== existing.id)).then(() => {
                void model.saveMacros(model.macros.map((macro) => macro.packageId === existing.id ? { ...macro, packageId: null } : macro))
                onBack()
              })
            }}
          >{t('delete')}</button>
        )}
      </form>
    </div>
  )
}

function SnippetView({
  vault,
  snippetId,
  onBack,
  onRun,
}: {
  vault: string
  snippetId?: string
  onBack: () => void
  onRun: (macro: Macro) => void
}) {
  const { t } = useI18n()
  const model = useModel()
  const existing = model.macros.find((item) => item.id === snippetId) || null
  const [name, setName] = useState(existing?.name || '')
  const [command, setCommand] = useState(existing?.secret ? '' : existing?.command || '')
  const [packageId, setPackageId] = useState(existing?.packageId || '')
  const [targets, setTargets] = useState<string[]>(existing?.targetIds || [])
  const [sendEnter, setSendEnter] = useState(existing?.sendEnter !== false)
  const [error, setError] = useState('')
  const [pickHosts, setPickHosts] = useState(false)

  useEffect(() => {
    if (!existing?.secret) return
    let live = true
    void snippetCommand(existing).then((value) => { if (live) setCommand(value) })
    return () => { live = false }
  }, [existing?.id])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!command.trim()) {
      setError(t('scriptRequired'))
      return
    }
    const next: Macro = {
      ...existing,
      id: existing?.id || crypto.randomUUID(),
      name: name.trim() || command.trim().slice(0, 40),
      command: command,
      sendEnter,
      packageId: packageId || null,
      targetIds: targets,
    }
    if (existing) {
      await model.saveMacros(model.macros.map((item) => item.id === existing.id ? next : item))
    } else {
      await model.saveMacros([...model.macros, next])
    }
    onBack()
  }

  return (
    <div className="side-panel sn">
      <header className="kc-head">
        <div>
          <strong>{existing ? t('editSnippet') : t('newSnippet')}</strong>
          <span className="kc-vault">{vault}</span>
        </div>
        <button type="button" className="kc-exit" title={t('close')} aria-label={t('close')} onClick={onBack}><ExitIcon /></button>
      </header>
      <form className="side-scroll kc-form" onSubmit={(event) => void submit(event)}>
        <div className="kc-block">
          <label className={name ? 'kc-float on' : 'kc-float'}>
            <span>{t('actionDescription')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <select value={packageId} onChange={(event) => setPackageId(event.target.value)}>
            <option value="">{t('addPackage')}</option>
            {model.packages.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <label className={command ? 'kc-float on' : 'kc-float'}>
            <span>{t('script')} *</span>
            <textarea dir="ltr" value={command} onChange={(event) => setCommand(event.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={sendEnter} onChange={(event) => setSendEnter(event.target.checked)} />
            {t('sendEnter')}
          </label>
        </div>

        <button type="button" className="sn-share" onClick={() => model.toast(t('shareSnippetSoon'))}>
          {t('shareSnippet')} <ShareIcon />
        </button>

        <div className="kc-block">
          <strong className="sn-targets-title">{t('targetsForExecution')}</strong>
          <p className="hint">{t('targetsHint')}</p>
          {targets.length === 0 ? (
            <>
              <div className="sn-target ghost"><ServerIcon /> <span>{t('ipOrHostname')} · SSH</span></div>
              <div className="sn-target ghost"><ServerIcon /> <span>{t('ipOrHostname')} · SSH</span></div>
            </>
          ) : (
            targets.map((id) => {
              const session = model.sessions.find((item) => item.id === id)
              return (
                <div key={id} className="sn-target">
                  <ServerIcon />
                  <span dir="ltr">{session ? `${session.host || session.name}` : id}</span>
                  <button type="button" className="textish danger" onClick={() => setTargets((list) => list.filter((item) => item !== id))}>{t('delete')}</button>
                </div>
              )
            })
          )}
          <button type="button" className="pf-help-link" onClick={() => setPickHosts(true)}>{t('addTargets')}</button>
        </div>

        {error && <p className="form-error">{error}</p>}
        <div className="sn-actions">
          {existing && (
            <button type="button" className="primary" onClick={() => onRun({
              ...existing,
              id: existing.id,
              name,
              command,
              sendEnter,
              packageId: packageId || null,
              targetIds: targets,
            })}>{t('run')}</button>
          )}
          <button type="submit" className="primary kc-cta">{t('save')}</button>
          {existing && (
            <button
              type="button"
              className="danger"
              onClick={() => void model.saveMacros(model.macros.filter((item) => item.id !== existing.id)).then(onBack)}
            >{t('delete')}</button>
          )}
        </div>
      </form>

      {pickHosts && (
        <TargetPicker
          sessions={model.sessions.filter((item) => item.protocol === 'ssh' || item.protocol === 'sftp' || item.protocol === 'local')}
          selected={targets}
          onClose={() => setPickHosts(false)}
          onPick={(id) => {
            setTargets((list) => list.includes(id) ? list : [...list, id])
            setPickHosts(false)
          }}
        />
      )}
    </div>
  )
}

function TargetPicker({
  sessions,
  selected,
  onClose,
  onPick,
}: {
  sessions: Session[]
  selected: string[]
  onClose: () => void
  onPick: (id: string) => void
}) {
  const { t } = useI18n()
  return createPortal(
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal pf-hosts-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{t('addTargets')}</h2>
          <button type="button" onClick={onClose}>{t('close')}</button>
        </header>
        <div className="side-scroll">
          {sessions.length === 0 && <p className="hint">{t('emptySessions')}</p>}
          {sessions.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selected.includes(item.id) ? 'side-row on' : 'side-row'}
              onClick={() => onPick(item.id)}
            >
              <strong>{item.name || item.host}</strong>
              <small dir="ltr">{item.host}:{item.port}</small>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
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

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8.5V12l2.5 2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 16l4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function PackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 8l8-4 8 4v8l-8 4-8-4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M4 8l8 4 8-4M12 12v8" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function BraceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M10 5.2c-2 .35-2.8 1.55-2.8 3.05 0 1.75 1.25 2.35 1.25 3.75S7.2 14 7.2 15.75c0 1.5.8 2.7 2.8 3.05" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M14 5.2c2 .35 2.8 1.55 2.8 3.05 0 1.75-1.25 2.35-1.25 3.75s1.25 1.95 1.25 3.7c0 1.5-.8 2.7-2.8 3.05" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="9" cy="10" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="15.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11.5 11.5l2.8-2M11.7 12.2l2.6 2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function ServerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="6" y="4" width="12" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6" y="10" width="12" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6" y="16" width="12" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
