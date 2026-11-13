import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MysAPI } from '../shared/api'
import type { HubEvent } from '../shared/types'

const api: MysAPI = {
  platform: process.platform,
  version: () => ipcRenderer.invoke('app:version'),
  capabilities: () => ipcRenderer.invoke('app:capabilities'),
  subscribe(fn) {
    const listener = (_event: unknown, payload: HubEvent) => fn(payload)
    ipcRenderer.on('hub:event', listener)
    return () => ipcRenderer.removeListener('hub:event', listener)
  },
  open: (spec) => ipcRenderer.invoke('conn:open', spec),
  write: (instanceId, data) => ipcRenderer.send('conn:write', instanceId, data),
  resize: (instanceId, cols, rows) => ipcRenderer.send('conn:resize', instanceId, cols, rows),
  close: (instanceId) => ipcRenderer.invoke('conn:close', instanceId),
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    save: (payload) => ipcRenderer.invoke('sessions:save', payload),
    remove: (id) => ipcRenderer.invoke('sessions:remove', id),
    duplicate: (id) => ipcRenderer.invoke('sessions:duplicate', id),
    secrets: (id) => ipcRenderer.invoke('sessions:secrets', id),
    touch: (id) => ipcRenderer.invoke('sessions:touch', id),
    move: (id, folderId, beforeId) => ipcRenderer.invoke('sessions:move', id, folderId, beforeId),
    saveFolder: (folder) => ipcRenderer.invoke('sessions:save-folder', folder),
    removeFolder: (id) => ipcRenderer.invoke('sessions:remove-folder', id),
    exportBundle: () => ipcRenderer.invoke('sessions:export'),
    exportOne: (id) => ipcRenderer.invoke('sessions:export-one', id),
    exportFolder: (id, format) => ipcRenderer.invoke('sessions:export-folder', id, format),
    exportSelection: (sessionIds, folderIds, format) => ipcRenderer.invoke('sessions:export-selection', sessionIds, folderIds, format),
    importBundle: () => ipcRenderer.invoke('sessions:import'),
    importFrom: (source) => ipcRenderer.invoke('sessions:import-from', source),
  },
  tabs: {
    detach: (tab, buffer) => ipcRenderer.invoke('tabs:detach', { tab, buffer }),
    detached: () => ipcRenderer.invoke('tabs:detached'),
    saveOutput: (name, text) => ipcRenderer.invoke('tabs:save-output', name, text),
    print: (title, text) => ipcRenderer.invoke('tabs:print', title, text),
  },
  workspaces: {
    create: (name) => ipcRenderer.invoke('workspaces:create', name),
    rename: (id, name) => ipcRenderer.invoke('workspaces:rename', id, name),
    setActive: (id) => ipcRenderer.invoke('workspaces:set-active', id),
    invite: (id, email) => ipcRenderer.invoke('workspaces:invite', id, email),
    removeMember: (id, email) => ipcRenderer.invoke('workspaces:remove-member', id, email),
  },
  files: {
    list: (instanceId, path) => ipcRenderer.invoke('files:list', instanceId, path),
    mkdir: (instanceId, path) => ipcRenderer.invoke('files:mkdir', instanceId, path),
    remove: (instanceId, path, isDir) => ipcRenderer.invoke('files:remove', instanceId, path, isDir),
    rename: (instanceId, from, to) => ipcRenderer.invoke('files:rename', instanceId, from, to),
    read: (instanceId, path) => ipcRenderer.invoke('files:read', instanceId, path),
    write: (instanceId, path, content) => ipcRenderer.invoke('files:write', instanceId, path, content),
    upload: (instanceId, dir) => ipcRenderer.invoke('files:upload', instanceId, dir),
    uploadPaths: (instanceId, dir, paths) => ipcRenderer.invoke('files:upload-paths', instanceId, dir, paths),
    download: (instanceId, path, isDir) => ipcRenderer.invoke('files:download', instanceId, path, isDir),
    chmod: (instanceId, path, mode) => ipcRenderer.invoke('files:chmod', instanceId, path, mode),
    syncPlan: (instanceId, localDir, remoteDir, direction) => ipcRenderer.invoke('files:sync-plan', instanceId, localDir, remoteDir, direction),
    syncRun: (instanceId, localDir, remoteDir, direction, rels) => ipcRenderer.invoke('files:sync-run', instanceId, localDir, remoteDir, direction, rels),
    readLocal: (path) => ipcRenderer.invoke('files:read-local', path),
    terminalCwd: (instanceId) => ipcRenderer.invoke('files:terminal-cwd', instanceId),
    editExternal: (instanceId, path) => ipcRenderer.invoke('files:edit-external', instanceId, path),
    dragOut: (instanceId, path, isDir) => ipcRenderer.invoke('files:drag-out', instanceId, path, isDir),
    reveal: (path) => ipcRenderer.invoke('files:reveal', path),
    openPath: (path) => ipcRenderer.invoke('files:open-path', path),
  },
  transfers: {
    list: (connId) => ipcRenderer.invoke('transfers:list', connId),
    pause: (id) => ipcRenderer.invoke('transfers:pause', id),
    resume: (id) => ipcRenderer.invoke('transfers:resume', id),
    cancel: (id) => ipcRenderer.invoke('transfers:cancel', id),
    clear: (connId) => ipcRenderer.invoke('transfers:clear', connId),
  },
  servers: {
    list: () => ipcRenderer.invoke('servers:list'),
    start: (kind, options) => ipcRenderer.invoke('servers:start', kind, options),
    stop: (id) => ipcRenderer.invoke('servers:stop', id),
  },
  recording: {
    start: (instanceId) => ipcRenderer.invoke('recording:start', instanceId),
    stop: (instanceId) => ipcRenderer.invoke('recording:stop', instanceId),
    list: () => ipcRenderer.invoke('recording:list'),
    read: (path) => ipcRenderer.invoke('recording:read', path),
    remove: (path) => ipcRenderer.invoke('recording:remove', path),
    reveal: (path) => ipcRenderer.invoke('recording:reveal', path),
  },
  monitor: {
    start: (instanceId) => ipcRenderer.invoke('monitor:start', instanceId),
    stop: (instanceId) => ipcRenderer.invoke('monitor:stop', instanceId),
  },
  lock: {
    status: () => ipcRenderer.invoke('lock:status'),
    unlock: (password) => ipcRenderer.invoke('lock:unlock', password),
    lockNow: () => ipcRenderer.invoke('lock:lock'),
    setPassword: (next, minutes, current) => ipcRenderer.invoke('lock:set-password', next, minutes, current),
    setMinutes: (minutes) => ipcRenderer.invoke('lock:set-minutes', minutes),
    disable: (current) => ipcRenderer.invoke('lock:disable', current),
    activity: () => ipcRenderer.send('lock:activity'),
    onChange(fn) {
      const listener = (_event: unknown, locked: boolean) => fn(locked)
      ipcRenderer.on('lock:changed', listener)
      return () => ipcRenderer.removeListener('lock:changed', listener)
    },
  },
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
  },
  tunnels: {
    list: (connId) => ipcRenderer.invoke('tunnels:list', connId),
    start: (connId, tunnel, persistSessionId) => ipcRenderer.invoke('tunnels:start', connId, tunnel, persistSessionId),
    stop: (id) => ipcRenderer.invoke('tunnels:stop', id),
  },
  tools: {
    run: (request) => ipcRenderer.invoke('tools:run', request),
    cancel: (runId) => ipcRenderer.invoke('tools:cancel', runId),
  },
  serial: {
    list: () => ipcRenderer.invoke('serial:list'),
  },
  targets: {
    list: (protocol, scope) => ipcRenderer.invoke('targets:list', protocol, scope),
  },
  dialog: {
    pickFile: () => ipcRenderer.invoke('dialog:pick-file'),
    pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
    pickSave: (defaultName) => ipcRenderer.invoke('dialog:pick-save', defaultName),
  },
  macros: {
    save: (macros) => ipcRenderer.invoke('macros:save', macros),
    savePackages: (packages) => ipcRenderer.invoke('macros:save-packages', packages),
    reveal: (id) => ipcRenderer.invoke('macros:reveal', id),
    pushHistory: (command) => ipcRenderer.invoke('macros:push-history', command),
    clearHistory: () => ipcRenderer.invoke('macros:clear-history'),
  },
  settings: {
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
    openLogs: () => ipcRenderer.invoke('settings:open-logs'),
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  popupMenu: (x, y) => ipcRenderer.invoke('app:menu-popup', x, y),
  onMenu(channel, fn) {
    const listener = () => fn()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  passwords: {
    list: () => ipcRenderer.invoke('passwords:list'),
    remember: (secret) => ipcRenderer.invoke('passwords:remember', secret),
    keep: (id, label) => ipcRenderer.invoke('passwords:keep', id, label),
    remove: (id) => ipcRenderer.invoke('passwords:remove', id),
    export: () => ipcRenderer.invoke('passwords:export'),
  },
  keychain: {
    list: () => ipcRenderer.invoke('keychain:list'),
    save: (item) => ipcRenderer.invoke('keychain:save', item),
    remove: (id) => ipcRenderer.invoke('keychain:remove', id),
    generate: (algo, passphrase) => ipcRenderer.invoke('keychain:generate', algo, passphrase ?? ''),
  },
  knownHosts: {
    list: () => ipcRenderer.invoke('known-hosts:list'),
    remove: (id) => ipcRenderer.invoke('known-hosts:remove', id),
  },
  connectionLogs: {
    list: () => ipcRenderer.invoke('connection-logs:list'),
    toggleSaved: (id) => ipcRenderer.invoke('connection-logs:toggle-saved', id),
    remove: (id) => ipcRenderer.invoke('connection-logs:remove', id),
  },
  auth: {
    account: () => ipcRenderer.invoke('auth:account'),
    googleClient: () => ipcRenderer.invoke('auth:google-client'),
    saveGoogleClient: (clientId) => ipcRenderer.invoke('auth:google-client-save', clientId),
    google: () => ipcRenderer.invoke('auth:google'),
    requestPhone: (phone, purpose) => ipcRenderer.invoke('auth:phone-request', phone, purpose),
    verifyPhone: (phone, code) => ipcRenderer.invoke('auth:phone-verify', phone, code),
    signup: (phone, proof, password, confirm, username) => ipcRenderer.invoke('auth:signup', phone, proof, password, confirm, username),
    login: (phone, password, remember) => ipcRenderer.invoke('auth:login', phone, password, remember),
    reset: (phone, proof, password, confirm) => ipcRenderer.invoke('auth:reset', phone, proof, password, confirm),
    setUsername: (username) => ipcRenderer.invoke('auth:set-username', username),
    setEmail: (email) => ipcRenderer.invoke('auth:set-email', email),
    lookupUsername: (username) => ipcRenderer.invoke('auth:lookup-username', username),
    lookupEmail: (email) => ipcRenderer.invoke('auth:lookup-email', email),
    signOut: () => ipcRenderer.invoke('auth:sign-out'),
  },
}

contextBridge.exposeInMainWorld('mys', api)
