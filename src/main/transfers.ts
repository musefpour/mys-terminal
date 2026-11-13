import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Transform, type Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { TransferInfo } from '../shared/types'
import { isDirMode, isLinkMode, joinRemote, MAX_FILES, mkdirPath, sftpReaddir, sftpStat } from './files'
import { explain, tr } from './i18n'
import type { LiveConn } from './live'
import { s3Get, s3Key, s3Keys, s3Put } from './s3'

interface Job extends TransferInfo {
  abort: AbortController | null
  /** What the user asked for while the job was running. */
  stopAs: 'paused' | 'canceled' | null
  sampleAt: number
  sampleBytes: number
}

interface PlannedFile {
  local: string
  remote: string
  size: number
}

const EMIT_EVERY = 250

/**
 * One queue per connection, one file at a time: SFTP shares a single channel and
 * a steady sequential stream beats parallel writes on most servers.
 */
export class Transfers {
  private jobs = new Map<string, Job>()
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private conns: (id: string) => LiveConn | undefined,
    private emit: (connId: string, items: TransferInfo[]) => void,
  ) {}

  list(connId: string): TransferInfo[] {
    return [...this.jobs.values()].filter((job) => job.connId === connId).map(publicInfo)
  }

  async upload(conn: LiveConn, dir: string, locals: string[]): Promise<void> {
    const plan: PlannedFile[] = []
    for (const local of locals) {
      const stat = await fs.stat(local)
      const target = joinRemote(conn, dir, path.basename(local))
      if (stat.isDirectory()) await this.planUploadDir(conn, local, target, plan)
      else plan.push({ local, remote: target, size: stat.size })
      if (plan.length > MAX_FILES) throw new Error(tr('tooManyFiles'))
    }
    this.add(conn, 'up', plan)
  }

  async download(conn: LiveConn, remote: string, dest: string, isDir: boolean): Promise<void> {
    const plan: PlannedFile[] = []
    if (isDir) await this.planDownloadDir(conn, remote, dest, plan)
    else plan.push({ remote, local: dest, size: await remoteSize(conn, remote) })
    this.add(conn, 'down', plan)
  }

  /** Queue the files of a sync plan; target folders are created first. */
  async sync(conn: LiveConn, localDir: string, remoteDir: string, direction: 'up' | 'down', rels: string[]): Promise<void> {
    if (rels.length > MAX_FILES * 5) throw new Error(tr('tooManyFiles'))
    const plan: PlannedFile[] = []
    const made = new Set<string>()
    for (const rel of rels) {
      if (!rel || rel.split('/').some((part) => part === '..' || part === '')) throw new Error(tr('invalidPath'))
      const local = path.join(localDir, ...rel.split('/'))
      const remote = syncRemotePath(conn, remoteDir, rel)
      if (direction === 'up') {
        const parts = rel.split('/').slice(0, -1)
        for (let i = 1; i <= parts.length; i += 1) {
          const dir = syncRemotePath(conn, remoteDir, parts.slice(0, i).join('/'))
          if (made.has(dir)) continue
          made.add(dir)
          try {
            await mkdirPath(conn, dir)
          } catch {
            /* exists */
          }
        }
        plan.push({ local, remote, size: (await fs.stat(local)).size })
      } else {
        plan.push({ local, remote, size: await remoteSize(conn, remote) })
      }
    }
    this.add(conn, direction, plan)
  }

  pause(id: string): void {
    const job = this.jobs.get(id)
    if (!job || !job.pausable) return
    if (job.state === 'running') {
      job.stopAs = 'paused'
      job.abort?.abort()
    } else if (job.state === 'queued') {
      job.state = 'paused'
      this.changed(job.connId)
    }
  }

  resume(id: string): void {
    const job = this.jobs.get(id)
    if (!job || (job.state !== 'paused' && job.state !== 'failed')) return
    job.state = 'queued'
    job.error = undefined
    this.changed(job.connId)
    this.pump(job.connId)
  }

  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.state === 'running') {
      if (!job.pausable) return
      job.stopAs = 'canceled'
      job.abort?.abort()
      return
    }
    if (job.state === 'queued' || job.state === 'paused' || job.state === 'failed') {
      job.state = 'canceled'
      void this.discardPartial(job)
      this.changed(job.connId)
    }
  }

  /** Forget finished, failed and canceled rows. */
  clear(connId: string): void {
    for (const job of [...this.jobs.values()]) {
      if (job.connId === connId && (job.state === 'done' || job.state === 'canceled' || job.state === 'failed')) this.jobs.delete(job.id)
    }
    this.changed(connId)
  }

  /** The connection is gone: stop its work and forget it. */
  dropConn(connId: string): void {
    for (const job of [...this.jobs.values()]) {
      if (job.connId !== connId) continue
      if (job.state === 'running') {
        job.stopAs = 'canceled'
        job.abort?.abort()
      }
      this.jobs.delete(job.id)
    }
    clearTimeout(this.timers.get(connId))
    this.timers.delete(connId)
  }

  private add(conn: LiveConn, direction: 'up' | 'down', plan: PlannedFile[]): void {
    const pausable = conn.fileMode === 'sftp' || conn.fileMode === 'local'
    for (const file of plan) {
      const id = randomUUID()
      this.jobs.set(id, {
        id,
        connId: conn.id,
        direction,
        name: path.posix.basename(file.remote.replace(/\\/g, '/')) || file.remote,
        remote: file.remote,
        local: file.local,
        size: file.size,
        transferred: 0,
        speed: 0,
        state: 'queued',
        pausable,
        abort: null,
        stopAs: null,
        sampleAt: 0,
        sampleBytes: 0,
      })
    }
    this.changed(conn.id)
    this.pump(conn.id)
  }

  private pump(connId: string): void {
    const mine = [...this.jobs.values()].filter((job) => job.connId === connId)
    if (mine.some((job) => job.state === 'running')) return
    const next = mine.find((job) => job.state === 'queued')
    if (next) void this.run(next)
  }

  private async run(job: Job): Promise<void> {
    const conn = this.conns(job.connId)
    if (!conn || conn.disposed) {
      job.state = 'failed'
      job.error = tr('filesInactive')
      this.changed(job.connId)
      return
    }
    job.state = 'running'
    job.stopAs = null
    job.abort = new AbortController()
    job.speed = 0
    try {
      const offset = job.pausable ? await this.resumeOffset(conn, job) : 0
      job.transferred = offset
      job.sampleAt = Date.now()
      job.sampleBytes = offset
      this.changed(job.connId)
      await copy(conn, job, offset, job.abort.signal, (bytes) => this.progress(job, bytes))
      job.state = 'done'
      job.transferred = Math.max(job.transferred, job.size)
    } catch (error) {
      // pause()/cancel() set stopAs from outside while the copy was running.
      const stopped = stopReason(job)
      if (stopped) job.state = stopped
      else {
        job.state = 'failed'
        job.error = explain(error, job.direction === 'up' ? 'uploadFailed' : 'downloadFailed')
      }
    }
    job.abort = null
    job.speed = 0
    if (job.state === 'canceled') await this.discardPartial(job)
    if (this.jobs.has(job.id)) this.changed(job.connId, true)
    this.pump(job.connId)
  }

  /** Bytes already at the destination from an earlier, paused run. */
  private async resumeOffset(conn: LiveConn, job: Job): Promise<number> {
    if (job.transferred <= 0) return 0
    try {
      const have = job.direction === 'down'
        ? (await fs.stat(job.local)).size
        : conn.fileMode === 'sftp' && conn.sftp
          ? (await sftpStat(conn.sftp, job.remote)).size
          : (await fs.stat(job.remote)).size
      return Math.max(0, Math.min(have, job.size))
    } catch {
      return 0
    }
  }

  private progress(job: Job, bytes: number): void {
    job.transferred = bytes
    const now = Date.now()
    const dt = now - job.sampleAt
    if (dt >= 500) {
      const rate = ((bytes - job.sampleBytes) * 1000) / dt
      job.speed = job.speed ? job.speed * 0.6 + rate * 0.4 : rate
      job.sampleAt = now
      job.sampleBytes = bytes
    }
    this.changed(job.connId)
  }

  private async discardPartial(job: Job): Promise<void> {
    if (job.transferred <= 0 && job.state !== 'canceled') return
    const conn = this.conns(job.connId)
    try {
      if (job.direction === 'down') await fs.unlink(job.local)
      else if (conn?.fileMode === 'sftp' && conn.sftp) {
        await new Promise<void>((resolve) => conn.sftp!.unlink(job.remote, () => resolve()))
      } else if (conn?.fileMode === 'local') await fs.unlink(job.remote)
    } catch {
      /* nothing written yet */
    }
  }

  private changed(connId: string, now = false): void {
    if (now) {
      clearTimeout(this.timers.get(connId))
      this.timers.delete(connId)
      this.emit(connId, this.list(connId))
      return
    }
    if (this.timers.has(connId)) return
    this.timers.set(connId, setTimeout(() => {
      this.timers.delete(connId)
      this.emit(connId, this.list(connId))
    }, EMIT_EVERY))
  }

  private async planUploadDir(conn: LiveConn, local: string, remote: string, plan: PlannedFile[]): Promise<void> {
    try {
      await mkdirPath(conn, remote)
    } catch {
      /* already there */
    }
    for (const entry of await fs.readdir(local, { withFileTypes: true })) {
      const from = path.join(local, entry.name)
      const to = joinRemote(conn, remote, entry.name)
      if (entry.isDirectory()) await this.planUploadDir(conn, from, to, plan)
      else if (entry.isFile()) plan.push({ local: from, remote: to, size: (await fs.stat(from)).size })
      if (plan.length > MAX_FILES) throw new Error(tr('tooManyFiles'))
    }
  }

  private async planDownloadDir(conn: LiveConn, remote: string, dest: string, plan: PlannedFile[]): Promise<void> {
    await fs.mkdir(dest, { recursive: true })
    if (conn.fileMode === 'sftp' && conn.sftp) {
      for (const item of await sftpReaddir(conn.sftp, remote)) {
        if (item.filename === '.' || item.filename === '..') continue
        const from = path.posix.join(remote, item.filename)
        const to = path.join(dest, item.filename)
        if (isDirMode(item.attrs.mode)) await this.planDownloadDir(conn, from, to, plan)
        else if (!isLinkMode(item.attrs.mode)) plan.push({ remote: from, local: to, size: item.attrs.size })
        if (plan.length > MAX_FILES) throw new Error(tr('tooManyFiles'))
      }
      return
    }
    if (conn.fileMode === 'ftp' && conn.ftp) {
      for (const item of await conn.ftp.list(remote)) {
        if (item.name === '.' || item.name === '..') continue
        const from = path.posix.join(remote, item.name)
        const to = path.join(dest, item.name)
        if (item.isDirectory) await this.planDownloadDir(conn, from, to, plan)
        else if (item.isFile) plan.push({ remote: from, local: to, size: item.size })
        if (plan.length > MAX_FILES) throw new Error(tr('tooManyFiles'))
      }
      return
    }
    if (conn.fileMode === 's3' && conn.s3) {
      const prefix = s3Key(remote)
      for (const key of await s3Keys(conn.s3, prefix ? `${prefix}/` : '')) {
        if (key.endsWith('/')) continue
        const relative = key.slice(prefix ? prefix.length + 1 : 0)
        plan.push({ remote: `/${key}`, local: path.join(dest, ...relative.split('/')), size: 0 })
        if (plan.length > MAX_FILES) throw new Error(tr('tooManyFiles'))
      }
      return
    }
    for (const entry of await fs.readdir(remote, { withFileTypes: true })) {
      const from = path.join(remote, entry.name)
      const to = path.join(dest, entry.name)
      if (entry.isDirectory()) await this.planDownloadDir(conn, from, to, plan)
      else if (entry.isFile()) plan.push({ remote: from, local: to, size: (await fs.stat(from)).size })
    }
  }
}

function syncRemotePath(conn: LiveConn, root: string, rel: string): string {
  if (conn.fileMode === 'local') return path.join(root, ...rel.split('/'))
  return path.posix.join(root || '/', rel)
}

function stopReason(job: Job): Job['stopAs'] {
  return job.stopAs
}

function publicInfo(job: Job): TransferInfo {
  const { abort: _abort, stopAs: _stop, sampleAt: _at, sampleBytes: _bytes, ...info } = job
  return info
}

async function remoteSize(conn: LiveConn, remote: string): Promise<number> {
  try {
    if (conn.fileMode === 'sftp' && conn.sftp) return (await sftpStat(conn.sftp, remote)).size
    if (conn.fileMode === 'ftp' && conn.ftp) return await conn.ftp.size(remote)
    if (conn.fileMode === 'local') return (await fs.stat(remote)).size
  } catch {
    /* size unknown */
  }
  return 0
}

function counter(start: number, onBytes: (total: number) => void): Transform {
  let total = start
  return new Transform({
    transform(chunk: Buffer, _enc, callback) {
      total += chunk.length
      onBytes(total)
      callback(null, chunk)
    },
  })
}

/** Move one file. Stream-based paths honor `signal` and continue from `offset`. */
async function copy(conn: LiveConn, job: Job, offset: number, signal: AbortSignal, onBytes: (total: number) => void): Promise<void> {
  const up = job.direction === 'up'
  if (!up) await fs.mkdir(path.dirname(job.local), { recursive: true })
  if (conn.fileMode === 'sftp' && conn.sftp) {
    const sftp = conn.sftp
    const source: Readable = up ? createReadStream(job.local, { start: offset }) : sftp.createReadStream(job.remote, { start: offset })
    const sink: Writable = up
      ? sftp.createWriteStream(job.remote, { flags: offset ? 'r+' : 'w', start: offset })
      : createWriteStream(job.local, { flags: offset ? 'r+' : 'w', start: offset })
    await pipeline(source, counter(offset, onBytes), sink, { signal })
    return
  }
  if (conn.fileMode === 'local') {
    const source = createReadStream(up ? job.local : job.remote, { start: offset })
    const sink = createWriteStream(up ? job.remote : job.local, { flags: offset ? 'r+' : 'w', start: offset })
    await pipeline(source, counter(offset, onBytes), sink, { signal })
    return
  }
  if (conn.fileMode === 'ftp' && conn.ftp) {
    const ftp = conn.ftp
    ftp.trackProgress((info) => onBytes(info.bytesOverall))
    try {
      if (up) await ftp.uploadFrom(job.local, job.remote)
      else await ftp.downloadTo(job.local, job.remote)
    } finally {
      ftp.trackProgress()
    }
    return
  }
  if (conn.fileMode === 's3' && conn.s3) {
    if (up) {
      await s3Put(conn.s3, s3Key(job.remote), await fs.readFile(job.local))
    } else {
      const data = await s3Get(conn.s3, s3Key(job.remote))
      job.size = data.length
      await fs.writeFile(job.local, data)
    }
    onBytes(job.size)
    return
  }
  throw new Error(tr('noFileBrowser'))
}
