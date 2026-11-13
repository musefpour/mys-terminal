import { spawn, execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, promises as fs, type WriteStream } from 'node:fs'
import net from 'node:net'
import { homedir, hostname, networkInterfaces, tmpdir } from 'node:os'
import path, { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { Client, type AnyAuthMethod, type ClientChannel, type ConnectConfig } from 'ssh2'
import { Client as FtpClient } from 'basic-ftp'
import { spawn as spawnPty, type IPty } from 'node-pty'
import { WebSocketServer, type RawData } from 'ws'
import { shell, type WebContents } from 'electron'
import {
  assertSafeHost,
  isProtocol,
  type HubEvent,
  type OpenResult,
  type OpenSpec,
  type ProxyType,
  type TunnelTemplate,
} from '../shared/types'
import {
  chmodPath,
  downloadEntry,
  listFiles,
  listSerialPorts,
  mkdirPath,
  readText,
  removePath,
  renamePath,
  terminalCwd,
  uploadFileTo,
  writeText,
} from './files'
import { createLive, type LiveConn } from './live'
import { Store } from './store'
import { Tunnels } from './tunnels'
import { ToolRunner } from './tools'
import { explain, tr } from './i18n'
import { s3Auth, s3List } from './s3'
import { assertUser, findFreerdp, findRdpApp, which } from './which'
import { currentAccount } from './auth'
import { connectX11, defaultShell, isMac, isWin, localUser, serialDevice, sshAgent } from './platform'
import { connectViaProxy } from './proxy'
import { certificateFor, certifiedKey, readCertificate } from './sshcert'
import { commandFor, type CommandProtocol } from './containers'
import { TerminalTransfer } from './termxfer'
import { MONITOR_COMMAND, parseMonitor, type MonitorState } from './monitor'
import { Transfers } from './transfers'
import { Recorder } from './recorder'
import { planSync } from './sync'

const IAC = 255
const SE = 240
const SB = 250
const WILL = 251
const WONT = 252
const DO = 253
const DONT = 254

interface Io {
  write: (data: string | Buffer) => void
  resize?: (cols: number, rows: number) => void
}

type ExitReason = 'ended' | 'lost'

/** Native file pickers for in-band transfers (rz/sz, trz/tsz); swapped out in tests. */
export interface Pickers {
  files: (directory: boolean) => Promise<string[] | undefined>
  directory: () => Promise<string | undefined>
}

const IN_BAND_TRANSFER = new Set(['ssh', 'local', 'telnet', 'raw', 'serial', 'wsl', 'docker', 'k8s', 'powershell'])

interface Route {
  jumpSessionId?: string
  proxyType?: ProxyType
  proxyHost?: string
  proxyPort?: number
  proxyUser?: string
  proxyPassword?: string
}

interface SshLogin {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: Buffer
  passphrase?: string
  /** OpenSSH certificate text for `privateKey`. */
  certificate?: string
  useAgent?: boolean
  agentForward?: boolean
}

/** A failure on a jump hop that already carries the result to show. */
class HopError extends Error {
  constructor(readonly result: Extract<OpenResult, { ok: false }>) {
    super(result.message)
  }
}

const PID_MARK = /\x1b\]7337;mys-pid=(\d+)\x07/

export class Hub {
  readonly tunnels = new Tunnels()
  readonly tools: ToolRunner
  readonly transfers: Transfers
  readonly recorder: Recorder
  private monitors = new Map<string, NodeJS.Timeout>()
  private xfers = new Map<string, TerminalTransfer>()
  private conns = new Map<string, LiveConn>()
  private io = new Map<string, Io>()
  private logs = new Map<string, WriteStream>()
  private queues = new Map<string, Buffer[]>()
  private pending = new Map<string, (result: OpenResult) => void>()
  private openMeta = new Map<string, OpenSpec>()
  private timer: NodeJS.Timeout

  constructor(
    private store: Store,
    /** Every window that shows tabs; each renderer picks the events for its own connections. */
    private sender: () => WebContents | WebContents[] | null,
    private pickers?: Pickers,
  ) {
    this.tools = new ToolRunner((event) => this.emit(event))
    this.recorder = new Recorder(() => this.store.recordingsDir())
    this.transfers = new Transfers((id) => this.conns.get(id), (connId, items) => this.emit({ type: 'transfers', connId, items }))
    this.timer = setInterval(() => {
      for (const conn of this.conns.values()) {
        if (!conn.ready) continue
        this.emit({ type: 'stats', instanceId: conn.id, bytesIn: conn.bytesIn, bytesOut: conn.bytesOut })
      }
    }, 1000)
  }

  listSerial(): Promise<string[]> {
    return listSerialPorts()
  }

  async open(spec: OpenSpec): Promise<OpenResult> {
    if (!spec || !isProtocol(spec.protocol) || !/^[\w-]{8,80}$/.test(spec.instanceId || '')) {
      return { ok: false, message: tr('invalidRequest'), code: 'error' }
    }
    const existing = this.conns.get(spec.instanceId)
    if (existing) this.destroy(existing, { silent: true })
    const conn = createLive(spec.instanceId, spec.protocol, spec.sessionId)
    this.conns.set(conn.id, conn)
    this.attachLog(conn, spec)
    try {
      const result = await this.dispatch(conn, spec)
      if (conn.disposed && result.ok) return { ok: false, message: tr('connectionClosed'), code: 'error' }
      if (result.ok) {
        conn.ready = true
        conn.startedAt = Date.now()
        this.openMeta.set(conn.id, spec)
        if (this.pickers && this.io.has(conn.id) && IN_BAND_TRANSFER.has(spec.protocol)) this.attachTransfer(conn, spec)
        if (this.store.data.settings.recordAll && this.io.has(conn.id)) void this.recordStart(conn.id)
      } else {
        if (spec.sessionId) void this.store.recordSessionError(spec.sessionId, result.message)
        if (!conn.disposed) this.destroy(conn, { silent: true })
      }
      return result
    } catch (error) {
      const message = explain(error, 'connectFailed')
      if (spec.sessionId) void this.store.recordSessionError(spec.sessionId, message)
      if (!conn.disposed) this.destroy(conn, { silent: true })
      return { ok: false, message, code: 'error' }
    }
  }

  write(id: string, data: string): void {
    const conn = this.conns.get(id)
    const io = this.io.get(id)
    if (!conn || !io || conn.disposed || typeof data !== 'string') return
    conn.bytesOut += Buffer.byteLength(data)
    const xfer = this.xfers.get(id)
    if (xfer) xfer.input(data)
    else io.write(data)
  }

  /** rz/sz and trz/tsz detection between the shell and the terminal. */
  private attachTransfer(conn: LiveConn, spec: OpenSpec): void {
    const pickers = this.pickers
    if (!pickers) return
    const xfer = new TerminalTransfer({
      toTerminal: (data) => this.deliver(conn, data),
      toServer: (data) => this.io.get(conn.id)?.write(data),
      pickFiles: (directory) => pickers.files(directory ?? false),
      pickDirectory: () => pickers.directory(),
      columns: clampDim(spec.cols, 80),
      windowsShell: isWin && (spec.protocol === 'local' || spec.protocol === 'powershell'),
    })
    this.xfers.set(conn.id, xfer)
    conn.addClean(() => {
      xfer.dispose()
      this.xfers.delete(conn.id)
    })
  }

  resize(id: string, cols: number, rows: number): void {
    const io = this.io.get(id)
    if (!io?.resize) return
    if (cols < 2 || rows < 2 || cols > 500 || rows > 200) return
    io.resize(cols, rows)
    const spec = this.openMeta.get(id)
    if (spec) {
      spec.cols = cols
      spec.rows = rows
    }
    this.recorder.resize(id, cols, rows)
    this.xfers.get(id)?.resize(cols)
  }

  /** Start writing this terminal's output to a .cast file. */
  async recordStart(id: string): Promise<string | null> {
    const conn = this.conns.get(id)
    const spec = this.openMeta.get(id)
    if (!conn || conn.disposed || !spec || !this.io.has(id)) return null
    const file = await this.recorder.start(id, { title: spec.name || spec.host || spec.protocol, cols: clampDim(spec.cols, 80), rows: clampDim(spec.rows, 24) })
    this.emit({ type: 'recording', instanceId: id, active: true, path: file })
    return file
  }

  recordStop(id: string): string | null {
    const file = this.recorder.stop(id)
    if (file) this.emit({ type: 'recording', instanceId: id, active: false, path: file })
    return file
  }

  close(id: string): void {
    const conn = this.conns.get(id)
    if (!conn) {
      const finish = this.pending.get(id)
      if (finish) {
        this.pending.delete(id)
        finish({ ok: false, message: tr('connectionClosed'), code: 'error' })
      }
      return
    }
    this.destroy(conn)
  }

  get(id: string): LiveConn | undefined {
    return this.conns.get(id)
  }

  async filesList(id: string, filePath?: string) {
    const conn = this.requireFiles(id)
    return listFiles(conn, filePath)
  }

  async filesMkdir(id: string, filePath: string) {
    await mkdirPath(this.requireFiles(id), filePath)
  }

  async filesRemove(id: string, filePath: string, isDir: boolean) {
    await removePath(this.requireFiles(id), filePath, isDir)
  }

  async filesRename(id: string, from: string, to: string) {
    await renamePath(this.requireFiles(id), from, to)
  }

  async filesRead(id: string, filePath: string) {
    return readText(this.requireFiles(id), filePath)
  }

  async filesWrite(id: string, filePath: string, content: string) {
    await writeText(this.requireFiles(id), filePath, content)
  }

  async filesSyncPlan(id: string, localDir: string, remoteDir: string, direction: 'up' | 'down') {
    return planSync(this.requireFiles(id), localDir, remoteDir, direction)
  }

  async filesSyncRun(id: string, localDir: string, remoteDir: string, direction: 'up' | 'down', rels: string[]) {
    await this.transfers.sync(this.requireFiles(id), localDir, remoteDir, direction, rels)
  }

  async filesChmod(id: string, filePath: string, mode: string) {
    await chmodPath(this.requireFiles(id), filePath, mode)
  }

  async filesTerminalCwd(id: string): Promise<string | null> {
    const conn = this.conns.get(id)
    if (!conn || conn.disposed) return null
    return terminalCwd(conn)
  }

  /** Download to a temp copy, open it in the system editor, upload on every save. */
  async filesEditExternal(id: string, remote: string) {
    const conn = this.requireFiles(id)
    if (conn.fileMode === 'local') {
      const failed = await shell.openPath(remote)
      if (failed) throw new Error(failed)
      return
    }
    const dir = await fs.mkdtemp(join(tmpdir(), 'mys-edit-'))
    const name = path.posix.basename(remote).replace(/[<>:"|?*\\]/g, '_') || 'file'
    const local = join(dir, name)
    await downloadEntry(conn, remote, local, false)
    let last = (await fs.stat(local)).mtimeMs
    let busy = false
    const timer = setInterval(() => {
      if (busy || conn.disposed) return
      busy = true
      void fs.stat(local).then(async (stat) => {
        if (stat.mtimeMs === last) return
        last = stat.mtimeMs
        try {
          await uploadFileTo(conn, local, remote)
          this.emit({ type: 'synced', instanceId: id, path: remote, ok: true })
        } catch (error) {
          this.emit({ type: 'synced', instanceId: id, path: remote, ok: false, message: explain(error, 'uploadFailed') })
        }
      }).catch(() => undefined).finally(() => {
        busy = false
      })
    }, 1000)
    conn.addClean(() => {
      clearInterval(timer)
      void fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    })
    const failed = await shell.openPath(local)
    if (failed) throw new Error(failed)
  }

  /** Temp folders holding copies made for dragging files out of the file panel. */
  private dragDirs = new Set<string>()

  /**
   * A local path the OS can drag to Finder/Explorer: the file itself for local browsing,
   * otherwise a fresh temp copy (removed when the connection closes).
   */
  async filesDragOut(id: string, remote: string, isDir: boolean): Promise<string> {
    const conn = this.requireFiles(id)
    if (conn.fileMode === 'local') return remote
    const dir = await fs.mkdtemp(join(tmpdir(), 'mys-drag-'))
    this.dragDirs.add(dir)
    conn.addClean(() => {
      this.dragDirs.delete(dir)
      void fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    })
    const name = (conn.fileMode === 's3' ? remote.split('/').filter(Boolean).pop() : path.posix.basename(remote))?.replace(/[<>:"|?*\\]/g, '_') || 'file'
    const local = join(dir, name)
    await downloadEntry(conn, remote, local, isDir)
    return local
  }

  /** Queue uploads; progress arrives as `transfers` events. */
  async filesUpload(id: string, dir: string, paths: string[]) {
    // A file dragged out of this panel and dropped back on it is not uploaded again.
    const fresh = paths.filter((item) => ![...this.dragDirs].some((dragDir) => item === dragDir || item.startsWith(dragDir + path.sep)))
    if (!fresh.length) return
    await this.transfers.upload(this.requireFiles(id), dir, fresh)
  }

  async filesDownload(id: string, filePath: string, dest: string, isDir: boolean) {
    const conn = this.requireFiles(id)
    if (conn.fileMode === 'local') {
      await downloadEntry(conn, filePath, dest, isDir)
      return
    }
    await this.transfers.download(conn, filePath, dest, isDir)
  }

  /** Sample CPU/RAM/disk/uptime of an SSH shell's server every few seconds. */
  monitorStart(id: string): void {
    const conn = this.conns.get(id)
    if (!conn?.ssh || conn.protocol !== 'ssh' || this.monitors.has(id)) return
    let state: MonitorState | null = null
    let busy = false
    const sample = () => {
      const ssh = conn.ssh
      if (busy || !ssh || conn.disposed) return
      busy = true
      let out = ''
      const done = () => {
        busy = false
        if (conn.disposed || !this.monitors.has(id)) return
        const parsed = parseMonitor(out, state)
        state = parsed.state
        this.emit({ type: 'monitor', instanceId: id, stats: parsed.stats })
      }
      try {
        ssh.exec(MONITOR_COMMAND, (error, stream) => {
          if (error || !stream) {
            busy = false
            return
          }
          stream.on('data', (chunk: Buffer) => {
            if (out.length < 65536) out += chunk.toString('utf8')
          })
          stream.stderr?.resume()
          stream.on('close', done)
        })
      } catch {
        busy = false
      }
    }
    sample()
    this.monitors.set(id, setInterval(sample, 3000))
    conn.addClean(() => this.monitorStop(id))
  }

  monitorStop(id: string): void {
    const timer = this.monitors.get(id)
    if (timer) clearInterval(timer)
    this.monitors.delete(id)
  }

  async tunnelStart(connId: string, template: TunnelTemplate, persistSessionId?: string) {
    const conn = this.conns.get(connId)
    if (!conn?.ssh || conn.disposed) throw new Error(tr('tunnelNeedsSsh'))
    const info = await this.tunnels.start(connId, conn.ssh, { ...template, id: template.id || randomUUID() })
    if (persistSessionId) {
      const session = this.store.data.sessions.find((item) => item.id === persistSessionId)
      if (session && !session.tunnels.some((item) => item.listenPort === info.listenPort && item.mode === info.mode)) {
        session.tunnels.push({
          id: info.id,
          mode: info.mode,
          listenPort: info.listenPort,
          targetHost: info.targetHost,
          targetPort: info.targetPort,
        })
        await this.store.saveSession(session)
      }
    }
    return info
  }

  tunnelStop(id: string): void {
    this.tunnels.stop(id)
  }

  /** Remove drag-out copies left behind (app quit). */
  private cleanDragDirs(): void {
    for (const dir of this.dragDirs) void fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    this.dragDirs.clear()
  }

  dispose(): void {
    clearInterval(this.timer)
    for (const conn of [...this.conns.values()]) this.destroy(conn, { silent: true })
    this.tunnels.stopAll()
    this.tools.stopAll()
    this.recorder.stopAll()
    this.cleanDragDirs()
  }

  private requireFiles(id: string): LiveConn {
    const conn = this.conns.get(id)
    if (!conn || conn.disposed) throw new Error(tr('filesInactive'))
    return conn
  }

  private emit(event: HubEvent): void {
    const target = this.sender()
    for (const contents of Array.isArray(target) ? target : target ? [target] : []) {
      if (!contents.isDestroyed()) contents.send('hub:event', event)
    }
  }

  private push(conn: LiveConn, chunk: Buffer | string): void {
    if (conn.disposed) return
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk)
    if (!buf.length) return
    conn.bytesIn += buf.length
    const xfer = this.xfers.get(conn.id)
    if (xfer) xfer.output(buf)
    else this.deliver(conn, buf)
  }

  /** Bytes that reach the terminal: logged, recorded, then batched to the renderer. */
  private deliver(conn: LiveConn, buf: Buffer): void {
    if (conn.disposed || !buf.length) return
    this.logs.get(conn.id)?.write(buf)
    this.recorder.output(conn.id, buf)
    const queued = this.queues.get(conn.id)
    if (queued) {
      queued.push(buf)
      return
    }
    this.queues.set(conn.id, [buf])
    queueMicrotask(() => {
      const parts = this.queues.get(conn.id)
      this.queues.delete(conn.id)
      if (!parts || conn.disposed) return
      const joined = parts.length === 1 ? parts[0] : Buffer.concat(parts)
      // latin1 keeps every byte (incl. ESC/ANSI) intact across contextBridge.
      this.emit({
        type: 'data',
        instanceId: conn.id,
        data: joined.toString('latin1'),
      })
    })
  }

  private recordConnection(conn: LiveConn, spec: OpenSpec): void {
    const account = currentAccount()
    const client = localClientInfo()
    const session = spec.sessionId ? this.store.data.sessions.find((item) => item.id === spec.sessionId) : null
    const hostLabel = spec.name
      || session?.name
      || (spec.protocol === 'local' ? 'Local Terminal' : spec.host || spec.url || spec.protocol)
    void this.store.addConnectionLog({
      startedAt: conn.startedAt || Date.now(),
      endedAt: Date.now(),
      userEmail: account?.email || '',
      userName: account?.name || account?.username || '',
      clientHost: client.host,
      clientIp: client.ip,
      sessionId: spec.sessionId || null,
      hostLabel: String(hostLabel || spec.protocol),
      protocol: spec.protocol,
      username: spec.username || session?.username || '',
      saved: Boolean(session?.favorite),
    })
  }

  private attachLog(conn: LiveConn, spec: OpenSpec): void {
    if (!this.store.data.settings.logAll) return
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safe = (spec.name || spec.protocol).replace(/[^\w.-]+/g, '_').slice(0, 40)
    const stream = createWriteStream(join(this.store.logsDir(), `${stamp}_${safe}.log`), { flags: 'a' })
    this.logs.set(conn.id, stream)
    conn.addClean(() => stream.end())
  }

  private destroy(conn: LiveConn, opts?: { silent?: boolean; reason?: ExitReason }): void {
    if (conn.disposed) return
    const wasReady = conn.ready
    conn.disposed = true
    this.conns.delete(conn.id)
    this.io.delete(conn.id)
    this.tunnels.stopConn(conn.id)
    this.transfers.dropConn(conn.id)
    this.recordStop(conn.id)
    const finish = this.pending.get(conn.id)
    if (finish) {
      this.pending.delete(conn.id)
      finish({ ok: false, message: tr('connectionClosed'), code: 'error' })
    }
    if (conn.sessionId && (wasReady || conn.bytesIn || conn.bytesOut)) {
      void this.store.recordSessionUsage(conn.sessionId, {
        activeMs: wasReady ? Math.max(0, Date.now() - conn.startedAt) : 0,
        bytesIn: conn.bytesIn,
        bytesOut: conn.bytesOut,
      })
    }
    if (wasReady) {
      const spec = this.openMeta.get(conn.id)
      if (spec) void this.recordConnection(conn, spec)
    }
    this.openMeta.delete(conn.id)
    conn.cleanup()
    const log = this.logs.get(conn.id)
    log?.end()
    this.logs.delete(conn.id)
    if (wasReady && !opts?.silent) this.emit({ type: 'exit', instanceId: conn.id, reason: opts?.reason ?? 'ended' })
  }

  private defer(conn: LiveConn): Promise<OpenResult> {
    return new Promise((resolve) => {
      this.pending.set(conn.id, resolve)
    })
  }

  private settle(conn: LiveConn, result: OpenResult): void {
    const finish = this.pending.get(conn.id)
    if (!finish) return
    this.pending.delete(conn.id)
    finish(result)
  }

  private bindIo(conn: LiveConn, io: Io): void {
    this.io.set(conn.id, io)
  }

  private auth(spec: OpenSpec): { password: string; passphrase: string; proxyPassword: string } {
    const saved = spec.sessionId ? this.store.secretsFor(spec.sessionId) : {}
    return {
      password: spec.password || saved.password || '',
      passphrase: spec.passphrase || saved.passphrase || '',
      proxyPassword: spec.proxyPassword || saved.proxyPassword || '',
    }
  }

  private async dispatch(conn: LiveConn, spec: OpenSpec): Promise<OpenResult> {
    switch (spec.protocol) {
      case 'local':
        return this.openLocal(conn, spec)
      case 'ssh':
      case 'sftp':
        return this.openSsh(conn, spec, spec.protocol === 'sftp')
      case 'telnet':
      case 'raw':
        return this.openTcp(conn, spec, spec.protocol === 'telnet')
      case 'serial':
        return this.openSerial(conn, spec)
      case 'ftp':
        return this.openFtp(conn, spec)
      case 's3':
        return this.openS3(conn, spec)
      case 'mosh':
        return this.openMosh(conn, spec)
      case 'vnc':
        return this.openVnc(conn, spec)
      case 'rdp':
        return this.openRdp(conn, spec)
      case 'browser':
        return { ok: true }
      case 'wsl':
      case 'docker':
      case 'k8s':
      case 'powershell':
        return this.openCommand(conn, spec, spec.protocol)
      default:
        return { ok: false, message: tr('protocolUnsupported'), code: 'error' }
    }
  }

  private ptyEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[key] = value
    }
    // Interactive PTY must not inherit IDE/CI flags that strip ANSI colors.
    for (const key of Object.keys(env)) {
      if (/^(npm_config_|npm_package_|ELECTRON_|CURSOR_|VSCODE_)/i.test(key)) delete env[key]
    }
    delete env.NO_COLOR
    delete env.NODE_DISABLE_COLORS
    delete env.NODE_OPTIONS
    delete env.CI
    delete env.CONTINUOUS_INTEGRATION
    delete env.BUILD_NUMBER
    delete env.TF_BUILD
    delete env.GITHUB_ACTIONS
    delete env.GITLAB_CI
    delete env.CIRCLECI
    delete env.JENKINS_URL
    delete env.TEAMCITY_VERSION
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    env.TERM_PROGRAM = 'mys-terminal'
    env.TERM_PROGRAM_VERSION = '1'
    env.CLICOLOR = '1'
    env.CLICOLOR_FORCE = '1'
    env.FORCE_COLOR = '3'
    env.LS_COLORS = 'always'
    env.PY_COLORS = '1'
    env.LANG = env.LANG || 'en_US.UTF-8'
    env.LC_ALL = env.LC_ALL || env.LANG
    env.LC_CTYPE = env.LC_CTYPE || env.LANG
    return env
  }

  private sshColorEnv(): Record<string, string> {
    return {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'mys-terminal',
      CLICOLOR: '1',
      CLICOLOR_FORCE: '1',
      FORCE_COLOR: '3',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    }
  }

  private sshColorShell(): string {
    // Wipe CI/NO_COLOR from the remote session even when AcceptEnv ignores SSH env.
    // `sh -c` reports its PID in a private OSC first; `exec` keeps that PID for the
    // login shell, so the file panel can follow the shell's working directory.
    const inner = [
      'printf "\\033]7337;mys-pid=%s\\007" "$$";',
      'exec env',
      '-u NO_COLOR',
      '-u NODE_DISABLE_COLORS',
      '-u CI',
      '-u CONTINUOUS_INTEGRATION',
      'TERM=xterm-256color',
      'COLORTERM=truecolor',
      'TERM_PROGRAM=mys-terminal',
      'FORCE_COLOR=3',
      'CLICOLOR=1',
      'CLICOLOR_FORCE=1',
      '"$SHELL" -l',
    ].join(' ')
    return `exec sh -c '${inner}'`
  }

  private openLocal(conn: LiveConn, spec: OpenSpec): OpenResult {
    const program = spec.shell?.trim() || defaultShell()
    const cwd = spec.cwd?.trim() || homedir()
    const term = spawnPty(program, [], {
      name: 'xterm-256color',
      cols: clampDim(spec.cols, 80),
      rows: clampDim(spec.rows, 24),
      cwd,
      env: this.ptyEnv(),
    })
    this.attachPty(conn, term, cwd)
    conn.ready = true
    this.writeStartup(spec)
    return { ok: true }
  }

  /** docker exec / kubectl exec / wsl / pwsh in a local pty. */
  private async openCommand(conn: LiveConn, spec: OpenSpec, protocol: CommandProtocol): Promise<OpenResult> {
    const tool = protocol === 'docker' ? 'docker' : protocol === 'k8s' ? 'kubectl' : protocol === 'wsl' ? 'wsl' : 'pwsh'
    let binary = await which(tool)
    if (!binary && protocol === 'powershell' && isWin) binary = 'powershell.exe'
    if (!binary) return { ok: false, code: 'missing-binary', message: tr('commandMissing', { tool }) }
    const { file, args } = commandFor(protocol, spec, binary)
    const term = spawnPty(file, args, {
      name: 'xterm-256color',
      cols: clampDim(spec.cols, 80),
      rows: clampDim(spec.rows, 24),
      cwd: protocol === 'powershell' && spec.cwd?.trim() ? spec.cwd.trim() : homedir(),
      env: this.ptyEnv(),
    })
    this.attachPty(conn, term)
    conn.fileMode = 'none'
    conn.ready = true
    this.writeStartup(spec)
    return { ok: true }
  }

  private attachPty(conn: LiveConn, term: IPty, cwd?: string): void {
    conn.ptyPid = term.pid
    conn.cwd = cwd || homedir()
    conn.fileMode = conn.protocol === 'local' ? 'local' : 'none'
    term.onData((data) => this.push(conn, data))
    term.onExit(() => {
      if (!conn.disposed) this.destroy(conn, { reason: 'ended' })
    })
    this.bindIo(conn, {
      write: (data) => term.write(data),
      resize: (cols, rows) => term.resize(cols, rows),
    })
    conn.addClean(() => {
      try {
        term.kill()
      } catch {
        /* already gone */
      }
    })
  }

  private writeStartup(spec: OpenSpec): void {
    const command = spec.startupCommand?.trim()
    if (!command) return
    // ConPTY needs CR; Unix ptys and SSH accept LF.
    const eol = isWin && spec.protocol === 'local' ? '\r\n' : '\n'
    this.write(spec.instanceId, `${command.replace(/\r?\n/g, eol)}${eol}`)
  }

  private async openSsh(conn: LiveConn, spec: OpenSpec, filesOnly: boolean): Promise<OpenResult> {
    const host = assertSafeHost(spec.host || '')
    const port = portOr(spec.port, 22)
    const username = assertUser(spec.username) || localUser()
    if (!username) return { ok: false, message: tr('userRequired'), code: 'auth' }
    const auth = this.auth(spec)
    let privateKey: Buffer | undefined
    let certificate: string | undefined
    if (spec.privateKeyPath?.trim()) {
      try {
        privateKey = await fs.readFile(spec.privateKeyPath)
      } catch (error) {
        const message = error instanceof Error ? error.message : tr('keyRead')
        return { ok: false, message: tr('keyReadFailed', { message }), code: 'error' }
      }
      const certPath = certificateFor(spec.privateKeyPath, spec.certificatePath)
      if (certPath) {
        try {
          certificate = await readCertificate(certPath)
        } catch (error) {
          return { ok: false, message: explain(error, 'certInvalid'), code: 'error' }
        }
      }
    }
    if (conn.disposed) return { ok: false, message: tr('connectionClosed'), code: 'error' }
    let sock: Duplex | undefined
    try {
      sock = await this.route(conn, { ...spec, proxyPassword: auth.proxyPassword }, host, port, Boolean(spec.forceHostKey), new Set(spec.sessionId ? [spec.sessionId] : []))
    } catch (error) {
      if (error instanceof HopError) return error.result
      return { ok: false, message: explain(error, 'connectFailed'), code: 'error' }
    }
    if (conn.disposed) {
      sock?.destroy()
      return { ok: false, message: tr('connectionClosed'), code: 'error' }
    }
    const client = new Client()
    conn.ssh = client
    conn.fileMode = 'sftp'
    conn.addClean(() => client.end())
    let rejected: string | null = null

    let config: ConnectConfig
    try {
      config = this.sshConfig({
        host,
        port,
        username,
        password: auth.password,
        privateKey,
        passphrase: auth.passphrase,
        certificate,
        useAgent: spec.useAgent,
        agentForward: spec.agentForward,
      }, sock)
    } catch (error) {
      sock?.destroy()
      return { ok: false, message: explain(error, 'certInvalid'), code: 'error' }
    }
    config.hostVerifier = this.verifier(`${host}:${port}`, Boolean(spec.forceHostKey), (fingerprint) => {
      rejected = fingerprint
    })
    const x11 = spec.x11
      ? { single: false, cookie: randomBytes(16).toString('hex'), screen: 0 }
      : undefined
    if (spec.x11) {
      if (!process.env.DISPLAY) process.env.DISPLAY = ':0'
      client.on('x11', (_info, accept, reject) => {
        connectX11().then((xserver) => {
          const channel = accept()
          xserver.pipe(channel)
          channel.pipe(xserver)
          xserver.on('error', () => channel.close())
          channel.on('close', () => xserver.destroy())
        }, () => {
          try {
            reject()
          } catch {
            /* already closed */
          }
        })
      })
      if (isMac && !existsSync('/tmp/.X11-unix/X0')) {
        spawn('open', ['-a', 'XQuartz'], { detached: true, stdio: 'ignore' }).unref()
      }
    }

    const result = this.defer(conn)
    client.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
      finish(prompts.map(() => auth.password))
    })
    client.on('error', (error) => {
      const message = error.message || tr('sshError')
      if (rejected) {
        this.settle(conn, {
          ok: false,
          code: 'hostkey',
          fingerprint: rejected,
          message: tr('hostKeyChanged'),
        })
        return
      }
      const authFailed = /auth|permission denied|all configured authentication methods failed/i.test(message)
      this.settle(conn, { ok: false, message, code: authFailed ? 'auth' : 'error' })
    })
    client.on('close', () => {
      if (!conn.disposed) this.destroy(conn, { reason: 'lost' })
    })
    client.on('ready', () => {
      client.setNoDelay(true)
      client.sftp((error, sftp) => {
        if (conn.disposed) return
        if (error || !sftp) {
          if (filesOnly) this.settle(conn, { ok: false, message: error?.message || tr('sftpFailed'), code: 'error' })
          return
        }
        conn.sftp = sftp
        if (filesOnly) {
          conn.ready = true
          this.settle(conn, { ok: true })
        }
      })
      if (filesOnly) return
      const pty = {
        term: 'xterm-256color',
        cols: clampDim(spec.cols, 80),
        rows: clampDim(spec.rows, 24),
      }
      const shellOpts = {
        ...(x11 ? { x11 } : {}),
        env: this.sshColorEnv(),
      }
      const onShell = (error: Error | undefined, stream?: ClientChannel) => {
        if (error || !stream) {
          this.settle(conn, { ok: false, message: error?.message || tr('shellFailed'), code: 'error' })
          return
        }
        this.bindStream(conn, stream)
        conn.ready = true
        this.settle(conn, { ok: true })
        this.writeStartup(spec)
        void this.autoTunnels(conn, spec)
      }
      client.exec(this.sshColorShell(), { pty, ...shellOpts }, (error, stream) => {
        if (!error && stream) {
          onShell(undefined, stream)
          return
        }
        client.shell(pty, shellOpts, onShell)
      })
    })
    client.connect(config)
    client.setNoDelay(true)
    return result
  }

  private sshConfig(login: SshLogin, sock?: Duplex): ConnectConfig {
    const config: ConnectConfig = {
      host: login.host,
      port: login.port,
      username: login.username,
      readyTimeout: 20000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 4,
      tryKeyboard: true,
      hostHash: 'sha256',
    }
    if (sock) config.sock = sock as ConnectConfig['sock']
    if (login.password) config.password = login.password
    if (login.privateKey) {
      config.privateKey = login.privateKey
      if (login.passphrase) config.passphrase = login.passphrase
    }
    const agent = login.useAgent !== false ? sshAgent() : undefined
    if (agent) {
      config.agent = agent
      config.agentForward = Boolean(login.agentForward)
    }
    if (login.certificate && login.privateKey) {
      // Certificate first, then the bare key, agent, password and prompts — same order as OpenSSH.
      const certKey = certifiedKey(login.privateKey, login.passphrase || undefined, login.certificate)
      const { username, password } = login
      const methods: AnyAuthMethod[] = [
        { type: 'publickey', username, key: certKey },
        { type: 'publickey', username, key: login.privateKey, passphrase: login.passphrase || undefined },
      ]
      if (agent) methods.push({ type: 'agent', username, agent })
      if (password) {
        methods.push({ type: 'password', username, password })
        methods.push({ type: 'keyboard-interactive', username, prompt: (_n, _i, _l, prompts, finish) => finish(prompts.map(() => password)) })
      }
      config.authHandler = methods as ConnectConfig['authHandler']
    }
    return config
  }

  private verifier(hostId: string, force: boolean, onReject: (fingerprint: string) => void): ConnectConfig['hostVerifier'] {
    return ((key: Buffer | string) => {
      const fingerprint = Buffer.isBuffer(key) ? key.toString('base64') : key
      const known = this.store.knownHost(hostId)
      if (known && known !== fingerprint && !force) {
        onReject(fingerprint)
        return false
      }
      void this.store.setKnownHost(hostId, fingerprint)
      return true
    }) as ConnectConfig['hostVerifier']
  }

  /** Socket to `host:port`: through a jump session, a proxy, or `undefined` for direct TCP. */
  private async route(conn: LiveConn, route: Route, host: string, port: number, force: boolean, seen: Set<string>): Promise<Duplex | undefined> {
    if (route.jumpSessionId) return this.jump(conn, route.jumpSessionId, host, port, force, seen)
    if (route.proxyType && route.proxyType !== 'none' && route.proxyHost?.trim()) {
      const socket = await connectViaProxy({
        type: route.proxyType,
        host: assertSafeHost(route.proxyHost),
        port: portOr(route.proxyPort, route.proxyType === 'http' ? 8080 : 1080),
        user: route.proxyUser?.trim() || undefined,
        password: route.proxyPassword || undefined,
      }, host, port)
      conn.addClean(() => socket.destroy())
      return socket
    }
    return undefined
  }

  /** Log in to a saved SSH session and open a direct-tcpip channel to the next hop. */
  private async jump(conn: LiveConn, sessionId: string, host: string, port: number, force: boolean, seen: Set<string>): Promise<Duplex> {
    const hop = await this.jumpClient(conn, sessionId, force, seen)
    return forwardThrough(hop.client, hop.label, host, port)
  }

  /** Logged-in SSH client for a saved session (itself reached through its own jump/proxy). */
  private async jumpClient(conn: LiveConn, sessionId: string, force: boolean, seen: Set<string>): Promise<{ client: Client; label: string }> {
    const hop = this.store.data.sessions.find((item) => item.id === sessionId)
    if (!hop || (hop.protocol !== 'ssh' && hop.protocol !== 'sftp')) throw new Error(tr('jumpMissing'))
    if (seen.has(hop.id) || seen.size > 6) throw new Error(tr('jumpLoop'))
    seen.add(hop.id)
    const label = hop.name || hop.host
    const hopHost = assertSafeHost(hop.host)
    const hopPort = portOr(hop.port, 22)
    const secrets = this.store.secretsFor(hop.id)
    const inner = await this.route(conn, { ...hop, proxyPassword: secrets.proxyPassword }, hopHost, hopPort, force, seen)
    let privateKey: Buffer | undefined
    let certificate: string | undefined
    if (hop.privateKeyPath.trim()) {
      try {
        privateKey = await fs.readFile(hop.privateKeyPath)
        const certPath = certificateFor(hop.privateKeyPath, hop.certificatePath)
        if (certPath) certificate = await readCertificate(certPath)
      } catch (error) {
        inner?.destroy()
        throw new Error(tr('jumpFailed', { name: label, message: explain(error, 'keyRead') }))
      }
    }
    if (conn.disposed) {
      inner?.destroy()
      throw new Error(tr('connectionClosed'))
    }
    const client = new Client()
    conn.addClean(() => client.end())
    let rejected: string | null = null
    const config = this.sshConfig({
      host: hopHost,
      port: hopPort,
      username: assertUser(hop.username) || localUser(),
      password: secrets.password,
      privateKey,
      passphrase: secrets.passphrase,
      certificate,
      useAgent: hop.useAgent,
      agentForward: hop.agentForward,
    }, inner)
    config.hostVerifier = this.verifier(`${hopHost}:${hopPort}`, force, (fingerprint) => {
      rejected = fingerprint
    })
    await new Promise<void>((resolve, reject) => {
      let settled = false
      client.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
        finish(prompts.map(() => secrets.password || ''))
      })
      client.once('ready', () => {
        settled = true
        resolve()
      })
      client.on('error', (error) => {
        if (settled) return
        settled = true
        if (rejected) {
          reject(new HopError({ ok: false, code: 'hostkey', fingerprint: rejected, message: tr('jumpHostKeyChanged', { name: label }) }))
          return
        }
        reject(new Error(tr('jumpFailed', { name: label, message: error.message || tr('sshError') })))
      })
      client.on('close', () => {
        if (!settled) {
          settled = true
          reject(new Error(tr('jumpFailed', { name: label, message: tr('connectionClosed') })))
        }
      })
      client.connect(config)
    })
    return { client, label }
  }

  /**
   * For RDP/VNC behind SSH: one login to the tunnel session, then a fresh
   * direct-tcpip channel per connection to the desktop host.
   */
  private async desktopRoute(conn: LiveConn, spec: OpenSpec, host: string, port: number): Promise<(() => Promise<Duplex>) | null> {
    if (!spec.jumpSessionId) return null
    const hop = await this.jumpClient(conn, spec.jumpSessionId, Boolean(spec.forceHostKey), new Set())
    return () => forwardThrough(hop.client, hop.label, host, port)
  }

  /** 127.0.0.1 listener that relays each accepted socket through `open()` (for external RDP clients). */
  private async localRelay(conn: LiveConn, open: () => Promise<Duplex>): Promise<number> {
    const server = net.createServer((socket) => {
      socket.on('error', () => undefined)
      open().then((remote) => {
        remote.on('error', () => socket.destroy())
        socket.pipe(remote).pipe(socket)
        socket.on('close', () => remote.destroy())
      }, () => socket.destroy())
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    conn.addClean(() => server.close())
    const address = server.address()
    return typeof address === 'object' && address ? address.port : 0
  }

  private bindStream(conn: LiveConn, stream: ClientChannel): void {
    stream.on('data', (data: Buffer) => {
      if (conn.remotePid === undefined) {
        const text = data.toString('latin1')
        const match = text.match(PID_MARK)
        if (match) {
          conn.remotePid = Number(match[1])
          this.push(conn, Buffer.from(text.replace(PID_MARK, ''), 'latin1'))
          return
        }
      }
      this.push(conn, data)
    })
    stream.stderr?.on('data', (data: Buffer) => this.push(conn, data))
    // The server sends exit-status when the shell quits; a dropped link closes without it.
    let exited = false
    stream.on('exit', () => {
      exited = true
    })
    stream.on('close', () => {
      if (!conn.disposed) this.destroy(conn, { reason: exited ? 'ended' : 'lost' })
    })
    this.bindIo(conn, {
      write: (data) => stream.write(data),
      resize: (cols, rows) => stream.setWindow(rows, cols, 0, 0),
    })
    conn.addClean(() => stream.end())
  }

  private async autoTunnels(conn: LiveConn, spec: OpenSpec): Promise<void> {
    if (!conn.ssh || !spec.tunnels?.length) return
    for (const tunnel of spec.tunnels) {
      if (conn.disposed) return
      try {
        await this.tunnels.start(conn.id, conn.ssh, tunnel)
      } catch (error) {
        const message = error instanceof Error ? error.message : tr('tunnelOpenFailed')
        this.push(conn, `\r\n[tunnel ${tunnel.listenPort}] ${message}\r\n`)
      }
    }
  }

  private openTcp(conn: LiveConn, spec: OpenSpec, telnet: boolean): Promise<OpenResult> {
    const host = assertSafeHost(spec.host || '')
    const port = portOr(spec.port, telnet ? 23 : 513)
    const result = this.defer(conn)
    const socket = net.connect({ host, port })
    socket.setNoDelay(true)
    socket.setTimeout(20000)
    conn.addClean(() => socket.destroy())
    this.bindIo(conn, { write: (data) => socket.write(data) })
    socket.once('connect', () => {
      socket.setTimeout(0)
      conn.ready = true
      this.settle(conn, { ok: true })
      this.writeStartup(spec)
    })
    socket.on('data', (data: Buffer | string) => {
      const buf = typeof data === 'string' ? Buffer.from(data) : data
      this.push(conn, telnet ? filterTelnet(buf, socket, clampDim(spec.cols, 80), clampDim(spec.rows, 24)) : buf)
    })
    socket.once('timeout', () => this.settle(conn, { ok: false, message: tr('timeout'), code: 'error' }))
    socket.once('error', (error) => this.settle(conn, { ok: false, message: error.message, code: 'error' }))
    socket.once('close', (hadError) => {
      if (!conn.disposed) this.destroy(conn, { reason: hadError ? 'lost' : 'ended' })
    })
    return result
  }

  private async openSerial(conn: LiveConn, spec: OpenSpec): Promise<OpenResult> {
    const device = serialDevice(spec.serialPath || '')
    if (!device) return { ok: false, message: tr('serialPath'), code: 'error' }
    const baud = Number(spec.baudRate) || 115200
    if (isWin) return this.openSerialWindows(conn, device, baud, spec)
    const flag = process.platform === 'darwin' ? '-f' : '-F'
    const args = [flag, device, String(baud), spec.dataBits === 7 ? 'cs7' : 'cs8']
    if (spec.stopBits === 2) args.push('cstopb')
    else args.push('-cstopb')
    if (spec.parity === 'even') args.push('parenb', '-parodd')
    else if (spec.parity === 'odd') args.push('parenb', 'parodd')
    else args.push('-parenb')
    args.push('raw', '-echo', 'clocal')
    await new Promise<void>((resolve, reject) => {
      execFile('stty', args, (error) => (error ? reject(new Error(`stty: ${error.message}`)) : resolve()))
    })
    const handle = await fs.open(device, 'r+')
    conn.addClean(() => {
      void handle.close().catch(() => undefined)
    })
    const result = this.defer(conn)
    this.bindIo(conn, {
      write: (data) => {
        void handle.write(Buffer.from(data)).catch(() => undefined)
      },
    })
    conn.ready = true
    this.settle(conn, { ok: true })
    const loop = async () => {
      const buf = Buffer.alloc(4096)
      while (!conn.disposed) {
        try {
          const { bytesRead } = await handle.read(buf, 0, buf.length, null)
          if (bytesRead > 0) this.push(conn, Buffer.from(buf.subarray(0, bytesRead)))
        } catch {
          if (!conn.disposed) this.destroy(conn, { reason: 'lost' })
          break
        }
      }
    }
    void loop()
    return result
  }

  /**
   * Windows COM ports block reads and writes on one synchronous handle, so a small
   * PowerShell bridge owns the port through System.IO.Ports and relays raw stdio.
   */
  private openSerialWindows(conn: LiveConn, device: string, baud: number, spec: OpenSpec): Promise<OpenResult> {
    const port = device.replace(/^\\\\\.\\/, '')
    const parity = spec.parity === 'even' ? 'Even' : spec.parity === 'odd' ? 'Odd' : 'None'
    const stop = spec.stopBits === 2 ? 'Two' : 'One'
    const data = spec.dataBits === 7 ? 7 : 8
    const script = [
      '$ErrorActionPreference = "Stop"',
      `$p = New-Object System.IO.Ports.SerialPort "${port}", ${baud}, ([System.IO.Ports.Parity]::${parity}), ${data}, ([System.IO.Ports.StopBits]::${stop})`,
      '$p.DtrEnable = $true; $p.RtsEnable = $true; $p.Open()',
      '[Console]::Error.WriteLine("open"); [Console]::Error.Flush()',
      '$in = [Console]::OpenStandardInput(); $out = [Console]::OpenStandardOutput()',
      '$ib = New-Object byte[] 4096; $ob = New-Object byte[] 4096',
      '$task = $in.ReadAsync($ib, 0, 4096)',
      'while ($true) {',
      '  $n = $p.BytesToRead',
      '  if ($n -gt 0) { $r = $p.Read($ob, 0, [Math]::Min(4096, $n)); $out.Write($ob, 0, $r); $out.Flush() }',
      '  if ($task.IsCompleted) { $r = $task.Result; if ($r -le 0) { break }; $p.Write($ib, 0, $r); $task = $in.ReadAsync($ib, 0, 4096) }',
      '  elseif ($n -le 0) { Start-Sleep -Milliseconds 8 }',
      '}',
      '$p.Close()',
    ].join('\n')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const result = this.defer(conn)
    let opened = false
    let errors = ''
    conn.addClean(() => {
      try {
        child.stdin?.end()
        child.kill()
      } catch {
        /* already gone */
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (!opened && text.includes('open')) {
        opened = true
        this.bindIo(conn, { write: (value) => child.stdin?.write(Buffer.from(value)) })
        conn.ready = true
        this.settle(conn, { ok: true })
        return
      }
      errors += text
    })
    child.stdout?.on('data', (chunk: Buffer) => this.push(conn, chunk))
    child.once('error', (error) => this.settle(conn, { ok: false, message: error.message, code: 'error' }))
    child.once('exit', () => {
      const message = errors.split(/\r?\n/).find((line) => line.trim()) || tr('connectionClosed')
      this.settle(conn, { ok: false, message, code: 'error' })
      if (!conn.disposed) this.destroy(conn, { reason: 'lost' })
    })
    return result
  }

  private async openFtp(conn: LiveConn, spec: OpenSpec): Promise<OpenResult> {
    const host = assertSafeHost(spec.host || '')
    const port = portOr(spec.port, spec.ftpSecure === 'implicit' ? 990 : 21)
    const auth = this.auth(spec)
    const ftp = new FtpClient(20000)
    conn.ftp = ftp
    conn.fileMode = 'ftp'
    conn.addClean(() => ftp.close())
    await ftp.access({
      host,
      port,
      user: spec.username?.trim() || 'anonymous',
      password: auth.password || 'mys-terminal',
      secure: spec.ftpSecure === 'implicit' ? 'implicit' : spec.ftpSecure === 'explicit',
    })
    conn.ready = true
    return { ok: true }
  }

  private async openS3(conn: LiveConn, spec: OpenSpec): Promise<OpenResult> {
    const bucket = (spec.host || '').trim()
    const accessKey = (spec.username || '').trim()
    if (!bucket || !accessKey) return { ok: false, message: tr('requiredFields'), code: 'error' }
    const auth = this.auth(spec)
    if (!auth.password) return { ok: false, message: tr('requiredFields'), code: 'auth' }
    const s3 = s3Auth({
      bucket,
      region: spec.domain,
      accessKey,
      secretKey: auth.password,
      endpoint: spec.url,
    })
    conn.s3 = s3
    conn.fileMode = 's3'
    conn.addClean(() => {
      conn.s3 = undefined
    })
    try {
      await s3List(s3, '/')
    } catch (error) {
      const message = error instanceof Error ? error.message : tr('s3Failed')
      return { ok: false, message, code: 'error' }
    }
    conn.ready = true
    return { ok: true }
  }

  private async openMosh(conn: LiveConn, spec: OpenSpec): Promise<OpenResult> {
    const mosh = await which('mosh')
    if (!mosh) {
      return {
        ok: false,
        code: 'missing-binary',
        message: tr('moshMissing'),
      }
    }
    const host = assertSafeHost(spec.host || '')
    const port = portOr(spec.port, 22)
    const username = assertUser(spec.username)
    if (!username) return { ok: false, message: tr('userRequired'), code: 'auth' }
    const key = spec.privateKeyPath?.trim() || ''
    if (key && /["$`\\\n]/.test(key)) return { ok: false, message: tr('moshKeyPath'), code: 'error' }
    const sshArg = `ssh -p ${port} -o StrictHostKeyChecking=accept-new${key ? ` -i "${key}"` : ''}${spec.agentForward ? ' -A' : ''}`
    const term = spawnPty(mosh, [`--ssh=${sshArg}`, `${username}@${host}`], {
      name: 'xterm-256color',
      cols: clampDim(spec.cols, 80),
      rows: clampDim(spec.rows, 24),
      cwd: homedir(),
      env: this.ptyEnv(),
    })
    this.attachPty(conn, term)
    conn.fileMode = 'none'
    conn.ready = true
    return { ok: true }
  }

  private async openVnc(conn: LiveConn, spec: OpenSpec): Promise<OpenResult> {
    const host = assertSafeHost(spec.host || '')
    const port = portOr(spec.port, 5900)
    const auth = this.auth(spec)
    let route: (() => Promise<Duplex>) | null
    try {
      route = await this.desktopRoute(conn, spec, host, port)
    } catch (error) {
      if (error instanceof HopError) return error.result
      return { ok: false, message: explain(error, 'connectFailed'), code: 'error' }
    }
    const proxy = await startVncProxy(route ?? (async () => net.connect(port, host)))
    conn.addClean(() => proxy.close())
    conn.ready = true
    return { ok: true, vncListen: proxy.port, vncPassword: auth.password }
  }

  private async openRdp(conn: LiveConn, spec: OpenSpec): Promise<OpenResult> {
    let host = assertSafeHost(spec.host || '')
    let port = portOr(spec.port, 3389)
    try {
      const route = await this.desktopRoute(conn, spec, host, port)
      if (route) {
        // External RDP clients need a TCP address: point them at a local relay into the tunnel.
        port = await this.localRelay(conn, route)
        host = '127.0.0.1'
      }
    } catch (error) {
      if (error instanceof HopError) return error.result
      return { ok: false, message: explain(error, 'connectFailed'), code: 'error' }
    }
    const auth = this.auth(spec)
    const user = assertUser(spec.username)
    const domain = (spec.domain?.trim() || '').replace(/[^\w.-]/g, '')
    const freerdp = await findFreerdp()
    if (freerdp) {
      // tofu pins the server certificate on first use instead of ignoring it.
      const args = [`/v:${host}:${port}`, '/cert:tofu', '/dynamic-resolution', '/network:auto', '+auto-reconnect']
      if (user) args.push(`/u:${user}`)
      if (domain) args.push(`/d:${domain}`)
      if (spec.rdpFullscreen) args.push('/f')
      args.push(spec.rdpClipboard === false ? '-clipboard' : '+clipboard')
      if (spec.rdpShareHome) args.push(`/drive:home,${homedir()}`)
      // The password goes in on stdin, never argv, so `ps` cannot read it.
      if (auth.password) args.push('/from-stdin')
      const child = spawn(freerdp, args, { stdio: [auth.password ? 'pipe' : 'ignore', 'ignore', 'ignore'] })
      if (auth.password && child.stdin) {
        const answers = [...(user ? [] : ['']), ...(domain ? [] : ['']), auth.password]
        child.stdin.on('error', () => undefined)
        child.stdin.end(`${answers.join('\n')}\n`)
      }
      const started = await new Promise<string | null>((resolve) => {
        child.once('error', (error) => resolve(error.message))
        child.once('spawn', () => resolve(null))
      })
      if (started) return { ok: false, message: started, code: 'missing-binary' }
      child.once('exit', () => {
        if (!conn.disposed) this.destroy(conn, { reason: 'ended' })
      })
      conn.addClean(() => {
        try {
          child.kill()
        } catch {
          /* window owns the process */
        }
      })
      conn.ready = true
      return { ok: true, detail: tr('freerdpOpened') }
    }

    const app = findRdpApp()
    if (!app) {
      return { ok: false, message: tr(isMac ? 'rdpMissing' : 'rdpMissingLinux'), code: 'missing-binary' }
    }

    const lines = [
      `full address:s:${host}:${port}`,
      'prompt for credentials:i:1',
      'authentication level:i:2',
      'negotiate security layer:i:1',
      `screen mode id:i:${spec.rdpFullscreen ? 2 : 1}`,
      'dynamic resolution:i:1',
      `redirectclipboard:i:${spec.rdpClipboard === false ? 0 : 1}`,
    ]
    if (spec.rdpShareHome) lines.push('drivestoredirect:s:*')
    if (user) lines.push(`username:s:${domain ? `${domain}\\${user}` : user}`)
    if (domain) lines.push(`domain:s:${domain}`)
    const dir = join(homedir(), '.mys-terminal')
    await fs.mkdir(dir, { recursive: true })
    const file = join(dir, `rdp-${randomUUID()}.rdp`)
    await fs.writeFile(file, `${lines.join('\r\n')}\r\n`, 'utf8')
    conn.addClean(() => {
      void fs.unlink(file).catch(() => undefined)
    })

    const ok = await new Promise<boolean>((resolve) => {
      const child = isWin
        ? spawn('mstsc', [file], { detached: true, stdio: 'ignore' })
        : spawn('open', ['-a', app, file], { detached: true, stdio: 'ignore' })
      let settled = false
      const done = (value: boolean) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      child.once('error', () => done(false))
      child.once('exit', (code) => done(code === 0 || code === null))
      child.unref()
      setTimeout(() => done(true), 1200)
    })
    if (!ok) return { ok: false, message: tr(isMac ? 'rdpMissing' : 'rdpMissingLinux'), code: 'missing-binary' }
    conn.ready = true
    return { ok: true, detail: tr(isWin ? 'rdpSentWin' : 'rdpSent') }
  }
}

function clampDim(value: number | undefined, fallback: number): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 2) return fallback
  return Math.min(500, n)
}

function portOr(value: number | undefined, fallback: number): number {
  const port = Number(value ?? fallback)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid-port')
  return port
}

function filterTelnet(buf: Buffer, socket: net.Socket, cols: number, rows: number): Buffer {
  const out: number[] = []
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] !== IAC) {
      out.push(buf[i])
      continue
    }
    const cmd = buf[i + 1]
    if (cmd === undefined) break
    if (cmd === IAC) {
      out.push(255)
      i += 1
      continue
    }
    if (cmd === WILL || cmd === WONT || cmd === DO || cmd === DONT) {
      const opt = buf[i + 2]
      if (opt === undefined) break
      if (cmd === WILL) socket.write(Buffer.from([IAC, opt === 1 || opt === 3 ? DO : DONT, opt]))
      else if (cmd === DO) {
        const accept = opt === 3 || opt === 31
        socket.write(Buffer.from([IAC, accept ? WILL : WONT, opt]))
        if (accept && opt === 31) {
          socket.write(Buffer.from([IAC, SB, 31, cols >> 8, cols & 255, rows >> 8, rows & 255, IAC, SE]))
        }
      } else if (cmd === WONT) socket.write(Buffer.from([IAC, DONT, opt]))
      else socket.write(Buffer.from([IAC, WONT, opt]))
      i += 2
      continue
    }
    if (cmd === SB) {
      const end = buf.indexOf(SE, i + 2)
      if (end < 0) break
      i = end
      continue
    }
    i += 1
  }
  return Buffer.from(out)
}

function forwardThrough(client: Client, label: string, host: string, port: number): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (error, stream) => {
      if (error || !stream) reject(new Error(tr('jumpFailed', { name: label, message: error?.message || tr('connectFailed') })))
      else resolve(stream)
    })
  })
}

/** WebSocket ↔ TCP bridge for noVNC; `open` makes the TCP side (direct or through SSH). */
function startVncProxy(open: () => Promise<Duplex>): Promise<{ port: number; close: () => void }> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  return new Promise((resolve, reject) => {
    wss.once('error', reject)
    wss.once('listening', () => {
      const address = wss.address()
      const listen = typeof address === 'object' && address ? address.port : 0
      resolve({
        port: listen,
        close: () => wss.close(),
      })
    })
    wss.on('connection', (ws) => {
      let socket: Duplex | null = null
      let closed = false
      const early: Buffer[] = []
      const closeBoth = () => {
        closed = true
        socket?.destroy()
        if (ws.readyState === ws.OPEN) ws.close()
      }
      ws.on('message', (data: RawData) => {
        const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
        if (socket && !socket.destroyed) socket.write(buf)
        else if (!socket) early.push(buf)
      })
      ws.on('close', () => {
        closed = true
        socket?.destroy()
      })
      ws.on('error', closeBoth)
      open().then((stream) => {
        if (closed) {
          stream.destroy()
          return
        }
        socket = stream
        for (const buf of early.splice(0)) stream.write(buf)
        stream.on('data', (data: Buffer) => {
          if (ws.readyState === ws.OPEN) ws.send(data)
        })
        stream.on('error', closeBoth)
        stream.on('close', () => {
          if (ws.readyState === ws.OPEN) ws.close()
        })
      }, closeBoth)
    })
  })
}

export { capabilities } from './which'

function localClientInfo(): { host: string; ip: string } {
  const host = hostname() || ''
  let ip = ''
  try {
    const nets = networkInterfaces()
    for (const rows of Object.values(nets)) {
      if (!rows) continue
      for (const row of rows) {
        if (row.internal || row.family !== 'IPv4') continue
        ip = row.address
        break
      }
      if (ip) break
    }
  } catch {
    /* ignore */
  }
  return { host, ip }
}
