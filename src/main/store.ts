import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { tr } from './i18n'
import type { ImportDraft } from './importers'
import { HOST_ICON_IDS, isHostColor } from '../shared/hostIcons'
import type { LockConfig } from './lock'
import {
  blankSession,
  defaultSettings,
  TERM_THEME_IDS,
  isProtocol,
  normalizeLocale,
  normalizeMode,
  normalizeTheme,
  normalizeHandle,
  normalizeEmail,
  canUseWorkspace,
  bumpDailyMap,
  dayKey,
  type Folder,
  type Macro,
  type MacroPackage,
  type Session,
  type Settings,
  type TunnelTemplate,
  type VaultPassword,
  type KeychainItem,
  type KeychainKind,
  type WorkSpace,
  type WorkspaceMember,
  type SessionErrorEntry,
  type ConnectionLog,
} from '../shared/types'

interface SecretBag {
  password?: string
  passphrase?: string
  proxyPassword?: string
}

const SEAL = 'MYS2'

function sealSecrets(json: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('encryption-unavailable')
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const wrapped = safeStorage.encryptString(key.toString('base64'))
  key.fill(0)
  if (wrapped.length > 0xffff) throw new Error('wrap-too-large')
  const len = Buffer.alloc(2)
  len.writeUInt16BE(wrapped.length)
  return Buffer.concat([Buffer.from(SEAL), len, wrapped, iv, tag, data])
}

function unsealSecrets(blob: Buffer): string {
  if (blob.length >= 4 && blob.subarray(0, 4).toString('ascii') === SEAL) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('encryption-unavailable')
    const wrappedLen = blob.readUInt16BE(4)
    const start = 6
    if (blob.length < start + wrappedLen + 28) throw new Error('truncated')
    const wrapped = blob.subarray(start, start + wrappedLen)
    const iv = blob.subarray(start + wrappedLen, start + wrappedLen + 12)
    const tag = blob.subarray(start + wrappedLen + 12, start + wrappedLen + 28)
    const data = blob.subarray(start + wrappedLen + 28)
    const key = Buffer.from(safeStorage.decryptString(wrapped), 'base64')
    if (key.length !== 32) throw new Error('bad-key')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const json = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    key.fill(0)
    return json
  }
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(blob)
    } catch {
      /* older copies were plain text; upgraded on the next save */
    }
  }
  const text = blob.toString('utf8')
  if (!text.startsWith('{')) throw new Error('unreadable')
  return text
}

function isHardSealed(blob: Buffer): boolean {
  return blob.length >= 4 && blob.subarray(0, 4).toString('ascii') === SEAL
}

interface DB {
  folders: Folder[]
  sessions: Session[]
  macros: Macro[]
  packages: MacroPackage[]
  shellHistory: string[]
  connectionLogs: ConnectionLog[]
  workspaces: WorkSpace[]
  knownHosts: Record<string, string>
  settings: Settings
  windowBounds?: { x: number; y: number; width: number; height: number }
  lock?: LockConfig
}

function emptyDb(): DB {
  return {
    folders: [],
    sessions: [],
    macros: [],
    packages: [],
    shellHistory: [],
    connectionLogs: [],
    workspaces: [],
    knownHosts: {},
    settings: defaultSettings(),
  }
}

function asTunnel(value: unknown): TunnelTemplate | null {
  if (!value || typeof value !== 'object') return null
  const t = value as TunnelTemplate
  if (t.mode !== 'local' && t.mode !== 'remote' && t.mode !== 'dynamic') return null
  if (!Number.isFinite(t.listenPort)) return null
  return {
    id: typeof t.id === 'string' ? t.id : randomUUID(),
    mode: t.mode,
    listenPort: Number(t.listenPort),
    targetHost: typeof t.targetHost === 'string' ? t.targetHost : '127.0.0.1',
    targetPort: Number(t.targetPort) || 0,
    label: typeof t.label === 'string' ? t.label.slice(0, 80) : undefined,
    bindAddress: typeof t.bindAddress === 'string' ? t.bindAddress.slice(0, 64) : undefined,
  }
}

function asMacro(value: unknown): Macro | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Macro
  if (typeof row.id !== 'string' || typeof row.command !== 'string') return null
  const targets = Array.isArray(row.targetIds)
    ? row.targetIds.filter((item): item is string => typeof item === 'string').slice(0, 40)
    : []
  return {
    id: row.id,
    name: String(row.name ?? '').slice(0, 80),
    command: String(row.command).slice(0, 8000),
    sendEnter: row.sendEnter !== false,
    packageId: typeof row.packageId === 'string' ? row.packageId : null,
    targetIds: targets,
    secret: row.secret === true,
    tags: Array.isArray(row.tags)
      ? [...new Set(row.tags.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 24)).filter(Boolean))].slice(0, 12)
      : [],
    pinned: row.pinned === true,
    uses: Number.isFinite(row.uses) && Number(row.uses) > 0 ? Math.floor(Number(row.uses)) : 0,
    lastRun: Number.isFinite(row.lastRun) && Number(row.lastRun) > 0 ? Number(row.lastRun) : 0,
  }
}

function asSnippetSecrets(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [id, command] of Object.entries(value as Record<string, unknown>)) {
    if (typeof command === 'string' && command) out[id] = command.slice(0, 8000)
  }
  return out
}

function asPackage(value: unknown): MacroPackage | null {
  if (!value || typeof value !== 'object') return null
  const row = value as MacroPackage
  if (typeof row.id !== 'string' || typeof row.name !== 'string' || !row.name.trim()) return null
  return { id: row.id, name: row.name.trim().slice(0, 80) }
}

function asConnectionLog(value: unknown): ConnectionLog | null {
  if (!value || typeof value !== 'object') return null
  const row = value as ConnectionLog
  if (typeof row.id !== 'string' || !Number.isFinite(row.startedAt)) return null
  if (!isProtocol(row.protocol)) return null
  return {
    id: row.id,
    startedAt: Number(row.startedAt) || Date.now(),
    endedAt: Number(row.endedAt) || Number(row.startedAt) || Date.now(),
    userEmail: String(row.userEmail ?? '').slice(0, 120),
    userName: String(row.userName ?? '').slice(0, 80),
    clientHost: String(row.clientHost ?? '').slice(0, 120),
    clientIp: String(row.clientIp ?? '').slice(0, 64),
    sessionId: typeof row.sessionId === 'string' ? row.sessionId : null,
    hostLabel: String(row.hostLabel ?? '').slice(0, 120),
    protocol: row.protocol,
    username: String(row.username ?? '').slice(0, 120),
    saved: Boolean(row.saved),
  }
}

function asMembers(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const handle = normalizeHandle(typeof item === 'string' ? item : '')
    if (handle && !out.includes(handle)) out.push(handle)
  }
  return out.slice(0, 40)
}

function asFolder(value: unknown): Folder | null {
  if (!value || typeof value !== 'object') return null
  const folder = value as Folder
  if (typeof folder.id !== 'string' || typeof folder.name !== 'string') return null
  return {
    id: folder.id,
    name: folder.name.trim().slice(0, 80),
    parentId: folder.parentId ?? null,
    owner: normalizeHandle(typeof folder.owner === 'string' ? folder.owner : ''),
    members: asMembers(folder.members),
    workspaceId: String(folder.workspaceId ?? ''),
  }
}

function asLock(value: unknown): LockConfig | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as LockConfig
  if (typeof row.salt !== 'string' || typeof row.hash !== 'string' || !row.salt || !row.hash) return undefined
  return { salt: row.salt, hash: row.hash, minutes: Math.max(0, Number(row.minutes) || 0) }
}

function asSession(value: unknown): Session | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Session
  if (!isProtocol(s.protocol) || typeof s.id !== 'string') return null
  return {
    id: s.id,
    name: String(s.name ?? '').slice(0, 80),
    folderId: s.folderId ?? null,
    workspaceId: String(s.workspaceId ?? ''),
    favorite: Boolean(s.favorite),
    protocol: s.protocol,
    host: String(s.host ?? ''),
    port: Number(s.port) || 0,
    username: String(s.username ?? ''),
    hasPassword: Boolean(s.hasPassword),
    hasPassphrase: Boolean(s.hasPassphrase),
    privateKeyPath: String(s.privateKeyPath ?? ''),
    certificatePath: String(s.certificatePath ?? ''),
    startupCommand: String(s.startupCommand ?? ''),
    cwd: String(s.cwd ?? ''),
    shell: String(s.shell ?? ''),
    x11: Boolean(s.x11),
    useAgent: s.useAgent !== false,
    agentForward: Boolean(s.agentForward),
    serialPath: String(s.serialPath ?? ''),
    baudRate: Number(s.baudRate) || 115200,
    dataBits: s.dataBits === 7 ? 7 : 8,
    parity: s.parity === 'even' || s.parity === 'odd' ? s.parity : 'none',
    stopBits: s.stopBits === 2 ? 2 : 1,
    url: String(s.url ?? ''),
    domain: String(s.domain ?? ''),
    ftpSecure: s.ftpSecure === 'explicit' || s.ftpSecure === 'implicit' ? s.ftpSecure : 'off',
    tunnels: Array.isArray(s.tunnels) ? s.tunnels.map(asTunnel).filter((t): t is TunnelTemplate => Boolean(t)) : [],
    jumpSessionId: typeof s.jumpSessionId === 'string' && s.jumpSessionId !== s.id ? s.jumpSessionId : '',
    proxyType: s.proxyType === 'socks5' || s.proxyType === 'http' ? s.proxyType : 'none',
    proxyHost: String(s.proxyHost ?? '').slice(0, 253),
    proxyPort: Number(s.proxyPort) || 1080,
    proxyUser: String(s.proxyUser ?? '').slice(0, 120),
    hasProxyPassword: Boolean(s.hasProxyPassword),
    rdpFullscreen: Boolean(s.rdpFullscreen),
    rdpClipboard: s.rdpClipboard !== false,
    rdpShareHome: Boolean(s.rdpShareHome),
    icon: typeof s.icon === 'string' && HOST_ICON_IDS.has(s.icon) ? s.icon : '',
    color: isHostColor(s.color) ? s.color.toLowerCase() : '',
    termTheme: typeof s.termTheme === 'string' && (TERM_THEME_IDS as readonly string[]).includes(s.termTheme) ? s.termTheme : '',
    termFontSize: Math.min(32, Math.max(0, Math.round(Number(s.termFontSize) || 0))),
    termFontFamily: String(s.termFontFamily ?? '').slice(0, 120),
    notes: String(s.notes ?? ''),
    lastUsed: Number(s.lastUsed) || 0,
    createdAt: Number(s.createdAt) || Date.now(),
    opens: Math.max(0, Number(s.opens) || 0),
    errors: Math.max(0, Number(s.errors) || 0),
    activeMs: Math.max(0, Number(s.activeMs) || 0),
    bytesIn: Math.max(0, Number(s.bytesIn) || 0),
    bytesOut: Math.max(0, Number(s.bytesOut) || 0),
    dailyOpens: asDayMap(s.dailyOpens),
    dailyErrors: asDayMap(s.dailyErrors),
    errorLog: asErrorLog(s.errorLog),
  }
}

function asErrorLog(value: unknown): SessionErrorEntry[] {
  if (!Array.isArray(value)) return []
  const out: SessionErrorEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const message = String((item as SessionErrorEntry).message || '').trim().slice(0, 240)
    if (!message) continue
    out.push({
      at: Number((item as SessionErrorEntry).at) || Date.now(),
      message,
    })
    if (out.length >= 12) break
  }
  return out
}

function asDayMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue
    const n = Math.max(0, Math.floor(Number(raw) || 0))
    if (n) out[key] = n
  }
  return out
}

function asWorkspace(value: unknown): WorkSpace | null {
  if (!value || typeof value !== 'object') return null
  const row = value as WorkSpace
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null
  const members: WorkspaceMember[] = []
  if (Array.isArray(row.members)) {
    for (const item of row.members) {
      if (!item || typeof item !== 'object') continue
      const email = normalizeEmail(String((item as WorkspaceMember).email || ''))
      if (!email) continue
      members.push({
        email,
        status: (item as WorkspaceMember).status === 'pending' ? 'pending' : 'active',
        invitedAt: Number((item as WorkspaceMember).invitedAt) || Date.now(),
      })
    }
  }
  return {
    id: row.id,
    name: row.name.trim().slice(0, 80) || 'Workspace',
    ownerEmail: normalizeEmail(String(row.ownerEmail || '')) || '',
    members,
    createdAt: Number(row.createdAt) || Date.now(),
  }
}

function asVault(value: unknown): VaultPassword[] {
  if (!Array.isArray(value)) return []
  const out: VaultPassword[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as VaultPassword
    if (typeof row.id !== 'string' || typeof row.secret !== 'string' || !row.secret) continue
    out.push({
      id: row.id,
      secret: row.secret.slice(0, 256),
      label: String(row.label ?? '').slice(0, 80),
      createdAt: Number(row.createdAt) || Date.now(),
      kept: Boolean(row.kept),
    })
  }
  return out.slice(0, 80)
}

const KEYCHAIN_KINDS = new Set<KeychainKind>(['identity', 'key', 'certificate', 'touchid', 'fido2'])

function asKeychain(value: unknown): KeychainItem[] {
  if (!Array.isArray(value)) return []
  const out: KeychainItem[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as KeychainItem
    if (typeof row.id !== 'string' || !KEYCHAIN_KINDS.has(row.kind)) continue
    out.push({
      id: row.id,
      kind: row.kind,
      label: String(row.label ?? '').slice(0, 80),
      username: String(row.username ?? '').slice(0, 120),
      password: String(row.password ?? '').slice(0, 512),
      privateKey: String(row.privateKey ?? '').slice(0, 32_000),
      publicKey: String(row.publicKey ?? '').slice(0, 16_000),
      certificate: String(row.certificate ?? '').slice(0, 32_000),
      passphrase: String(row.passphrase ?? '').slice(0, 512),
      savePassphrase: Boolean(row.savePassphrase),
      keyType: (['ed25519', 'ecdsa', 'rsa', 'ml-dsa'].includes(String(row.keyType)) ? row.keyType : '') as KeychainItem['keyType'],
      createdAt: Number(row.createdAt) || Date.now(),
    })
  }
  return out.slice(0, 200)
}

export class Store {
  private db: DB = emptyDb()
  private secrets: Record<string, SecretBag> = {}
  private vault: VaultPassword[] = []
  private snippetSecrets: Record<string, string> = {}
  private keychain: KeychainItem[] = []
  private queue: Promise<void> = Promise.resolve()
  private dir = ''
  private dbPath = ''
  private secretPath = ''

  async init(): Promise<void> {
    this.dir = app.getPath('userData')
    await mkdir(this.dir, { recursive: true })
    await mkdir(join(this.dir, 'logs'), { recursive: true })
    this.dbPath = join(this.dir, 'sessions.json')
    this.secretPath = join(this.dir, 'secrets.bin')
    await this.load()
  }

  get data(): DB {
    return this.db
  }

  logsDir(): string {
    return join(this.dir, 'logs')
  }

  recordingsDir(): string {
    return join(this.dir, 'recordings')
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.dbPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<DB>
      const sessions = Array.isArray(parsed.sessions) ? parsed.sessions.map(asSession).filter((s): s is Session => Boolean(s)) : []
      const folders = Array.isArray(parsed.folders)
        ? parsed.folders.map(asFolder).filter((folder): folder is Folder => Boolean(folder))
        : []
      const macros = Array.isArray(parsed.macros) ? parsed.macros.map(asMacro).filter((m): m is Macro => Boolean(m)) : []
      const packages = Array.isArray(parsed.packages) ? parsed.packages.map(asPackage).filter((p): p is MacroPackage => Boolean(p)) : []
      const shellHistory = Array.isArray(parsed.shellHistory)
        ? parsed.shellHistory.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.slice(0, 500)).slice(0, 200)
        : []
      const connectionLogs = Array.isArray(parsed.connectionLogs)
        ? parsed.connectionLogs.map(asConnectionLog).filter((item): item is ConnectionLog => Boolean(item)).slice(0, 500)
        : []
      const workspaces = Array.isArray(parsed.workspaces)
        ? parsed.workspaces.map(asWorkspace).filter((item): item is WorkSpace => Boolean(item))
        : []
      this.db = {
        folders,
        sessions,
        macros,
        packages,
        shellHistory,
        connectionLogs,
        workspaces,
        knownHosts: parsed.knownHosts && typeof parsed.knownHosts === 'object' ? parsed.knownHosts : {},
        settings: {
          ...defaultSettings(),
          ...(parsed.settings ?? {}),
          theme: normalizeTheme(parsed.settings?.theme),
          locale: normalizeLocale(parsed.settings?.locale),
          mode: normalizeMode(parsed.settings?.mode),
          activeWorkspaceId: String(parsed.settings?.activeWorkspaceId ?? ''),
        },
        windowBounds: parsed.windowBounds,
        lock: asLock(parsed.lock),
      }
      this.ensureWorkspace()
    } catch {
      this.db = emptyDb()
      this.ensureWorkspace()
    }

    let upgrade = false
    try {
      const blob = await readFile(this.secretPath)
      const json = unsealSecrets(blob)
      const parsed = JSON.parse(json) as { sessions?: Record<string, SecretBag>; vault?: unknown; keychain?: unknown; snippets?: unknown }
      const sessions = parsed?.sessions
      if (sessions && typeof sessions === 'object') {
        this.secrets = sessions
        this.vault = asVault(parsed.vault)
        this.keychain = asKeychain(parsed.keychain)
        this.snippetSecrets = asSnippetSecrets(parsed.snippets)
      } else {
        this.secrets = parsed && typeof parsed === 'object' ? parsed as unknown as Record<string, SecretBag> : {}
        this.vault = []
        this.keychain = []
      }
      upgrade = !isHardSealed(blob)
    } catch {
      this.secrets = {}
      this.vault = []
      this.keychain = []
    }
    if (upgrade) await this.persistSecrets()
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task, task)
    return this.queue
  }

  private persistDb(): Promise<void> {
    const json = JSON.stringify(this.db, null, 2)
    const tmp = `${this.dbPath}.tmp`
    return this.enqueue(async () => {
      await mkdir(dirname(this.dbPath), { recursive: true })
      await writeFile(tmp, json, 'utf8')
      await rename(tmp, this.dbPath)
    })
  }

  private persistSecrets(): Promise<void> {
    const json = JSON.stringify({ sessions: this.secrets, vault: this.vault, keychain: this.keychain, snippets: this.snippetSecrets })
    const payload = sealSecrets(json)
    const tmp = `${this.secretPath}.tmp`
    return this.enqueue(async () => {
      await mkdir(dirname(this.secretPath), { recursive: true })
      await writeFile(tmp, payload, { mode: 0o600 })
      await rename(tmp, this.secretPath)
    })
  }

  snapshot(): Pick<DB, 'folders' | 'sessions' | 'macros' | 'packages' | 'shellHistory' | 'settings' | 'workspaces'> {
    return {
      folders: this.db.folders,
      sessions: this.db.sessions,
      macros: this.db.macros,
      packages: this.db.packages,
      shellHistory: this.db.shellHistory,
      settings: this.db.settings,
      workspaces: this.db.workspaces,
    }
  }

  private ensureWorkspace(): void {
    if (this.db.workspaces.length === 0) {
      const id = randomUUID()
      this.db.workspaces.push({
        id,
        name: 'Personal',
        ownerEmail: '',
        members: [],
        createdAt: Date.now(),
      })
      for (const session of this.db.sessions) if (!session.workspaceId) session.workspaceId = id
      for (const folder of this.db.folders) if (!folder.workspaceId) folder.workspaceId = id
      this.db.settings.activeWorkspaceId = id
      return
    }
    const known = new Set(this.db.workspaces.map((item) => item.id))
    const fallback = this.db.workspaces[0].id
    for (const session of this.db.sessions) {
      if (!session.workspaceId || !known.has(session.workspaceId)) session.workspaceId = fallback
    }
    for (const folder of this.db.folders) {
      if (!folder.workspaceId || !known.has(folder.workspaceId)) folder.workspaceId = fallback
    }
    if (!this.db.settings.activeWorkspaceId || !known.has(this.db.settings.activeWorkspaceId)) {
      this.db.settings.activeWorkspaceId = fallback
    }
  }

  listForEmail(email: string | null): Pick<DB, 'folders' | 'sessions' | 'macros' | 'packages' | 'shellHistory' | 'settings' | 'workspaces'> {
    this.ensureWorkspace()
    const spaces = this.db.workspaces.filter((space) => canUseWorkspace(space, email))
    const ids = new Set(spaces.map((space) => space.id))
    const active = ids.has(this.db.settings.activeWorkspaceId)
      ? this.db.settings.activeWorkspaceId
      : (spaces[0]?.id || this.db.settings.activeWorkspaceId)
    return {
      workspaces: spaces,
      folders: this.db.folders.filter((folder) => folder.workspaceId === active),
      sessions: this.db.sessions.filter((session) => session.workspaceId === active),
      macros: this.db.macros,
      packages: this.db.packages,
      shellHistory: this.db.shellHistory,
      settings: { ...this.db.settings, activeWorkspaceId: active },
    }
  }

  async createWorkspace(name: string, ownerEmail: string): Promise<WorkSpace> {
    const email = normalizeEmail(ownerEmail) || ''
    const space: WorkSpace = {
      id: randomUUID(),
      name: name.trim().slice(0, 80) || 'Workspace',
      ownerEmail: email,
      members: [],
      createdAt: Date.now(),
    }
    this.db.workspaces.push(space)
    this.db.settings.activeWorkspaceId = space.id
    await this.persistDb()
    return space
  }

  async renameWorkspace(id: string, name: string): Promise<WorkSpace[]> {
    const space = this.db.workspaces.find((item) => item.id === id)
    if (!space) throw new Error(tr('invalidRequest'))
    space.name = name.trim().slice(0, 80) || space.name
    await this.persistDb()
    return this.db.workspaces
  }

  async setActiveWorkspace(id: string): Promise<Settings> {
    if (!this.db.workspaces.some((item) => item.id === id)) throw new Error(tr('invalidRequest'))
    this.db.settings.activeWorkspaceId = id
    await this.persistDb()
    return this.db.settings
  }

  async inviteWorkspace(id: string, rawEmail: string, ownerEmail: string, known: boolean): Promise<WorkSpace> {
    const space = this.db.workspaces.find((item) => item.id === id)
    if (!space) throw new Error(tr('invalidRequest'))
    const me = normalizeEmail(ownerEmail)
    if (!me || space.ownerEmail && space.ownerEmail !== me) throw new Error(tr('notFolderOwner'))
    if (!space.ownerEmail) space.ownerEmail = me
    const email = normalizeEmail(rawEmail)
    if (!email) throw new Error(tr('invalidUser'))
    if (email === me) throw new Error(tr('cannotInviteSelf'))
    if (space.members.some((member) => member.email === email)) throw new Error(tr('alreadyMember'))
    space.members.push({ email, status: known ? 'active' : 'pending', invitedAt: Date.now() })
    await this.persistDb()
    return space
  }

  async removeWorkspaceMember(id: string, rawEmail: string, ownerEmail: string): Promise<WorkSpace> {
    const space = this.db.workspaces.find((item) => item.id === id)
    if (!space) throw new Error(tr('invalidRequest'))
    const me = normalizeEmail(ownerEmail)
    if (!me || space.ownerEmail !== me) throw new Error(tr('notFolderOwner'))
    const email = normalizeEmail(rawEmail)
    if (!email) throw new Error(tr('invalidUser'))
    space.members = space.members.filter((member) => member.email !== email)
    await this.persistDb()
    return space
  }

  async activatePendingInvites(email: string): Promise<void> {
    const normalized = normalizeEmail(email)
    if (!normalized) return
    let changed = false
    for (const space of this.db.workspaces) {
      for (const member of space.members) {
        if (member.email === normalized && member.status === 'pending') {
          member.status = 'active'
          changed = true
        }
      }
    }
    if (changed) await this.persistDb()
  }

  async saveSession(session: Session, auth?: { password?: string | null; passphrase?: string | null; proxyPassword?: string | null }): Promise<Session> {
    const next = asSession(session)
    if (!next) throw new Error(tr('invalidSession'))
    const bag: SecretBag = { ...(this.secrets[next.id] ?? {}) }
    if (auth) {
      if (auth.password === null) delete bag.password
      else if (typeof auth.password === 'string' && auth.password.length) bag.password = auth.password
      if (auth.passphrase === null) delete bag.passphrase
      else if (typeof auth.passphrase === 'string' && auth.passphrase.length) bag.passphrase = auth.passphrase
      if (auth.proxyPassword === null) delete bag.proxyPassword
      else if (typeof auth.proxyPassword === 'string' && auth.proxyPassword.length) bag.proxyPassword = auth.proxyPassword
    }
    next.hasPassword = Boolean(bag.password)
    next.hasPassphrase = Boolean(bag.passphrase)
    next.hasProxyPassword = Boolean(bag.proxyPassword)
    const index = this.db.sessions.findIndex((s) => s.id === next.id)
    if (index >= 0) this.db.sessions[index] = next
    else this.db.sessions.push(next)
    if (bag.password || bag.passphrase || bag.proxyPassword) this.secrets[next.id] = bag
    else delete this.secrets[next.id]
    await this.persistDb()
    await this.persistSecrets()
    return next
  }

  secretsFor(id: string): SecretBag {
    return { ...(this.secrets[id] ?? {}) }
  }

  listPasswords(): VaultPassword[] {
    return [...this.vault].sort((a, b) => b.createdAt - a.createdAt)
  }

  async rememberPassword(secret: string): Promise<VaultPassword[]> {
    const value = secret.slice(0, 256)
    if (!value || this.vault.some((item) => item.secret === value)) return this.listPasswords()
    this.vault.unshift({ id: randomUUID(), secret: value, label: '', createdAt: Date.now(), kept: false })
    const loose = this.vault.filter((item) => !item.kept)
    if (loose.length > 40) {
      const drop = new Set(loose.slice(40).map((item) => item.id))
      this.vault = this.vault.filter((item) => item.kept || !drop.has(item.id))
    }
    await this.persistSecrets()
    return this.listPasswords()
  }

  async keepPassword(id: string, label: string): Promise<VaultPassword[]> {
    const item = this.vault.find((row) => row.id === id)
    if (!item) return this.listPasswords()
    item.kept = true
    item.label = label.trim().slice(0, 80)
    await this.persistSecrets()
    return this.listPasswords()
  }

  /** Vault passwords as CSV (label, password, created, saved) or plain text, one per line. */
  exportPasswords(format: 'csv' | 'txt'): string {
    const rows = this.listPasswords()
    if (format === 'txt') return `${rows.map((item) => item.secret).join('\n')}\n`
    const cell = (value: unknown) => {
      const text = String(value ?? '')
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const head = ['label', 'password', 'created', 'saved']
    const lines = rows.map((item) => [item.label, item.secret, new Date(item.createdAt).toISOString(), item.kept ? 'yes' : 'no'].map(cell).join(','))
    return `\uFEFF${[head.join(','), ...lines].join('\r\n')}\r\n`
  }

  async removePassword(id: string): Promise<VaultPassword[]> {
    this.vault = this.vault.filter((item) => item.id !== id)
    await this.persistSecrets()
    return this.listPasswords()
  }

  listKeychain(): KeychainItem[] {
    return [...this.keychain].sort((a, b) => b.createdAt - a.createdAt)
  }

  async saveKeychain(input: Partial<KeychainItem> & { kind: KeychainKind }): Promise<KeychainItem[]> {
    const id = typeof input.id === 'string' && input.id ? input.id : randomUUID()
    const existing = this.keychain.find((item) => item.id === id)
    const next: KeychainItem = {
      id,
      kind: input.kind,
      label: String(input.label ?? existing?.label ?? '').trim().slice(0, 80),
      username: String(input.username ?? existing?.username ?? '').slice(0, 120),
      password: String(input.password ?? existing?.password ?? '').slice(0, 512),
      privateKey: String(input.privateKey ?? existing?.privateKey ?? '').slice(0, 32_000),
      publicKey: String(input.publicKey ?? existing?.publicKey ?? '').slice(0, 16_000),
      certificate: String(input.certificate ?? existing?.certificate ?? '').slice(0, 32_000),
      passphrase: input.savePassphrase === false
        ? ''
        : String(input.passphrase ?? (input.savePassphrase ? existing?.passphrase : '') ?? '').slice(0, 512),
      savePassphrase: Boolean(input.savePassphrase ?? existing?.savePassphrase),
      keyType: (input.keyType ?? existing?.keyType ?? '') as KeychainItem['keyType'],
      createdAt: existing?.createdAt ?? Date.now(),
    }
    if (!next.label) {
      next.label = next.username || next.kind
    }
    if (existing) {
      Object.assign(existing, next)
    } else {
      this.keychain.unshift(next)
    }
    await this.persistSecrets()
    return this.listKeychain()
  }

  async removeKeychain(id: string): Promise<KeychainItem[]> {
    this.keychain = this.keychain.filter((item) => item.id !== id)
    await this.persistSecrets()
    return this.listKeychain()
  }

  async removeSession(id: string): Promise<void> {
    this.db.sessions = this.db.sessions.filter((s) => s.id !== id)
    for (const session of this.db.sessions) {
      if (session.jumpSessionId === id) session.jumpSessionId = ''
    }
    delete this.secrets[id]
    await this.persistDb()
    await this.persistSecrets()
  }

  async duplicateSession(id: string): Promise<Session> {
    const source = this.db.sessions.find((s) => s.id === id)
    if (!source) throw new Error(tr('sessionNotFound'))
    const copyId = randomUUID()
    const copy: Session = {
      ...source,
      id: copyId,
      name: tr('sessionCopy', { name: source.name || tr('sessionWord') }),
      createdAt: Date.now(),
      lastUsed: 0,
      opens: 0,
      errors: 0,
      activeMs: 0,
      bytesIn: 0,
      bytesOut: 0,
      dailyOpens: {},
      dailyErrors: {},
      errorLog: [],
      tunnels: source.tunnels.map((t) => ({ ...t, id: randomUUID() })),
    }
    if (this.secrets[id]) this.secrets[copyId] = { ...this.secrets[id] }
    this.db.sessions.push(copy)
    await this.persistDb()
    await this.persistSecrets()
    return copy
  }

  async moveSession(id: string, folderId: string | null, beforeId: string | null): Promise<void> {
    const from = this.db.sessions.findIndex((session) => session.id === id)
    if (from < 0) throw new Error(tr('sessionNotFound'))
    if (folderId && !this.db.folders.some((folder) => folder.id === folderId)) throw new Error(tr('invalidRequest'))
    const session = this.db.sessions[from]
    session.folderId = folderId
    const next = this.db.sessions.filter((item) => item.id !== id)
    let index = next.length
    if (beforeId && beforeId !== id) {
      const at = next.findIndex((item) => item.id === beforeId)
      if (at >= 0) index = at
    }
    next.splice(index, 0, session)
    this.db.sessions = next
    await this.persistDb()
  }

  async touchSession(id: string): Promise<void> {
    const session = this.db.sessions.find((s) => s.id === id)
    if (!session) return
    session.lastUsed = Date.now()
    session.opens = (session.opens || 0) + 1
    session.dailyOpens = bumpDailyMap(session.dailyOpens, dayKey())
    await this.persistDb()
  }

  async recordSessionError(id: string, reason?: string): Promise<void> {
    const session = this.db.sessions.find((s) => s.id === id)
    if (!session) return
    session.errors = (session.errors || 0) + 1
    session.dailyErrors = bumpDailyMap(session.dailyErrors, dayKey())
    const message = String(reason || '').trim().slice(0, 240) || 'error'
    const log = Array.isArray(session.errorLog) ? session.errorLog.slice() : []
    log.unshift({ at: Date.now(), message })
    session.errorLog = log.slice(0, 12)
    await this.persistDb()
  }

  async recordSessionUsage(id: string, patch: { activeMs?: number; bytesIn?: number; bytesOut?: number }): Promise<void> {
    const session = this.db.sessions.find((s) => s.id === id)
    if (!session) return
    if (patch.activeMs) session.activeMs = (session.activeMs || 0) + Math.max(0, Math.floor(patch.activeMs))
    if (patch.bytesIn) session.bytesIn = (session.bytesIn || 0) + Math.max(0, Math.floor(patch.bytesIn))
    if (patch.bytesOut) session.bytesOut = (session.bytesOut || 0) + Math.max(0, Math.floor(patch.bytesOut))
    await this.persistDb()
  }

  async saveFolder(folder: Folder): Promise<void> {
    if (!folder.id || !folder.name.trim()) throw new Error(tr('folderNameRequired'))
    let parent = folder.parentId
    while (parent) {
      if (parent === folder.id) throw new Error(tr('folderInsideItself'))
      parent = this.db.folders.find((f) => f.id === parent)?.parentId ?? null
    }
    const next = asFolder(folder)
    if (!next) throw new Error(tr('folderNameRequired'))
    const index = this.db.folders.findIndex((f) => f.id === folder.id)
    if (index >= 0) this.db.folders[index] = next
    else this.db.folders.push(next)
    await this.persistDb()
  }

  async removeFolder(id: string): Promise<void> {
    const drop = new Set<string>()
    const walk = (folderId: string) => {
      drop.add(folderId)
      for (const child of this.db.folders) if (child.parentId === folderId) walk(child.id)
    }
    walk(id)
    this.db.folders = this.db.folders.filter((f) => !drop.has(f.id))
    for (const session of this.db.sessions) {
      if (session.folderId && drop.has(session.folderId)) session.folderId = null
    }
    await this.persistDb()
  }

  async saveMacros(macros: Macro[]): Promise<void> {
    const next = macros.map(asMacro).filter((item): item is Macro => Boolean(item))
    const secrets: Record<string, string> = {}
    for (const macro of next) {
      if (!macro.secret) continue
      // An empty command on a secret snippet means "unchanged": keep what is sealed.
      const value = macro.command || this.snippetSecrets[macro.id]
      if (value) secrets[macro.id] = value
      macro.command = ''
    }
    const changed = JSON.stringify(secrets) !== JSON.stringify(this.snippetSecrets)
    if (changed) {
      const before = this.snippetSecrets
      this.snippetSecrets = secrets
      try {
        await this.persistSecrets()
      } catch (error) {
        this.snippetSecrets = before
        throw error
      }
    }
    this.db.macros = next
    await this.persistDb()
  }

  /** Plain text of a secret snippet, read on demand (reveal, run, copy). */
  revealMacro(id: string): string {
    const macro = this.db.macros.find((item) => item.id === id)
    if (!macro) return ''
    return macro.secret ? this.snippetSecrets[id] ?? '' : macro.command
  }

  async savePackages(packages: MacroPackage[]): Promise<void> {
    this.db.packages = packages.map(asPackage).filter((item): item is MacroPackage => Boolean(item))
    await this.persistDb()
  }

  async pushShellHistory(command: string): Promise<string[]> {
    const value = command.trim().slice(0, 500)
    if (!value) return this.db.shellHistory
    this.db.shellHistory = [value, ...this.db.shellHistory.filter((item) => item !== value)].slice(0, 200)
    await this.persistDb()
    return this.db.shellHistory
  }

  async clearShellHistory(): Promise<string[]> {
    this.db.shellHistory = []
    await this.persistDb()
    return this.db.shellHistory
  }

  listConnectionLogs(): ConnectionLog[] {
    return [...this.db.connectionLogs].sort((a, b) => b.startedAt - a.startedAt)
  }

  async addConnectionLog(entry: Omit<ConnectionLog, 'id'> & { id?: string }): Promise<ConnectionLog[]> {
    const row: ConnectionLog = {
      id: entry.id || randomUUID(),
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      userEmail: entry.userEmail.slice(0, 120),
      userName: entry.userName.slice(0, 80),
      clientHost: entry.clientHost.slice(0, 120),
      clientIp: entry.clientIp.slice(0, 64),
      sessionId: entry.sessionId,
      hostLabel: entry.hostLabel.slice(0, 120),
      protocol: entry.protocol,
      username: entry.username.slice(0, 120),
      saved: Boolean(entry.saved),
    }
    this.db.connectionLogs = [row, ...this.db.connectionLogs].slice(0, 500)
    await this.persistDb()
    return this.listConnectionLogs()
  }

  async toggleConnectionLogSaved(id: string): Promise<ConnectionLog[]> {
    const row = this.db.connectionLogs.find((item) => item.id === id)
    if (row) {
      row.saved = !row.saved
      await this.persistDb()
    }
    return this.listConnectionLogs()
  }

  async removeConnectionLog(id: string): Promise<ConnectionLog[]> {
    this.db.connectionLogs = this.db.connectionLogs.filter((item) => item.id !== id)
    await this.persistDb()
    return this.listConnectionLogs()
  }

  async saveSettings(settings: Settings): Promise<Settings> {
    this.db.settings = {
      ...defaultSettings(),
      ...settings,
      theme: normalizeTheme(settings.theme),
      locale: normalizeLocale(settings.locale),
      mode: normalizeMode(settings.mode),
    }
    await this.persistDb()
    return this.db.settings
  }

  knownHost(id: string): string | undefined {
    return this.db.knownHosts[id]
  }

  async setKnownHost(id: string, fingerprint: string): Promise<void> {
    this.db.knownHosts[id] = fingerprint
    await this.persistDb()
  }

  listKnownHosts(): { id: string; fingerprint: string }[] {
    return Object.entries(this.db.knownHosts)
      .map(([id, fingerprint]) => ({ id, fingerprint: String(fingerprint) }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  async removeKnownHost(id: string): Promise<{ id: string; fingerprint: string }[]> {
    delete this.db.knownHosts[id]
    await this.persistDb()
    return this.listKnownHosts()
  }

  get lockConfig(): LockConfig | undefined {
    return this.db.lock
  }

  async setLockConfig(config: LockConfig | undefined): Promise<void> {
    if (config) this.db.lock = config
    else delete this.db.lock
    await this.persistDb()
  }

  get bounds(): DB['windowBounds'] {
    return this.db.windowBounds
  }

  async setBounds(bounds: NonNullable<DB['windowBounds']>): Promise<void> {
    this.db.windowBounds = bounds
    await this.persistDb()
  }

  async exportBundle(): Promise<string> {
    return JSON.stringify({ folders: this.db.folders, sessions: this.db.sessions, macros: this.db.macros }, null, 2)
  }

  exportFolder(id: string, format: 'json' | 'csv'): { name: string; body: string } | null {
    const root = this.db.folders.find((item) => item.id === id)
    if (!root) return null
    return { name: root.name, body: this.exportSelection([], [root.id], format) }
  }

  /**
   * Hosts picked one by one plus whole folders (with their subfolders). Parent folders of
   * anything picked come along so an import rebuilds the same tree. Secrets never leave.
   */
  exportSelection(sessionIds: string[], folderIds: string[], format: 'json' | 'csv'): string {
    const folderSet = new Set<string>()
    const walk = (folderId: string) => {
      if (folderSet.has(folderId)) return
      folderSet.add(folderId)
      for (const child of this.db.folders) if (child.parentId === folderId) walk(child.id)
    }
    for (const id of folderIds) if (this.db.folders.some((item) => item.id === id)) walk(id)
    const picked = new Set(sessionIds)
    const sessions = this.db.sessions
      .filter((item) => picked.has(item.id) || (item.folderId && folderSet.has(item.folderId)))
      .map((item) => ({ ...item, hasPassword: false, hasPassphrase: false, hasProxyPassword: false }))
    const keep = new Set(folderSet)
    const climb = (folderId: string | null | undefined) => {
      let current = folderId ? this.db.folders.find((item) => item.id === folderId) : undefined
      while (current && !keep.has(current.id)) {
        keep.add(current.id)
        current = current.parentId ? this.db.folders.find((item) => item.id === current?.parentId) : undefined
      }
    }
    for (const session of sessions) climb(session.folderId)
    for (const id of folderSet) climb(this.db.folders.find((item) => item.id === id)?.parentId)
    const folders = this.db.folders.filter((item) => keep.has(item.id))
    if (format === 'json') return JSON.stringify({ folders, sessions, macros: [] }, null, 2)
    const names = new Map(folders.map((item) => [item.id, item.name]))
    const cell = (value: unknown) => {
      const text = String(value ?? '')
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const head = ['name', 'folder', 'protocol', 'host', 'port', 'username', 'url', 'notes']
    const rows = sessions.map((item) => [
      item.name, names.get(item.folderId ?? '') ?? '', item.protocol, item.host, item.port, item.username, item.url, item.notes,
    ].map(cell).join(','))
    return `\uFEFF${[head.join(','), ...rows].join('\r\n')}\r\n`
  }

  exportSession(id: string): string | null {
    const session = this.db.sessions.find((item) => item.id === id)
    if (!session) return null
    const folder = session.folderId ? this.db.folders.find((item) => item.id === session.folderId) : null
    return JSON.stringify({
      folders: folder ? [folder] : [],
      sessions: [{ ...session, hasPassword: false, hasPassphrase: false, hasProxyPassword: false }],
      macros: [],
    }, null, 2)
  }

  async importBundle(json: string): Promise<number> {
    const parsed = JSON.parse(json) as { folders?: Folder[]; sessions?: unknown[]; macros?: Macro[] }
    let count = 0
    const idMap = new Map<string, string>()
    const sessionMap = new Map<string, string>()
    const imported: Session[] = []
    if (Array.isArray(parsed.folders)) {
      for (const folder of parsed.folders) {
        if (!folder || typeof folder.id !== 'string' || typeof folder.name !== 'string') continue
        const id = randomUUID()
        idMap.set(folder.id, id)
      }
      for (const folder of parsed.folders) {
        if (!folder || typeof folder.id !== 'string' || typeof folder.name !== 'string') continue
        const id = idMap.get(folder.id)
        if (!id) continue
        const saved = asFolder({
          ...folder,
          id,
          parentId: folder.parentId ? idMap.get(folder.parentId) ?? null : null,
        })
        if (saved) this.db.folders.push(saved)
      }
    }
    if (Array.isArray(parsed.sessions)) {
      for (const raw of parsed.sessions) {
        const session = asSession({ ...(raw as object), id: randomUUID() })
        if (!session) continue
        const original = raw as Session
        if (original.folderId) session.folderId = idMap.get(original.folderId) ?? null
        session.hasPassword = false
        session.hasPassphrase = false
        session.hasProxyPassword = false
        session.tunnels = session.tunnels.map((t) => ({ ...t, id: randomUUID() }))
        if (original.id) sessionMap.set(original.id, session.id)
        this.db.sessions.push(session)
        imported.push(session)
        count += 1
      }
    }
    // Jump hosts point at ids from the source file; remap or drop them.
    for (const session of imported) {
      if (session.jumpSessionId) session.jumpSessionId = sessionMap.get(session.jumpSessionId) ?? ''
    }
    if (Array.isArray(parsed.macros)) {
      for (const macro of parsed.macros) {
        // Secret snippets are exported without their command; nothing to import.
        if (!macro || typeof macro.command !== 'string' || !macro.command) continue
        this.db.macros.push({
          id: randomUUID(),
          name: String(macro.name ?? tr('macroWord')).slice(0, 80),
          command: String(macro.command),
          sendEnter: macro.sendEnter !== false,
          packageId: null,
          targetIds: [],
        })
      }
    }
    await this.persistDb()
    return count
  }

  /** Save sessions found in another tool. Existing identical targets are kept, not duplicated. */
  async importDrafts(drafts: ImportDraft[]): Promise<number> {
    const workspaceId = this.db.settings.activeWorkspaceId
    const folderAt = (parts: string[]): string | null => {
      let parentId: string | null = null
      for (const raw of parts) {
        const name = raw.trim().slice(0, 80)
        if (!name) continue
        let folder: Folder | undefined = this.db.folders.find((item) => item.name === name && item.parentId === parentId && item.workspaceId === workspaceId)
        if (!folder) {
          folder = { id: randomUUID(), name, parentId, owner: null, members: [], workspaceId }
          this.db.folders.push(folder)
        }
        parentId = folder.id
      }
      return parentId
    }
    const same = (a: Session, d: ImportDraft) =>
      a.workspaceId === workspaceId
      && a.protocol === d.protocol
      && a.host.toLowerCase() === d.host.toLowerCase()
      && a.port === d.port
      && a.username === d.username
      && (d.protocol !== 'browser' || a.url === d.url)
      && (d.protocol !== 'serial' || a.serialPath === d.serialPath)
    const ids = new Map<string, string>()
    const fresh: { session: Session; draft: ImportDraft }[] = []
    for (const draft of drafts) {
      const existing = this.db.sessions.find((item) => same(item, draft))
      if (existing) {
        ids.set(draft.alias, existing.id)
        continue
      }
      const session = blankSession(draft.protocol, randomUUID(), workspaceId)
      Object.assign(session, {
        name: draft.name.slice(0, 80),
        folderId: folderAt(draft.folder),
        host: draft.host,
        port: draft.port,
        username: draft.username,
        privateKeyPath: draft.privateKeyPath || '',
        certificatePath: draft.certificatePath || '',
        agentForward: Boolean(draft.agentForward),
        x11: Boolean(draft.x11),
        tunnels: (draft.tunnels ?? []).map((tunnel) => ({ ...tunnel, id: randomUUID() })),
        serialPath: draft.serialPath ?? session.serialPath,
        baudRate: draft.baudRate ?? session.baudRate,
        dataBits: draft.dataBits ?? session.dataBits,
        parity: draft.parity ?? session.parity,
        stopBits: draft.stopBits ?? session.stopBits,
        url: draft.url ?? session.url,
      })
      const clean = asSession(session)
      if (!clean) continue
      ids.set(draft.alias, clean.id)
      fresh.push({ session: clean, draft })
    }
    for (const { session, draft } of fresh) {
      if (draft.jumpAlias) session.jumpSessionId = ids.get(draft.jumpAlias) ?? ''
      this.db.sessions.push(session)
    }
    await this.persistDb()
    return fresh.length
  }

  async backupSecrets(): Promise<void> {
    try {
      await copyFile(this.secretPath, `${this.secretPath}.bak`)
    } catch {
      /* first run */
    }
  }
}
