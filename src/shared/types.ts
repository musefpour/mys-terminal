export type Protocol =
  | 'local'
  | 'ssh'
  | 'sftp'
  | 'telnet'
  | 'raw'
  | 'serial'
  | 'ftp'
  | 's3'
  | 'rdp'
  | 'vnc'
  | 'mosh'
  | 'browser'
  | 'wsl'
  | 'docker'
  | 'k8s'
  | 'powershell'

export type TunnelMode = 'local' | 'remote' | 'dynamic'
export type FtpSecure = 'off' | 'explicit' | 'implicit'
export type Parity = 'none' | 'even' | 'odd'
export type ProxyType = 'none' | 'socks5' | 'http'
export const TERM_THEME_IDS = [
  'mys',
  'tokyo-night',
  'catppuccin-mocha',
  'dracula',
  'nord',
  'one-dark',
  'gruvbox-dark',
  'rose-pine',
  'kanagawa',
  'everforest',
  'night-owl',
  'synthwave',
  'ayu-dark',
  'palenight',
  'iran',
  'paper',
  'catppuccin-latte',
  'github-light',
  'solarized-light',
  'gruvbox-light',
  'one-light',
  'rose-pine-dawn',
  'tokyo-day',
  'ayu-light',
  'everforest-light',
] as const

export type TermThemeName = (typeof TERM_THEME_IDS)[number]

export const LOCALE_IDS = [
  'en',
  'nl',
  'de',
  'de-AT',
  'fr',
  'zh',
  'hi',
  'es',
  'pt',
  'pt-BR',
  'el',
  'tr',
  'ar',
  'fa',
  'ru',
  'da',
] as const

export type LocaleId = (typeof LOCALE_IDS)[number]

export function normalizeLocale(value: unknown): LocaleId {
  if (typeof value === 'string' && (LOCALE_IDS as readonly string[]).includes(value)) return value as LocaleId
  return 'fa'
}

const LEGACY_THEMES: Record<string, TermThemeName> = {
  midnight: 'tokyo-night',
  contrast: 'night-owl',
}

export function normalizeTheme(value: unknown): TermThemeName {
  if (typeof value === 'string' && (TERM_THEME_IDS as readonly string[]).includes(value)) return value as TermThemeName
  if (typeof value === 'string' && value in LEGACY_THEMES) return LEGACY_THEMES[value]
  return 'mys'
}

export interface TunnelTemplate {
  id: string
  mode: TunnelMode
  listenPort: number
  targetHost: string
  targetPort: number
  label?: string
  bindAddress?: string
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  owner: string | null
  members: string[]
  workspaceId: string
}

export interface WorkspaceMember {
  email: string
  status: 'active' | 'pending'
  invitedAt: number
}

export interface WorkSpace {
  id: string
  name: string
  ownerEmail: string
  members: WorkspaceMember[]
  createdAt: number
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email.slice(0, 120)
}

export function canUseWorkspace(space: WorkSpace, email: string | null | undefined): boolean {
  if (!space.ownerEmail) return true
  if (!email) return false
  if (space.ownerEmail === email) return true
  return space.members.some((member) => member.email === email && member.status === 'active')
}

export function normalizeHandle(value: string): string | null {
  const handle = value.trim().toLowerCase()
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(handle)) return null
  return handle
}

export function canSeeFolder(folder: Folder, username: string | null, folders: Folder[]): boolean {
  let current: Folder | undefined = folder
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.owner) {
      if (!username) return false
      return current.owner === username || current.members.includes(username)
    }
    if (!current.parentId) return true
    const parentId: string = current.parentId
    current = folders.find((item) => item.id === parentId)
  }
  return true
}

export interface SessionErrorEntry {
  at: number
  message: string
}

export interface ConnectionLog {
  id: string
  startedAt: number
  endedAt: number
  userEmail: string
  userName: string
  clientHost: string
  clientIp: string
  sessionId: string | null
  hostLabel: string
  protocol: Protocol
  username: string
  saved: boolean
}

export interface Session {
  id: string
  name: string
  folderId: string | null
  workspaceId: string
  favorite: boolean
  protocol: Protocol
  host: string
  port: number
  username: string
  hasPassword: boolean
  hasPassphrase: boolean
  privateKeyPath: string
  /** OpenSSH user certificate (`*-cert.pub`); empty = look next to the private key. */
  certificatePath: string
  startupCommand: string
  cwd: string
  shell: string
  x11: boolean
  useAgent: boolean
  agentForward: boolean
  serialPath: string
  baudRate: number
  dataBits: 7 | 8
  parity: Parity
  stopBits: 1 | 2
  url: string
  domain: string
  ftpSecure: FtpSecure
  tunnels: TunnelTemplate[]
  jumpSessionId: string
  proxyType: ProxyType
  proxyHost: string
  proxyPort: number
  proxyUser: string
  hasProxyPassword: boolean
  rdpFullscreen: boolean
  rdpClipboard: boolean
  rdpShareHome: boolean
  /** Per-session terminal look; empty / 0 means "use the app setting". */
  /** Preset id from shared/hostIcons.ts; empty = the protocol glyph. */
  icon: string
  /** Tint for the icon (#rrggbb); empty = the protocol colour. */
  color: string
  termTheme: string
  termFontSize: number
  termFontFamily: string
  notes: string
  lastUsed: number
  createdAt: number
  opens: number
  errors: number
  activeMs: number
  bytesIn: number
  bytesOut: number
  dailyOpens: Record<string, number>
  dailyErrors: Record<string, number>
  errorLog: SessionErrorEntry[]
}

export interface Macro {
  id: string
  name: string
  command: string
  sendEnter: boolean
  packageId?: string | null
  targetIds?: string[]
  /** The command lives in the sealed secrets file; `command` is always empty here. */
  secret?: boolean
  tags?: string[]
  pinned?: boolean
  uses?: number
  lastRun?: number
}

export interface MacroPackage {
  id: string
  name: string
}

export interface Settings {
  fontSize: number
  fontFamily: string
  theme: TermThemeName
  locale: LocaleId
  cursorBlink: boolean
  scrollback: number
  copyOnSelect: boolean
  logAll: boolean
  openLocalOnStart: boolean
  autoReconnect: boolean
  restoreTabs: boolean
  serverMonitor: boolean
  autoUpdate: boolean
  webgl: boolean
  pasteWarning: boolean
  highlightKeywords: boolean
  recordAll: boolean
  activeWorkspaceId: string
  mode: 'offline' | 'online'
}

export interface VaultPassword {
  id: string
  secret: string
  label: string
  createdAt: number
  kept: boolean
}

export type KeychainKind = 'identity' | 'key' | 'certificate' | 'touchid' | 'fido2'
export type SshKeyAlgo = 'ed25519' | 'ecdsa' | 'rsa' | 'ml-dsa'

export interface KeychainItem {
  id: string
  kind: KeychainKind
  label: string
  username: string
  password: string
  privateKey: string
  publicKey: string
  certificate: string
  passphrase: string
  savePassphrase: boolean
  keyType: SshKeyAlgo | ''
  createdAt: number
}

export interface Account {
  provider: 'google' | 'phone'
  id: string
  name: string
  username?: string
  email?: string
  phone?: string
  picture?: string
}

export interface OpenSpec {
  instanceId: string
  sessionId?: string
  name?: string
  protocol: Protocol
  host?: string
  port?: number
  username?: string
  password?: string
  passphrase?: string
  privateKeyPath?: string
  certificatePath?: string
  startupCommand?: string
  cwd?: string
  shell?: string
  x11?: boolean
  useAgent?: boolean
  agentForward?: boolean
  serialPath?: string
  baudRate?: number
  dataBits?: 7 | 8
  parity?: Parity
  stopBits?: 1 | 2
  url?: string
  domain?: string
  ftpSecure?: FtpSecure
  tunnels?: TunnelTemplate[]
  jumpSessionId?: string
  proxyType?: ProxyType
  proxyHost?: string
  proxyPort?: number
  proxyUser?: string
  proxyPassword?: string
  rdpFullscreen?: boolean
  rdpClipboard?: boolean
  rdpShareHome?: boolean
  cols: number
  rows: number
  forceHostKey?: boolean
}

export interface FileEntry {
  name: string
  size: number
  mtime: number
  isDir: boolean
  isLink: boolean
  mode: string
}

export interface TunnelInfo {
  id: string
  connId: string
  mode: TunnelMode
  listenPort: number
  targetHost: string
  targetPort: number
}

export type HubEvent =
  | { type: 'data'; instanceId: string; data: string }
  | { type: 'exit'; instanceId: string; code?: number; reason?: 'ended' | 'lost' }
  | { type: 'stats'; instanceId: string; bytesIn: number; bytesOut: number }
  | { type: 'progress'; instanceId: string; label: string; transferred: number; total: number }
  | { type: 'tool'; runId: string; stream: 'stdout' | 'stderr' | 'done'; data?: string; code?: number }
  | { type: 'synced'; instanceId: string; path: string; ok: boolean; message?: string }
  | { type: 'transfers'; connId: string; items: TransferInfo[] }
  | { type: 'monitor'; instanceId: string; stats: ServerStats }
  | { type: 'recording'; instanceId: string; active: boolean; path: string | null }
  | { type: 'servers'; items: LocalServerInfo[] }

export type OpenResult =
  | { ok: true; vncListen?: number; vncPassword?: string; detail?: string }
  | { ok: false; message: string; code?: 'hostkey' | 'auth' | 'missing-binary' | 'error'; fingerprint?: string }

export interface Capabilities {
  mosh: string | null
  freerdp: string | null
  xquartz: boolean
  display: string
  shell: string
  home: string
  platform: string
  docker: string | null
  kubectl: string | null
  wsl: string | null
  pwsh: string | null
}

/** Local programs that open a shell somewhere else (container, pod, WSL distro). */
export const COMMAND_PROTOCOLS = ['wsl', 'docker', 'k8s', 'powershell'] as const satisfies readonly Protocol[]

export type ImportSource = 'json' | 'ssh-config' | 'putty' | 'mobaxterm' | 'securecrt'

export type TransferState = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'canceled'

export interface TransferInfo {
  id: string
  connId: string
  direction: 'up' | 'down'
  name: string
  remote: string
  local: string
  size: number
  transferred: number
  /** Bytes per second, smoothed. */
  speed: number
  state: TransferState
  /** Pause/resume and mid-file cancel work (SFTP and local copies). */
  pausable: boolean
  error?: string
}

/** One sample from the SSH server monitor. Fields are null when the server does not expose them. */
export interface ServerStats {
  cpu: number | null
  memUsed: number | null
  memTotal: number | null
  diskUsed: number | null
  diskTotal: number | null
  uptime: number | null
  load: number | null
  rxRate: number | null
  txRate: number | null
}

export type LocalServerKind = 'http' | 'tftp' | 'ftp'

export interface LocalServerOptions {
  root: string
  port: number
  /** Listen on all interfaces instead of 127.0.0.1. */
  lanAccess: boolean
  allowWrite: boolean
  /** FTP only; empty = anonymous. */
  user?: string
  password?: string
}

export interface LocalServerInfo {
  id: string
  kind: LocalServerKind
  root: string
  port: number
  host: string
  allowWrite: boolean
  addresses: string[]
  startedAt: number
  log: string[]
}

export type SyncDirection = 'up' | 'down'

export interface SyncItem {
  /** Path below the synced folders, "/"-separated. */
  rel: string
  size: number
  reason: 'new' | 'changed'
}

export interface RecordingInfo {
  path: string
  name: string
  title: string
  startedAt: number
  size: number
  cols: number
  rows: number
  active: boolean
}

export interface LockStatus {
  enabled: boolean
  locked: boolean
  minutes: number
  /** Milliseconds until another unlock attempt is accepted. */
  retryIn: number
  locale: LocaleId
  theme: TermThemeName
}

export interface ToolRequest {
  runId: string
  tool: 'ping' | 'traceroute' | 'nslookup' | 'whois' | 'ports' | 'wol'
  host: string
  port?: number
  mac?: string
}

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  local: 'Local',
  ssh: 'SSH',
  sftp: 'SFTP',
  telnet: 'Telnet',
  raw: 'TCP',
  serial: 'Serial',
  ftp: 'FTP',
  s3: 'S3',
  rdp: 'RDP',
  vnc: 'VNC',
  mosh: 'Mosh',
  browser: 'Browser',
  wsl: 'WSL',
  docker: 'Docker',
  k8s: 'Kubernetes',
  powershell: 'PowerShell',
}

export const DEFAULT_PORT: Record<Protocol, number> = {
  local: 0,
  ssh: 22,
  sftp: 22,
  telnet: 23,
  raw: 513,
  serial: 0,
  ftp: 21,
  s3: 443,
  rdp: 3389,
  vnc: 5900,
  mosh: 22,
  browser: 443,
  wsl: 0,
  docker: 0,
  k8s: 0,
  powershell: 0,
}

export function normalizeMode(value: unknown): Settings['mode'] {
  return value === 'online' ? 'online' : 'offline'
}

export function defaultSettings(): Settings {
  return {
    fontSize: 13,
    fontFamily: 'Menlo, "SF Mono", ui-monospace, monospace',
    theme: 'mys',
    locale: 'fa',
    cursorBlink: true,
    scrollback: 10000,
    copyOnSelect: false,
    logAll: false,
    openLocalOnStart: false,
    autoReconnect: true,
    restoreTabs: true,
    serverMonitor: true,
    autoUpdate: true,
    webgl: true,
    pasteWarning: true,
    highlightKeywords: true,
    recordAll: false,
    activeWorkspaceId: '',
    mode: 'offline',
  }
}

export function blankSession(protocol: Protocol, id: string, workspaceId = ''): Session {
  const now = Date.now()
  return {
    id,
    name: '',
    folderId: null,
    workspaceId,
    favorite: false,
    protocol,
    host: '',
    port: DEFAULT_PORT[protocol],
    username: '',
    hasPassword: false,
    hasPassphrase: false,
    privateKeyPath: '',
    certificatePath: '',
    startupCommand: '',
    cwd: '',
    shell: '',
    x11: false,
    useAgent: true,
    agentForward: false,
    serialPath: '',
    baudRate: 115200,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    url: protocol === 'browser' ? 'https://' : '',
    domain: protocol === 's3' ? 'us-east-1' : '',
    ftpSecure: 'off',
    tunnels: [],
    jumpSessionId: '',
    proxyType: 'none',
    proxyHost: '',
    proxyPort: 1080,
    proxyUser: '',
    hasProxyPassword: false,
    rdpFullscreen: false,
    rdpClipboard: true,
    rdpShareHome: false,
    icon: '',
    color: '',
    termTheme: '',
    termFontSize: 0,
    termFontFamily: '',
    notes: '',
    lastUsed: 0,
    createdAt: now,
    opens: 0,
    errors: 0,
    activeMs: 0,
    bytesIn: 0,
    bytesOut: 0,
    dailyOpens: {},
    dailyErrors: {},
    errorLog: [],
  }
}

export function dayKey(ts = Date.now()): string {
  const date = new Date(ts)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function lastDayKeys(count: number, from = Date.now()): string[] {
  const keys: string[] = []
  const base = new Date(from)
  base.setHours(12, 0, 0, 0)
  for (let i = count - 1; i >= 0; i -= 1) {
    const day = new Date(base)
    day.setDate(base.getDate() - i)
    keys.push(dayKey(day.getTime()))
  }
  return keys
}

export function bumpDailyMap(map: Record<string, number> | undefined, day = dayKey(), by = 1): Record<string, number> {
  const next: Record<string, number> = { ...(map || {}) }
  next[day] = Math.max(0, (next[day] || 0) + by)
  const keys = Object.keys(next).sort()
  while (keys.length > 14) {
    const drop = keys.shift()
    if (drop) delete next[drop]
  }
  return next
}

export function sessionTitle(session: Pick<Session, 'name' | 'protocol' | 'host' | 'username'>): string {
  if (session.name.trim()) return session.name.trim()
  if (session.protocol === 'local') return 'Local'
  if (session.protocol === 'browser') return 'Browser'
  if (session.protocol === 'serial') return 'Serial'
  const user = session.username ? `${session.username}@` : ''
  return `${PROTOCOL_LABEL[session.protocol]} ${user}${session.host}`.trim()
}

const PROTOCOLS = new Set<Protocol>([
  'local',
  'ssh',
  'sftp',
  'telnet',
  'raw',
  'serial',
  'ftp',
  's3',
  'rdp',
  'vnc',
  'mosh',
  'browser',
  'wsl',
  'docker',
  'k8s',
  'powershell',
])

export function isProtocol(value: unknown): value is Protocol {
  return typeof value === 'string' && PROTOCOLS.has(value as Protocol)
}

/** Parse a quick-connect line: `ssh user@host`, `user@host:22`, `https://…`. */
export function parseQuickConnect(input: string): Partial<OpenSpec> & { protocol: Protocol } | null {
  const raw = input.trim()
  if (!raw) return null

  if (/^https?:\/\//i.test(raw)) {
    return { protocol: 'browser', url: raw, name: raw }
  }

  const labeled = raw.match(/^(ssh|sftp|telnet|ftp|ftps|s3|rdp|vnc|mosh|raw|tcp)\s+(.+)$/i)
  const body = labeled ? labeled[2].trim() : raw
  let protocol: Protocol = 'ssh'
  if (labeled) {
    const word = labeled[1].toLowerCase()
    protocol = word === 'tcp' ? 'raw' : word === 'ftps' ? 'ftp' : (word as Protocol)
  }

  const url = body.match(/^([a-z0-9+.-]+):\/\/(?:([^@/?#]+)@)?([^:/?#]+)(?::(\d+))?/i)
  if (url) {
    const scheme = url[1].toLowerCase()
    const map: Record<string, Protocol> = {
      ssh: 'ssh',
      sftp: 'sftp',
      telnet: 'telnet',
      ftp: 'ftp',
      ftps: 'ftp',
      s3: 's3',
      rdp: 'rdp',
      vnc: 'vnc',
      mosh: 'mosh',
      tcp: 'raw',
    }
    const proto = map[scheme]
    if (!proto) return null
    return {
      protocol: proto,
      username: url[2] ? decodeURIComponent(url[2]) : undefined,
      host: url[3],
      port: url[4] ? Number(url[4]) : DEFAULT_PORT[proto],
      ftpSecure: scheme === 'ftps' ? 'explicit' : undefined,
    }
  }

  const at = body.match(/^(?:([^@\s]+)@)?([^:\s]+)(?::(\d+))?(?:\s+(\d+))?$/)
  if (!at) return null
  const port = at[3] ? Number(at[3]) : at[4] ? Number(at[4]) : DEFAULT_PORT[protocol]
  return {
    protocol,
    username: at[1],
    host: at[2],
    port,
  }
}

export function assertSafeHost(host: string): string {
  const value = host.trim()
  if (!value || value.length > 253 || !/^[a-zA-Z0-9_.:\-\[\]]+$/.test(value)) {
    throw new Error('invalid-host')
  }
  return value
}

export function fontStacks(): { id: string; label: string; value: string }[] {
  return [
    { id: 'menlo', label: 'Menlo', value: 'Menlo, "SF Mono", ui-monospace, monospace' },
    { id: 'sf', label: 'SF Mono', value: '"SF Mono", Menlo, ui-monospace, monospace' },
    { id: 'jb', label: 'JetBrains Mono', value: '"JetBrains Mono", Menlo, ui-monospace, monospace' },
    { id: 'ui', label: 'System', value: 'ui-monospace, Menlo, monospace' },
  ]
}
