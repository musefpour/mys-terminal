import { promises as fs, constants as fsc } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { Server, utils, type ServerChannel, type SFTPWrapper } from 'ssh2'

const { STATUS_CODE, OPEN_MODE } = utils.sftp

export const hostKey = utils.generateKeyPairSync('ed25519').private

export function listen(server: { listen: (port: number, host: string, cb: () => void) => unknown; address: () => unknown }): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
  })
}

export interface TargetOptions {
  /** Root directory served over SFTP. */
  root: string
  /** Delay per SFTP READ/WRITE so tests can pause mid-file. */
  ioDelayMs?: number
  /** Output for the server-monitor command; called once per sample. */
  monitor?: () => string
}

/** SSH server with password "pw": exec wrapper reports a PID, readlink answers a cwd, SFTP serves `root`. */
export function targetServer(options: TargetOptions) {
  const shells: ServerChannel[] = []
  const sockets: net.Socket[] = []
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('error', () => undefined)
    client.on('authentication', (ctx) => (ctx.method === 'password' && ctx.password === 'pw' ? ctx.accept() : ctx.reject(['password'])))
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        session.on('pty', (ok) => ok?.())
        session.on('env', (ok) => ok?.())
        session.on('exec', (ok, _reject, info) => {
          const stream = ok()
          if (info.command.startsWith('readlink /proc/4242/cwd')) {
            stream.write('/srv/data\n')
            stream.exit(0)
            stream.end()
          } else if (info.command.includes('/proc/stat')) {
            stream.write(options.monitor?.() ?? '')
            stream.exit(0)
            stream.end()
          } else if (info.command.includes('mys-pid')) {
            stream.write('\x1b]7337;mys-pid=4242\x07hello from target\r\n')
            shells.push(stream)
          } else {
            stream.exit(1)
            stream.end()
          }
        })
        session.on('sftp', (acceptSftp) => serveSftp(acceptSftp(), options.root, options.ioDelayMs ?? 0))
      })
    })
  })
  ;(server as unknown as { _srv: net.Server })._srv.on('connection', (socket: net.Socket) => sockets.push(socket))
  return { server, shells, sockets }
}

/** Jump host: user "hop" / "hp", relays direct-tcpip channels. */
export function jumpServer() {
  const state = { forwards: 0 }
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('error', () => undefined)
    client.on('authentication', (ctx) => (ctx.method === 'password' && ctx.username === 'hop' && ctx.password === 'hp' ? ctx.accept() : ctx.reject(['password'])))
    client.on('ready', () => {
      client.on('tcpip', (accept, _reject, info) => {
        state.forwards += 1
        const upstream = net.connect(info.destPort, info.destIP, () => {
          const channel = accept()
          channel.pipe(upstream).pipe(channel)
        })
        upstream.on('error', () => undefined)
      })
    })
  })
  return { server, state }
}

/** SOCKS5 proxy that requires user "su" / "sp". */
export function socksProxy() {
  const state = { used: 0 }
  const server = net.createServer((sock) => {
    sock.on('error', () => undefined)
    let stage = 0
    let buf = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      if (stage === 0 && buf.length >= 2 && buf.length >= 2 + buf[1]) {
        const methods = [...buf.subarray(2, 2 + buf[1])]
        buf = buf.subarray(2 + buf[1])
        sock.write(Buffer.from([5, methods.includes(2) ? 2 : 0xff]))
        stage = 1
      }
      if (stage === 1 && buf.length >= 2) {
        const ulen = buf[1]
        if (buf.length < 3 + ulen) return
        const plen = buf[2 + ulen]
        if (buf.length < 3 + ulen + plen) return
        const user = buf.subarray(2, 2 + ulen).toString()
        const pass = buf.subarray(3 + ulen, 3 + ulen + plen).toString()
        buf = buf.subarray(3 + ulen + plen)
        sock.write(Buffer.from([1, user === 'su' && pass === 'sp' ? 0 : 1]))
        stage = 2
      }
      if (stage === 2 && buf.length >= 5) {
        const len = buf[4]
        if (buf.length < 7 + len) return
        const host = buf.subarray(5, 5 + len).toString()
        const port = buf.readUInt16BE(5 + len)
        const rest = buf.subarray(7 + len)
        stage = 3
        sock.removeListener('data', onData)
        state.used += 1
        const up = net.connect(port, host, () => {
          sock.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
          if (rest.length) up.write(rest)
          sock.pipe(up).pipe(sock)
        })
        up.on('error', () => undefined)
      }
    }
    sock.on('data', onData)
  })
  return { server, state }
}

export function httpProxy() {
  const state = { used: 0 }
  const server = net.createServer((sock) => {
    sock.on('error', () => undefined)
    let head = ''
    const onData = (chunk: Buffer) => {
      head += chunk.toString('latin1')
      if (!head.includes('\r\n\r\n')) return
      sock.removeListener('data', onData)
      const [host, port] = head.split(' ')[1].split(':')
      state.used += 1
      const up = net.connect(Number(port), host, () => {
        sock.write('HTTP/1.1 200 Connection established\r\n\r\n')
        sock.pipe(up).pipe(sock)
      })
      up.on('error', () => undefined)
    }
    sock.on('data', onData)
  })
  return { server, state }
}

/* Minimal SFTP v3 server over a real directory — enough for ssh2's streams, stat and readdir. */
function serveSftp(sftp: SFTPWrapper, root: string, delay: number): void {
  const handles = new Map<number, { fh?: fs.FileHandle; dir?: string[]; done?: boolean; path: string }>()
  let next = 1
  const local = (p: string) => path.join(root, path.posix.normalize(`/${p}`))
  const handleOf = (buf: Buffer) => handles.get(buf.readUInt32BE(0))
  const newHandle = (entry: { fh?: fs.FileHandle; dir?: string[]; path: string }) => {
    const id = next++
    handles.set(id, entry)
    const buf = Buffer.alloc(4)
    buf.writeUInt32BE(id)
    return buf
  }
  const wait = () => (delay ? new Promise((r) => setTimeout(r, delay)) : Promise.resolve())
  const attrsOf = (stat: import('node:fs').Stats) => ({ mode: stat.mode, uid: 0, gid: 0, size: stat.size, atime: Math.floor(stat.atimeMs / 1000), mtime: Math.floor(stat.mtimeMs / 1000) })
  const fail = (reqid: number, error: unknown) => {
    const code = (error as NodeJS.ErrnoException)?.code
    try {
      sftp.status(reqid, code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE)
    } catch {
      /* channel already gone */
    }
  }

  sftp.on('OPEN', async (reqid, filename, flags) => {
    let mode = 0
    if (flags & OPEN_MODE.READ && flags & OPEN_MODE.WRITE) mode = fsc.O_RDWR
    else if (flags & OPEN_MODE.WRITE) mode = fsc.O_WRONLY
    else mode = fsc.O_RDONLY
    if (flags & OPEN_MODE.CREAT) mode |= fsc.O_CREAT
    if (flags & OPEN_MODE.TRUNC) mode |= fsc.O_TRUNC
    if (flags & OPEN_MODE.APPEND) mode |= fsc.O_APPEND
    try {
      const fh = await fs.open(local(filename), mode, 0o644)
      sftp.handle(reqid, newHandle({ fh, path: filename }))
    } catch (error) {
      fail(reqid, error)
    }
  })
  sftp.on('READ', async (reqid, handle, offset, length) => {
    const entry = handleOf(handle)
    if (!entry?.fh) return sftp.status(reqid, STATUS_CODE.FAILURE)
    await wait()
    try {
      const buf = Buffer.alloc(length)
      const { bytesRead } = await entry.fh.read(buf, 0, length, offset)
      if (!bytesRead) return sftp.status(reqid, STATUS_CODE.EOF)
      sftp.data(reqid, buf.subarray(0, bytesRead))
    } catch (error) {
      // The client may close the handle while a delayed read is pending (pause/cancel).
      fail(reqid, error)
    }
  })
  sftp.on('WRITE', async (reqid, handle, offset, data) => {
    const entry = handleOf(handle)
    if (!entry?.fh) return sftp.status(reqid, STATUS_CODE.FAILURE)
    await wait()
    try {
      await entry.fh.write(data, 0, data.length, offset)
      sftp.status(reqid, STATUS_CODE.OK)
    } catch (error) {
      fail(reqid, error)
    }
  })
  sftp.on('CLOSE', async (reqid, handle) => {
    const id = handle.readUInt32BE(0)
    await handles.get(id)?.fh?.close().catch(() => undefined)
    handles.delete(id)
    sftp.status(reqid, STATUS_CODE.OK)
  })
  sftp.on('FSTAT', async (reqid, handle) => {
    const entry = handleOf(handle)
    if (!entry?.fh) return sftp.status(reqid, STATUS_CODE.FAILURE)
    sftp.attrs(reqid, attrsOf(await entry.fh.stat()))
  })
  const stat = async (reqid: number, p: string) => {
    try {
      sftp.attrs(reqid, attrsOf(await fs.stat(local(p))))
    } catch (error) {
      fail(reqid, error)
    }
  }
  sftp.on('STAT', stat)
  sftp.on('LSTAT', stat)
  sftp.on('FSETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK))
  sftp.on('SETSTAT', async (reqid, p, attrs) => {
    try {
      if (attrs.mode !== undefined) await fs.chmod(local(p), attrs.mode)
      sftp.status(reqid, STATUS_CODE.OK)
    } catch (error) {
      fail(reqid, error)
    }
  })
  sftp.on('REALPATH', (reqid, p) => {
    const resolved = path.posix.normalize(`/${p === '.' ? '' : p}`)
    sftp.name(reqid, [{ filename: resolved, longname: resolved, attrs: {} as never }])
  })
  sftp.on('OPENDIR', async (reqid, p) => {
    try {
      const names = await fs.readdir(local(p))
      sftp.handle(reqid, newHandle({ dir: names, path: p }))
    } catch (error) {
      fail(reqid, error)
    }
  })
  sftp.on('READDIR', async (reqid, handle) => {
    const entry = handleOf(handle)
    if (!entry?.dir) return sftp.status(reqid, STATUS_CODE.FAILURE)
    if (entry.done) return sftp.status(reqid, STATUS_CODE.EOF)
    entry.done = true
    const items = await Promise.all(entry.dir.map(async (name) => {
      const st = await fs.lstat(path.join(local(entry.path), name))
      return { filename: name, longname: name, attrs: attrsOf(st) }
    }))
    sftp.name(reqid, items)
  })
  sftp.on('REMOVE', async (reqid, p) => {
    try {
      await fs.unlink(local(p))
      sftp.status(reqid, STATUS_CODE.OK)
    } catch (error) {
      fail(reqid, error)
    }
  })
  sftp.on('MKDIR', async (reqid, p) => {
    try {
      await fs.mkdir(local(p))
      sftp.status(reqid, STATUS_CODE.OK)
    } catch (error) {
      fail(reqid, error)
    }
  })
  sftp.on('RMDIR', async (reqid, p) => {
    try {
      await fs.rmdir(local(p))
      sftp.status(reqid, STATUS_CODE.OK)
    } catch (error) {
      fail(reqid, error)
    }
  })
}
