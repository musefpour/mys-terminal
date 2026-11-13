import type {
  Capabilities,
  FileEntry,
  Folder,
  HubEvent,
  Macro,
  MacroPackage,
  OpenResult,
  OpenSpec,
  Session,
  Settings,
  ToolRequest,
  TunnelInfo,
  TunnelTemplate,
  Account,
  VaultPassword,
  KeychainItem,
  KeychainKind,
  SshKeyAlgo,
  ConnectionLog,
  WorkSpace,
  ImportSource,
  LockStatus,
  RecordingInfo,
  TransferInfo,
  LocalServerInfo,
  LocalServerKind,
  LocalServerOptions,
  SyncDirection,
  SyncItem,
} from './types'

export interface SaveSessionPayload {
  session: Session
  password?: string | null
  passphrase?: string | null
  proxyPassword?: string | null
}

/** A tab moved into its own window, with the text its terminal showed. */
export interface DetachedTab {
  tab: unknown
  buffer: string
}

export interface MysAPI {
  platform: string
  version(): Promise<string>
  capabilities(): Promise<Capabilities>
  subscribe(fn: (event: HubEvent) => void): () => void
  open(spec: OpenSpec): Promise<OpenResult>
  write(instanceId: string, data: string): void
  resize(instanceId: string, cols: number, rows: number): void
  close(instanceId: string): Promise<void>
  sessions: {
    list(): Promise<{ folders: Folder[]; sessions: Session[]; macros: Macro[]; packages: MacroPackage[]; shellHistory: string[]; settings: Settings; workspaces: WorkSpace[] }>
    save(payload: SaveSessionPayload): Promise<Session>
    remove(id: string): Promise<void>
    duplicate(id: string): Promise<Session>
    /** Saved password, key passphrase and proxy password of a session (edit dialog only). */
    secrets(id: string): Promise<{ password?: string; passphrase?: string; proxyPassword?: string }>
    touch(id: string): Promise<void>
    move(id: string, folderId: string | null, beforeId: string | null): Promise<void>
    saveFolder(folder: Folder): Promise<void>
    removeFolder(id: string): Promise<void>
    exportBundle(): Promise<string>
    exportOne(id: string): Promise<string>
    exportFolder(id: string, format: 'json' | 'csv'): Promise<string>
    exportSelection(sessionIds: string[], folderIds: string[], format: 'json' | 'csv'): Promise<string>
    importBundle(): Promise<number>
    importFrom(source: ImportSource): Promise<number>
  }
  tabs: {
    /** Open the tab in a new window; its connection stays open and moves with it. */
    detach(tab: unknown, buffer: string): Promise<void>
    /** In a detached window: the tab it was opened for. */
    detached(): Promise<DetachedTab | null>
    /** Save dialog, then write the text. Returns the path, or '' if cancelled. */
    saveOutput(name: string, text: string): Promise<string>
    print(title: string, text: string): Promise<void>
  }
  workspaces: {
    create(name: string): Promise<WorkSpace>
    rename(id: string, name: string): Promise<WorkSpace[]>
    setActive(id: string): Promise<Settings>
    invite(id: string, email: string): Promise<WorkSpace>
    removeMember(id: string, email: string): Promise<WorkSpace>
  }
  files: {
    list(instanceId: string, path?: string): Promise<{ path: string; entries: FileEntry[] }>
    mkdir(instanceId: string, path: string): Promise<void>
    remove(instanceId: string, path: string, isDir: boolean): Promise<void>
    rename(instanceId: string, from: string, to: string): Promise<void>
    read(instanceId: string, path: string): Promise<{ content: string } | { binary: true; size: number }>
    write(instanceId: string, path: string, content: string): Promise<void>
    upload(instanceId: string, dir: string): Promise<{ canceled: boolean }>
    uploadPaths(instanceId: string, dir: string, paths: string[]): Promise<void>
    download(instanceId: string, path: string, isDir: boolean): Promise<{ canceled: boolean }>
    chmod(instanceId: string, path: string, mode: string): Promise<void>
    syncPlan(instanceId: string, localDir: string, remoteDir: string, direction: SyncDirection): Promise<SyncItem[]>
    syncRun(instanceId: string, localDir: string, remoteDir: string, direction: SyncDirection, rels: string[]): Promise<void>
    readLocal(path: string): Promise<{ content: string } | { binary: true }>
    terminalCwd(instanceId: string): Promise<string | null>
    editExternal(instanceId: string, path: string): Promise<void>
    /** Start a native drag of a file or folder (remote ones are copied to a temp folder first). */
    dragOut(instanceId: string, path: string, isDir: boolean): Promise<string>
    reveal(path: string): Promise<void>
    openPath(path: string): Promise<void>
  }
  transfers: {
    list(connId: string): Promise<TransferInfo[]>
    pause(id: string): Promise<void>
    resume(id: string): Promise<void>
    cancel(id: string): Promise<void>
    clear(connId: string): Promise<void>
  }
  servers: {
    list(): Promise<LocalServerInfo[]>
    start(kind: LocalServerKind, options: LocalServerOptions): Promise<LocalServerInfo>
    stop(id: string): Promise<void>
  }
  recording: {
    start(instanceId: string): Promise<string | null>
    stop(instanceId: string): Promise<string | null>
    list(): Promise<RecordingInfo[]>
    read(path: string): Promise<string>
    remove(path: string): Promise<void>
    reveal(path: string): Promise<void>
  }
  monitor: {
    start(instanceId: string): Promise<void>
    stop(instanceId: string): Promise<void>
  }
  lock: {
    status(): Promise<LockStatus>
    unlock(password: string): Promise<{ ok: true } | { ok: false; code: 'wrong' | 'wait'; retryIn: number }>
    lockNow(): Promise<void>
    setPassword(next: string, minutes: number, current?: string): Promise<LockStatus>
    setMinutes(minutes: number): Promise<LockStatus>
    disable(current: string): Promise<LockStatus>
    activity(): void
    onChange(fn: (locked: boolean) => void): () => void
  }
  updates: {
    check(): Promise<void>
  }
  tunnels: {
    list(connId: string): Promise<TunnelInfo[]>
    start(connId: string, tunnel: TunnelTemplate, persistSessionId?: string): Promise<TunnelInfo>
    stop(id: string): Promise<void>
  }
  tools: {
    run(request: ToolRequest): Promise<void>
    cancel(runId: string): Promise<void>
  }
  serial: {
    list(): Promise<string[]>
  }
  targets: {
    list(protocol: 'docker' | 'k8s' | 'wsl', scope: { context?: string; namespace?: string }): Promise<string[]>
  }
  dialog: {
    pickFile(): Promise<string | null>
    pickFolder(): Promise<string | null>
    pickSave(defaultName?: string): Promise<string | null>
  }
  macros: {
    save(macros: Macro[]): Promise<Macro[]>
    savePackages(packages: MacroPackage[]): Promise<MacroPackage[]>
    /** Command text of a snippet; the only way a secret snippet's command reaches the renderer. */
    reveal(id: string): Promise<string>
    pushHistory(command: string): Promise<string[]>
    clearHistory(): Promise<string[]>
  }
  settings: {
    save(settings: Settings): Promise<Settings>
    openLogs(): Promise<void>
  }
  getPathForFile(file: File): string
  openExternal(url: string): Promise<void>
  /** Show the application menu at window coordinates (Windows/Linux, where there is no menu bar). */
  popupMenu(x: number, y: number): Promise<void>
  onMenu(channel: string, fn: () => void): () => void
  passwords: {
    list(): Promise<VaultPassword[]>
    remember(secret: string): Promise<VaultPassword[]>
    keep(id: string, label: string): Promise<VaultPassword[]>
    remove(id: string): Promise<VaultPassword[]>
    /** Save dialog, then write the vault as CSV or TXT. Returns the path, or '' if cancelled. */
    export(): Promise<string>
  }
  keychain: {
    list(): Promise<KeychainItem[]>
    save(item: Partial<KeychainItem> & { kind: KeychainKind }): Promise<KeychainItem[]>
    remove(id: string): Promise<KeychainItem[]>
    generate(algo: SshKeyAlgo, passphrase?: string): Promise<{ privateKey: string; publicKey: string; keyType: SshKeyAlgo }>
  }
  knownHosts: {
    list(): Promise<{ id: string; fingerprint: string }[]>
    remove(id: string): Promise<{ id: string; fingerprint: string }[]>
  }
  connectionLogs: {
    list(): Promise<ConnectionLog[]>
    toggleSaved(id: string): Promise<ConnectionLog[]>
    remove(id: string): Promise<ConnectionLog[]>
  }
  auth: {
    account(): Promise<Account | null>
    googleClient(): Promise<string>
    saveGoogleClient(clientId: string): Promise<void>
    google(): Promise<{ ok: true; account: Account } | { ok: false; code: string }>
    requestPhone(phone: string, purpose: 'signup' | 'reset'): Promise<{ ok: true; phone: string; delivery: 'sms' | 'device' } | { ok: false; code: string }>
    verifyPhone(phone: string, code: string): Promise<{ ok: true; phone: string; proof: string } | { ok: false; code: string }>
    signup(phone: string, proof: string, password: string, confirm: string, username: string): Promise<{ ok: true; account: Account } | { ok: false; code: string }>
    login(phone: string, password: string, remember: boolean): Promise<{ ok: true; account: Account } | { ok: false; code: string }>
    reset(phone: string, proof: string, password: string, confirm: string): Promise<{ ok: true; account: Account } | { ok: false; code: string }>
    setUsername(username: string): Promise<{ ok: true; account: Account } | { ok: false; code: string }>
    setEmail(email: string): Promise<{ ok: true; account: Account } | { ok: false; code: string }>
    lookupUsername(username: string): Promise<{ ok: true; username: string; name: string } | { ok: false; code: string }>
    lookupEmail(email: string): Promise<{ ok: true; email: string; name?: string; known: boolean } | { ok: false; code: string }>
    signOut(): Promise<void>
  }
}
