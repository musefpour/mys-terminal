import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { Client as FtpClient, type FileInfo } from 'basic-ftp'
import type { FileEntry as SftpEntry, SFTPWrapper } from 'ssh2'
import type { FileEntry } from '../shared/types'
import { tr } from './i18n'
import type { LiveConn } from './live'
import { s3Copy, s3Delete, s3Get, s3Key, s3Keys, s3List, s3Put } from './s3'

const MAX_READ = 1_500_000
export const MAX_FILES = 4000

export type ProgressFn = (label: string, transferred: number, total: number) => void

export async function listFiles(conn: LiveConn, requested?: string): Promise<{ path: string; entries: FileEntry[] }> {
  if (conn.fileMode === 'sftp' && !conn.sftp) throw new Error('sftp-not-ready')
  if (conn.fileMode === 'sftp' && conn.sftp) {
    let dir = requested || (await remoteCwd(conn)) || (await sftpRealpath(conn.sftp, '.'))
    let list: SftpEntry[]
    try {
      list = await sftpReaddir(conn.sftp, dir)
    } catch (error) {
      // The shell's directory may be unreadable over SFTP (chroot, permissions): start at home.
      if (requested) throw error
      dir = await sftpRealpath(conn.sftp, '.')
      list = await sftpReaddir(conn.sftp, dir)
    }
    return { path: dir, entries: list.filter((item) => item.filename !== '.' && item.filename !== '..').map(fromSftp).sort(sortEntries) }
  }
  if (conn.fileMode === 'ftp' && conn.ftp) {
    const dir = requested || (await conn.ftp.pwd())
    const list = await conn.ftp.list(dir)
    return { path: dir, entries: list.filter((item) => item.name !== '.' && item.name !== '..').map(fromFtp).sort(sortEntries) }
  }
  if (conn.fileMode === 's3' && conn.s3) {
    return s3List(conn.s3, requested || '/')
  }
  if (conn.fileMode === 'local') {
    const dir = requested || conn.cwd || homedir()
    if (conn.ptyPid && !requested) {
      const cwd = await pidCwd(conn.ptyPid)
      if (cwd) conn.cwd = cwd
    }
    const finalDir = requested || conn.cwd || homedir()
    const names = await fs.readdir(finalDir, { withFileTypes: true })
    const entries: FileEntry[] = []
    for (const name of names) {
      if (name.name === '.' || name.name === '..') continue
      try {
        const stat = await fs.lstat(path.join(finalDir, name.name))
        entries.push({
          name: name.name,
          size: stat.size,
          mtime: stat.mtimeMs,
          isDir: stat.isDirectory(),
          isLink: stat.isSymbolicLink(),
          mode: (stat.mode & 0o777).toString(8),
        })
      } catch {
        entries.push({ name: name.name, size: 0, mtime: 0, isDir: name.isDirectory(), isLink: name.isSymbolicLink(), mode: '' })
      }
    }
    return { path: finalDir, entries: entries.sort(sortEntries) }
  }
  throw new Error(tr('noFileBrowser'))
}

export async function mkdirPath(conn: LiveConn, dir: string): Promise<void> {
  assertPath(dir)
  if (conn.fileMode === 'sftp' && conn.sftp) {
    await call((cb) => conn.sftp!.mkdir(dir, cb))
    return
  }
  if (conn.fileMode === 'ftp' && conn.ftp) {
    await conn.ftp.ensureDir(dir)
    return
  }
  if (conn.fileMode === 's3' && conn.s3) {
    const key = s3Key(dir)
    if (!key) return
    await s3Put(conn.s3, `${key}/`, Buffer.alloc(0))
    return
  }
  await fs.mkdir(dir, { recursive: true })
}

export async function removePath(conn: LiveConn, target: string, isDir: boolean): Promise<void> {
  assertPath(target)
  if (conn.fileMode === 'sftp' && conn.sftp) {
    if (isDir) await sftpRemoveTree(conn.sftp, target, { count: 0 })
    else await call((cb) => conn.sftp!.unlink(target, cb))
    return
  }
  if (conn.fileMode === 'ftp' && conn.ftp) {
    if (isDir) await conn.ftp.removeDir(target)
    else await conn.ftp.remove(target)
    return
  }
  if (conn.fileMode === 's3' && conn.s3) {
    const key = s3Key(target)
    if (isDir) {
      const prefix = key ? `${key}/` : ''
      const keys = await s3Keys(conn.s3, prefix)
      for (const item of keys) await s3Delete(conn.s3, item)
      if (key) {
        try { await s3Delete(conn.s3, `${key}/`) } catch { /* no placeholder */ }
      }
      return
    }
    await s3Delete(conn.s3, key)
    return
  }
  await fs.rm(target, { recursive: isDir, force: false })
}

export async function renamePath(conn: LiveConn, from: string, to: string): Promise<void> {
  assertPath(from)
  assertPath(to)
  if (conn.fileMode === 'sftp' && conn.sftp) {
    await call((cb) => conn.sftp!.rename(from, to, cb))
    return
  }
  if (conn.fileMode === 'ftp' && conn.ftp) {
    await conn.ftp.rename(from, to)
    return
  }
  if (conn.fileMode === 's3' && conn.s3) {
    const src = s3Key(from)
    const dest = s3Key(to)
    const keys = await s3Keys(conn.s3, src)
    const isPrefix = keys.some((item) => item === `${src}/` || item.startsWith(`${src}/`))
    if (isPrefix || keys.length > 1 || (keys.length === 1 && keys[0] !== src)) {
      const prefix = src.endsWith('/') ? src : `${src}/`
      const all = keys.length ? keys : await s3Keys(conn.s3, prefix)
      for (const item of all) {
        const next = dest + item.slice(src.length)
        await s3Copy(conn.s3, item, next.startsWith('/') ? next.slice(1) : next)
        await s3Delete(conn.s3, item)
      }
      return
    }
    await s3Copy(conn.s3, src, dest)
    await s3Delete(conn.s3, src)
    return
  }
  await fs.rename(from, to)
}

export async function chmodPath(conn: LiveConn, target: string, mode: string): Promise<void> {
  assertPath(target)
  const octal = mode.trim()
  if (!/^[0-7]{3,4}$/.test(octal)) throw new Error(tr('invalidMode'))
  const value = parseInt(octal, 8)
  if (conn.fileMode === 'sftp' && conn.sftp) {
    await call((cb) => conn.sftp!.chmod(target, value, cb))
    return
  }
  if (conn.fileMode === 'ftp' && conn.ftp) {
    if (/[\r\n]/.test(target)) throw new Error(tr('invalidPath'))
    await conn.ftp.send(`SITE CHMOD ${octal} ${target}`)
    return
  }
  if (conn.fileMode === 'local') {
    await fs.chmod(target, value)
    return
  }
  throw new Error(tr('chmodUnsupported'))
}

/** Working directory of the shell behind this tab, when it can be known. */
export async function terminalCwd(conn: LiveConn): Promise<string | null> {
  if (conn.fileMode === 'local' && conn.ptyPid) return pidCwd(conn.ptyPid)
  if (conn.fileMode === 'sftp') return remoteCwd(conn)
  return null
}

export async function readText(conn: LiveConn, target: string): Promise<{ content: string } | { binary: true; size: number }> {
  assertPath(target)
  if (conn.fileMode === 'sftp' && conn.sftp) {
    const stat = await sftpStat(conn.sftp, target)
    if (stat.size > MAX_READ) return { binary: true, size: stat.size }
    const buf = await sftpReadFile(conn.sftp, target)
    if (buf.includes(0)) return { binary: true, size: buf.length }
    return { content: buf.toString('utf8') }
  }
  if (conn.fileMode === 'ftp' && conn.ftp) {
    const chunks: Buffer[] = []
    let size = 0
    const sink = new Writable({
      write(chunk, _enc, callback) {
        const buf = Buffer.from(chunk)
        size += buf.length
        if (size <= MAX_READ) chunks.push(buf)
        callback()
      },
    })
    await conn.ftp.downloadTo(sink, target)
    if (size > MAX_READ) return { binary: true, size }
    const buf = Buffer.concat(chunks)
    if (buf.includes(0)) return { binary: true, size }
    return { content: buf.toString('utf8') }
  }
  if (conn.fileMode === 's3' && conn.s3) {
    const buf = await s3Get(conn.s3, s3Key(target))
    if (buf.length > MAX_READ) return { binary: true, size: buf.length }
    if (buf.includes(0)) return { binary: true, size: buf.length }
    return { content: buf.toString('utf8') }
  }
  const stat = await fs.stat(target)
  if (stat.size > MAX_READ) return { binary: true, size: stat.size }
  const buf = await fs.readFile(target)
  if (buf.includes(0)) return { binary: true, size: buf.length }
  return { content: buf.toString('utf8') }
}

export async function writeText(conn: LiveConn, target: string, content: string): Promise<void> {
  assertPath(target)
  const buf = Buffer.from(content, 'utf8')
  if (conn.fileMode === 'sftp' && conn.sftp) {
    await call((cb) => conn.sftp!.writeFile(target, buf, cb))
    return
  }
  if (conn.fileMode === 'ftp' && conn.ftp) {
    await conn.ftp.uploadFrom(Readable.from(buf), target)
    return
  }
  if (conn.fileMode === 's3' && conn.s3) {
    await s3Put(conn.s3, s3Key(target), buf, 'text/plain; charset=utf-8')
    return
  }
  await fs.writeFile(target, buf)
}

export async function uploadPaths(conn: LiveConn, dir: string, locals: string[], progress?: ProgressFn): Promise<void> {
  assertPath(dir)
  let count = 0
  for (const local of locals) {
    const stat = await fs.stat(local)
    if (stat.isDirectory()) await uploadDir(conn, local, joinRemote(conn, dir, path.basename(local)), progress, () => count++)
    else {
      count += 1
      if (count > MAX_FILES) throw new Error(tr('tooManyFiles'))
      await uploadOne(conn, local, joinRemote(conn, dir, path.basename(local)), stat.size, progress)
    }
  }
}

export async function downloadEntry(
  conn: LiveConn,
  remote: string,
  dest: string,
  isDir: boolean,
  progress?: ProgressFn,
): Promise<void> {
  assertPath(remote)
  if (conn.fileMode === 'local') {
    await fs.cp(remote, dest, { recursive: isDir })
    return
  }
  if (isDir) await downloadDir(conn, remote, dest, progress, { count: 0 })
  else await downloadOne(conn, remote, dest, progress)
}

export async function uploadFileTo(conn: LiveConn, local: string, remote: string, progress?: ProgressFn): Promise<void> {
  assertPath(remote)
  const stat = await fs.stat(local)
  await uploadOne(conn, local, remote, stat.size, progress)
}

async function uploadOne(conn: LiveConn, local: string, remote: string, size: number, progress?: ProgressFn): Promise<void> {
  progress?.(path.basename(local), 0, size)
  if (conn.fileMode === 'sftp' && conn.sftp) {
    await new Promise<void>((resolve, reject) => {
      conn.sftp!.fastPut(local, remote, {
        step: (transferred, _chunk, total) => progress?.(path.basename(local), transferred, total),
      }, (error) => (error ? reject(error) : resolve()))
    })
    return
  }
  if (conn.fileMode === 'ftp' && conn.ftp) {
    conn.ftp.trackProgress((info) => progress?.(info.name, info.bytes, info.bytesOverall || size))
    try {
      await conn.ftp.uploadFrom(local, remote)
    } finally {
      conn.ftp.trackProgress()
    }
    return
  }
  if (conn.fileMode === 's3' && conn.s3) {
    const data = await fs.readFile(local)
    progress?.(path.basename(local), 0, size)
    await s3Put(conn.s3, s3Key(remote), data)
    progress?.(path.basename(local), size, size)
    return
  }
  await fs.copyFile(local, remote)
  progress?.(path.basename(local), size, size)
}

async function uploadDir(conn: LiveConn, local: string, remote: string, progress: ProgressFn | undefined, tick: () => void): Promise<void> {
  await mkdirPath(conn, remote)
  const names = await fs.readdir(local, { withFileTypes: true })
  for (const name of names) {
    const from = path.join(local, name.name)
    const to = joinRemote(conn, remote, name.name)
    if (name.isDirectory()) await uploadDir(conn, from, to, progress, tick)
    else {
      tick()
      const stat = await fs.stat(from)
      await uploadOne(conn, from, to, stat.size, progress)
    }
  }
}

async function downloadOne(conn: LiveConn, remote: string, dest: string, progress?: ProgressFn): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true })
  if (conn.fileMode === 'sftp' && conn.sftp) {
    const stat = await sftpStat(conn.sftp, remote)
    await new Promise<void>((resolve, reject) => {
      conn.sftp!.fastGet(remote, dest, {
        step: (transferred, _chunk, total) => progress?.(path.basename(remote), transferred, total || stat.size),
      }, (error) => (error ? reject(error) : resolve()))
    })
    return
  }
  if (conn.fileMode === 'ftp' && conn.ftp) {
    conn.ftp.trackProgress((info) => progress?.(info.name, info.bytes, info.bytesOverall))
    try {
      await conn.ftp.downloadTo(dest, remote)
    } finally {
      conn.ftp.trackProgress()
    }
    return
  }
  if (conn.fileMode === 's3' && conn.s3) {
    const data = await s3Get(conn.s3, s3Key(remote))
    progress?.(path.basename(remote), 0, data.length)
    await fs.writeFile(dest, data)
    progress?.(path.basename(remote), data.length, data.length)
  }
}

async function downloadDir(
  conn: LiveConn,
  remote: string,
  dest: string,
  progress: ProgressFn | undefined,
  state: { count: number },
): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  if (conn.fileMode === 'ftp' && conn.ftp) {
    await conn.ftp.downloadToDir(dest, remote)
    return
  }
  if (conn.fileMode === 's3' && conn.s3) {
    const prefix = s3Key(remote)
    const keys = await s3Keys(conn.s3, prefix ? `${prefix}/` : '')
    for (const key of keys) {
      if (key.endsWith('/')) continue
      state.count += 1
      if (state.count > MAX_FILES) throw new Error(tr('tooManyFiles'))
      const relative = key.slice(prefix ? prefix.length + 1 : 0)
      const to = path.join(dest, ...relative.split('/'))
      await downloadOne(conn, `/${key}`, to, progress)
    }
    return
  }
  if (!conn.sftp) return
  const list = await sftpReaddir(conn.sftp, remote)
  for (const item of list) {
    if (item.filename === '.' || item.filename === '..') continue
    state.count += 1
    if (state.count > MAX_FILES) throw new Error(tr('tooManyFiles'))
    const from = path.posix.join(remote, item.filename)
    const to = path.join(dest, item.filename)
    if (isDirMode(item.attrs.mode)) await downloadDir(conn, from, to, progress, state)
    else if (!isLinkMode(item.attrs.mode)) await downloadOne(conn, from, to, progress)
  }
}

function fromSftp(item: SftpEntry): FileEntry {
  return {
    name: item.filename,
    size: item.attrs.size,
    mtime: (item.attrs.mtime || 0) * 1000,
    isDir: isDirMode(item.attrs.mode),
    isLink: isLinkMode(item.attrs.mode),
    mode: item.attrs.mode.toString(8),
  }
}

function fromFtp(item: FileInfo): FileEntry {
  return {
    name: item.name,
    size: item.size,
    mtime: item.modifiedAt?.getTime?.() ?? 0,
    isDir: item.isDirectory,
    isLink: item.isSymbolicLink,
    mode: ftpMode(item.permissions),
  }
}

function ftpMode(perms?: { user: number; group: number; world: number }): string {
  if (!perms) return ''
  const bit = (value: number) => `${value & 4 ? 'r' : '-'}${value & 2 ? 'w' : '-'}${value & 1 ? 'x' : '-'}`
  return `${bit(perms.user)}${bit(perms.group)}${bit(perms.world)}`
}

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

export function isDirMode(mode: number): boolean {
  return (mode & S_IFMT) === S_IFDIR
}

export function isLinkMode(mode: number): boolean {
  return (mode & S_IFMT) === S_IFLNK
}

function sortEntries(a: FileEntry, b: FileEntry): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
  return a.name.localeCompare(b.name)
}

export function joinRemote(conn: LiveConn, dir: string, name: string): string {
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) throw new Error(tr('invalidFileName'))
  if (conn.fileMode === 'local') return path.join(dir, name)
  return path.posix.join(dir === '/' ? '/' : dir, name)
}

function assertPath(value: string): void {
  if (!value || value.includes('\0')) throw new Error(tr('invalidPath'))
}

function call(fn: (cb: (error: Error | null | undefined) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    fn((error) => (error ? reject(error) : resolve()))
  })
}

export function sftpReaddir(sftp: SFTPWrapper, dir: string): Promise<SftpEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(dir, (error, list) => (error ? reject(error) : resolve(list)))
  })
}

function sftpRealpath(sftp: SFTPWrapper, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.realpath(target, (error, resolved) => (error ? reject(error) : resolve(resolved)))
  })
}

export function sftpStat(sftp: SFTPWrapper, target: string): Promise<{ size: number }> {
  return new Promise((resolve, reject) => {
    sftp.stat(target, (error, stats) => (error ? reject(error) : resolve(stats)))
  })
}

function sftpReadFile(sftp: SFTPWrapper, target: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(target, (error, data) => (error ? reject(error) : resolve(data)))
  })
}

async function sftpRemoveTree(sftp: SFTPWrapper, dir: string, state: { count: number }): Promise<void> {
  const list = await sftpReaddir(sftp, dir)
  for (const item of list) {
    if (item.filename === '.' || item.filename === '..') continue
    state.count += 1
    if (state.count > MAX_FILES * 5) throw new Error(tr('tooManyFiles'))
    const child = path.posix.join(dir, item.filename)
    if (isDirMode(item.attrs.mode)) await sftpRemoveTree(sftp, child, state)
    else await call((cb) => sftp.unlink(child, cb))
  }
  await call((cb) => sftp.rmdir(dir, cb))
}

/** Ask the SSH server where the login shell currently is (Linux /proc, else lsof). */
function remoteCwd(conn: LiveConn): Promise<string | null> {
  const pid = conn.remotePid
  const ssh = conn.ssh
  if (!ssh || !pid || conn.disposed) return Promise.resolve(null)
  const command = `readlink /proc/${pid}/cwd 2>/dev/null || lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'`
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (value: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), 4000)
    try {
      ssh.exec(command, (error, stream) => {
        if (error || !stream) {
          finish(null)
          return
        }
        stream.on('data', (chunk: Buffer) => {
          if (out.length < 4096) out += chunk.toString('utf8')
        })
        stream.stderr?.resume()
        stream.on('close', () => {
          const line = out.split('\n')[0]?.trim() || ''
          finish(line.startsWith('/') ? line : null)
        })
      })
    } catch {
      finish(null)
    }
  })
}

async function pidCwd(pid: number): Promise<string | null> {
  if (process.platform === 'win32') return null
  if (process.platform === 'linux') {
    try {
      return await fs.readlink(`/proc/${pid}/cwd`)
    } catch {
      return null
    }
  }
  return new Promise((resolve) => {
    const child = spawn('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('error', () => resolve(null))
    child.on('close', () => {
      const line = out.split('\n').find((item) => item.startsWith('n'))
      resolve(line ? line.slice(1) : null)
    })
  })
}

export async function listSerialPorts(): Promise<string[]> {
  if (process.platform === 'win32') return listComPorts()
  try {
    const names = await fs.readdir('/dev')
    return names
      .filter((name) => /^(cu\.|ttyUSB|ttyACM|tty\.usb|ttyS|ttyAMA|rfcomm)/.test(name))
      .map((name) => path.join('/dev', name))
      .sort()
  } catch {
    return []
  }
}

function listComPorts(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '[System.IO.Ports.SerialPort]::GetPortNames() -join "`n"'],
      { windowsHide: true, timeout: 8000 },
      (error, stdout) => {
        if (error) {
          resolve([])
          return
        }
        const ports = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^COM\d+$/i.test(line))
        resolve([...new Set(ports)].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3))))
      },
    )
  })
}
