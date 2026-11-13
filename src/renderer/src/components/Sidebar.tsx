import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { protocolBadge, protocolLabel } from '../../../shared/i18n'
import { canSeeFolder, type Folder, type ImportSource, type Protocol, type Session } from '../../../shared/types'
import { NAV_SHORTCUTS } from '../../../shared/shortcuts'
import { useI18n } from '../i18n'
import { appShortcut, titled } from '../keys'
import { useModel } from '../model'
import { allTabs } from '../layout'
import { KeychainPanel } from './Keychain'
import { LogsPanel } from './Logs'
import { RecordingsPanel } from './Recordings'
import { PortForwardingPanel } from './PortForwarding'
import { SnippetsPanel } from './Snippets'
import { CloseButton } from './XMark'
import { HostBadge } from '../protocols'

const SESSION_MIME = 'application/x-mys-session'
type NavTab = 'hosts' | 'keychain' | 'tunnels' | 'snippets' | 'known' | 'logs' | 'recordings'

function readDraggedSession(event: DragEvent): string {
  return event.dataTransfer.getData(SESSION_MIME)
}

function allowSessionDrag(event: DragEvent): boolean {
  if (![...event.dataTransfer.types].includes(SESSION_MIME)) return false
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  return true
}

interface Selection {
  active: boolean
  sessions: Set<string>
  folders: Set<string>
  start: () => void
  toggleSession: (id: string, range?: boolean) => void
  toggleFolder: (id: string) => void
  /** True when the folder or one of its parents is selected (its hosts export with it). */
  covered: (folderId: string | null) => boolean
}

const SelectionContext = createContext<Selection | null>(null)

function useSelectionState(rootRef: { current: HTMLElement | null }) {
  const model = useModel()
  const [active, setActive] = useState(false)
  const [sessions, setSessions] = useState<Set<string>>(() => new Set())
  const [folders, setFolders] = useState<Set<string>>(() => new Set())
  const anchor = useRef<string | null>(null)
  const clear = useCallback(() => {
    setActive(false)
    setSessions(new Set())
    setFolders(new Set())
    anchor.current = null
  }, [])
  const toggleSession = useCallback((id: string, range = false) => {
    setActive(true)
    // Read the anchor now: the updater below runs later, after anchor.current moves to `id`.
    const from = anchor.current
    const order = range && from ? [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-session-id]') ?? [])].map((el) => el.dataset.sessionId ?? '') : []
    setSessions((prev) => {
      const next = new Set(prev)
      if (from && order.length) {
        // Shift+click: everything between the last clicked row and this one, in visible order.
        const a = order.indexOf(from)
        const b = order.indexOf(id)
        if (a >= 0 && b >= 0) {
          for (const item of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(item)
          return next
        }
      }
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    anchor.current = id
  }, [rootRef])
  const toggleFolder = useCallback((id: string) => {
    setActive(true)
    setFolders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const covered = useCallback((folderId: string | null) => {
    let current = folderId ? model.folders.find((item) => item.id === folderId) : undefined
    while (current) {
      if (folders.has(current.id)) return true
      const parentId = current.parentId
      current = parentId ? model.folders.find((item) => item.id === parentId) : undefined
    }
    return false
  }, [folders, model.folders])
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.row-menu, .modal-back')) clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, clear])
  const selection: Selection = { active, sessions, folders, start: () => setActive(true), toggleSession, toggleFolder, covered }
  return { selection, clear }
}

function SelectionBar({ selection, onClear }: { selection: Selection; onClear: () => void }) {
  const model = useModel()
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const hostCount = model.sessions.filter((session) => selection.sessions.has(session.id) || selection.covered(session.folderId)).length
  const empty = !selection.sessions.size && !selection.folders.size
  const run = async (format: 'json' | 'csv') => {
    setBusy(true)
    const done = await model.exportSelection([...selection.sessions], [...selection.folders], format)
    setBusy(false)
    if (done) onClear()
  }
  return (
    <div className="side-foot selection-bar" role="toolbar" aria-label={t('select')}>
      <div className="selection-sum">
        <strong>{t('selectedHosts', { n: hostCount })}</strong>
        <small>{selection.folders.size ? t('selectedFolders', { n: selection.folders.size }) : t('selectHint')}</small>
      </div>
      <button type="button" className="primary" disabled={empty || busy} onClick={() => void run('json')}>JSON</button>
      <button type="button" disabled={empty || busy} onClick={() => void run('csv')}>CSV</button>
      <button type="button" className="selection-close" title={t('cancel')} aria-label={t('cancel')} onClick={onClear}>✕</button>
    </div>
  )
}

export function Sidebar() {
  const model = useModel()
  const { t } = useI18n()
  const [nav, setNav] = useState<NavTab>('hosts')
  const [query, setQuery] = useState('')
  const [invite, setInvite] = useState<Folder | null>(null)
  const [spaceInvite, setSpaceInvite] = useState(false)
  const [newSpace, setNewSpace] = useState(false)
  const [newFolder, setNewFolder] = useState<{ parentId: string | null } | null>(null)
  const [awaitOnline, setAwaitOnline] = useState(false)
  const sections = useSections()
  const rootRef = useRef<HTMLElement>(null)
  const { selection, clear: clearSelection } = useSelectionState(rootRef)
  const q = query.trim().toLowerCase()
  const handle = model.account?.username ?? null
  const activeSpace = model.workspaces.find((item) => item.id === model.settings.activeWorkspaceId) ?? model.workspaces[0] ?? null
  const visible = (session: Session) => {
    if (!session.folderId) return true
    const folder = model.folders.find((item) => item.id === session.folderId)
    return Boolean(folder && canSeeFolder(folder, handle, model.folders))
  }

  const favorites = model.sessions.filter((session) => session.favorite && visible(session) && match(session, q))
  const loose = model.sessions.filter((session) => !session.folderId && match(session, q))

  const offline = model.settings.mode !== 'online'
  const tabs: { id: NavTab; label: string }[] = [
    { id: 'hosts', label: t('hosts') },
    { id: 'keychain', label: t('keychain') },
    { id: 'tunnels', label: t('portForwarding') },
    { id: 'snippets', label: t('snippets') },
    { id: 'known', label: t('knownHosts') },
    { id: 'logs', label: t('logs') },
    { id: 'recordings', label: t('recordings') },
  ]

  // Ctrl+1…7 jump to a rail section; ⌘⇧N / Ctrl+Shift+Alt+N creates a folder from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const id = appShortcut(event)
      const index = id ? NAV_SHORTCUTS.indexOf(id) : -1
      if (index < 0 || !tabs[index]) return
      event.preventDefault()
      event.stopPropagation()
      setNav(tabs[index].id)
      model.setSidebar(true)
    }
    window.addEventListener('keydown', onKey, true)
    const off = window.mys.onMenu('menu:new-folder', () => {
      setNav('hosts')
      model.setSidebar(true)
      setNewFolder({ parentId: null })
    })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      off()
    }
  })

  useEffect(() => {
    if (!awaitOnline) return
    if (model.account?.email) {
      setAwaitOnline(false)
      void model.saveSettings({ ...model.settings, mode: 'online' }, { quiet: true })
      return
    }
    if (!model.loginOpen) setAwaitOnline(false)
  }, [awaitOnline, model.account?.email, model.loginOpen, model.saveSettings, model.settings])

  useEffect(() => {
    if (awaitOnline || model.loginOpen) return
    if (model.settings.mode === 'online' && !model.account?.email) {
      void model.saveSettings({ ...model.settings, mode: 'offline' }, { quiet: true })
    }
  }, [awaitOnline, model.account?.email, model.loginOpen, model.saveSettings, model.settings])

  const setMode = (mode: 'offline' | 'online') => {
    if (mode === 'online' && !model.account?.email) {
      setAwaitOnline(true)
      model.setLogin(true)
      return
    }
    setAwaitOnline(false)
    void model.saveSettings({ ...model.settings, mode }, { quiet: true })
  }

  const makeWorkspace = () => {
    if (!offline && !model.account?.email) {
      model.toast(t('emailRequired'), 'err')
      model.setLogin(true)
      return
    }
    setNewSpace(true)
  }

  return (
    <aside className={selection.active ? 'sidebar selecting' : 'sidebar'} ref={rootRef}>
      <nav className="side-rail" role="tablist" aria-label={t('sessions')}>
        {tabs.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            title={titled(item.label, NAV_SHORTCUTS[index])}
            aria-label={item.label}
            aria-selected={model.sidebar && nav === item.id}
            className={model.sidebar && nav === item.id ? 'on' : ''}
            onClick={() => {
              // Collapsed: open on that panel. Open: the active icon collapses back to the rail.
              if (model.sidebar && nav === item.id) {
                model.setSidebar(false)
                return
              }
              setNav(item.id)
              model.setSidebar(true)
            }}
          >
            <NavIcon name={item.id} />
          </button>
        ))}
      </nav>
      <div className="side-main" {...(model.sidebar ? {} : { inert: '', 'aria-hidden': true })}>
        {nav === 'hosts' && (
          <SelectionContext.Provider value={selection}>
            <div className="side-head">
              <div className="side-title">
                <div>
                  <strong>{t('hosts')}</strong>
                  <span>{t('savedCount', { n: model.sessions.length })}</span>
                </div>
                <CloseButton label={titled(t('close'), 'sidebar')} onClick={() => model.setSidebar(false)} />
              </div>
              <div className="mode-switch" role="group" aria-label={t('appMode')}>
                <button type="button" className={offline ? 'on' : ''} onClick={() => setMode('offline')}>{t('offlineMode')}</button>
                <button type="button" className={offline ? '' : 'on'} onClick={() => setMode('online')}>{t('onlineMode')}</button>
              </div>
              <div className="workspace-pick">
                <label>
                  {t('workspace')}
                  <select
                    dir="ltr"
                    value={activeSpace?.id || ''}
                    onChange={(event) => void model.switchWorkspace(event.target.value)}
                  >
                    {model.workspaces.map((space) => (
                      <option key={space.id} value={space.id}>{space.name}</option>
                    ))}
                  </select>
                </label>
                <div className="workspace-actions">
                  <button type="button" title={t('newWorkspace')} onClick={() => void makeWorkspace()}>+</button>
                  <button
                    type="button"
                    title={t('inviteWorkspace')}
                    disabled={!activeSpace || offline}
                    onClick={() => {
                      if (offline) return
                      if (!model.account?.email) {
                        model.toast(t('emailRequired'), 'err')
                        model.setLogin(true)
                        return
                      }
                      setSpaceInvite(true)
                    }}
                  >⋯</button>
                </div>
              </div>
            </div>
            <form
              className="quick"
              onSubmit={(event) => {
                event.preventDefault()
                const value = query.trim()
                if (!value) return
                // Enter opens the first matching saved host, otherwise treats the text as a quick-connect target.
                const hit = model.sessions.find((session) => visible(session) && match(session, value.toLowerCase()))
                if (hit) model.openSession(hit)
                else model.openQuick(value)
                setQuery('')
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
              <input
                dir="auto"
                value={query}
                placeholder={t('hostFind')}
                title={t('quickPlaceholder')}
                onChange={(event) => setQuery(event.target.value)}
              />
            </form>
            <div className="tree">
              <button type="button" className="local-btn new-folder-btn" title={titled(t('newFolder'), 'newFolder')} onClick={() => setNewFolder({ parentId: null })}>
                <span className="new-folder-ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M12 11v5M9.5 13.5h5" /></svg>
                </span>
                <span className="item-copy"><strong>{t('newFolder')}</strong></span>
              </button>
              {favorites.length > 0 && (
                <Section id="favorites" title={t('favorites')} count={favorites.length} sections={sections} forceOpen={Boolean(q)}>
                  {favorites.map((session) => (
                    <SessionRow key={session.id} session={session} />
                  ))}
                </Section>
              )}
              {model.folders.some((folder) => canSeeFolder(folder, handle, model.folders)) && (
                <Section id="folders" title={t('folders')} sections={sections} forceOpen={Boolean(q)}>
                  <FolderTree parentId={null} query={q} sections={sections} onInvite={setInvite} onNewFolder={(parentId) => setNewFolder({ parentId })} />
                </Section>
              )}
              {loose.length > 0 && (
                <Section id="notes" title={t('notes')} count={loose.length} sections={sections} forceOpen={Boolean(q)} drop={{ folderId: null, beforeId: loose[0]?.id ?? null }}>
                  {loose.map((session) => (
                    <SessionRow key={session.id} session={session} />
                  ))}
                </Section>
              )}
              {model.sessions.length === 0 && <p className="hint">{t('emptySessions')}</p>}
            </div>
            {selection.active ? (
              <SelectionBar selection={selection} onClear={clearSelection} />
            ) : (
              <div className="side-foot">
                <ImportButton />
                <button type="button" onClick={() => void model.exportSessions()}>{t('export')}</button>
                <button type="button" onClick={selection.start}>{t('select')}</button>
              </div>
            )}
          </SelectionContext.Provider>
        )}
        {nav === 'keychain' && <KeychainPanel />}
        {nav === 'tunnels' && <PortForwardingPanel />}
        {nav === 'snippets' && <SnippetsPanel />}
        {nav === 'known' && <KnownHostsPanel />}
        {nav === 'logs' && <LogsPanel />}
        {nav === 'recordings' && <RecordingsPanel />}
      </div>
      {invite && <InviteDialog folder={invite} onClose={() => setInvite(null)} />}
      {spaceInvite && activeSpace && <WorkspaceInviteDialog spaceId={activeSpace.id} onClose={() => setSpaceInvite(false)} />}
      {newFolder && (
        <NameDialog
          title={newFolder.parentId ? t('newSubfolder') : t('newFolder')}
          label={t('folderName')}
          onClose={() => setNewFolder(null)}
          onCreate={async (name) => {
            const parentId = newFolder.parentId
            setNewFolder(null)
            await model.saveFolder(name, parentId)
            sections.expand('folders')
            if (parentId) sections.expand(`folder:${parentId}`)
          }}
        />
      )}
      {newSpace && (
        <NameDialog
          title={t('newWorkspace')}
          label={t('workspaceName')}
          onClose={() => setNewSpace(false)}
          onCreate={async (name) => {
            setNewSpace(false)
            const code = await model.createWorkspace(name)
            if (code) model.toast(t(code), 'err')
          }}
        />
      )}
    </aside>
  )
}

function FolderTree({ parentId, query, sections, onInvite, onNewFolder }: { parentId: string | null; query: string; sections: Sections; onInvite: (folder: Folder) => void; onNewFolder: (parentId: string | null) => void }) {
  const model = useModel()
  const handle = model.account?.username ?? null
  const folders = model.folders.filter((folder) => {
    if (!canSeeFolder(folder, handle, model.folders)) return false
    if (folder.parentId === parentId) return true
    if (parentId !== null) return false
    const parent = model.folders.find((item) => item.id === folder.parentId)
    return Boolean(folder.parentId && (!parent || !canSeeFolder(parent, handle, model.folders)))
  })
  if (!folders.length && parentId !== null) return null
  return (
    <>
      {folders.map((folder) => (
        <FolderBlock key={folder.id} folder={folder} query={query} sections={sections} onInvite={onInvite} onNewFolder={onNewFolder} />
      ))}
    </>
  )
}

function FolderBlock({ folder, query, sections, onInvite, onNewFolder }: { folder: Folder; query: string; sections: Sections; onInvite: (folder: Folder) => void; onNewFolder: (parentId: string | null) => void }) {
  const model = useModel()
  const { t } = useI18n()
  const me = model.account?.username
  const canManage = !folder.owner || folder.owner === me
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const selection = useContext(SelectionContext)
  const sessions = model.sessions.filter((session) => session.folderId === folder.id && match(session, query))
  const childFolders = model.folders.filter((item) => item.parentId === folder.id)
  if (query && !sessions.length && !childFolders.length && !folder.name.toLowerCase().includes(query)) return null
  return (
    <Section
      id={`folder:${folder.id}`}
      title={folder.name}
      count={sessions.length}
      sections={sections}
      forceOpen={Boolean(query)}
      drop={{ folderId: folder.id, beforeId: sessions[0]?.id ?? null }}
      extra={(
        <>
          {selection?.active && (
            <SelectBox
              checked={selection.folders.has(folder.id)}
              implied={!selection.folders.has(folder.id) && selection.covered(folder.parentId)}
              label={folder.name}
              onToggle={() => selection.toggleFolder(folder.id)}
            />
          )}
          <button
            type="button"
            className="star folder-more"
            title={t('more')}
            aria-label={t('more')}
            onClick={(event) => {
              event.stopPropagation()
              const box = event.currentTarget.getBoundingClientRect()
              setMenuAt(menuAt ? null : { x: box.left, y: box.bottom + 4 })
            }}
          >⋯</button>
          {menuAt && (
            <FolderMenu
              folder={folder}
              canManage={canManage}
              x={menuAt.x}
              y={menuAt.y}
              onInvite={() => onInvite(folder)}
              onNewSubfolder={() => onNewFolder(folder.id)}
              onSelect={selection ? () => { if (!selection.folders.has(folder.id)) selection.toggleFolder(folder.id) } : undefined}
              onClose={() => setMenuAt(null)}
            />
          )}
        </>
      )}
    >
      {folder.members.length > 0 && <p className="members" dir="ltr">{folder.members.join(' · ')}</p>}
      {sessions.map((session) => (
        <SessionRow key={session.id} session={session} />
      ))}
      <FolderTree parentId={folder.id} query={query} sections={sections} onInvite={onInvite} onNewFolder={onNewFolder} />
    </Section>
  )
}

interface Sections {
  open: (id: string, force: boolean) => boolean
  toggle: (id: string) => void
  expand: (id: string) => void
}

function useSections(): Sections {
  const [closed, setClosed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('mys.sections')
      return raw ? JSON.parse(raw) as Record<string, boolean> : {}
    } catch {
      return {}
    }
  })
  return {
    open: (id, force) => force || !closed[id],
    expand: (id) => {
      setClosed((current) => {
        if (!current[id]) return current
        const next = { ...current, [id]: false }
        localStorage.setItem('mys.sections', JSON.stringify(next))
        return next
      })
    },
    toggle: (id) => {
      setClosed((current) => {
        const next = { ...current, [id]: !current[id] }
        localStorage.setItem('mys.sections', JSON.stringify(next))
        return next
      })
    },
  }
}

function Section({ id, title, count, sections, forceOpen, extra, drop, children }: { id: string; title: string; count?: number; sections: Sections; forceOpen: boolean; extra?: ReactNode; drop?: { folderId: string | null; beforeId: string | null }; children: ReactNode }) {
  const model = useModel()
  const [over, setOver] = useState(false)
  const open = sections.open(id, forceOpen)
  return (
    <section
      className={over ? 'drop-over' : ''}
      onDragOver={(event) => {
        if (!drop || !allowSessionDrag(event)) return
        setOver(true)
        sections.expand(id)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!drop) return
        const dragged = readDraggedSession(event)
        setOver(false)
        if (!dragged) return
        event.preventDefault()
        event.stopPropagation()
        void model.moveSession(dragged, drop.folderId, drop.beforeId === dragged ? null : drop.beforeId)
      }}
    >
      <h3>
        <button type="button" className="section-toggle" aria-expanded={open} onClick={() => sections.toggle(id)}>
          <i className={open ? 'caret open' : 'caret'} />
          <span>{title}</span>
          {count !== undefined && <small className="section-count">{count}</small>}
        </button>
        {extra}
      </h3>
      {open && children}
    </section>
  )
}

function FolderMenu({ folder, canManage, x, y, onInvite, onNewSubfolder, onSelect, onClose }: { folder: Folder; canManage: boolean; x: number; y: number; onInvite: () => void; onNewSubfolder: () => void; onSelect?: () => void; onClose: () => void }) {
  const model = useModel()
  const { t } = useI18n()
  const menuRef = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(folder.name)
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: y, left: x, visibility: 'hidden' })
  useLayoutEffect(() => {
    const popup = menuRef.current
    if (!popup) return
    const box = popup.getBoundingClientRect()
    const left = Math.min(window.innerWidth - box.width - 8, Math.max(8, x))
    const top = y + box.height > window.innerHeight - 8 ? Math.max(8, y - box.height) : y
    setStyle({ position: 'fixed', top, left, visibility: 'visible' })
  }, [x, y, renaming])
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const submitRename = async (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const next = name.trim()
    if (next && next !== folder.name) await model.renameFolder(folder, next)
    onClose()
  }

  return createPortal(
    <div
      ref={menuRef}
      className="row-menu"
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {renaming ? (
        <form className="row-rename" onSubmit={(event) => void submitRename(event)}>
          <input
            dir="auto"
            autoFocus
            value={name}
            placeholder={t('folderName')}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                onClose()
              }
            }}
          />
          <button type="submit" className="primary">{t('save')}</button>
        </form>
      ) : (
        <>
          {canManage && <button type="button" onClick={() => { setName(folder.name); setRenaming(true) }}>{t('edit')}</button>}
          {canManage && <button type="button" onClick={() => { onNewSubfolder(); onClose() }}>{t('newSubfolder')}</button>}
          {canManage && <button type="button" onClick={() => { onInvite(); onClose() }}>{t('invite')}</button>}
          {onSelect && <button type="button" onClick={() => { onSelect(); onClose() }}>{t('select')}</button>}
          <button type="button" onClick={() => { void model.exportFolder(folder, 'json'); onClose() }}>{t('exportJson')}</button>
          <button type="button" onClick={() => { void model.exportFolder(folder, 'csv'); onClose() }}>{t('exportCsv')}</button>
          {canManage && <button type="button" className="danger" onClick={() => { void model.removeFolder(folder.id); onClose() }}>{t('delete')}</button>}
        </>
      )}
    </div>,
    document.body,
  )
}

const IMPORT_SOURCES: { id: ImportSource; label: 'importSshConfig' | 'importPutty' | 'importMoba' | 'importCrt' | 'importJson' }[] = [
  { id: 'ssh-config', label: 'importSshConfig' },
  { id: 'putty', label: 'importPutty' },
  { id: 'mobaxterm', label: 'importMoba' },
  { id: 'securecrt', label: 'importCrt' },
  { id: 'json', label: 'importJson' },
]

function ImportButton() {
  const model = useModel()
  const { t } = useI18n()
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!at) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setAt(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAt(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [at])
  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          setAt(at ? null : { x: box.left, y: box.top })
        }}
      >{t('import')}</button>
      {at && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="row-menu"
          style={{ position: 'fixed', left: at.x, bottom: window.innerHeight - at.y + 4 }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {IMPORT_SOURCES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setAt(null)
                void model.importSessions(item.id)
              }}
            >{t(item.label)}</button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

export function SessionMenu({ session, x, y, onSelect, onClose }: { session: Session; x: number; y: number; onSelect?: () => void; onClose: () => void }) {
  const model = useModel()
  const { t } = useI18n()
  const menuRef = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(session.name)
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: y, left: x, visibility: 'hidden' })
  useLayoutEffect(() => {
    const popup = menuRef.current
    if (!popup) return
    const box = popup.getBoundingClientRect()
    const left = Math.min(window.innerWidth - box.width - 8, Math.max(8, x))
    const top = y + box.height > window.innerHeight - 8 ? Math.max(8, y - box.height) : y
    setStyle({ position: 'fixed', top, left, visibility: 'visible' })
  }, [x, y, renaming])
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const submitRename = async (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const next = name.trim()
    if (!next || next === session.name) {
      onClose()
      return
    }
    await model.saveSession({ ...session, name: next })
    onClose()
  }

  return createPortal(
    <div
      ref={menuRef}
      className="row-menu"
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {renaming ? (
        <form className="row-rename" onSubmit={(event) => void submitRename(event)}>
          <input
            dir="auto"
            autoFocus
            value={name}
            placeholder={t('rename')}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                onClose()
              }
            }}
          />
          <button type="submit" className="primary">{t('save')}</button>
        </form>
      ) : (
        <>
          <button type="button" onClick={() => { model.editSession(session); onClose() }}>{t('edit')}</button>
          <button type="button" onClick={() => { void model.duplicateSession(session.id); onClose() }}>{t('duplicate')}</button>
          {onSelect && <button type="button" onClick={() => { onSelect(); onClose() }}>{t('select')}</button>}
          <button type="button" onClick={() => { void model.toggleFavorite(session); onClose() }}>{t('favorite')}</button>
          <button type="button" onClick={() => { void model.exportSession(session); onClose() }}>{t('export')}</button>
          <button type="button" onClick={() => { setName(session.name); setRenaming(true) }}>{t('rename')}</button>
          <button type="button" className="danger" onClick={() => { void model.removeSession(session.id); onClose() }}>{t('delete')}</button>
        </>
      )}
    </div>,
    document.body,
  )
}

function SessionRow({ session }: { session: Session }) {
  const model = useModel()
  const { t } = useI18n()
  const [over, setOver] = useState(false)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const skipClick = useRef(false)
  const selection = useContext(SelectionContext)
  const picked = Boolean(selection?.sessions.has(session.id))
  const implied = !picked && Boolean(selection?.active && selection.covered(session.folderId))
  const live = allTabs(model.layout).some((tab) => tab.spec.sessionId === session.id)
  return (
    <div
      data-session-id={session.id}
      className={`session-row${over ? ' drop-over' : ''}${menuAt ? ' menu-open' : ''}${picked || implied ? ' selected' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuAt({ x: event.clientX, y: event.clientY })
      }}
      onDragOver={(event) => {
        if (!allowSessionDrag(event)) return
        event.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        const dragged = readDraggedSession(event)
        setOver(false)
        if (!dragged || dragged === session.id) return
        event.preventDefault()
        event.stopPropagation()
        void model.moveSession(dragged, session.folderId, session.id)
      }}
    >
      <button
        type="button"
        className="session-main"
        draggable
        onDragStart={(event) => {
          skipClick.current = true
          event.dataTransfer.setData(SESSION_MIME, session.id)
          event.dataTransfer.effectAllowed = 'move'
          event.stopPropagation()
        }}
        onDragEnd={() => setOver(false)}
        aria-pressed={selection?.active ? picked || implied : undefined}
        onClick={(event) => {
          skipClick.current = false
          // Cmd/Ctrl+click toggles, Shift+click selects a range; in selection mode a plain click toggles.
          if (!selection || !(selection.active || event.metaKey || event.ctrlKey || event.shiftKey)) return
          event.preventDefault()
          selection.toggleSession(session.id, event.shiftKey)
        }}
        onDoubleClick={() => {
          if (selection?.active) return
          if (skipClick.current) {
            skipClick.current = false
            return
          }
          model.openSession(session)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          model.openSession(session)
        }}
      >
        {selection?.active && <i className={`sel-box${picked ? ' on' : ''}${implied ? ' implied' : ''}`} aria-hidden="true" />}
        <span className="badge-wrap">
          <Badge session={session} />
          {live && <i className="live-dot" title={t('connected')} />}
        </span>
        <ItemCopy session={session} />
      </button>
      <span className="row-actions">
        <button
          type="button"
          className="row-more"
          title={t('more')}
          aria-label={t('more')}
          onClick={(event) => {
            event.stopPropagation()
            const box = event.currentTarget.getBoundingClientRect()
            setMenuAt(menuAt ? null : { x: box.left, y: box.bottom + 4 })
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="12.5" cy="8" r="1.2" /></svg>
        </button>
        <button
          type="button"
          className={session.favorite ? 'row-star on' : 'row-star'}
          title={t('favorite')}
          aria-label={t('favorite')}
          aria-pressed={session.favorite}
          onClick={() => void model.toggleFavorite(session)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l1.75 3.6 3.95.55-2.87 2.77.7 3.93L8 11.2l-3.53 1.85.7-3.93L2.3 6.35l3.95-.55z" /></svg>
        </button>
      </span>
      {menuAt && (
        <SessionMenu
          session={session}
          x={menuAt.x}
          y={menuAt.y}
          onSelect={selection && !picked ? () => selection.toggleSession(session.id) : undefined}
          onClose={() => setMenuAt(null)}
        />
      )}
    </div>
  )
}

function SelectBox({ checked, implied, label, onToggle }: { checked: boolean; implied: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked || implied}
      aria-label={label}
      className="sel-toggle"
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
    >
      <i className={`sel-box${checked ? ' on' : ''}${implied ? ' implied' : ''}`} aria-hidden="true" />
    </button>
  )
}

function Badge({ session }: { session: Session }) {
  const { locale } = useI18n()
  return <HostBadge protocol={session.protocol} label={protocolBadge(locale, session.protocol)} icon={session.icon} color={session.color} />
}

function ItemCopy({ session }: { session: Session }) {
  const { locale } = useI18n()
  const title = session.name || session.host || protocolLabel(locale, session.protocol)
  const host = `${session.username ? `${session.username}@` : ''}${session.host}${session.port ? `:${session.port}` : ''}`
  const stamp = session.lastUsed || session.createdAt
  const when = new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', year: '2-digit' }).format(stamp)
  return (
    <span className="item-copy" title={`${title} · ${when}`}>
      <strong>{title}</strong>
      <small className="item-meta">
        <span dir="ltr">{host || protocolLabel(locale, session.protocol)}</span>
      </small>
    </span>
  )
}

function match(session: Session, query: string): boolean {
  if (!query) return true
  return `${session.name} ${session.host} ${session.username} ${session.protocol}`.toLowerCase().includes(query)
}

function InviteDialog({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const model = useModel()
  const { t } = useI18n()
  const live = model.folders.find((item) => item.id === folder.id) ?? folder
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const me = model.account?.username

  const add = async () => {
    const code = await model.inviteMember(live, name)
    if (code) {
      setError(t(code))
      return
    }
    setName('')
    setError('')
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal invite" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{t('inviteTo', { name: live.name })}</h2>
          <CloseButton label={t('close')} onClick={onClose} />
        </header>
        {me ? <p className="hint" dir="ltr">{t('folderOwner')}: {live.owner || me}</p> : <p className="form-error">{t('usernameRequired')}</p>}
        <p className="hint">{t('inviteHint')}</p>
        <ul className="plain">
          {live.members.length === 0 && <li className="hint">{t('membersEmpty')}</li>}
          {live.members.map((member) => (
            <li key={member}>
              <span dir="ltr">{member}</span>
              <button type="button" className="textish danger" onClick={() => void model.removeMember(live, member)}>{t('removeMember')}</button>
            </li>
          ))}
        </ul>
        <form onSubmit={(event) => { event.preventDefault(); void add() }}>
          <label>
            {t('memberUsername')}
            <input dir="ltr" value={name} autoFocus onChange={(event) => setName(event.target.value)} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <footer>
            <button type="button" onClick={onClose}>{t('close')}</button>
            <button type="submit" className="primary" disabled={!me || !name.trim()}>{t('invite')}</button>
          </footer>
        </form>
      </div>
    </div>
  )
}

function NameDialog({ title, label, onClose, onCreate }: { title: string; label: string; onClose: () => void; onCreate: (name: string) => void | Promise<void> }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal invite" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <CloseButton label={t('close')} onClick={onClose} />
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const next = name.trim()
            if (!next || busy) return
            setBusy(true)
            void Promise.resolve(onCreate(next)).finally(() => setBusy(false))
          }}
        >
          <label>
            {label}
            <input value={name} dir="auto" autoFocus onChange={(event) => setName(event.target.value)} />
          </label>
          <footer>
            <button type="button" onClick={onClose}>{t('cancel')}</button>
            <button type="submit" className="primary" disabled={busy || !name.trim()}>{t('save')}</button>
          </footer>
        </form>
      </div>
    </div>
  )
}

function WorkspaceInviteDialog({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const model = useModel()
  const { t } = useI18n()
  const live = model.workspaces.find((item) => item.id === spaceId)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const me = model.account?.email

  if (!live) return null

  const add = async () => {
    const code = await model.inviteWorkspace(live.id, email)
    if (code) {
      setError(t(code))
      return
    }
    setEmail('')
    setError('')
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal invite" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{t('inviteWorkspace')}</h2>
          <CloseButton label={t('close')} onClick={onClose} />
        </header>
        <p className="hint" dir="ltr">{live.name}</p>
        {me ? <p className="hint" dir="ltr">{t('folderOwner')}: {live.ownerEmail || me}</p> : <p className="form-error">{t('emailRequired')}</p>}
        <p className="hint">{t('inviteEmailHint')}</p>
        <ul className="plain">
          {live.members.length === 0 && <li className="hint">{t('membersEmpty')}</li>}
          {live.members.map((member) => (
            <li key={member.email}>
              <span dir="ltr">
                {member.email}
                {member.status === 'pending' ? ` (${t('workspacePending')})` : ''}
              </span>
              <button type="button" className="textish danger" onClick={() => void model.removeWorkspaceMember(live.id, member.email)}>{t('removeMember')}</button>
            </li>
          ))}
        </ul>
        <form onSubmit={(event) => { event.preventDefault(); void add() }}>
          <label>
            {t('inviteEmail')}
            <input dir="ltr" type="email" value={email} autoFocus onChange={(event) => setEmail(event.target.value)} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <footer>
            <button type="button" onClick={onClose}>{t('close')}</button>
            <button type="submit" className="primary" disabled={!me || !email.trim()}>{t('invite')}</button>
          </footer>
        </form>
      </div>
    </div>
  )
}

function KnownHostsPanel() {
  const { t } = useI18n()
  const [items, setItems] = useState<{ id: string; fingerprint: string }[]>([])
  useEffect(() => {
    void window.mys.knownHosts.list().then(setItems)
  }, [])
  return (
    <div className="side-panel">
      <div className="side-panel-head"><strong>{t('knownHosts')}</strong></div>
      <div className="side-scroll">
        {items.length === 0 && <p className="hint">{t('knownHostsEmpty')}</p>}
        <ul className="plain">
          {items.map((item) => (
            <li key={item.id} className="known-row">
              <span className="known-meta" dir="ltr">
                <strong>{item.id}</strong>
                <small>{item.fingerprint}</small>
              </span>
              <button
                type="button"
                className="danger"
                onClick={() => void window.mys.knownHosts.remove(item.id).then(setItems)}
              >{t('delete')}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function NavIcon({ name }: { name: NavTab }) {
  if (name === 'recordings') {
    return (
      <svg className="side-ico" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="6" width="17" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.6" className="dot" />
      </svg>
    )
  }
  if (name === 'hosts') {
    return (
      <svg className="side-ico" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="4" width="14" height="6" rx="1.5" />
        <rect x="5" y="14" width="14" height="6" rx="1.5" />
        <circle cx="8" cy="7" r="0.9" className="dot" />
        <circle cx="8" cy="17" r="0.9" className="dot" />
      </svg>
    )
  }
  if (name === 'keychain') {
    return (
      <svg className="side-ico" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="9" r="3.5" />
        <path d="M12 9h8l-1.5 2H17l-1 2h-2.2" />
      </svg>
    )
  }
  if (name === 'tunnels') {
    return (
      <svg className="side-ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8h12" />
        <path d="M12 4l4 4-4 4" />
        <path d="M4 16h12" />
        <path d="M12 12l4 4-4 4" />
      </svg>
    )
  }
  if (name === 'snippets') {
    return (
      <svg className="side-ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 5.2c-2 .35-2.8 1.55-2.8 3.05 0 1.75 1.25 2.35 1.25 3.75S7.2 14 7.2 15.75c0 1.5.8 2.7 2.8 3.05" />
        <path d="M14 5.2c2 .35 2.8 1.55 2.8 3.05 0 1.75-1.25 2.35-1.25 3.75s1.25 1.95 1.25 3.7c0 1.5-.8 2.7-2.8 3.05" />
      </svg>
    )
  }
  if (name === 'known') {
    return (
      <svg className="side-ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.8c-2.4 1.2-4.2 3.6-4.2 6.4 0 2.2 1.1 3.9 2.6 5.1.6.5.9 1.1.9 1.9v1.2h2.4v-1.2c0-.8.3-1.4.9-1.9 1.5-1.2 2.6-2.9 2.6-5.1 0-2.8-1.8-5.2-4.2-6.4z" />
        <circle cx="12" cy="9.2" r="1.4" />
        <path d="M9.2 20.2h5.6" />
      </svg>
    )
  }
  return (
    <svg className="side-ico" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.25" />
      <path d="M12 8.5V12l2.5 2" />
    </svg>
  )
}

export function useFolderOptions(): { id: string; label: string }[] {
  const model = useModel()
  const handle = model.account?.username ?? null
  return useMemo(() => {
    const walk = (parentId: string | null, depth: number): { id: string; label: string }[] => {
      return model.folders
        .filter((folder) => folder.parentId === parentId && canSeeFolder(folder, handle, model.folders))
        .flatMap((folder) => [{ id: folder.id, label: `${'· '.repeat(depth)}${folder.name}` }, ...walk(folder.id, depth + 1)])
    }
    return walk(null, 0)
  }, [handle, model.folders])
}
