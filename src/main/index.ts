import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type {
  Folder,
  ImportSource,
  Macro,
  OpenSpec,
  Session,
  Settings,
  ToolRequest,
  TunnelTemplate,
} from '../shared/types'
import { Hub } from './hub'
import { setAppLocale, tr } from './i18n'
import { Store } from './store'
import { capabilities, which } from './which'
import { listTargets } from './containers'
import { LocalServers } from './servers'
import { defaultSshConfigPath, importMobaXterm, importPuttyReg, importSecureCrt, importSshConfig, readPuttyRegistry, type ImportDraft } from './importers'
import { isMac, isWin } from './platform'
import { accelerator, type ShortcutId } from '../shared/shortcuts'
import { AppLock } from './lock'
import { checkForUpdatesNow, initUpdater, setAutoUpdate } from './updater'
import {
  completeSignup,
  currentAccount,
  currentGoogleClient,
  loadAuth,
  loginWithPassword,
  lookupEmail,
  lookupUsername,
  requestPhoneCode,
  resetPassword,
  saveGoogleClient,
  setAccountEmail,
  setUsername,
  signInWithGoogle,
  signOut,
  verifyPhoneCode,
} from './auth'

const isDev = !app.isPackaged
// Dev runs keep their own profile, so sessions, secrets, tabs and logs made while
// developing never show up in a packaged build — every release starts empty.
if (isDev) app.setPath('userData', join(app.getPath('appData'), `${app.getName()} (Dev)`))
let mainWindow: BrowserWindow | null = null
let hub: Hub | null = null
let appLock: AppLock | null = null
const servers = new LocalServers((items) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hub:event', { type: 'servers', items })
})
const store = new Store()
const pickedFiles = new Set<string>()
/** Which window opened each connection, so closing that window ends its connections. */
const connOwner = new Map<string, number>()
/** Tab handed to a detached window, read once by that window's renderer (kept for reloads). */
const detachedTabs = new Map<number, unknown>()

function allContents(): Electron.WebContents[] {
  return BrowserWindow.getAllWindows().map((win) => win.webContents).filter((contents) => !contents.isDestroyed())
}

/** End the connections a window opened, once that window is gone. */
function releaseConnections(contentsId: number): void {
  for (const [id, owner] of connOwner) {
    if (owner !== contentsId) continue
    connOwner.delete(id)
    hub?.close(id)
  }
  detachedTabs.delete(contentsId)
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char)
}

/** A plain window holding one tab moved out of the main window. */
function createDetachedWindow(title: string): BrowserWindow {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null
  const icon = appIcon()
  const win = new BrowserWindow({
    width: 1000,
    height: 680,
    ...(parent ? { x: parent.x + 40, y: parent.y + 40 } : {}),
    minWidth: 520,
    minHeight: 320,
    title,
    backgroundColor: '#0e1416',
    ...(icon ? { icon } : {}),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      spellcheck: false,
    },
  })
  const contentsId = win.webContents.id
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => releaseConnections(contentsId))
  if (isDev && process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#detached`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'detached' })
  return win
}

/** Channels the lock screen itself needs; everything else waits for the master password. */
// Closing and resizing never expose data, and must keep working if a tab goes away while locked.
const OPEN_WHILE_LOCKED = new Set(['app:version', 'app:capabilities', 'lock:status', 'lock:unlock', 'lock:activity', 'conn:resize', 'conn:close'])

function isLocked(channel: string): boolean {
  return Boolean(appLock?.locked) && !OPEN_WHILE_LOCKED.has(channel)
}

function handle(channel: string, fn: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (isLocked(channel)) throw new Error('locked')
    return fn(event, ...args)
  })
}

function listen(channel: string, fn: (event: IpcMainEvent, ...args: any[]) => void): void {
  ipcMain.on(channel, (event, ...args) => {
    if (isLocked(channel)) return
    fn(event, ...args)
  })
}

function lockStatus() {
  return {
    enabled: Boolean(appLock?.enabled),
    locked: Boolean(appLock?.locked),
    minutes: appLock?.minutes ?? 0,
    retryIn: appLock?.retryIn() ?? 0,
    locale: store.data.settings.locale,
    theme: store.data.settings.theme,
  }
}

function sendMenu(channel: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel)
}

const AUTHOR_SITE = 'https://usefpour.com'

async function showAbout(): Promise<void> {
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    title: tr('menuAbout'),
    message: `Mys Terminal Management ${app.getVersion()}`,
    detail: `${tr('about')}\n\n${tr('aboutAuthor', { name: tr('aboutAuthorName') })}\n${AUTHOR_SITE.replace('https://', '')}`,
    buttons: [tr('aboutVisitSite'), tr('close')],
    defaultId: 1,
    cancelId: 1,
    icon: appIcon(),
  }
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  if (result.response === 0) void shell.openExternal(AUTHOR_SITE)
}

function createMenu(): void {
  const key = (id: ShortcutId) => accelerator(id, process.platform)
  const item = (label: string, id: ShortcutId | null, channel: string): Electron.MenuItemConstructorOptions =>
    ({ label, ...(id ? { accelerator: key(id) } : {}), click: () => sendMenu(channel) })
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Mys Terminal Management',
      submenu: [
        { label: tr('menuAbout'), click: () => void showAbout() },
        { type: 'separator' },
        item(tr('settings'), 'settings', 'menu:settings'),
        item(tr('account'), 'account', 'menu:account'),
        {
          label: tr('lockNow'),
          accelerator: key('lock'),
          // Without a master password there is nothing to unlock with: open the setup instead.
          click: () => (appLock?.enabled ? appLock.lock() : sendMenu('menu:lock-setup')),
        },
        { label: tr('updateCheck'), click: () => void checkForUpdatesNow(() => mainWindow) },
        { type: 'separator' },
        ...(isMac ? [{ role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }] as Electron.MenuItemConstructorOptions[] : []),
        { role: 'quit' },
      ],
    },
    {
      label: tr('menuSession'),
      submenu: [
        item(tr('newSession'), 'newSession', 'menu:new'),
        item(`${tr('tbPickProtocol')}…`, 'pickProtocol', 'menu:pick-protocol'),
        item(tr('localTerminal'), 'localTerminal', 'menu:local'),
        item(tr('newFolder'), 'newFolder', 'menu:new-folder'),
        { type: 'separator' },
        item(tr('menuCloseTab'), 'closeTab', 'menu:close-tab'),
        item(tr('closePane'), 'closePane', 'menu:close-pane'),
        { type: 'separator' },
        item(tr('splitV'), 'splitV', 'menu:split-v'),
        item(tr('splitQuad'), 'splitQuad', 'menu:split-quad'),
        item(tr('splitH'), 'splitH', 'menu:split-h'),
        { type: 'separator' },
        item(tr('multiExec'), 'multiExec', 'menu:multi'),
        item(tr('recordStart'), 'record', 'menu:record'),
        item(tr('clearTerminal'), 'clearTerminal', 'menu:clear'),
        { type: 'separator' },
        item(tr('exportSessions'), null, 'menu:export-sessions'),
        {
          label: tr('importFrom'),
          submenu: [
            item(tr('importSshConfig'), null, 'menu:import-ssh-config'),
            item(tr('importPutty'), null, 'menu:import-putty'),
            item(tr('importMoba'), null, 'menu:import-mobaxterm'),
            item(tr('importCrt'), null, 'menu:import-securecrt'),
            item(tr('importJson'), null, 'menu:import-json'),
          ],
        },
      ],
    },
    {
      label: tr('tools'),
      submenu: [
        item(tr('tunnel'), null, 'menu:tunnels'),
        item(tr('macros'), null, 'menu:macros'),
        item(tr('networkTools'), null, 'menu:tools'),
        item(tr('localServers'), null, 'menu:servers'),
        { type: 'separator' },
        item(tr('passwordGen'), 'passwordGen', 'menu:passgen'),
      ],
    },
    {
      label: tr('menuEdit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        item(tr('menuFind'), 'find', 'menu:find'),
      ],
    },
    {
      label: tr('menuView'),
      submenu: [
        item(tr('commandPalette'), 'palette', 'menu:palette'),
        { type: 'separator' },
        item(tr('menuSidebar'), 'sidebar', 'menu:sidebar'),
        item(tr('sidePanel'), 'sidePanel', 'menu:side-panel'),
        { type: 'separator' },
        item(tr('fontBigger'), 'fontBigger', 'menu:font-bigger'),
        item(tr('fontSmaller'), 'fontSmaller', 'menu:font-smaller'),
        item(tr('fontReset', { n: 13 }), 'fontReset', 'menu:font-reset'),
        { type: 'separator' },
        item(`${tr('language')}…`, 'language', 'menu:language'),
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function appIcon(): Electron.NativeImage | undefined {
  const file = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon-dark.png')
  const image = nativeImage.createFromPath(file)
  return image.isEmpty() ? undefined : image
}

function createWindow(): void {
  const bounds = store.bounds
  const icon = appIcon()
  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 920,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 980,
    minHeight: 640,
    title: 'Mys Terminal Management',
    // macOS keeps inset traffic lights; Windows/Linux need overlay buttons or the
    // hidden title bar leaves the window without minimize/maximize/close.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 15 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#00000000', symbolColor: '#9aa7ad', height: 44 } }),
    backgroundColor: '#0e1416',
    ...(icon ? { icon } : {}),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (isDev) {
    mainWindow.webContents.on('console-message', (event) => {
      const message = (event as unknown as { message?: string }).message || ''
      if (!message || message.includes('[vite]') || message.includes('Electron Security Warning') || message.includes('React DevTools')) return
      console.log(`[renderer] ${message}`)
    })
    mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
      console.error(`[renderer] failed to load ${code} ${description}`)
    })
  }
  mainWindow.on('close', () => {
    if (!mainWindow) return
    void store.setBounds(mainWindow.getBounds())
  })
  const mainContentsId = mainWindow.webContents.id
  mainWindow.on('closed', () => {
    mainWindow = null
    releaseConnections(mainContentsId)
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  const active = () => {
    if (!hub) throw new Error(tr('hubNotReady'))
    return hub
  }

  handle('app:version', () => app.getVersion())
  handle('lock:status', () => lockStatus())
  handle('lock:unlock', (_e, password: string) => appLock!.unlock(String(password || '')))
  handle('lock:lock', () => appLock?.lock())
  handle('lock:set-password', async (_e, next: string, minutes: number, current?: string) => {
    await appLock!.setPassword(String(next || ''), Number(minutes), current === undefined ? undefined : String(current))
    createMenu()
    return lockStatus()
  })
  handle('lock:set-minutes', async (_e, minutes: number) => {
    await appLock!.setMinutes(Number(minutes))
    return lockStatus()
  })
  handle('lock:disable', async (_e, current: string) => {
    await appLock!.disable(String(current || ''))
    createMenu()
    return lockStatus()
  })
  listen('lock:activity', () => appLock?.touch())
  handle('updates:check', () => checkForUpdatesNow(() => mainWindow))
  handle('transfers:list', (_e, connId: string) => active().transfers.list(String(connId || '')))
  handle('transfers:pause', (_e, id: string) => active().transfers.pause(String(id || '')))
  handle('transfers:resume', (_e, id: string) => active().transfers.resume(String(id || '')))
  handle('transfers:cancel', (_e, id: string) => active().transfers.cancel(String(id || '')))
  handle('transfers:clear', (_e, connId: string) => active().transfers.clear(String(connId || '')))
  handle('recording:start', (_e, id: string) => active().recordStart(String(id || '')))
  handle('recording:stop', (_e, id: string) => active().recordStop(String(id || '')))
  handle('recording:list', () => active().recorder.list())
  handle('recording:read', (_e, file: string) => active().recorder.read(String(file || '')))
  handle('recording:remove', (_e, file: string) => active().recorder.remove(String(file || '')))
  handle('recording:reveal', (_e, file: string) => shell.showItemInFolder(active().recorder.inside(String(file || ''))))
  handle('monitor:start', (_e, id: string) => active().monitorStart(String(id || '')))
  handle('monitor:stop', (_e, id: string) => active().monitorStop(String(id || '')))
  handle('app:capabilities', () => capabilities())
  handle('conn:open', (event, spec: OpenSpec) => {
    if (spec && typeof spec.instanceId === 'string') connOwner.set(spec.instanceId, event.sender.id)
    return active().open(spec)
  })
  listen('conn:write', (_e, id: string, data: string) => active().write(id, data))
  listen('conn:resize', (_e, id: string, cols: number, rows: number) => active().resize(id, cols, rows))
  handle('conn:close', (_e, id: string) => {
    connOwner.delete(String(id))
    return active().close(id)
  })
  // Move a live tab into its own window; the connection stays open and changes owner.
  handle('tabs:detach', (_e, payload: { tab: { instanceId: string; title: string }; buffer: string }) => {
    const id = String(payload?.tab?.instanceId || '')
    if (!id) throw new Error(tr('invalidRequest'))
    const win = createDetachedWindow(String(payload.tab.title || 'Mys Terminal Management'))
    connOwner.set(id, win.webContents.id)
    detachedTabs.set(win.webContents.id, { tab: payload.tab, buffer: String(payload.buffer || '') })
  })
  handle('tabs:detached', (event) => detachedTabs.get(event.sender.id) ?? null)
  handle('tabs:save-output', async (event, name: string, text: string) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = {
      defaultPath: `${String(name || 'terminal').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60)}.txt`,
      filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
    }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return ''
    await writeFile(result.filePath, String(text ?? ''), 'utf8')
    return result.filePath
  })
  // Print through a hidden window so the system print dialog gets clean monospaced text.
  handle('tabs:print', async (_e, title: string, text: string) => {
    const dir = await mkdtemp(join(tmpdir(), 'mys-print-'))
    const file = join(dir, 'output.html')
    const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(String(title || ''))}</title>`
      + '<style>body{margin:16px;font:10.5px/1.35 Menlo,Consolas,"DejaVu Sans Mono",monospace;white-space:pre-wrap;word-break:break-all;color:#000;background:#fff}</style>'
      + `<body>${escapeHtml(String(text ?? ''))}</body>`
    await writeFile(file, html, 'utf8')
    const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
    const cleanup = () => {
      if (!printer.isDestroyed()) printer.destroy()
      void rm(dir, { recursive: true, force: true })
    }
    try {
      await printer.loadFile(file)
    } catch (error) {
      cleanup()
      throw error
    }
    await new Promise<void>((resolve) => {
      printer.webContents.print({ printBackground: false }, () => {
        cleanup()
        resolve()
      })
    })
  })

  handle('sessions:list', async () => {
    const account = currentAccount()
    if (account?.email) await store.activatePendingInvites(account.email)
    return store.listForEmail(account?.email ?? null)
  })
  handle('workspaces:create', (_e, name: string) => {
    const account = currentAccount()
    const offline = store.data.settings.mode !== 'online'
    if (!offline && !account?.email) throw new Error(tr('emailRequired'))
    return store.createWorkspace(String(name || ''), offline ? '' : (account?.email || ''))
  })
  handle('workspaces:rename', (_e, id: string, name: string) => store.renameWorkspace(String(id || ''), String(name || '')))
  handle('workspaces:set-active', (_e, id: string) => store.setActiveWorkspace(String(id || '')))
  handle('workspaces:invite', async (_e, id: string, email: string) => {
    const account = currentAccount()
    if (!account?.email) throw new Error(tr('emailRequired'))
    const found = lookupEmail(String(email || ''))
    if (!found.ok) throw new Error(tr('invalidEmail'))
    return store.inviteWorkspace(String(id || ''), found.email, account.email, found.known)
  })
  handle('workspaces:remove-member', (_e, id: string, email: string) => {
    const account = currentAccount()
    if (!account?.email) throw new Error(tr('emailRequired'))
    return store.removeWorkspaceMember(String(id || ''), String(email || ''), account.email)
  })
  handle('sessions:save', (_e, payload: { session: Session; password?: string | null; passphrase?: string | null; proxyPassword?: string | null }) => {
    const session = payload.session
    if (!session.workspaceId) session.workspaceId = store.data.settings.activeWorkspaceId
    return store.saveSession(session, { password: payload.password, passphrase: payload.passphrase, proxyPassword: payload.proxyPassword })
  })
  // Saved secrets of one session, for the edit dialog's prefilled fields and its show button.
  handle('sessions:secrets', (_e, id: string) => store.secretsFor(String(id || '')))
  handle('sessions:remove', (_e, id: string) => store.removeSession(id))
  handle('sessions:duplicate', (_e, id: string) => store.duplicateSession(id))
  handle('sessions:touch', (_e, id: string) => store.touchSession(id))
  handle('sessions:move', (_e, id: string, folderId: string | null, beforeId: string | null) => store.moveSession(id, folderId, beforeId))
  handle('sessions:save-folder', (_e, folder: Folder) => {
    if (!folder.workspaceId) folder.workspaceId = store.data.settings.activeWorkspaceId
    return store.saveFolder(folder)
  })
  handle('sessions:remove-folder', (_e, id: string) => store.removeFolder(id))
  handle('sessions:export-one', async (_e, id: string) => {
    const json = store.exportSession(String(id || ''))
    if (!json) return ''
    const session = store.data.sessions.find((item) => item.id === id)
    const result = await dialog.showSaveDialog({
      defaultPath: `${(session?.name || 'session').replace(/[^\w.-]+/g, '_')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return ''
    const { writeFile } = await import('node:fs/promises')
    await writeFile(result.filePath, json, 'utf8')
    return result.filePath
  })
  handle('sessions:export-folder', async (_e, id: string, format: string) => {
    const kind = format === 'csv' ? 'csv' : 'json'
    const out = store.exportFolder(String(id || ''), kind)
    if (!out) return ''
    const result = await dialog.showSaveDialog({
      defaultPath: `${(out.name || 'folder').replace(/[^\w.-]+/g, '_')}.${kind}`,
      filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
    })
    if (result.canceled || !result.filePath) return ''
    const { writeFile } = await import('node:fs/promises')
    await writeFile(result.filePath, out.body, 'utf8')
    return result.filePath
  })
  handle('sessions:export-selection', async (_e, sessionIds: unknown, folderIds: unknown, format: string) => {
    const kind = format === 'csv' ? 'csv' : 'json'
    const ids = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
    const body = store.exportSelection(ids(sessionIds), ids(folderIds), kind)
    const result = await dialog.showSaveDialog({
      defaultPath: `mys-terminal-selection.${kind}`,
      filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
    })
    if (result.canceled || !result.filePath) return ''
    const { writeFile } = await import('node:fs/promises')
    await writeFile(result.filePath, body, 'utf8')
    return result.filePath
  })
  handle('sessions:export', async () => {
    const result = await dialog.showSaveDialog({ defaultPath: 'mys-terminal-sessions.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return ''
    const json = await store.exportBundle()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(result.filePath, json, 'utf8')
    return result.filePath
  })
  handle('sessions:import', async () => {
    const result = await dialog.showOpenDialog({ filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] })
    if (result.canceled || !result.filePaths[0]) return 0
    const { readFile } = await import('node:fs/promises')
    const json = await readFile(result.filePaths[0], 'utf8')
    return store.importBundle(json)
  })
  handle('sessions:import-from', async (_e, source: ImportSource) => {
    const pick = async (name: string, extensions: string[]) => {
      const result = await dialog.showOpenDialog({ filters: [{ name, extensions }, { name: '*', extensions: ['*'] }], properties: ['openFile', 'showHiddenFiles'] })
      return result.canceled ? null : result.filePaths[0] ?? null
    }
    let drafts: ImportDraft[] = []
    if (source === 'json') {
      const file = await pick('JSON', ['json'])
      if (!file) return 0
      const { readFile } = await import('node:fs/promises')
      return store.importBundle(await readFile(file, 'utf8'))
    }
    if (source === 'ssh-config') {
      const fallback = defaultSshConfigPath()
      const file = existsSync(fallback) ? fallback : await pick('SSH config', ['*'])
      if (!file) return 0
      drafts = await importSshConfig(file)
    } else if (source === 'putty') {
      if (isWin) drafts = await readPuttyRegistry()
      else {
        const file = await pick('PuTTY .reg', ['reg'])
        if (!file) return 0
        drafts = await importPuttyReg(file)
      }
    } else if (source === 'securecrt') {
      // A Config/Sessions folder or an exported settings .xml. Only macOS can pick
      // either in one dialog; elsewhere openFile+openDirectory shows a folder picker.
      let kinds: ('openFile' | 'openDirectory')[] = ['openFile', 'openDirectory']
      if (process.platform !== 'darwin') {
        const { response } = await dialog.showMessageBox({ type: 'question', message: tr('importCrt'), buttons: [tr('importCrtFolder'), tr('importCrtFile'), tr('cancel')], cancelId: 2, defaultId: 0 })
        if (response === 2) return 0
        kinds = [response === 0 ? 'openDirectory' : 'openFile']
      }
      const result = await dialog.showOpenDialog({ title: tr('importCrt'), filters: [{ name: 'SecureCRT', extensions: ['xml', 'ini'] }], properties: [...kinds, 'showHiddenFiles'] })
      const file = result.canceled ? null : result.filePaths[0]
      if (!file) return 0
      drafts = await importSecureCrt(file)
    } else if (source === 'mobaxterm') {
      const file = await pick('MobaXterm', ['mxtsessions', 'ini'])
      if (!file) return 0
      drafts = await importMobaXterm(file)
    } else {
      return 0
    }
    return store.importDrafts(drafts)
  })

  handle('macros:save', async (_e, macros: Macro[]) => {
    await store.saveMacros(macros)
    return store.data.macros
  })
  handle('macros:save-packages', async (_e, packages: import('../shared/types').MacroPackage[]) => {
    await store.savePackages(packages)
    return store.data.packages
  })
  handle('macros:reveal', (_e, id: string) => store.revealMacro(String(id || '')))
  handle('macros:push-history', (_e, command: string) => store.pushShellHistory(String(command || '')))
  handle('macros:clear-history', () => store.clearShellHistory())
  handle('settings:save', async (_e, settings: Settings) => {
    const saved = await store.saveSettings(settings)
    setAppLocale(saved.locale)
    setAutoUpdate(saved.autoUpdate)
    createMenu()
    return saved
  })
  handle('settings:open-logs', () => shell.openPath(store.logsDir()))

  handle('files:list', (_e, id: string, filePath?: string) => active().filesList(id, filePath))
  handle('files:mkdir', (_e, id: string, filePath: string) => active().filesMkdir(id, filePath))
  handle('files:remove', (_e, id: string, filePath: string, isDir: boolean) => active().filesRemove(id, filePath, isDir))
  handle('files:rename', (_e, id: string, from: string, to: string) => active().filesRename(id, from, to))
  handle('files:read', (_e, id: string, filePath: string) => active().filesRead(id, filePath))
  handle('files:write', (_e, id: string, filePath: string, content: string) => active().filesWrite(id, filePath, content))
  handle('files:upload', async (_e, id: string, dir: string) => {
    const picked = await dialog.showOpenDialog({ properties: ['openFile', 'openDirectory', 'multiSelections'] })
    if (picked.canceled || !picked.filePaths.length) return { canceled: true }
    await active().filesUpload(id, dir, picked.filePaths)
    return { canceled: false }
  })
  handle('files:upload-paths', (_e, id: string, dir: string, paths: string[]) => active().filesUpload(id, dir, paths))
  handle('files:download', async (_e, id: string, filePath: string, isDir: boolean) => {
    if (isDir) {
      const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
      if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
      await active().filesDownload(id, filePath, join(picked.filePaths[0], basename(filePath)), true)
      return { canceled: false }
    }
    const picked = await dialog.showSaveDialog({ defaultPath: basename(filePath) })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await active().filesDownload(id, filePath, picked.filePath, false)
    return { canceled: false }
  })
  handle('files:sync-plan', (_e, id: string, localDir: string, remoteDir: string, direction: string) =>
    active().filesSyncPlan(String(id || ''), String(localDir || ''), String(remoteDir || ''), direction === 'down' ? 'down' : 'up'))
  handle('files:sync-run', (_e, id: string, localDir: string, remoteDir: string, direction: string, rels: string[]) =>
    active().filesSyncRun(String(id || ''), String(localDir || ''), String(remoteDir || ''), direction === 'down' ? 'down' : 'up', Array.isArray(rels) ? rels.map(String) : []))
  // Only files the user picked in this session can be read for a compare.
  handle('files:read-local', async (_e, filePath: string) => {
    const target = String(filePath || '')
    if (!pickedFiles.has(target)) throw new Error(tr('invalidPath'))
    const { readFile, stat } = await import('node:fs/promises')
    if ((await stat(target)).size > 1_500_000) return { binary: true as const }
    const buf = await readFile(target)
    return buf.includes(0) ? { binary: true as const } : { content: buf.toString('utf8') }
  })
  handle('files:chmod', (_e, id: string, filePath: string, mode: string) => active().filesChmod(id, String(filePath || ''), String(mode || '')))
  handle('files:terminal-cwd', (_e, id: string) => active().filesTerminalCwd(id))
  // Drag a file-panel row out to Finder/Explorer: get a local copy, then start a native drag of it.
  handle('files:drag-out', async (event, id: string, filePath: string, isDir: boolean) => {
    const local = await active().filesDragOut(String(id || ''), String(filePath || ''), Boolean(isDir))
    let icon = await app.getFileIcon(local, { size: 'normal' }).catch(() => null)
    if (!icon || icon.isEmpty()) icon = appIcon()?.resize({ width: 32, height: 32 }) ?? null
    if (!icon || icon.isEmpty()) icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=')
    if (!event.sender.isDestroyed()) event.sender.startDrag({ file: local, icon })
    return local
  })
  handle('files:edit-external', (_e, id: string, filePath: string) => active().filesEditExternal(id, String(filePath || '')))
  handle('files:reveal', (_e, filePath: string) => shell.showItemInFolder(filePath))
  handle('files:open-path', (_e, filePath: string) => shell.openPath(filePath))

  handle('tunnels:list', (_e, connId: string) => active().tunnels.list(connId))
  handle('tunnels:start', (_e, connId: string, tunnel: TunnelTemplate, persistSessionId?: string) =>
    active().tunnelStart(connId, tunnel, persistSessionId),
  )
  handle('tunnels:stop', (_e, id: string) => active().tunnelStop(id))
  handle('tools:run', (_e, request: ToolRequest) => active().tools.run(request))
  handle('tools:cancel', (_e, runId: string) => active().tools.cancel(runId))
  handle('serial:list', () => active().listSerial())
  handle('targets:list', async (_e, protocol: string, scope: { context?: string; namespace?: string }) => {
    if (protocol !== 'docker' && protocol !== 'k8s' && protocol !== 'wsl') return []
    const binary = await which(protocol === 'k8s' ? 'kubectl' : protocol)
    if (!binary) throw new Error(tr('commandMissing', { tool: protocol === 'k8s' ? 'kubectl' : protocol }))
    return listTargets(protocol, binary, scope ?? {})
  })
  handle('dialog:pick-file', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'] })
    if (result.canceled || !result.filePaths[0]) return null
    pickedFiles.add(result.filePaths[0])
    return result.filePaths[0]
  })
  handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  handle('servers:list', () => servers.list())
  handle('servers:start', (_e, kind: string, options: Parameters<typeof servers.start>[1]) => {
    if (kind !== 'http' && kind !== 'tftp' && kind !== 'ftp') throw new Error(tr('invalidRequest'))
    return servers.start(kind, options)
  })
  handle('servers:stop', (_e, id: string) => servers.stop(String(id || '')))
  handle('dialog:pick-save', async (_e, defaultName?: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName })
    return result.canceled ? null : result.filePath ?? null
  })
  // Windows/Linux hide the native menu bar behind the custom title bar; the ☰ button pops the same menu.
  handle('app:menu-popup', (event, x: number, y: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    Menu.getApplicationMenu()?.popup({ window: win, x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0) })
  })
  handle('shell:open-external', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url)
    return Promise.resolve()
  })
  handle('passwords:list', () => store.listPasswords())
  handle('passwords:remember', (_e, secret: string) => store.rememberPassword(String(secret || '')))
  handle('passwords:keep', (_e, id: string, label: string) => store.keepPassword(String(id || ''), String(label || '')))
  handle('passwords:remove', (_e, id: string) => store.removePassword(String(id || '')))
  handle('passwords:export', async () => {
    if (store.listPasswords().length === 0) return ''
    const result = await dialog.showSaveDialog({
      defaultPath: 'mys-terminal-passwords.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }, { name: 'Text', extensions: ['txt'] }],
    })
    if (result.canceled || !result.filePath) return ''
    const body = store.exportPasswords(/\.txt$/i.test(result.filePath) ? 'txt' : 'csv')
    const { writeFile, chmod } = await import('node:fs/promises')
    // Plain-text secrets: readable by the owner only (mode only applies to new files, so chmod too).
    await writeFile(result.filePath, body, { encoding: 'utf8', mode: 0o600 })
    await chmod(result.filePath, 0o600).catch(() => undefined)
    return result.filePath
  })
  handle('keychain:list', () => store.listKeychain())
  handle('keychain:save', (_e, item: Parameters<typeof store.saveKeychain>[0]) => store.saveKeychain(item))
  handle('keychain:remove', (_e, id: string) => store.removeKeychain(String(id || '')))
  handle('keychain:generate', async (_e, algo: string, passphrase: string) => {
    const { generateSshKey } = await import('./keygen')
    const kind = algo === 'ecdsa' || algo === 'rsa' || algo === 'ml-dsa' ? algo : 'ed25519'
    return generateSshKey(kind, String(passphrase || ''))
  })
  handle('known-hosts:list', () => store.listKnownHosts())
  handle('known-hosts:remove', (_e, id: string) => store.removeKnownHost(String(id || '')))
  handle('connection-logs:list', () => store.listConnectionLogs())
  handle('connection-logs:toggle-saved', (_e, id: string) => store.toggleConnectionLogSaved(String(id || '')))
  handle('connection-logs:remove', (_e, id: string) => store.removeConnectionLog(String(id || '')))
  handle('auth:account', () => currentAccount())
  handle('auth:google-client', () => currentGoogleClient())
  handle('auth:google-client-save', (_e, clientId: string) => saveGoogleClient(String(clientId || '')))
  handle('auth:google', () => signInWithGoogle())
  handle('auth:phone-request', (_e, phone: string, purpose: 'signup' | 'reset') => requestPhoneCode(String(phone || ''), purpose === 'reset' ? 'reset' : 'signup'))
  handle('auth:phone-verify', (_e, phone: string, code: string) => verifyPhoneCode(String(phone || ''), String(code || '')))
  handle('auth:signup', (_e, phone: string, proof: string, password: string, confirm: string, username: string) => completeSignup(String(phone || ''), String(proof || ''), String(password || ''), String(confirm || ''), String(username || '')))
  handle('auth:login', (_e, phone: string, password: string, remember: boolean) => loginWithPassword(String(phone || ''), String(password || ''), Boolean(remember)))
  handle('auth:reset', (_e, phone: string, proof: string, password: string, confirm: string) => resetPassword(String(phone || ''), String(proof || ''), String(password || ''), String(confirm || '')))
  handle('auth:set-username', (_e, username: string) => setUsername(String(username || '')))
  handle('auth:set-email', (_e, email: string) => setAccountEmail(String(email || '')))
  handle('auth:lookup-username', (_e, username: string) => lookupUsername(String(username || '')))
  handle('auth:lookup-email', (_e, email: string) => lookupEmail(String(email || '')))
  handle('auth:sign-out', () => signOut())
}

// The UI is laid out for 100% only: no menu zoom, no pinch zoom, no Ctrl+wheel zoom,
// in the main window and in embedded <webview>s alike.
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'window' && contents.getType() !== 'webview') return
  const lock = () => {
    contents.setZoomLevel(0)
    void contents.setVisualZoomLevelLimits(1, 1)
  }
  contents.on('did-finish-load', lock)
  contents.on('zoom-changed', lock)
})

app.whenReady().then(async () => {
  await store.init()
  await loadAuth()
  setAppLocale(store.data.settings.locale)
  hub = new Hub(store, allContents, {
    files: async (directory) => {
      const options: Electron.OpenDialogOptions = { properties: directory ? ['openFile', 'openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'] }
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
      return result.canceled ? undefined : result.filePaths
    },
    directory: async () => {
      const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], title: tr('zmodemSaveTo') }
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
      return result.canceled ? undefined : result.filePaths[0]
    },
  })
  appLock = new AppLock(store, (locked) => {
    for (const contents of allContents()) contents.send('lock:changed', locked)
  })
  // Leaving the desk locks too: OS screen lock and sleep.
  powerMonitor.on('lock-screen', () => appLock?.lock())
  powerMonitor.on('suspend', () => appLock?.lock())
  registerIpc()
  createMenu()
  createWindow()
  initUpdater(() => mainWindow, store.data.settings.autoUpdate)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  servers.stopAll()
  appLock?.dispose()
  hub?.dispose()
})
