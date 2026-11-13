import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  blankSession,
  defaultSettings,
  parseQuickConnect,
  type Folder,
  type Macro,
  type MacroPackage,
  type OpenSpec,
  type Protocol,
  type Session,
  type Settings,
  type Account,
  type ImportSource,
  type WorkSpace,
} from '../../shared/types'
import { titledSession, translate, type MessageKey } from '../../shared/i18n'
import { FONT_DEFAULT, FONT_MAX, FONT_MIN, isTerminalProtocol, SIDE_PANEL_PROTOCOLS } from './terminal-protocols'
import { handOff, seedTerminal, terminalText, wasHandedOff } from './term-registry'
import {
  addTab,
  allTabs,
  bulkCloseIds,
  closeTabs as closeTabsIn,
  homeTab,
  pinTab,
  type BulkClose,
  closeLeaf,
  closeTab,
  cycleTab,
  emptyLayout,
  findLeaf,
  isHomeTab,
  firstLeaf,
  persistableLayout,
  replaceTab,
  reviveLayout,
  setActiveTab,
  setRatio,
  splitLeaf,
  splitQuad,
  updateTab,
  type Layout,
  type Tab,
} from './layout'

interface Toast {
  id: string
  text: string
  kind: 'ok' | 'err'
  reveal?: string
}

interface DialogState {
  open: boolean
  session: Session | null
}

interface EditorState {
  instanceId: string
  path: string
  content: string
  mode: 'sftp' | 'ftp' | 's3' | 'local'
}

interface Model {
  sessions: Session[]
  folders: Folder[]
  workspaces: WorkSpace[]
  macros: Macro[]
  packages: MacroPackage[]
  shellHistory: string[]
  settings: Settings
  layout: Layout
  activeLeafId: string
  multiExec: boolean
  sidebar: boolean
  dialog: DialogState
  drawer: 'tunnels' | 'macros' | 'tools' | 'settings' | 'servers' | null
  editor: EditorState | null
  player: string | null
  recordingIds: string[]
  toasts: Toast[]
  findNonce: number
  confirm: { text: string } | null
  terminalIds: string[]
  toast: (text: string, kind?: 'ok' | 'err', reveal?: string) => void
  ask: (text: string) => Promise<boolean>
  answer: (value: boolean) => void
  registerTerm: (id: string) => void
  unregisterTerm: (id: string) => void
  broadcast: (data: string, except?: string) => void
  setMultiExec: (value: boolean) => void
  setSidebar: (value: boolean) => void
  setDrawer: (drawer: Model['drawer']) => void
  setEditor: (editor: EditorState | null) => void
  setPlayer: (path: string | null) => void
  toggleRecording: (instanceId: string) => void
  /** A terminal's font (the active tab unless `tabId` is given): +1 / -1, or null for the default. A session's own size wins over the app setting. */
  changeFontSize: (step: number | null, tabId?: string) => void
  /** This window holds one tab moved out of the main window. */
  detached: boolean
  /** Close the tabs before / after this one, all others, or all; one confirmation for the lot. */
  closeTabs: (leafId: string, tabId: string, which: BulkClose) => void
  /** Open the same connection again in a new tab next to this one. */
  duplicateTab: (tabId: string) => void
  togglePin: (tabId: string) => void
  /** Move the tab, connection and output included, into its own window. */
  detachTab: (leafId: string, tabId: string) => Promise<void>
  focusLeaf: (id: string) => void
  openLocal: (leafId?: string) => void
  openSession: (session: Session, leafId?: string) => void
  launch: (partial: Omit<OpenSpec, 'instanceId' | 'cols' | 'rows'>, title: string) => void
  openQuick: (input: string) => void
  openBlank: (protocol: Protocol) => void
  closeActiveTab: () => void
  closeTabById: (leafId: string, tabId: string) => void
  activateTab: (leafId: string, tabId: string) => void
  split: (dir: 'h' | 'v') => void
  splitQuad: () => void
  closePane: (leafId: string) => void
  resizeSplit: (splitId: string, ratio: number) => void
  toggleFiles: (tabId: string) => void
  reconnect: (tabId: string, patch?: Partial<OpenSpec>, attempt?: number) => void
  patchTab: (tabId: string, patch: Partial<Tab>) => void
  cycle: (delta: number) => void
  requestFind: () => void
  saveSession: (session: Session, auth?: SessionAuth, opts?: { quiet?: boolean }) => Promise<Session>
  removeSession: (id: string) => Promise<void>
  duplicateSession: (id: string) => Promise<void>
  toggleFavorite: (session: Session) => Promise<void>
  moveSession: (id: string, folderId: string | null, beforeId: string | null) => Promise<void>
  saveFolder: (name: string, parentId?: string | null) => Promise<string | null>
  renameFolder: (folder: Folder, name: string) => Promise<void>
  removeFolder: (id: string) => Promise<void>
  inviteMember: (folder: Folder, username: string) => Promise<MessageKey | null>
  removeMember: (folder: Folder, username: string) => Promise<MessageKey | null>
  createWorkspace: (name: string) => Promise<MessageKey | null>
  switchWorkspace: (id: string) => Promise<void>
  inviteWorkspace: (id: string, email: string) => Promise<MessageKey | null>
  removeWorkspaceMember: (id: string, email: string) => Promise<MessageKey | null>
  saveMacros: (macros: Macro[]) => Promise<void>
  savePackages: (packages: MacroPackage[]) => Promise<void>
  pushShellHistory: (command: string) => Promise<void>
  clearShellHistory: () => Promise<void>
  saveSettings: (settings: Settings, opts?: { quiet?: boolean }) => Promise<void>
  exportSessions: () => Promise<void>
  exportSession: (session: Session) => Promise<void>
  exportFolder: (folder: Folder, format: 'json' | 'csv') => Promise<void>
  exportSelection: (sessionIds: string[], folderIds: string[], format: 'json' | 'csv') => Promise<boolean>
  importSessions: (source?: ImportSource) => Promise<void>
  activeTab: () => Tab | null
  editSession: (session: Session | null) => void
  closeDialog: () => void
  account: Account | null
  loginOpen: boolean
  setLogin: (open: boolean) => void
  setAccount: (account: Account | null) => void
  refresh: () => Promise<unknown>
}

type SessionAuth = { password?: string | null; passphrase?: string | null; proxyPassword?: string | null }

const TABS_KEY = 'mys.tabs.v1'

const Ctx = createContext<Model | null>(null)

export function useModel(): Model {
  const value = useContext(Ctx)
  if (!value) throw new Error('model missing')
  return value
}

const FILE_PROTOCOLS = new Set<Protocol>(['ssh', 'sftp', 'ftp', 's3', 'local'])

function makeTab(partial: Omit<OpenSpec, 'instanceId' | 'cols' | 'rows'> & { cols?: number; rows?: number }, title: string): Tab {
  const instanceId = crypto.randomUUID()
  const spec: OpenSpec = {
    ...partial,
    instanceId,
    cols: partial.cols ?? 80,
    rows: partial.rows ?? 24,
  }
  if (!spec.password) delete spec.password
  if (!spec.passphrase) delete spec.passphrase
  return {
    instanceId,
    title,
    protocol: spec.protocol,
    spec,
    showFiles: FILE_PROTOCOLS.has(spec.protocol),
  }
}

export function specFromSession(session: Session, locale: string): Omit<OpenSpec, 'instanceId' | 'cols' | 'rows'> {
  return {
    sessionId: session.id,
    name: titledSession(session, locale),
    protocol: session.protocol,
    host: session.host,
    port: session.port,
    username: session.username,
    privateKeyPath: session.privateKeyPath || undefined,
    certificatePath: session.certificatePath || undefined,
    startupCommand: session.startupCommand || undefined,
    cwd: session.cwd || undefined,
    shell: session.shell || undefined,
    x11: session.x11,
    useAgent: session.useAgent,
    agentForward: session.agentForward,
    serialPath: session.serialPath || undefined,
    baudRate: session.baudRate,
    dataBits: session.dataBits,
    parity: session.parity,
    stopBits: session.stopBits,
    url: session.url || undefined,
    domain: session.domain || undefined,
    ftpSecure: session.ftpSecure,
    tunnels: session.tunnels,
    jumpSessionId: session.jumpSessionId || undefined,
    proxyType: session.proxyType,
    proxyHost: session.proxyHost || undefined,
    proxyPort: session.proxyPort,
    proxyUser: session.proxyUser || undefined,
    rdpFullscreen: session.rdpFullscreen,
    rdpClipboard: session.rdpClipboard,
    rdpShareHome: session.rdpShareHome,
  }
}

export function ModelProvider({ children, detached = false }: { children: ReactNode; detached?: boolean }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [workspaces, setWorkspaces] = useState<WorkSpace[]>([])
  const [macros, setMacros] = useState<Macro[]>([])
  const [packages, setPackages] = useState<MacroPackage[]>([])
  const [shellHistory, setShellHistory] = useState<string[]>([])
  const [settings, setSettings] = useState<Settings>(defaultSettings())
  const [layout, setLayout] = useState<Layout>(emptyLayout())
  const [activeLeafId, setActiveLeafId] = useState('root')
  const [multiExec, setMultiExec] = useState(false)
  const [sidebar, setSidebar] = useState(true)
  const [dialog, setDialog] = useState<DialogState>({ open: false, session: null })
  const [drawer, setDrawer] = useState<Model['drawer']>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [player, setPlayer] = useState<string | null>(null)
  const [recordingIds, setRecordingIds] = useState<string[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [findNonce, setFindNonce] = useState(0)
  const [confirm, setConfirm] = useState<{ text: string } | null>(null)
  const [terminalIds, setTerminalIds] = useState<string[]>([])
  const [account, setAccount] = useState<Account | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const confirmRef = useRef<((value: boolean) => void) | null>(null)
  const leafRef = useRef(activeLeafId)
  const layoutRef = useRef(layout)
  const booted = useRef(false)
  const tabsReady = useRef(false)
  const settingsRef = useRef(settings)
  leafRef.current = activeLeafId
  layoutRef.current = layout
  settingsRef.current = settings

  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok', reveal?: string) => {
    const id = crypto.randomUUID()
    setToasts((list) => [...list, { id, text, kind, reveal }])
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), reveal ? 8000 : 4200)
  }, [])

  const say = useCallback((key: MessageKey, kind: 'ok' | 'err' = 'ok', vars?: Record<string, string | number>) => {
    toast(translate(settingsRef.current.locale, key, vars), kind)
  }, [toast])

  const ask = useCallback((text: string) => {
    return new Promise<boolean>((resolve) => {
      confirmRef.current = resolve
      setConfirm({ text })
    })
  }, [])

  const answer = useCallback((value: boolean) => {
    confirmRef.current?.(value)
    confirmRef.current = null
    setConfirm(null)
  }, [])

  const reload = useCallback(async () => {
    const data = await window.mys.sessions.list()
    setSessions(data.sessions)
    setFolders(data.folders)
    setWorkspaces(data.workspaces)
    setMacros(data.macros)
    setPackages(data.packages ?? [])
    setShellHistory(data.shellHistory ?? [])
    setSettings(data.settings)
    return data
  }, [])

  const placeTab = useCallback((tab: Tab, leafId?: string) => {
    const target = leafId && findLeaf(layoutRef.current, leafId) ? leafId : leafRef.current
    const leaf = findLeaf(layoutRef.current, target) ? target : firstLeaf(layoutRef.current).id
    setLayout((current) => addTab(current, leaf, tab))
    setActiveLeafId(leaf)
  }, [])

  const openLocal = useCallback((leafId?: string) => {
    const title = translate(settingsRef.current.locale, 'localTerminal')
    placeTab(makeTab({ protocol: 'local', name: title }, title), leafId)
  }, [placeTab])

  const openSession = useCallback((session: Session, leafId?: string) => {
    const locale = settingsRef.current.locale
    const tab = makeTab(specFromSession(session, locale), titledSession(session, locale))
    placeTab(tab, leafId)
    if (session.id) void window.mys.sessions.touch(session.id).then(() => reload())
  }, [placeTab, reload])

  const launch = useCallback((partial: Omit<OpenSpec, 'instanceId' | 'cols' | 'rows'>, title: string) => {
    placeTab(makeTab(partial, title))
    if (partial.sessionId) void window.mys.sessions.touch(partial.sessionId).then(() => reload())
  }, [placeTab, reload])

  const openQuick = useCallback((input: string) => {
    const parsed = parseQuickConnect(input)
    if (!parsed) {
      say('unknownConnect', 'err')
      return
    }
    const title = parsed.protocol === 'browser' ? parsed.url || translate(settingsRef.current.locale, 'protocolBrowser') : `${parsed.username ? `${parsed.username}@` : ''}${parsed.host || ''}`.trim()
    placeTab(makeTab({ ...parsed, name: title || input }, title || input))
  }, [placeTab, say])

  const openBlank = useCallback((protocol: Protocol) => {
    setDialog({ open: true, session: blankSession(protocol, crypto.randomUUID(), settingsRef.current.activeWorkspaceId) })
  }, [])

  const saveFolder = useCallback(async (name: string, parentId: string | null = null) => {
    const trimmed = name.trim()
    if (!trimmed) return null
    const id = crypto.randomUUID()
    await window.mys.sessions.saveFolder({
      id,
      name: trimmed,
      parentId,
      owner: account?.username ?? null,
      members: [],
      workspaceId: settingsRef.current.activeWorkspaceId,
    })
    await reload()
    return id
  }, [account, reload])

  const workspaceErr = useCallback((caught: unknown, fallback: MessageKey): MessageKey => {
    const message = caught instanceof Error ? caught.message : String(caught || '')
    const loc = settingsRef.current.locale
    const keys: MessageKey[] = ['emailRequired', 'invalidEmail', 'invalidUser', 'alreadyMember', 'cannotInviteSelf', 'notFolderOwner', 'invalidRequest']
    for (const key of keys) {
      if (message === translate(loc, key) || message === key) return key === 'invalidUser' ? 'invalidEmail' : key
    }
    return fallback
  }, [])

  const createWorkspace = useCallback(async (name: string): Promise<MessageKey | null> => {
    if (settingsRef.current.mode === 'online' && !account?.email) return 'emailRequired'
    try {
      await window.mys.workspaces.create(name)
      await reload()
      return null
    } catch (caught) {
      return workspaceErr(caught, 'invalidRequest')
    }
  }, [account, reload, workspaceErr])

  const switchWorkspace = useCallback(async (id: string) => {
    await window.mys.workspaces.setActive(id)
    await reload()
  }, [reload])

  const inviteWorkspace = useCallback(async (id: string, email: string): Promise<MessageKey | null> => {
    if (!account?.email) return 'emailRequired'
    try {
      await window.mys.workspaces.invite(id, email)
      await reload()
      return null
    } catch (caught) {
      return workspaceErr(caught, 'invalidEmail')
    }
  }, [account, reload, workspaceErr])

  const removeWorkspaceMember = useCallback(async (id: string, email: string): Promise<MessageKey | null> => {
    if (!account?.email) return 'emailRequired'
    try {
      await window.mys.workspaces.removeMember(id, email)
      await reload()
      return null
    } catch (caught) {
      return workspaceErr(caught, 'notFolderOwner')
    }
  }, [account, reload, workspaceErr])

  const applyAccount = useCallback((next: Account | null) => {
    setAccount(next)
    void reload()
  }, [reload])

  /** Every tab close goes through here: a confirmation first, then the layout change. */
  const closeTabById = useCallback(async (leafId: string, tabId: string) => {
    const leaf = findLeaf(layoutRef.current, leafId)
    const tab = leaf?.tabs.find((item) => item.instanceId === tabId)
    if (!tab || isHomeTab(tab)) return
    if (!(await ask(translate(settingsRef.current.locale, 'closeTabAsk', { name: tab.title })))) return
    setLayout((current) => closeTab(current, leafId, tabId))
  }, [ask])

  const closeActiveTab = useCallback(() => {
    const leaf = findLeaf(layoutRef.current, leafRef.current)
    if (!leaf?.activeTabId) return
    void closeTabById(leaf.id, leaf.activeTabId)
  }, [closeTabById])

  const activateTab = useCallback((leafId: string, tabId: string) => {
    setActiveLeafId(leafId)
    setLayout((current) => setActiveTab(current, leafId, tabId))
  }, [])

  const split = useCallback((dir: 'h' | 'v') => {
    const currentLeaf = leafRef.current
    setLayout((current) => {
      const next = splitLeaf(current, currentLeaf, dir)
      leafRef.current = next.leafId
      setActiveLeafId(next.leafId)
      return next.layout
    })
  }, [])

  const splitQuadLayout = useCallback(() => {
    const currentLeaf = leafRef.current
    setLayout((current) => {
      const next = splitQuad(current, currentLeaf)
      leafRef.current = next.leafId
      setActiveLeafId(next.leafId)
      return next.layout
    })
  }, [])

  const closePane = useCallback(async (leafId: string) => {
    const leaf = findLeaf(layoutRef.current, leafId)
    const open = leaf ? leaf.tabs.filter((tab) => !isHomeTab(tab)).length : 0
    if (open > 0 && !(await ask(translate(settingsRef.current.locale, 'closePaneAsk', { n: open })))) return
    setLayout((current) => {
      const next = closeLeaf(current, leafId)
      const leaf = firstLeaf(next)
      setActiveLeafId(leaf.id)
      return next
    })
  }, [ask])

  const resizeSplit = useCallback((splitId: string, ratio: number) => {
    setLayout((current) => setRatio(current, splitId, Math.min(0.8, Math.max(0.2, ratio))))
  }, [])

  const toggleFiles = useCallback((tabId: string) => {
    setLayout((current) => updateTab(current, tabId, (tab) => ({ ...tab, showFiles: !tab.showFiles })))
  }, [])

  const reconnect = useCallback((tabId: string, patch?: Partial<OpenSpec>, attempt = 0) => {
    setLayout((current) => {
      const prev = allTabs(current).find((tab) => tab.instanceId === tabId)
      if (!prev) return current
      const instanceId = crypto.randomUUID()
      const next: Tab = {
        ...prev,
        instanceId,
        attempt,
        adopted: undefined,
        spec: { ...prev.spec, ...patch, instanceId },
      }
      return replaceTab(current, tabId, next)
    })
  }, [])

  const patchTab = useCallback((tabId: string, patch: Partial<Tab>) => {
    setLayout((current) => updateTab(current, tabId, (tab) => ({ ...tab, ...patch, instanceId: tab.instanceId })))
  }, [])

  const closeTabs = useCallback(async (leafId: string, tabId: string, which: BulkClose) => {
    const leaf = findLeaf(layoutRef.current, leafId)
    if (!leaf) return
    const ids = bulkCloseIds(leaf, tabId, which)
    if (!ids.length) return
    if (!(await ask(translate(settingsRef.current.locale, 'closeTabsAsk', { n: ids.length })))) return
    setLayout((current) => closeTabsIn(current, leafId, ids))
  }, [ask])

  const duplicateTab = useCallback((tabId: string) => {
    let leafId: string | null = null
    const walk = (node: Layout): void => {
      if (node.kind === 'leaf') {
        if (node.tabs.some((tab) => tab.instanceId === tabId)) leafId = node.id
        return
      }
      walk(node.a)
      walk(node.b)
    }
    walk(layoutRef.current)
    const source = allTabs(layoutRef.current).find((tab) => tab.instanceId === tabId)
    if (!source || isHomeTab(source) || !leafId) return
    const instanceId = crypto.randomUUID()
    const copy: Tab = {
      instanceId,
      title: source.title,
      protocol: source.protocol,
      spec: { ...source.spec, instanceId },
      showFiles: source.showFiles,
      ...(source.color ? { color: source.color } : {}),
    }
    const target: string = leafId
    setLayout((current) => addTab(current, target, copy, tabId))
    setActiveLeafId(target)
  }, [])

  const togglePin = useCallback((tabId: string) => {
    const tab = allTabs(layoutRef.current).find((item) => item.instanceId === tabId)
    if (!tab || isHomeTab(tab)) return
    setLayout((current) => pinTab(current, tabId, !tab.pinned))
  }, [])

  const detachTab = useCallback(async (leafId: string, tabId: string) => {
    const tab = allTabs(layoutRef.current).find((item) => item.instanceId === tabId)
    if (!tab || isHomeTab(tab) || !isTerminalProtocol(tab.protocol)) return
    // Secrets stay here; the connection is already authenticated.
    const { password: _p, passphrase: _pp, proxyPassword: _px, forceHostKey: _f, ...spec } = tab.spec
    const moved: Tab = { ...tab, spec: { ...spec, instanceId: tab.instanceId }, pinned: false, attempt: 0, adopted: undefined }
    // Mark first: closing the tab below must not end the connection the new window takes over.
    handOff(tab.instanceId)
    try {
      await window.mys.tabs.detach(moved, terminalText(tab.instanceId))
    } catch {
      wasHandedOff(tab.instanceId)
      say('detachFailed', 'err')
      return
    }
    setLayout((current) => closeTabsIn(current, leafId, [tabId]))
  }, [say])

  const cycle = useCallback((delta: number) => {
    const leafId = leafRef.current
    setLayout((current) => cycleTab(current, leafId, delta))
  }, [])

  const activeTab = useCallback(() => {
    const leaf = findLeaf(layoutRef.current, leafRef.current)
    if (!leaf) return null
    return leaf.tabs.find((tab) => tab.instanceId === leaf.activeTabId) ?? null
  }, [])

  const saveSession = useCallback(async (session: Session, auth?: SessionAuth, opts?: { quiet?: boolean }) => {
    const saved = await window.mys.sessions.save({ session, password: auth?.password, passphrase: auth?.passphrase, proxyPassword: auth?.proxyPassword })
    await reload()
    if (!opts?.quiet) say('sessionSaved')
    return saved
  }, [reload, say])

  const removeSession = useCallback(async (id: string) => {
    if (!(await ask(translate(settingsRef.current.locale, 'deleteSessionAsk')))) return
    await window.mys.sessions.remove(id)
    await reload()
  }, [ask, reload])

  const duplicateSession = useCallback(async (id: string) => {
    await window.mys.sessions.duplicate(id)
    await reload()
    say('duplicated')
  }, [reload, say])

  const moveSession = useCallback(async (id: string, folderId: string | null, beforeId: string | null) => {
    await window.mys.sessions.move(id, folderId, beforeId)
    await reload()
  }, [reload])

  const toggleFavorite = useCallback(async (session: Session) => {
    await window.mys.sessions.save({ session: { ...session, favorite: !session.favorite } })
    await reload()
  }, [reload])

  const renameFolder = useCallback(async (folder: Folder, name: string) => {
    await window.mys.sessions.saveFolder({ ...folder, name })
    await reload()
  }, [reload])

  const inviteMember = useCallback(async (folder: Folder, raw: string): Promise<MessageKey | null> => {
    const me = account?.username
    if (!me) return 'usernameRequired'
    if (folder.owner && folder.owner !== me) return 'notFolderOwner'
    const found = await window.mys.auth.lookupUsername(raw)
    if (!found.ok) return found.code === 'username-invalid' ? 'invalidUser' : 'usernameMissing'
    if (found.username === me) return 'cannotInviteSelf'
    if (folder.members.includes(found.username)) return 'alreadyMember'
    await window.mys.sessions.saveFolder({
      ...folder,
      owner: folder.owner || me,
      members: [...folder.members, found.username],
    })
    await reload()
    return null
  }, [account, reload])

  const removeMember = useCallback(async (folder: Folder, username: string): Promise<MessageKey | null> => {
    const me = account?.username
    if (!me) return 'usernameRequired'
    if (folder.owner && folder.owner !== me) return 'notFolderOwner'
    await window.mys.sessions.saveFolder({
      ...folder,
      members: folder.members.filter((item) => item !== username),
    })
    await reload()
    return null
  }, [account, reload])

  const removeFolder = useCallback(async (id: string) => {
    if (!(await ask(translate(settingsRef.current.locale, 'deleteFolderAsk')))) return
    await window.mys.sessions.removeFolder(id)
    await reload()
  }, [ask, reload])

  const saveMacros = useCallback(async (next: Macro[]) => {
    const saved = await window.mys.macros.save(next)
    setMacros(saved)
  }, [])

  const savePackages = useCallback(async (next: MacroPackage[]) => {
    const saved = await window.mys.macros.savePackages(next)
    setPackages(saved)
  }, [])

  const pushShellHistory = useCallback(async (command: string) => {
    const next = await window.mys.macros.pushHistory(command)
    setShellHistory(next)
  }, [])

  const clearShellHistory = useCallback(async () => {
    const next = await window.mys.macros.clearHistory()
    setShellHistory(next)
  }, [])

  const saveSettings = useCallback(async (next: Settings, opts?: { quiet?: boolean }) => {
    const saved = await window.mys.settings.save(next)
    setSettings(saved)
    if (!opts?.quiet) say('settingsSaved')
  }, [say])

  const exportSessions = useCallback(async () => {
    const path = await window.mys.sessions.exportBundle()
    if (path) say('sessionsExported')
  }, [say])

  const exportSession = useCallback(async (session: Session) => {
    const path = await window.mys.sessions.exportOne(session.id)
    if (path) say('sessionsExported')
  }, [say])

  const exportFolder = useCallback(async (folder: Folder, format: 'json' | 'csv') => {
    const path = await window.mys.sessions.exportFolder(folder.id, format)
    if (path) say('sessionsExported')
  }, [say])

  const exportSelection = useCallback(async (sessionIds: string[], folderIds: string[], format: 'json' | 'csv') => {
    const path = await window.mys.sessions.exportSelection(sessionIds, folderIds, format)
    if (path) say('sessionsExported')
    return Boolean(path)
  }, [say])

  const importSessions = useCallback(async (source: ImportSource = 'json') => {
    try {
      const count = await window.mys.sessions.importFrom(source)
      await reload()
      say(count ? 'sessionsImported' : 'importNothing', 'ok', { n: count })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''
      toast(translate(settingsRef.current.locale, 'importFailed', { message }), 'err')
    }
  }, [reload, say, toast])

  const registerTerm = useCallback((id: string) => {
    setTerminalIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
  }, [])

  const unregisterTerm = useCallback((id: string) => {
    setTerminalIds((ids) => ids.filter((item) => item !== id))
  }, [])

  const broadcast = useCallback((data: string, except?: string) => {
    for (const id of terminalIds) {
      if (id !== except) window.mys.write(id, data)
    }
  }, [terminalIds])

  useEffect(() => {
    void reload().then(async (data) => {
      if (booted.current) return
      booted.current = true
      let restored = false
      if (detached) {
        // A detached window starts with the one tab it was opened for; its connection is already up.
        const payload = await window.mys.tabs.detached().catch(() => null)
        const raw = payload?.tab as Tab | undefined
        if (raw && typeof raw.instanceId === 'string' && raw.spec) {
          seedTerminal(raw.instanceId, payload?.buffer ?? '')
          const home = homeTab()
          const tab: Tab = { ...raw, adopted: true, attempt: 0 }
          const next: Layout = { kind: 'leaf', id: 'root', tabs: [home, tab], activeTabId: tab.instanceId }
          layoutRef.current = next
          setLayout(next)
          setActiveLeafId('root')
          document.title = tab.title
        }
        tabsReady.current = true
        setAccount(await window.mys.auth.account())
        return
      }
      if (data.settings.restoreTabs) {
        try {
          const saved = reviveLayout(JSON.parse(localStorage.getItem(TABS_KEY) || 'null'))
          if (saved) {
            layoutRef.current = saved
            setLayout(saved)
            setActiveLeafId(firstLeaf(saved).id)
            restored = true
          }
        } catch {
          /* unreadable snapshot: start clean */
        }
      }
      tabsReady.current = true
      if (!restored && data.settings.openLocalOnStart) openLocal()
      setAccount(await window.mys.auth.account())
    })
  }, [openLocal, reload])

  useEffect(() => {
    if (!tabsReady.current) return
    if (detached) {
      // Only the main window's tabs are restored on the next launch; a detached window closes with its last tab.
      if (!allTabs(layout).some((tab) => !isHomeTab(tab))) window.close()
      return
    }
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(TABS_KEY, JSON.stringify(persistableLayout(layout)))
      } catch {
        /* storage full: skip */
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [layout, detached])

  useEffect(() => {
    return window.mys.subscribe((event) => {
      if (event.type === 'exit') void reload()
      if (event.type === 'recording') {
        setRecordingIds((ids) => (event.active ? [...new Set([...ids, event.instanceId])] : ids.filter((id) => id !== event.instanceId)))
        if (!event.active && event.path) toast(translate(settingsRef.current.locale, 'recordingSaved'), 'ok', event.path)
      }
      if (event.type === 'synced') {
        const name = event.path.split('/').pop() || event.path
        if (event.ok) say('fileUploaded', 'ok', { name })
        else toast(`${name}: ${event.message || translate(settingsRef.current.locale, 'uploadFailed')}`, 'err')
      }
    })
  }, [reload, say, toast])

  const recordingRef = useRef(recordingIds)
  recordingRef.current = recordingIds
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const changeFontSize = useCallback((step: number | null, tabId?: string) => {
    const tab = tabId ? allTabs(layoutRef.current).find((item) => item.instanceId === tabId) ?? null : activeTab()
    if (!tab || !isTerminalProtocol(tab.protocol)) return
    const session = tab.spec.sessionId ? sessionsRef.current.find((item) => item.id === tab.spec.sessionId) : undefined
    const size = session?.termFontSize || settingsRef.current.fontSize
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, step === null ? FONT_DEFAULT : size + step))
    if (next === size) return
    if (session?.termFontSize) void saveSession({ ...session, termFontSize: next }, undefined, { quiet: true })
    else void saveSettings({ ...settingsRef.current, fontSize: next }, { quiet: true })
  }, [activeTab, saveSession, saveSettings])

  useEffect(() => {
    const withTerminal = (fn: (instanceId: string) => void) => () => {
      const tab = activeTab()
      if (tab && isTerminalProtocol(tab.protocol)) fn(tab.instanceId)
    }
    const offs = [
      window.mys.onMenu('menu:close-pane', () => { if (layoutRef.current.kind === 'split') closePane(leafRef.current) }),
      window.mys.onMenu('menu:record', withTerminal((id) => {
        if (recordingRef.current.includes(id)) void window.mys.recording.stop(id)
        else void window.mys.recording.start(id)
      })),
      window.mys.onMenu('menu:clear', withTerminal((id) => window.dispatchEvent(new CustomEvent('mys-clear', { detail: id })))),
      window.mys.onMenu('menu:side-panel', () => {
        const tab = activeTab()
        if (tab && SIDE_PANEL_PROTOCOLS.includes(tab.protocol)) toggleFiles(tab.instanceId)
      }),
      window.mys.onMenu('menu:font-bigger', () => changeFontSize(1)),
      window.mys.onMenu('menu:font-smaller', () => changeFontSize(-1)),
      window.mys.onMenu('menu:font-reset', () => changeFontSize(null)),
      window.mys.onMenu('menu:local', () => openLocal()),
      window.mys.onMenu('menu:new', () => openBlank('ssh')),
      window.mys.onMenu('menu:close-tab', () => closeActiveTab()),
      window.mys.onMenu('menu:split-v', () => split('v')),
      window.mys.onMenu('menu:split-h', () => split('h')),
      window.mys.onMenu('menu:split-quad', () => splitQuadLayout()),
      window.mys.onMenu('menu:sidebar', () => setSidebar((value) => !value)),
      window.mys.onMenu('menu:find', () => setFindNonce((value) => value + 1)),
      window.mys.onMenu('menu:settings', () => setDrawer('settings')),
      window.mys.onMenu('menu:lock-setup', () => {
        setDrawer('settings')
        say('lockSetFirst')
      }),
      window.mys.onMenu('menu:account', () => setLoginOpen(true)),
      window.mys.onMenu('menu:tunnels', () => setDrawer('tunnels')),
      window.mys.onMenu('menu:macros', () => setDrawer('macros')),
      window.mys.onMenu('menu:tools', () => setDrawer('tools')),
      window.mys.onMenu('menu:servers', () => setDrawer('servers')),
      window.mys.onMenu('menu:multi', () => setMultiExec((value) => !value)),
      window.mys.onMenu('menu:export-sessions', () => void exportSessions()),
      window.mys.onMenu('menu:import-ssh-config', () => void importSessions('ssh-config')),
      window.mys.onMenu('menu:import-putty', () => void importSessions('putty')),
      window.mys.onMenu('menu:import-mobaxterm', () => void importSessions('mobaxterm')),
      window.mys.onMenu('menu:import-securecrt', () => void importSessions('securecrt')),
      window.mys.onMenu('menu:import-json', () => void importSessions('json')),
    ]
    return () => offs.forEach((off) => off())
  }, [activeTab, changeFontSize, closeActiveTab, closePane, exportSessions, importSessions, openBlank, openLocal, say, split, splitQuadLayout, toggleFiles])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Inline popovers (icon picker) close themselves first and keep their dialog open.
      if (event.key === 'Escape' && event.target instanceof Element && event.target.closest('[data-own-escape]')) return
      // An open floating menu takes the first Escape for itself; the dialog under it stays.
      if (event.key === 'Escape' && document.querySelector('.popup-menu')) return
      if (event.key === 'Escape') {
        if (confirm) {
          answer(false)
          return
        }
        if (dialog.open) {
          setDialog({ open: false, session: null })
          return
        }
        if (loginOpen) {
          setLoginOpen(false)
          return
        }
        if (drawer) {
          setDrawer(null)
          return
        }
        if (editor) {
          setEditor(null)
          return
        }
      }
      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault()
        cycle(event.shiftKey ? -1 : 1)
      }
      if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const target = event.target
        if (target instanceof HTMLElement) {
          // Inside a terminal ⌥/Alt+←/→ jumps words (TerminalView); in text fields it moves the caret.
          if (target.closest('.xterm, input, textarea, select, [contenteditable="true"]')) return
        }
        event.preventDefault()
        event.stopPropagation()
        const rtl = document.documentElement.dir === 'rtl'
        const toTheRight = event.key === 'ArrowRight'
        cycle(toTheRight === rtl ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [answer, confirm, cycle, dialog.open, drawer, editor, loginOpen])

  const value = useMemo<Model>(() => ({
    sessions,
    folders,
    workspaces,
    macros,
    packages,
    shellHistory,
    settings,
    layout,
    activeLeafId,
    multiExec,
    sidebar,
    dialog,
    drawer,
    editor,
    player,
    recordingIds,
    toasts,
    findNonce,
    confirm,
    terminalIds,
    toast,
    ask,
    answer,
    registerTerm,
    unregisterTerm,
    broadcast,
    setMultiExec,
    setSidebar,
    setDrawer,
    setEditor,
    setPlayer,
    toggleRecording: (instanceId: string) => {
      if (recordingIds.includes(instanceId)) void window.mys.recording.stop(instanceId)
      else void window.mys.recording.start(instanceId)
    },
    changeFontSize,
    focusLeaf: setActiveLeafId,
    openLocal,
    openSession,
    launch,
    openQuick,
    openBlank,
    closeActiveTab,
    closeTabById,
    activateTab,
    split,
    splitQuad: splitQuadLayout,
    closePane,
    resizeSplit,
    toggleFiles,
    reconnect,
    patchTab,
    detached,
    closeTabs: (leafId, tabId, which) => void closeTabs(leafId, tabId, which),
    duplicateTab,
    togglePin,
    detachTab,
    cycle,
    requestFind: () => setFindNonce((item) => item + 1),
    saveSession,
    removeSession,
    duplicateSession,
    toggleFavorite,
    moveSession,
    saveFolder,
    renameFolder,
    removeFolder,
    inviteMember,
    removeMember,
    createWorkspace,
    switchWorkspace,
    inviteWorkspace,
    removeWorkspaceMember,
    saveMacros,
    savePackages,
    pushShellHistory,
    clearShellHistory,
    saveSettings,
    exportSessions,
    exportSession,
    exportFolder,
    exportSelection,
    importSessions,
    activeTab,
    editSession: (session) => setDialog({ open: true, session }),
    closeDialog: () => setDialog({ open: false, session: null }),
    account,
    loginOpen,
    setLogin: setLoginOpen,
    setAccount: applyAccount,
    refresh: reload,
  }), [
    activateTab, activeLeafId, activeTab, detached, closeTabs, duplicateTab, togglePin, detachTab, answer, changeFontSize, ask, applyAccount, broadcast, closeActiveTab, closePane, closeTabById, account, loginOpen,
    confirm, createWorkspace, cycle, dialog, drawer, duplicateSession, editor, player, recordingIds, exportFolder, exportSelection, exportSession, exportSessions, findNonce, folders, importSessions,
    inviteWorkspace, layout, macros, packages, shellHistory, moveSession, multiExec, openBlank, openLocal, openQuick, openSession, launch, reconnect, patchTab, registerTerm, reload,
    inviteMember, removeFolder, removeMember, removeSession, removeWorkspaceMember, renameFolder, resizeSplit, saveFolder, saveMacros, savePackages, pushShellHistory, clearShellHistory, saveSession, saveSettings,
    sessions, settings, sidebar, split, splitQuadLayout, switchWorkspace, terminalIds, toast, toggleFavorite, toggleFiles, toasts, unregisterTerm, workspaces,
  ])

  return (
    <Ctx.Provider value={value}>{children}</Ctx.Provider>
  )
}
