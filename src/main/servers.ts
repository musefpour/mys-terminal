import { randomUUID } from 'node:crypto'
import dgram from 'node:dgram'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { LocalServerInfo, LocalServerKind, LocalServerOptions } from '../shared/types'
import { tr } from './i18n'

interface Running {
  info: LocalServerInfo
  close: () => void
}

/**
 * Share a folder on the LAN the way MobaXterm's "Servers" do: HTTP (read-only
 * listing), TFTP (RFC 1350) and FTP (passive mode). Every path is confined to
 * the chosen root; writes are off unless the user turns them on.
 */
export class LocalServers {
  private running = new Map<string, Running>()

  constructor(private emit: (items: LocalServerInfo[]) => void) {}

  list(): LocalServerInfo[] {
    return [...this.running.values()].map((item) => ({ ...item.info, log: [...item.info.log] }))
  }

  async start(kind: LocalServerKind, options: LocalServerOptions): Promise<LocalServerInfo> {
    const root = await fs.realpath(path.resolve(options.root))
    if (!(await fs.stat(root)).isDirectory()) throw new Error(tr('serverRootInvalid'))
    const host = options.lanAccess ? '0.0.0.0' : '127.0.0.1'
    const port = Number(options.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(tr('invalidPort'))
    const info: LocalServerInfo = {
      id: randomUUID(),
      kind,
      root,
      port,
      host,
      allowWrite: Boolean(options.allowWrite) && kind !== 'http',
      addresses: addresses(host, port, kind),
      startedAt: Date.now(),
      log: [],
    }
    const log = (line: string) => {
      info.log.push(`${new Date().toLocaleTimeString()}  ${line}`)
      if (info.log.length > 200) info.log.splice(0, info.log.length - 200)
      this.emit(this.list())
    }
    const jail = new Jail(root)
    const close = kind === 'http'
      ? await startHttp(jail, host, port, log)
      : kind === 'tftp'
        ? await startTftp(jail, host, port, info.allowWrite, log)
        : await startFtp(jail, host, port, info.allowWrite, options.user?.trim() || '', options.password || '', log)
    this.running.set(info.id, { info, close })
    log(tr('serverStarted', { address: info.addresses[0] || `${host}:${port}` }))
    return info
  }

  stop(id: string): void {
    const item = this.running.get(id)
    if (!item) return
    item.close()
    this.running.delete(id)
    this.emit(this.list())
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id)
  }
}

/** Resolves client paths inside `root`; `..`, absolute escapes and symlinks out are refused. */
export class Jail {
  constructor(readonly root: string) {}

  async resolve(clientPath: string, mustExist = true): Promise<string> {
    const clean = path.posix.normalize(`/${clientPath.replace(/\\/g, '/')}`)
    const target = path.join(this.root, ...clean.split('/').filter(Boolean))
    if (!this.contains(target)) throw new Error('outside root')
    if (!mustExist) {
      const parent = await fs.realpath(path.dirname(target))
      if (!this.contains(parent)) throw new Error('outside root')
      return target
    }
    const real = await fs.realpath(target)
    if (!this.contains(real)) throw new Error('outside root')
    return real
  }

  /** Client-facing path for a real path (always starts with "/"). */
  display(real: string): string {
    const rel = path.relative(this.root, real).split(path.sep).join('/')
    return rel ? `/${rel}` : '/'
  }

  private contains(target: string): boolean {
    const rel = path.relative(this.root, target)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  }
}

function addresses(host: string, port: number, kind: LocalServerKind): string[] {
  const scheme = kind === 'http' ? 'http' : kind
  if (host === '127.0.0.1') return [`${scheme}://127.0.0.1:${port}`]
  const out: string[] = []
  for (const rows of Object.values(networkInterfaces())) {
    for (const row of rows ?? []) {
      if (row.family === 'IPv4' && !row.internal) out.push(`${scheme}://${row.address}:${port}`)
    }
  }
  return out.length ? out : [`${scheme}://127.0.0.1:${port}`]
}

function listen(server: net.Server | http.Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(new Error(error.code === 'EACCES' ? tr('serverPortDenied', { port }) : error.code === 'EADDRINUSE' ? tr('serverPortBusy', { port }) : error.message))
    })
    server.listen(port, host, () => resolve())
  })
}

/* ───────────── HTTP: read-only folder listing ───────────── */

async function startHttp(jail: Jail, host: string, port: number, log: (line: string) => void): Promise<() => void> {
  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url || '/', 'http://local')
      const peer = req.socket.remoteAddress || '?'
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end()
        return
      }
      let real: string
      try {
        real = await jail.resolve(decodeURIComponent(url.pathname))
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found')
        log(`${peer} 404 ${url.pathname}`)
        return
      }
      const stat = await fs.stat(real)
      if (stat.isDirectory()) {
        if (!url.pathname.endsWith('/')) {
          res.writeHead(301, { Location: `${url.pathname}/` }).end()
          return
        }
        const entries = (await fs.readdir(real, { withFileTypes: true })).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        const rows = entries.map((entry) => {
          const name = entry.name + (entry.isDirectory() ? '/' : '')
          return `<li><a href="${encodeURIComponent(entry.name)}${entry.isDirectory() ? '/' : ''}">${escapeHtml(name)}</a></li>`
        })
        const title = escapeHtml(jail.display(real))
        const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:15px system-ui;margin:2rem}a{text-decoration:none}li{margin:.3rem 0}</style><h1>${title}</h1><ul>${url.pathname !== '/' ? '<li><a href="../">../</a></li>' : ''}${rows.join('')}</ul>`
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
        res.end(req.method === 'HEAD' ? undefined : body)
        log(`${peer} 200 ${url.pathname}`)
        return
      }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(real))}`,
        'X-Content-Type-Options': 'nosniff',
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      log(`${peer} GET ${url.pathname} (${stat.size} B)`)
      await pipeline(createReadStream(real), res).catch(() => undefined)
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end()
    })
  })
  await listen(server, host, port)
  return () => server.close()
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string)
}

/* ───────────── TFTP (RFC 1350, octet mode, 512-byte blocks) ───────────── */

const TFTP = { RRQ: 1, WRQ: 2, DATA: 3, ACK: 4, ERROR: 5 }
const BLOCK = 512
const RETRIES = 5
const TIMEOUT = 1500
const MAX_TFTP_FILE = BLOCK * 65535

function tftpError(code: number, message: string): Buffer {
  return Buffer.concat([Buffer.from([0, TFTP.ERROR, 0, code]), Buffer.from(message, 'ascii'), Buffer.from([0])])
}

async function startTftp(jail: Jail, host: string, port: number, allowWrite: boolean, log: (line: string) => void): Promise<() => void> {
  const main = dgram.createSocket('udp4')
  const sessions = new Set<dgram.Socket>()
  main.on('message', (msg, peer) => {
    const op = msg.readUInt16BE(0)
    const parts = msg.subarray(2).toString('latin1').split('\0')
    const file = parts[0] || ''
    const mode = (parts[1] || 'octet').toLowerCase()
    // Each transfer gets its own socket (TID), as the RFC requires.
    const sock = dgram.createSocket('udp4')
    sessions.add(sock)
    const end = () => {
      sessions.delete(sock)
      try {
        sock.close()
      } catch {
        /* closed */
      }
    }
    sock.bind(0, host === '0.0.0.0' ? undefined : host, () => {
      const send = (buf: Buffer) => sock.send(buf, peer.port, peer.address)
      // UDP send is async: close only once the error datagram is out.
      const fail = (buf: Buffer) => sock.send(buf, peer.port, peer.address, () => end())
      if (mode !== 'octet' && mode !== 'netascii') {
        fail(tftpError(4, 'Only octet mode'))
        return
      }
      if (op === TFTP.RRQ) void tftpRead(jail, file, sock, send, fail, end, `${peer.address}`, log)
      else if (op === TFTP.WRQ) {
        if (!allowWrite) {
          fail(tftpError(2, 'Uploads are disabled'))
          log(`${peer.address} WRQ ${file} refused`)
          return
        }
        void tftpWrite(jail, file, sock, send, fail, end, `${peer.address}`, log)
      } else {
        fail(tftpError(4, 'Illegal operation'))
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    main.once('error', (error: NodeJS.ErrnoException) => reject(new Error(error.code === 'EACCES' ? tr('serverPortDenied', { port }) : error.code === 'EADDRINUSE' ? tr('serverPortBusy', { port }) : error.message)))
    main.bind(port, host, () => resolve())
  })
  return () => {
    main.close()
    for (const sock of sessions) sock.close()
  }
}

async function tftpRead(jail: Jail, file: string, sock: dgram.Socket, send: (buf: Buffer) => void, fail: (buf: Buffer) => void, end: () => void, peer: string, log: (line: string) => void): Promise<void> {
  let data: Buffer
  try {
    const real = await jail.resolve(file)
    const stat = await fs.stat(real)
    if (!stat.isFile() || stat.size > MAX_TFTP_FILE) throw new Error('not a file')
    data = await fs.readFile(real)
  } catch {
    fail(tftpError(1, 'File not found'))
    log(`${peer} RRQ ${file} not found`)
    return
  }
  let block = 1
  let tries = 0
  let timer: NodeJS.Timeout
  const chunk = () => data.subarray((block - 1) * BLOCK, block * BLOCK)
  const transmit = () => {
    send(Buffer.concat([Buffer.from([0, TFTP.DATA, block >> 8, block & 255]), chunk()]))
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (++tries > RETRIES) {
        log(`${peer} RRQ ${file} timed out`)
        end()
        return
      }
      transmit()
    }, TIMEOUT)
  }
  sock.on('message', (msg) => {
    if (msg.readUInt16BE(0) !== TFTP.ACK || msg.readUInt16BE(2) !== block) return
    const last = chunk().length < BLOCK
    if (last) {
      clearTimeout(timer)
      log(`${peer} RRQ ${file} (${data.length} B)`)
      end()
      return
    }
    block += 1
    tries = 0
    transmit()
  })
  transmit()
}

async function tftpWrite(jail: Jail, file: string, sock: dgram.Socket, send: (buf: Buffer) => void, fail: (buf: Buffer) => void, end: () => void, peer: string, log: (line: string) => void): Promise<void> {
  let target: string
  try {
    target = await jail.resolve(file, false)
  } catch {
    fail(tftpError(2, 'Access violation'))
    return
  }
  const parts: Buffer[] = []
  let expected = 1
  let size = 0
  let timer: NodeJS.Timeout | undefined
  const ack = (block: number) => send(Buffer.from([0, TFTP.ACK, block >> 8, block & 255]))
  const idle = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      log(`${peer} WRQ ${file} timed out`)
      end()
    }, TIMEOUT * RETRIES)
  }
  sock.on('message', (msg) => {
    if (msg.readUInt16BE(0) !== TFTP.DATA) return
    const block = msg.readUInt16BE(2)
    if (block !== expected) {
      ack(block)
      return
    }
    const payload = msg.subarray(4)
    size += payload.length
    if (size > MAX_TFTP_FILE) {
      fail(tftpError(3, 'File too large'))
      return
    }
    parts.push(payload)
    ack(block)
    expected += 1
    idle()
    if (payload.length < BLOCK) {
      clearTimeout(timer)
      void fs.writeFile(target, Buffer.concat(parts)).then(() => log(`${peer} WRQ ${file} (${size} B)`), () => log(`${peer} WRQ ${file} failed`)).finally(end)
    }
  })
  ack(0)
  idle()
}

/* ───────────── FTP (passive mode, one user or anonymous) ───────────── */

async function startFtp(jail: Jail, host: string, port: number, allowWrite: boolean, user: string, password: string, log: (line: string) => void): Promise<() => void> {
  const clients = new Set<net.Socket>()
  const server = net.createServer((control) => {
    clients.add(control)
    control.setEncoding('utf8')
    control.on('error', () => undefined)
    control.on('close', () => clients.delete(control))
    const peer = control.remoteAddress || '?'
    let cwd = '/'
    let loginUser = ''
    let authed = false
    let renameFrom: string | null = null
    let passive: net.Server | null = null
    let dataSocket: Promise<net.Socket> | null = null
    let buffer = ''
    const reply = (code: number, text: string) => control.write(`${code} ${text}\r\n`)
    const closePassive = () => {
      passive?.close()
      passive = null
      dataSocket = null
    }
    const openPassive = async (): Promise<number> => {
      closePassive()
      const pasv = net.createServer()
      passive = pasv
      dataSocket = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('data timeout')), 15_000)
        pasv.once('connection', (socket) => {
          clearTimeout(timer)
          socket.on('error', () => undefined)
          // Only the control peer may open the data channel.
          if (socket.remoteAddress !== control.remoteAddress) {
            socket.destroy()
            reject(new Error('data peer mismatch'))
            return
          }
          resolve(socket)
          pasv.close()
        })
      })
      dataSocket.catch(() => undefined)
      await new Promise<void>((resolve) => pasv.listen(0, host, () => resolve()))
      return (pasv.address() as net.AddressInfo).port
    }
    const withData = async (work: (socket: net.Socket) => Promise<void>) => {
      if (!dataSocket) {
        reply(425, 'Use PASV or EPSV first')
        return
      }
      const pending = dataSocket
      dataSocket = null
      reply(150, 'Opening data connection')
      try {
        const socket = await pending
        await work(socket)
        reply(226, 'Transfer complete')
      } catch {
        reply(451, 'Transfer failed')
      } finally {
        closePassive()
      }
    }
    const target = (arg: string) => (arg.startsWith('/') ? arg : path.posix.join(cwd, arg || '.'))
    const needWrite = () => {
      if (allowWrite) return true
      reply(550, 'Read-only server')
      return false
    }

    const handle = async (line: string) => {
      const space = line.indexOf(' ')
      const cmd = (space < 0 ? line : line.slice(0, space)).toUpperCase()
      const arg = space < 0 ? '' : line.slice(space + 1)
      if (!authed && !['USER', 'PASS', 'QUIT', 'FEAT', 'SYST', 'OPTS', 'AUTH'].includes(cmd)) {
        reply(530, 'Please log in')
        return
      }
      try {
        switch (cmd) {
          case 'USER':
            loginUser = arg
            reply(331, 'Password required')
            return
          case 'PASS': {
            const anonymous = !user && (loginUser === 'anonymous' || loginUser === 'ftp')
            if (anonymous || (user && loginUser === user && arg === password)) {
              authed = true
              reply(230, 'Logged in')
              log(`${peer} login ${loginUser}`)
            } else {
              reply(530, 'Login incorrect')
              log(`${peer} login refused for ${loginUser}`)
            }
            return
          }
          case 'AUTH':
            reply(502, 'TLS not supported')
            return
          case 'SYST':
            reply(215, 'UNIX Type: L8')
            return
          case 'FEAT':
            control.write('211-Features\r\n EPSV\r\n PASV\r\n SIZE\r\n MDTM\r\n UTF8\r\n211 End\r\n')
            return
          case 'OPTS':
            reply(200, 'OK')
            return
          case 'NOOP':
            reply(200, 'OK')
            return
          case 'TYPE':
            reply(200, 'Type set')
            return
          case 'PWD':
            reply(257, `"${cwd}"`)
            return
          case 'CWD': {
            const real = await jail.resolve(target(arg))
            if (!(await fs.stat(real)).isDirectory()) throw new Error('not dir')
            cwd = jail.display(real)
            reply(250, 'OK')
            return
          }
          case 'CDUP':
            cwd = path.posix.dirname(cwd)
            reply(250, 'OK')
            return
          case 'PASV': {
            const dataPort = await openPassive()
            const address = control.localAddress?.replace(/^::ffff:/, '') || '127.0.0.1'
            const ip = net.isIPv4(address) ? address : '127.0.0.1'
            reply(227, `Entering Passive Mode (${ip.split('.').join(',')},${dataPort >> 8},${dataPort & 255})`)
            return
          }
          case 'EPSV':
            reply(229, `Entering Extended Passive Mode (|||${await openPassive()}|)`)
            return
          case 'LIST':
          case 'NLST': {
            const dir = await jail.resolve(target(arg.startsWith('-') ? '' : arg))
            await withData(async (socket) => {
              const entries = await fs.readdir(dir, { withFileTypes: true })
              const lines: string[] = []
              for (const entry of entries) {
                if (cmd === 'NLST') {
                  lines.push(entry.name)
                  continue
                }
                const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null)
                if (!stat) continue
                lines.push(listLine(entry.name, stat))
              }
              await new Promise<void>((resolve) => socket.end(lines.map((item) => `${item}\r\n`).join(''), () => resolve()))
            })
            return
          }
          case 'SIZE': {
            const stat = await fs.stat(await jail.resolve(target(arg)))
            reply(213, String(stat.size))
            return
          }
          case 'MDTM': {
            const stat = await fs.stat(await jail.resolve(target(arg)))
            reply(213, stat.mtime.toISOString().replace(/[-:T]/g, '').slice(0, 14))
            return
          }
          case 'RETR': {
            const real = await jail.resolve(target(arg))
            await withData(async (socket) => {
              await pipeline(createReadStream(real), socket)
            })
            log(`${peer} RETR ${target(arg)}`)
            return
          }
          case 'STOR':
          case 'APPE': {
            if (!needWrite()) return
            const real = await jail.resolve(target(arg), false)
            await withData(async (socket) => {
              await pipeline(socket, createWriteStream(real, { flags: cmd === 'APPE' ? 'a' : 'w' }))
            })
            log(`${peer} ${cmd} ${target(arg)}`)
            return
          }
          case 'MKD': {
            if (!needWrite()) return
            await fs.mkdir(await jail.resolve(target(arg), false))
            reply(257, `"${target(arg)}" created`)
            return
          }
          case 'RMD':
          case 'DELE': {
            if (!needWrite()) return
            const real = await jail.resolve(target(arg))
            if (real === jail.root) throw new Error('root')
            if (cmd === 'RMD') await fs.rmdir(real)
            else await fs.unlink(real)
            reply(250, 'Deleted')
            return
          }
          case 'RNFR':
            if (!needWrite()) return
            renameFrom = await jail.resolve(target(arg))
            reply(350, 'Ready for RNTO')
            return
          case 'RNTO': {
            if (!needWrite()) return
            if (!renameFrom) {
              reply(503, 'RNFR first')
              return
            }
            await fs.rename(renameFrom, await jail.resolve(target(arg), false))
            renameFrom = null
            reply(250, 'Renamed')
            return
          }
          case 'QUIT':
            reply(221, 'Bye')
            control.end()
            return
          default:
            reply(502, 'Command not implemented')
        }
      } catch {
        reply(550, 'Failed')
      }
    }

    let queue = Promise.resolve()
    control.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > 8192) {
        control.destroy()
        return
      }
      let at: number
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at).replace(/\r$/, '')
        buffer = buffer.slice(at + 1)
        if (line) queue = queue.then(() => handle(line))
      }
    })
    control.on('close', closePassive)
    reply(220, 'Mys Terminal FTP ready')
  })
  await listen(server, host, port)
  return () => {
    server.close()
    for (const client of clients) client.destroy()
  }
}

function listLine(name: string, stat: import('node:fs').Stats): string {
  const type = stat.isDirectory() ? 'd' : '-'
  const perms = (stat.mode & 0o777).toString(8).padStart(3, '0').split('').map((digit) => {
    const n = Number(digit)
    return `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`
  }).join('')
  const month = stat.mtime.toLocaleString('en-US', { month: 'short' })
  const day = String(stat.mtime.getDate()).padStart(2, ' ')
  const time = `${String(stat.mtime.getHours()).padStart(2, '0')}:${String(stat.mtime.getMinutes()).padStart(2, '0')}`
  return `${type}${perms} 1 owner group ${String(stat.size).padStart(12, ' ')} ${month} ${day} ${time} ${name}`
}
