import net from 'node:net'
import type { ProxyType } from '../shared/types'
import { tr } from './i18n'

export interface ProxySpec {
  type: ProxyType
  host: string
  port: number
  user?: string
  password?: string
}

const TIMEOUT = 20000

/** Open a TCP socket to `host:port` through a SOCKS5 or HTTP CONNECT proxy. */
export function connectViaProxy(proxy: ProxySpec, host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port })
    socket.setNoDelay(true)
    socket.setTimeout(TIMEOUT)
    const reader = new ByteReader(socket)
    const fail = (error: unknown) => {
      reader.detach()
      socket.destroy()
      const message = error instanceof Error ? error.message : String(error)
      reject(new Error(tr('proxyFailed', { message })))
    }
    socket.once('timeout', () => fail(new Error(tr('timeout'))))
    socket.once('error', fail)
    socket.once('connect', () => {
      const handshake = proxy.type === 'http' ? httpConnect(socket, reader, proxy, host, port) : socks5(socket, reader, proxy, host, port)
      handshake.then(() => {
        socket.setTimeout(0)
        socket.removeListener('error', fail)
        reader.detach()
        resolve(socket)
      }, fail)
    })
  })
}

async function socks5(socket: net.Socket, reader: ByteReader, proxy: ProxySpec, host: string, port: number): Promise<void> {
  const withAuth = Boolean(proxy.user)
  socket.write(Buffer.from(withAuth ? [5, 2, 0, 2] : [5, 1, 0]))
  const hello = await reader.read(2)
  if (hello[0] !== 5) throw new Error('SOCKS version')
  if (hello[1] === 2) {
    const user = Buffer.from(proxy.user || '', 'utf8')
    const pass = Buffer.from(proxy.password || '', 'utf8')
    if (user.length > 255 || pass.length > 255) throw new Error('SOCKS credentials too long')
    socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]))
    const reply = await reader.read(2)
    if (reply[1] !== 0) throw new Error('SOCKS authentication rejected')
  } else if (hello[1] !== 0) {
    throw new Error('SOCKS method rejected')
  }
  const name = Buffer.from(host, 'utf8')
  if (name.length > 255) throw new Error('host too long')
  socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([port >> 8, port & 255])]))
  const head = await reader.read(4)
  if (head[1] !== 0) throw new Error(`SOCKS reply ${head[1]}`)
  const kind = head[3]
  const rest = kind === 1 ? 4 : kind === 4 ? 16 : (await reader.read(1))[0]
  await reader.read(rest + 2)
}

async function httpConnect(socket: net.Socket, reader: ByteReader, proxy: ProxySpec, host: string, port: number): Promise<void> {
  const target = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
  const lines = [`CONNECT ${target} HTTP/1.1`, `Host: ${target}`]
  if (proxy.user) {
    const token = Buffer.from(`${proxy.user}:${proxy.password || ''}`, 'utf8').toString('base64')
    lines.push(`Proxy-Authorization: Basic ${token}`)
  }
  socket.write(`${lines.join('\r\n')}\r\n\r\n`)
  const head = (await reader.readUntil('\r\n\r\n', 16384)).toString('latin1')
  const status = Number(head.split(' ')[1])
  if (status !== 200) throw new Error(head.split('\r\n')[0] || 'HTTP proxy refused')
}

/** Pull exact byte counts off a socket during a handshake, then hand leftovers back. */
class ByteReader {
  private buf = Buffer.alloc(0)
  private wake: (() => void) | null = null
  private closed = false
  private readonly onData = (chunk: Buffer) => {
    this.buf = Buffer.concat([this.buf, chunk])
    this.wake?.()
  }
  private readonly onEnd = () => {
    this.closed = true
    this.wake?.()
  }

  constructor(private socket: net.Socket) {
    socket.on('data', this.onData)
    socket.on('end', this.onEnd)
  }

  async read(count: number): Promise<Buffer> {
    while (this.buf.length < count) await this.more()
    const out = this.buf.subarray(0, count)
    this.buf = this.buf.subarray(count)
    return out
  }

  async readUntil(marker: string, limit: number): Promise<Buffer> {
    for (;;) {
      const at = this.buf.indexOf(marker)
      if (at >= 0) return this.read(at + marker.length)
      if (this.buf.length > limit) throw new Error('proxy reply too large')
      await this.more()
    }
  }

  detach(): void {
    this.socket.removeListener('data', this.onData)
    this.socket.removeListener('end', this.onEnd)
    this.socket.pause()
    if (this.buf.length) this.socket.unshift(this.buf)
    this.buf = Buffer.alloc(0)
  }

  private more(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('proxy closed the connection'))
    return new Promise((resolve) => {
      this.wake = () => {
        this.wake = null
        resolve()
      }
    })
  }
}
