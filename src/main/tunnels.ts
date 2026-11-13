import net from 'node:net'
import type { Client, ClientChannel } from 'ssh2'
import { randomUUID } from 'node:crypto'
import type { TunnelInfo, TunnelMode, TunnelTemplate } from '../shared/types'
import { tr } from './i18n'

interface Tunnel extends TunnelInfo {
  stop: () => void
}

export class Tunnels {
  private items = new Map<string, Tunnel>()

  list(connId?: string): TunnelInfo[] {
    return [...this.items.values()]
      .filter((item) => !connId || item.connId === connId)
      .map(({ id, connId: cid, mode, listenPort, targetHost, targetPort }) => ({
        id,
        connId: cid,
        mode,
        listenPort,
        targetHost,
        targetPort,
      }))
  }

  stop(id: string): void {
    const item = this.items.get(id)
    if (!item) return
    item.stop()
    this.items.delete(id)
  }

  stopConn(connId: string): void {
    for (const item of this.items.values()) {
      if (item.connId === connId) this.stop(item.id)
    }
  }

  stopAll(): void {
    for (const id of [...this.items.keys()]) this.stop(id)
  }

  async start(connId: string, client: Client, template: TunnelTemplate): Promise<TunnelInfo> {
    if (this.items.size > 32) throw new Error(tr('tooManyTunnels'))
    const id = template.id || randomUUID()
    const mode = template.mode
    const listenPort = Number(template.listenPort)
    const targetHost = template.targetHost?.trim() || '127.0.0.1'
    const targetPort = Number(template.targetPort) || 0
    const bind = sanitizeBind(template.bindAddress)
    if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
      throw new Error(tr('invalidListen'))
    }
    if (mode !== 'dynamic' && (!targetHost || targetPort < 1 || targetPort > 65535)) {
      throw new Error(tr('invalidTunnelTarget'))
    }

    if (mode === 'local') {
      const server = await listenLocal(listenPort, bind, (socket) => {
        client.forwardOut(
          socket.remoteAddress || '127.0.0.1',
          socket.remotePort || 0,
          targetHost,
          targetPort,
          (error, stream) => pipeOrClose(error, stream, socket),
        )
      })
      return this.track({ id, connId, mode, listenPort, targetHost, targetPort, stop: () => server.close() })
    }

    if (mode === 'dynamic') {
      const server = await listenSocks(listenPort, bind, client)
      return this.track({
        id,
        connId,
        mode,
        listenPort,
        targetHost: '',
        targetPort: 0,
        stop: () => server.close(),
      })
    }

    await forwardIn(client, listenPort, bind)
    const onTcp = (info: { destPort: number }, accept: () => ClientChannel, reject: () => void) => {
      if (info.destPort !== listenPort) return
      const stream = accept()
      const socket = net.connect(targetPort, targetHost)
      socket.on('error', () => stream.end())
      stream.on('error', () => socket.destroy())
      stream.pipe(socket)
      socket.pipe(stream)
    }
    client.on('tcp connection', onTcp)
    return this.track({
      id,
      connId,
      mode,
      listenPort,
      targetHost,
      targetPort,
      stop: () => {
        client.removeListener('tcp connection', onTcp)
        client.unforwardIn(bind, listenPort, () => undefined)
      },
    })
  }

  private track(tunnel: Tunnel): TunnelInfo {
    this.items.set(tunnel.id, tunnel)
    const { stop: _stop, ...info } = tunnel
    return info
  }
}

function sanitizeBind(value?: string): string {
  const raw = (value || '').trim() || '127.0.0.1'
  if (raw === '*' || raw === '0.0.0.0') return '0.0.0.0'
  if (/^[\d.a-fA-F:]+$/.test(raw) || raw === 'localhost') return raw === 'localhost' ? '127.0.0.1' : raw
  return '127.0.0.1'
}

function listenLocal(port: number, bind: string, onSocket: (socket: net.Socket) => void): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(onSocket)
    server.once('error', reject)
    server.listen(port, bind, () => resolve(server))
  })
}

function forwardIn(client: Client, port: number, bind: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.forwardIn(bind, port, (error) => (error ? reject(error) : resolve()))
  })
}

function pipeOrClose(error: Error | undefined, stream: ClientChannel | undefined, socket: net.Socket): void {
  if (error || !stream) {
    socket.end()
    return
  }
  socket.pipe(stream)
  stream.pipe(socket)
  stream.on('close', () => socket.end())
  socket.on('close', () => stream.end())
  stream.on('error', () => socket.destroy())
  socket.on('error', () => stream.end())
}

function listenSocks(port: number, bind: string, client: Client): Promise<net.Server> {
  return listenLocal(port, bind, (socket) => {
    let stage = 0
    let buf = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      if (stage === 0) {
        if (buf.length < 2) return
        const methods = buf[1]
        if (buf.length < 2 + methods) return
        buf = buf.subarray(2 + methods)
        socket.write(Buffer.from([0x05, 0x00]))
        stage = 1
      }
      if (stage !== 1 || buf.length < 4) return
      const atyp = buf[3]
      let host = ''
      let offset = 4
      if (atyp === 1) {
        if (buf.length < 10) return
        host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`
        offset = 8
      } else if (atyp === 3) {
        const len = buf[4]
        if (buf.length < 5 + len + 2) return
        host = buf.subarray(5, 5 + len).toString('utf8')
        offset = 5 + len
      } else if (atyp === 4) {
        if (buf.length < 22) return
        const parts: string[] = []
        for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(4 + i).toString(16))
        host = parts.join(':')
        offset = 20
      } else {
        socket.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
        return
      }
      const destPort = buf.readUInt16BE(offset)
      socket.off('data', onData)
      client.forwardOut('127.0.0.1', 0, host, destPort, (error, stream) => {
        if (error || !stream) {
          socket.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
          return
        }
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
        stream.pipe(socket)
        socket.pipe(stream)
        stream.on('close', () => socket.end())
        socket.on('close', () => stream.end())
      })
    }
    socket.on('data', onData)
    socket.on('error', () => socket.destroy())
  })
}

export type { TunnelMode }
